import { defineStore } from 'pinia'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { PlaybackEngine, PlaybackSession } from '@/core/media/PlaybackEngine'
import { createCockpitPlaybackEngine } from '@/adapters/cockpitPlayback'
import { useSettingsStore } from '@/stores/settings'

interface PlayerDeps { engine: PlaybackEngine; sleep?: (ms: number) => Promise<void> }

const SETTLE_MS = 700

export const usePlayerStore = defineStore('player', {
  state: () => ({
    status: 'idle' as 'idle' | 'starting' | 'playing' | 'error',
    error: '',
    item: null as ContentItem | null,
    session: null as PlaybackSession | null,
    duration: null as number | null,
    startOffset: 0,
    account: null as Account | null,
    _pendingSeek: null as number | null,
    _seeking: false,
    _deps: null as PlayerDeps | null,
  }),
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
    async play(account: Account, item: ContentItem, opts?: { durationSeconds?: number | null }) {
      if (this.session) await this.stop()
      this.status = 'starting'
      this.error = ''
      this.item = item
      this.account = account
      this.duration = opts?.durationSeconds ?? null
      this.startOffset = 0
      try {
        const engine = await this._engine()
        const bufferSeconds = useSettingsStore().bufferSeconds
        this.session = await engine.start(account, item, { bufferSeconds, startOffsetSeconds: 0 })
        this.status = 'playing'
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        this.session = null
      }
    },
    // Coalesced single-flight seek: restarts the VOD session at `toSeconds`. If a seek is
    // already in flight, the new target simply replaces `_pendingSeek` (latest wins) — the
    // in-flight loop below picks it up next iteration, so the panel never sees two overlapping
    // connections. Order is always stop -> settle -> start (never start before the old session
    // has been torn down).
    async seek(toSeconds: number) {
      if (!this.account || !this.item || this.duration == null) return
      this._pendingSeek = Math.max(0, Math.min(toSeconds, this.duration))
      if (this._seeking) return
      this._seeking = true
      try {
        while (this._pendingSeek != null) {
          const target = this._pendingSeek
          this._pendingSeek = null
          const bufferSeconds = useSettingsStore().bufferSeconds
          const s = this.session
          this.session = null
          if (s) await s.stop() // release the one connection
          await this.sleep(SETTLE_MS) // let the panel see the drop before reconnecting
          const engine = await this._engine()
          this.session = await engine.start(this.account, this.item, { bufferSeconds, startOffsetSeconds: target })
          this.startOffset = target
          this.status = 'playing'
        }
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        this.session = null
      } finally {
        this._seeking = false
      }
    },
    async stop() {
      const s = this.session
      this.session = null
      this.item = null
      this.account = null
      this.status = 'idle'
      this.error = ''
      this.duration = null
      this.startOffset = 0
      this._pendingSeek = null
      if (s) await s.stop()
    },
    // Fatal playback failure: kill the ffmpeg session but keep the overlay showing the error.
    async fail(message: string) {
      const s = this.session
      this.session = null
      this.status = 'error'
      this.error = message
      if (s) await s.stop()
    },
  },
})
