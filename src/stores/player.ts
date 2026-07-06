import { defineStore } from 'pinia'
import { markRaw } from 'vue'
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
    _deps: null as PlayerDeps | null,
    // Concurrency guard (non-reactive): `lock` serialises play/seek/stop/fail so their async
    // bodies never interleave, and `gen` supersedes an in-flight op when a newer one starts.
    // Together these keep the panel at exactly ONE connection — no two sessions ever overlap.
    _mx: markRaw({ lock: Promise.resolve() as Promise<unknown>, gen: 0 }),
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
    // Run `fn` with exclusive access — bodies queued here execute strictly one at a time.
    _exclusive<T>(fn: () => Promise<T>): Promise<T> {
      const run = this._mx.lock.then(fn, fn) as Promise<T>
      this._mx.lock = run.then(() => {}, () => {})
      return run
    },
    async play(account: Account, item: ContentItem, opts?: { durationSeconds?: number | null }) {
      const gen = ++this._mx.gen
      await this._exclusive(async () => {
        if (gen !== this._mx.gen) return // superseded before we got the lock
        if (this.session) { const s = this.session; this.session = null; await s.stop() }
        this.status = 'starting'
        this.error = ''
        this.item = item
        this.account = account
        this.duration = opts?.durationSeconds ?? null
        this.startOffset = 0
        try {
          const engine = await this._engine()
          const bufferSeconds = useSettingsStore().bufferSeconds
          const session = await engine.start(account, item, { bufferSeconds, startOffsetSeconds: 0 })
          if (gen !== this._mx.gen) { await session.stop(); return } // superseded while starting
          this.session = session
          this.status = 'playing'
        } catch (e) {
          if (gen === this._mx.gen) {
            this.status = 'error'
            this.error = e instanceof Error ? e.message : String(e)
            this.session = null
          }
        }
      })
    },
    // Seek restarts the VOD session at `toSeconds`. Only the latest of any concurrent seeks runs
    // to completion (older ones are superseded by `gen` and no-op); the winner always tears the
    // current session down (releasing the one connection) and settles before reconnecting.
    async seek(toSeconds: number) {
      if (!this.account || !this.item || this.duration == null) return
      const target = Math.max(0, Math.min(toSeconds, this.duration))
      const gen = ++this._mx.gen
      await this._exclusive(async () => {
        if (gen !== this._mx.gen) return // a newer seek/play/stop replaced this one
        const account = this.account
        const item = this.item
        if (!account || !item) return
        const bufferSeconds = useSettingsStore().bufferSeconds
        const s = this.session
        this.session = null
        if (s) await s.stop() // release the one connection first
        await this.sleep(SETTLE_MS) // let the panel see the drop before reconnecting
        if (gen !== this._mx.gen) return // superseded during settle → the newer op will start
        try {
          const engine = await this._engine()
          const session = await engine.start(account, item, { bufferSeconds, startOffsetSeconds: target })
          if (gen !== this._mx.gen) { await session.stop(); return }
          this.session = session
          this.startOffset = target
          this.status = 'playing'
        } catch (e) {
          if (gen === this._mx.gen) {
            this.status = 'error'
            this.error = e instanceof Error ? e.message : String(e)
            this.session = null
          }
        }
      })
    },
    async stop() {
      ++this._mx.gen // supersede any in-flight play/seek so it won't start a session
      await this._exclusive(async () => {
        const s = this.session
        this.session = null
        this.item = null
        this.account = null
        this.status = 'idle'
        this.error = ''
        this.duration = null
        this.startOffset = 0
        if (s) await s.stop()
      })
    },
    // Fatal playback failure: kill the ffmpeg session but keep the overlay showing the error.
    async fail(message: string) {
      ++this._mx.gen
      await this._exclusive(async () => {
        const s = this.session
        this.session = null
        this.status = 'error'
        this.error = message
        this.duration = null
        this.startOffset = 0
        if (s) await s.stop()
      })
    },
  },
})
