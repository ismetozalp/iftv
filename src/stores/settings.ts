import { defineStore } from 'pinia'
import type { JsonStore } from '@/core/storage/appState'
import { createCockpitStore } from '@/adapters/cockpitFile'

const DEFAULT_BUFFER_SECONDS = 30
const MIN_BUFFER_SECONDS = 5
const MAX_BUFFER_SECONDS = 120

interface Deps { store: JsonStore }

function clampBufferSeconds(n: number): number {
  return Math.min(MAX_BUFFER_SECONDS, Math.max(MIN_BUFFER_SECONDS, n))
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    bufferSeconds: DEFAULT_BUFFER_SECONDS,
    _deps: null as Deps | null,
  }),
  actions: {
    $configure(deps: Deps) {
      this._deps = deps
    },
    async _host(): Promise<Deps> {
      if (!this._deps) this._deps = { store: await createCockpitStore() }
      return this._deps
    },
    async load() {
      const { store } = await this._host()
      const loaded = await store.load('settings.json', { bufferSeconds: DEFAULT_BUFFER_SECONDS })
      this.bufferSeconds = clampBufferSeconds(loaded.bufferSeconds)
    },
    async setBufferSeconds(n: number) {
      const { store } = await this._host()
      const bufferSeconds = clampBufferSeconds(n)
      this.bufferSeconds = bufferSeconds
      await store.save('settings.json', { bufferSeconds })
    },
  },
})
