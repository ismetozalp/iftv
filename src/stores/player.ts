import { defineStore } from 'pinia'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { PlaybackEngine, PlaybackSession } from '@/core/media/PlaybackEngine'
import { createCockpitPlaybackEngine } from '@/adapters/cockpitPlayback'
import { useSettingsStore } from '@/stores/settings'

interface PlayerDeps { engine: PlaybackEngine }

export const usePlayerStore = defineStore('player', {
  state: () => ({
    status: 'idle' as 'idle' | 'starting' | 'playing' | 'error',
    error: '',
    item: null as ContentItem | null,
    session: null as PlaybackSession | null,
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
    async play(account: Account, item: ContentItem) {
      if (this.session) await this.stop()
      this.status = 'starting'
      this.error = ''
      this.item = item
      try {
        const engine = await this._engine()
        const bufferSeconds = useSettingsStore().bufferSeconds
        this.session = await engine.start(account, item, { bufferSeconds })
        this.status = 'playing'
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        this.session = null
      }
    },
    async stop() {
      const s = this.session
      this.session = null
      this.item = null
      this.status = 'idle'
      this.error = ''
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
