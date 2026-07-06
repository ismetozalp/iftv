import { defineStore } from 'pinia'
import type { JsonStore } from '@/core/storage/appState'
import { createCockpitStore } from '@/adapters/cockpitFile'
import { fetchEpgXml } from '@/adapters/cockpitEpg'
import { useSettingsStore, EPG_TTL_MS } from '@/stores/settings'
import type { ContentItem } from '@/core/content/types'
import { parseXmltv } from '@/core/epg/parseXmltv'
import { buildIndex, nowNext, programmesInWindow, daySchedule } from '@/core/epg/index'
import { normalizeChannelName } from '@/core/epg/normalize'
import type { EpgIndex, Programme, XmltvChannel } from '@/core/epg/types'

interface Deps {
  store: JsonStore
  fetchXml?: (url: string) => Promise<string>
}

interface PersistedEpg {
  loadedAt: number
  channels: XmltvChannel[]
  programmes: Programme[]
}

const EMPTY_PERSISTED: PersistedEpg = { loadedAt: 0, channels: [], programmes: [] }

export const useEpgStore = defineStore('epg', {
  state: () => ({
    index: {} as EpgIndex,
    loadedAt: 0,
    loading: false,
    error: '',
    _deps: null as Deps | null,
  }),
  actions: {
    $configure(deps: Deps) {
      this._deps = deps
    },
    async _host(): Promise<Deps> {
      if (!this._deps) this._deps = { store: await createCockpitStore(), fetchXml: fetchEpgXml }
      return this._deps
    },
    async _persist(channels: XmltvChannel[], programmes: Programme[]) {
      const { store } = await this._host()
      const value: PersistedEpg = { loadedAt: this.loadedAt, channels, programmes }
      await store.save('epg.json', value)
    },
    // Rebuild the index from the on-disk cache — never fetches. Safe to call even when there's
    // no EPG configured (or offline): the cache just stays empty until the first refresh().
    async load() {
      const { store } = await this._host()
      const loaded = await store.load('epg.json', EMPTY_PERSISTED)
      this.index = buildIndex({ channels: loaded.channels, programmes: loaded.programmes })
      this.loadedAt = loaded.loadedAt
    },
    // Fetch + reparse the configured EPG URL. Never blocks/throws to the caller — on failure it
    // records `error` and leaves the previous (possibly stale) index in place.
    async refresh() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        const { fetchXml } = await this._host()
        const settings = useSettingsStore()
        const xml = await (fetchXml ?? fetchEpgXml)(settings.epgUrl)
        const parsed = parseXmltv(xml)
        this.index = buildIndex(parsed)
        this.loadedAt = Date.now()
        await this._persist(parsed.channels, parsed.programmes)
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
      }
    },
    // Called on mount (after load()): refresh only when an EPG URL is configured and the cache
    // is older than the TTL. `now` is injectable for tests; real callers rely on the default.
    async ensureFresh(now = Date.now()) {
      const settings = useSettingsStore()
      if (settings.epgUrl && now - this.loadedAt > EPG_TTL_MS) await this.refresh()
    },
  },
  getters: {
    // `atMs` is injectable for tests; real callers rely on the default (Date.now() lives only here,
    // never in core/epg).
    nowNextFor:
      (state) =>
      (name: string, atMs = Date.now()) =>
        nowNext(state.index[normalizeChannelName(name)] ?? [], atMs),
    scheduleFor:
      (state) =>
      (name: string, atMs = Date.now()) =>
        daySchedule(state.index[normalizeChannelName(name)] ?? [], atMs),
    hasEpgFor: (state) => (name: string) => (state.index[normalizeChannelName(name)] ?? []).length > 0,
    guideChannels:
      (state) =>
      (items: ContentItem[], fromMs: number, toMs: number): { item: ContentItem; programmes: Programme[] }[] =>
        items
          .filter((i) => i.kind === 'live' && (state.index[normalizeChannelName(i.name)] ?? []).length > 0)
          .map((i) => ({
            item: i,
            programmes: programmesInWindow(state.index[normalizeChannelName(i.name)] ?? [], fromMs, toMs),
          })),
  },
})
