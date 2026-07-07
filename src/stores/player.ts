import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { PlaybackEngine, PlaybackSession } from '@/core/media/PlaybackEngine'
import { createCockpitPlaybackEngine } from '@/adapters/cockpitPlayback'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'
import { resolveEncoder } from '@/core/media/encoder'
import { parseTracks, type AudioTrack, type SubtitleTrack } from '@/core/media/tracks'
import { probeStreams } from '@/adapters/cockpitProbe'
import { playbackUrl } from '@/core/media/streamUrl'

interface PlayerDeps {
  engine: PlaybackEngine
  sleep?: (ms: number) => Promise<void>
  probe?: (account: Account, item: ContentItem) => Promise<{ audio: AudioTrack[]; subtitles: SubtitleTrack[] }>
}

const SETTLE_MS = 700

// One Slot per account: the SAME mutex+gen single-flight that used to guard ONE global session
// now guards each account's session independently — for any ONE account, ≤1 session is ever
// alive (maxActive-per-account===1); different accounts are fully independent and may each have
// a live session concurrently. No action on account A may ever touch account B's slot or `_mx`.
export interface Slot {
  accountId: string
  account: Account
  status: 'idle' | 'starting' | 'playing' | 'error'
  error: string
  item: ContentItem | null
  session: PlaybackSession | null
  duration: number | null
  startOffset: number
  transcode: boolean
  currentCodec: 'copy' | 'nvenc' | 'x264' // codec the ACTIVE session is using
  _forceSoftware: boolean // sticky once nvenc fails (start or mid-stream) → stay on x264 for this item
  audioTracks: AudioTrack[]
  subtitleTracks: SubtitleTrack[]
  selectedAudio: number
  selectedSubtitle: number | null
  minimized: boolean
  // Concurrency guard (non-reactive): `lock` serialises play/seek/stop/fail so their async
  // bodies never interleave, and `gen` supersedes an in-flight op when a newer one starts.
  // Together these keep THIS account at exactly ONE connection — no two sessions ever overlap.
  _mx: { lock: Promise<unknown>; gen: number }
}

function emptySlot(account: Account): Slot {
  return {
    accountId: account.id,
    account,
    status: 'idle',
    error: '',
    item: null,
    session: null,
    duration: null,
    startOffset: 0,
    transcode: false,
    currentCodec: 'copy',
    _forceSoftware: false,
    audioTracks: [],
    subtitleTracks: [],
    selectedAudio: 0,
    selectedSubtitle: null,
    minimized: false,
    _mx: markRaw({ lock: Promise.resolve() as Promise<unknown>, gen: 0 }),
  }
}

// Stable fallback for `activeSlot` when there is no active account (e.g. no tabs open) — never
// inserted into `slots`, so it's never a target of play/stop/seek/etc.
const IDLE_SLOT: Slot = emptySlot({ id: '', type: 'xtream', name: '', url: '', username: '', password: '', createdAt: 0 })

export const usePlayerStore = defineStore('player', {
  state: () => ({
    slots: {} as Record<string, Slot>,
    _deps: null as PlayerDeps | null,
  }),
  getters: {
    // The slot for the currently active tab (or the idle sentinel if there is none).
    activeSlot(state): Slot {
      const id = useWorkspaceStore().activeAccount?.id
      return (id ? state.slots[id] : undefined) ?? IDLE_SLOT
    },
    // Every slot with a live/starting/error session — drives PlayerHost's v-for.
    playingSlots(state): Slot[] {
      return Object.values(state.slots).filter((s) => s.status !== 'idle')
    },
    anyPlaying(): boolean {
      return this.playingSlots.length > 0
    },
    // Back-compat proxies for consumers that used to read the single global session — they now
    // read the ACTIVE account's slot (matches prior single-player UX for non-PlayerView callers).
    status(): Slot['status'] { return this.activeSlot.status },
    error(): string { return this.activeSlot.error },
    item(): ContentItem | null { return this.activeSlot.item },
    session(): PlaybackSession | null { return this.activeSlot.session },
    account(): Account { return this.activeSlot.account },
    duration(): number | null { return this.activeSlot.duration },
    startOffset(): number { return this.activeSlot.startOffset },
    transcode(): boolean { return this.activeSlot.transcode },
    currentCodec(): Slot['currentCodec'] { return this.activeSlot.currentCodec },
    minimized(): boolean { return this.activeSlot.minimized },
    audioTracks(): AudioTrack[] { return this.activeSlot.audioTracks },
    subtitleTracks(): SubtitleTrack[] { return this.activeSlot.subtitleTracks },
    selectedAudio(): number { return this.activeSlot.selectedAudio },
    selectedSubtitle(): number | null { return this.activeSlot.selectedSubtitle },
  },
  actions: {
    $configure(deps: PlayerDeps) {
      this._deps = deps
    },
    async _engine(): Promise<PlaybackEngine> {
      if (!this._deps) this._deps = { engine: await createCockpitPlaybackEngine() }
      return this._deps.engine
    },
    async sleep(ms: number): Promise<void> {
      if (this._deps?.sleep) return this._deps.sleep(ms)
      return new Promise((resolve) => setTimeout(resolve, ms))
    },
    // Get-or-create the slot for `account`, assigning it into the reactive `slots` map so its
    // fields (status/item/minimized/…) stay reactive for the UI.
    _slot(account: Account): Slot {
      // Must return the store's REACTIVE proxy, not the raw object. `x ??= y` returns the raw RHS
      // (`y`), so mutating that would bypass reactivity (playingSlots/UI never update). Read it back.
      if (!this.slots[account.id]) this.slots[account.id] = emptySlot(account)
      return this.slots[account.id]
    },
    // Run `fn` with exclusive access on THIS slot only — bodies queued here execute strictly one
    // at a time, per account. Slot B's queue is entirely separate.
    _exclusive<T>(slot: Slot, fn: () => Promise<T>): Promise<T> {
      const run = slot._mx.lock.then(fn, fn) as Promise<T>
      slot._mx.lock = run.then(() => {}, () => {})
      return run
    },
    // Which codec the NEXT start() should request for THIS slot: 'copy' unless we're in a
    // transcode session, in which case resolve GPU/CPU from Settings (mode + last encoder probe).
    _resolveVideoCodec(slot: Slot): 'copy' | 'nvenc' | 'x264' {
      if (!slot.transcode) return 'copy'
      if (slot._forceSoftware) return 'x264' // nvenc already failed for this item — don't retry it
      const settings = useSettingsStore()
      return resolveEncoder(settings.transcodeMode, settings.encoderTest)
    },
    // Resolve the track-discovery dep (injected in tests) or the real ffprobe-backed default.
    // Pure per-call — not slot-specific.
    async _probe(account: Account, item: ContentItem): Promise<{ audio: AudioTrack[]; subtitles: SubtitleTrack[] }> {
      if (this._deps?.probe) return this._deps.probe(account, item)
      return parseTracks(await probeStreams(playbackUrl(account, item) ?? ''))
    },
    // Start the session, and if an nvenc attempt throws, retry ONCE with x264 before surfacing
    // the error — a runtime GPU failure (driver/session-limit/etc.) shouldn't strand playback.
    async _startWithFallback(slot: Slot, account: Account, item: ContentItem, opts: { bufferSeconds?: number; startOffsetSeconds?: number; videoCodec?: 'copy' | 'nvenc' | 'x264'; audioIndex?: number; subtitleIndex?: number | null }): Promise<PlaybackSession> {
      const engine = await this._engine()
      try {
        return await engine.start(account, item, opts)
      } catch (e) {
        if (opts.videoCodec === 'nvenc') {
          slot._forceSoftware = true // stick to software for this item (incl. later seeks)
          return engine.start(account, item, { ...opts, videoCodec: 'x264' })
        }
        throw e
      }
    },
    async play(account: Account, item: ContentItem, opts?: { durationSeconds?: number | null; startOffsetSeconds?: number }) {
      const slot = this._slot(account)
      const gen = ++slot._mx.gen
      await this._exclusive(slot, async () => {
        if (gen !== slot._mx.gen) return // superseded before we got the lock
        if (slot.session) { const s = slot.session; slot.session = null; await s.stop() }
        slot.account = account // refresh to the latest Account object for this id (creds/URL may have been edited); _restart reads slot.account
        slot.status = 'starting'
        slot.error = ''
        slot.item = item
        slot.duration = opts?.durationSeconds ?? null
        slot.startOffset = opts?.startOffsetSeconds ?? 0
        slot.transcode = false
        slot._forceSoftware = false
        slot.currentCodec = 'copy'
        slot.selectedAudio = 0
        slot.selectedSubtitle = null
        slot.audioTracks = []
        slot.subtitleTracks = []
        slot.minimized = false
        try {
          const bufferSeconds = useSettingsStore().bufferSeconds
          // Track discovery runs ffprobe = a SECOND connection to the source. To honour the panel's
          // 1-connection-per-account limit (exceeding it stalls the feed / risks a ban), NEVER hold
          // two at once for this account:
          //  • LIVE: skip discovery entirely — a concurrent ffprobe races the curl→FIFO feed and the
          //    panel cuts curl (playback stalls after the initial burst ~20s). Live rarely has tracks.
          //  • VOD: probe BEFORE opening the playback connection (sequential), so the probe connection
          //    has closed by the time ffmpeg connects. Costs a moment before start; keeps 1 connection.
          // Best-effort: playback proceeds on defaults if discovery fails; the gen guard drops a probe
          // superseded by a newer play().
          if (item.kind !== 'live') {
            try {
              const t = await this._probe(account, item)
              if (gen === slot._mx.gen) { slot.audioTracks = t.audio; slot.subtitleTracks = t.subtitles }
            } catch { /* discovery is best-effort — start playback regardless */ }
            if (gen !== slot._mx.gen) return // superseded during discovery
          }
          const session = await this._startWithFallback(slot, account, item, { bufferSeconds, startOffsetSeconds: slot.startOffset, videoCodec: this._resolveVideoCodec(slot), audioIndex: slot.selectedAudio, subtitleIndex: slot.selectedSubtitle })
          if (gen !== slot._mx.gen) { await session.stop(); return } // superseded while starting
          slot.session = session
          slot.currentCodec = this._resolveVideoCodec(slot)
          slot.status = 'playing'
        } catch (e) {
          if (gen === slot._mx.gen) {
            slot.status = 'error'
            slot.error = e instanceof Error ? e.message : String(e)
            slot.session = null
          }
        }
      })
    },
    // Shared restart body (DRY): stop the current session → settle → start again at a new offset,
    // optionally flipping transcode/forceSoftware on first. Used by seek/retryWithTranscode/
    // fallbackToSoftware/_restartCurrent — byte-identical single-flight discipline for all four.
    async _restart(slot: Slot, opts: { offsetSeconds: number; setTranscode?: boolean; forceSoftware?: boolean }) {
      const gen = ++slot._mx.gen
      await this._exclusive(slot, async () => {
        if (gen !== slot._mx.gen) return // a newer seek/play/stop replaced this one
        const { account, item } = slot
        if (!account || !item) return
        if (opts.setTranscode) slot.transcode = true
        if (opts.forceSoftware) slot._forceSoftware = true
        const bufferSeconds = useSettingsStore().bufferSeconds
        const s = slot.session
        slot.session = null
        if (s) await s.stop() // release the one connection first
        await this.sleep(SETTLE_MS) // let the panel see the drop before reconnecting
        if (gen !== slot._mx.gen) return // superseded during settle → the newer op will start
        try {
          const session = await this._startWithFallback(slot, account, item, { bufferSeconds, startOffsetSeconds: opts.offsetSeconds, videoCodec: this._resolveVideoCodec(slot), audioIndex: slot.selectedAudio, subtitleIndex: slot.selectedSubtitle })
          if (gen !== slot._mx.gen) { await session.stop(); return }
          slot.session = session
          slot.startOffset = opts.offsetSeconds
          slot.currentCodec = this._resolveVideoCodec(slot)
          slot.status = 'playing'
        } catch (e) {
          if (gen === slot._mx.gen) {
            slot.status = 'error'
            slot.error = e instanceof Error ? e.message : String(e)
            slot.session = null
          }
        }
      })
    },
    // Seek restarts the VOD session (for this account) at `toSeconds`. Only the latest of any
    // concurrent seeks runs to completion (older ones are superseded by `gen` and no-op); the
    // winner always tears the current session down (releasing the one connection) and settles
    // before reconnecting.
    async seek(toSeconds: number, account: Account | null = useWorkspaceStore().activeAccount) {
      if (!account) return
      const slot = this._slot(account)
      if (!slot.item || slot.duration == null) return
      const target = Math.max(0, Math.min(toSeconds, slot.duration))
      await this._restart(slot, { offsetSeconds: target })
    },
    // Restart the CURRENT item, at the CURRENT offset, forcing a transcode — used when the
    // player detects the source can't be decoded as-is (e.g. HEVC). Mirrors seek()'s single-flight
    // restart exactly (same mutex+gen discipline), so it can never overlap a play/seek/stop.
    async retryWithTranscode(account: Account | null = useWorkspaceStore().activeAccount) {
      if (!account) return
      const slot = this._slot(account)
      if (!slot.item) return
      if (useSettingsStore().transcodeMode === 'off') {
        slot.error = 'Transcoding is turned off in Settings'
        slot.status = 'error'
        return
      }
      await this._restart(slot, { offsetSeconds: slot.startOffset, setTranscode: true })
    },
    // Mid-stream / runtime GPU failure recovery: if the active session is transcoding on nvenc and
    // it fails after start, restart on software (x264). Sticky (_forceSoftware) so seeks stay on
    // software too. Same single-flight discipline as seek/retry — never overlaps another op.
    async fallbackToSoftware(account: Account | null = useWorkspaceStore().activeAccount) {
      if (!account) return
      const slot = this._slot(account)
      if (!slot.item || !slot.transcode || slot.currentCodec !== 'nvenc') return
      await this._restart(slot, { offsetSeconds: slot.startOffset, forceSoftware: true })
    },
    // Restart the CURRENT item at the CURRENT offset with a new audio/subtitle selection
    // (setAudioTrack/setSubtitle). Same single-flight discipline as the other restarts, so it can
    // never overlap a play/seek/stop/retry/fallback, and always leaves exactly one connection alive.
    async _restartCurrent(slot: Slot) {
      if (!slot.item) return
      await this._restart(slot, { offsetSeconds: slot.startOffset })
    },
    async setAudioTrack(i: number, account: Account | null = useWorkspaceStore().activeAccount) {
      if (!account) return
      const slot = this._slot(account)
      slot.selectedAudio = i
      await this._restartCurrent(slot)
    },
    async setSubtitle(i: number | null, account: Account | null = useWorkspaceStore().activeAccount) {
      if (!account) return
      const slot = this._slot(account)
      slot.selectedSubtitle = i
      await this._restartCurrent(slot)
    },
    async stop(account: Account | null = useWorkspaceStore().activeAccount) {
      if (!account) return
      const slot = this._slot(account)
      ++slot._mx.gen // supersede any in-flight play/seek so it won't start a session
      await this._exclusive(slot, async () => {
        const s = slot.session
        slot.session = null
        slot.item = null
        slot.status = 'idle'
        slot.error = ''
        slot.duration = null
        slot.startOffset = 0
        slot.transcode = false
        slot._forceSoftware = false
        slot.currentCodec = 'copy'
        slot.audioTracks = []
        slot.subtitleTracks = []
        slot.selectedAudio = 0
        slot.selectedSubtitle = null
        slot.minimized = false
        if (s) await s.stop()
      })
    },
    // Fatal playback failure: kill the ffmpeg session but keep the overlay showing the error.
    async fail(message: string, account: Account | null = useWorkspaceStore().activeAccount) {
      if (!account) return
      const slot = this._slot(account)
      ++slot._mx.gen
      await this._exclusive(slot, async () => {
        const s = slot.session
        slot.session = null
        slot.status = 'error'
        slot.error = message
        slot.duration = null
        slot.startOffset = 0
        slot.transcode = false
        slot._forceSoftware = false
        slot.currentCodec = 'copy'
        slot.audioTracks = []
        slot.subtitleTracks = []
        slot.selectedAudio = 0
        slot.selectedSubtitle = null
        if (s) await s.stop()
      })
    },
    // Minimize/restore are pure UI toggles — they never touch `_mx`/session, so they can never
    // race or interfere with the connection-leak-sensitive single-flight above.
    minimize(account: Account | null = useWorkspaceStore().activeAccount) {
      if (!account) return
      this._slot(account).minimized = true
    },
    restore(account: Account | null = useWorkspaceStore().activeAccount) {
      if (!account) return
      this._slot(account).minimized = false
    },
  },
})
