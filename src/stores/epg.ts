import { defineStore } from 'pinia'
import type { JsonStore } from '@/core/storage/appState'
import { createCockpitStore } from '@/adapters/cockpitFile'
import { fetchEpgXml } from '@/adapters/cockpitEpg'
import { useSettingsStore, EPG_TTL_MS } from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import { parseXmltv } from '@/core/epg/parseXmltv'
import { buildIndex, lookup, nowNext, programmesInWindow, EMPTY_INDEX } from '@/core/epg/index'
import { resolveEpgUrl } from '@/core/epg/source'
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
type PersistedByAccount = Record<string, PersistedEpg>

interface AccountEpg {
  index: EpgIndex
  loadedAt: number
  error: string
}

const DAY_MS = 24 * 3600 * 1000

// EPG is now per-account: each account resolves its own XMLTV (manual URL / panel guide / global
// fallback) into its own index, so different providers never share or clobber one another's guide.
function idxFor(byAccount: Record<string, AccountEpg>, accountId: string | undefined): EpgIndex {
  return (accountId && byAccount[accountId]?.index) || EMPTY_INDEX
}

export const useEpgStore = defineStore('epg', {
  state: () => ({
    byAccount: {} as Record<string, AccountEpg>,
    tvgUrlByAccount: {} as Record<string, string>, // M3U `url-tvg` captured when the playlist is parsed
    srcByAccount: {} as Record<string, string>, // the resolved URL that produced each account's current index
    loadingIds: [] as string[],
    _refreshAgain: [] as string[], // account ids asked to refresh while one was already in flight
    _writeChain: Promise.resolve() as Promise<unknown>, // serializes epg.json read-modify-write
    nowMs: Date.now(), // ticked ~1/min from App.vue so now/next getters stay fresh between refreshes
    _deps: null as Deps | null,
  }),
  actions: {
    $configure(deps: Deps) {
      this._deps = deps
    },
    // Bump the reactive clock so card/schedule now/next re-evaluate as programmes roll over.
    tick(now = Date.now()) {
      this.nowMs = now
    },
    async _host(): Promise<Deps> {
      if (!this._deps) this._deps = { store: await createCockpitStore(), fetchXml: fetchEpgXml }
      return this._deps
    },
    // Rebuild every account's index from the on-disk cache — never fetches. An old (unkeyed) cache
    // is naturally ignored (its values aren't per-account {channels,programmes}) and repopulates on
    // the next refresh.
    async load() {
      const { store } = await this._host()
      const all = await store.load('epg.json', {} as PersistedByAccount)
      const byAccount: Record<string, AccountEpg> = {}
      for (const [id, v] of Object.entries(all)) {
        if (v && Array.isArray(v.channels) && Array.isArray(v.programmes)) {
          byAccount[id] = { index: buildIndex({ channels: v.channels, programmes: v.programmes }), loadedAt: v.loadedAt || 0, error: '' }
        }
      }
      this.byAccount = byAccount
    },
    // Serialized read-modify-write so concurrent per-account refreshes can't clobber epg.json.
    _persistAccount(id: string, loadedAt: number, channels: XmltvChannel[], programmes: Programme[]) {
      this._writeChain = this._writeChain.then(async () => {
        const { store } = await this._host()
        const all = await store.load('epg.json', {} as PersistedByAccount)
        all[id] = { loadedAt, channels, programmes }
        await store.save('epg.json', all)
      })
      return this._writeChain
    },
    // Record a playlist's declared `url-tvg`; refresh that account if it changes the resolved URL.
    async noteTvgUrl(accountId: string, url: string) {
      if (this.tvgUrlByAccount[accountId] === url) return
      this.tvgUrlByAccount[accountId] = url
      const account = useWorkspaceStore().accounts.accounts.find((a) => a.id === accountId)
      if (account) await this.ensureFresh(account)
    },
    // Fetch + reparse an account's resolved EPG URL. Never throws to the caller — on failure it
    // records that account's `error` and leaves its previous index in place. Isolated per account.
    async refresh(account: Account | null = useWorkspaceStore().activeAccount) {
      if (!account) return
      const id = account.id
      // Single-flight per account. If a refresh is requested while one is running (e.g. the resolved
      // URL just changed via noteTvgUrl), remember to run once more when it finishes.
      if (this.loadingIds.includes(id)) {
        if (!this._refreshAgain.includes(id)) this._refreshAgain = [...this._refreshAgain, id]
        return
      }
      this.loadingIds = [...this.loadingIds, id]
      try {
        const { fetchXml } = await this._host()
        const settings = useSettingsStore()
        const url = resolveEpgUrl(account, settings.epgUrl, this.tvgUrlByAccount[id] ?? '')
        this.srcByAccount = { ...this.srcByAccount, [id]: url } // record what the current state reflects
        if (!url) {
          this.byAccount = { ...this.byAccount, [id]: { index: EMPTY_INDEX, loadedAt: Date.now(), error: '' } }
          await this._persistAccount(id, Date.now(), [], [])
          return
        }
        const xml = await (fetchXml ?? fetchEpgXml)(url)
        const parsed = parseXmltv(xml)
        const loadedAt = Date.now()
        this.byAccount = { ...this.byAccount, [id]: { index: buildIndex(parsed), loadedAt, error: '' } }
        await this._persistAccount(id, loadedAt, parsed.channels, parsed.programmes)
      } catch (e) {
        const prev = this.byAccount[id]
        this.byAccount = {
          ...this.byAccount,
          [id]: { index: prev?.index ?? EMPTY_INDEX, loadedAt: prev?.loadedAt ?? 0, error: e instanceof Error ? e.message : String(e) },
        }
      } finally {
        this.loadingIds = this.loadingIds.filter((x) => x !== id)
        if (this._refreshAgain.includes(id)) {
          this._refreshAgain = this._refreshAgain.filter((x) => x !== id)
          void this.refresh(account) // resolves the URL afresh (now incl. any newly-known tvgUrl)
        }
      }
    },
    // Refresh an account when its cache is stale OR its resolved EPG URL changed (e.g. an M3U's
    // url-tvg became known after the playlist parsed, or the account's manual URL was edited).
    async ensureFresh(account: Account | null = useWorkspaceStore().activeAccount, now = Date.now()) {
      if (!account) return
      const settings = useSettingsStore()
      const url = resolveEpgUrl(account, settings.epgUrl, this.tvgUrlByAccount[account.id] ?? '')
      if (!url) return
      const stale = now - (this.byAccount[account.id]?.loadedAt ?? 0) > EPG_TTL_MS
      const urlChanged = url !== this.srcByAccount[account.id]
      if (stale || urlChanged) await this.refresh(account)
    },
  },
  getters: {
    // `accountId` defaults to the active account; `atMs` to the reactive clock (Date.now() lives only
    // here, never in core/epg). Lookups prefer the channel's EPG id, then its normalized name.
    nowNextFor:
      (state) =>
      (name: string, epgId = '', accountId?: string, atMs = state.nowMs) => {
        const id = accountId ?? useWorkspaceStore().activeAccount?.id
        return nowNext(lookup(idxFor(state.byAccount, id), name, epgId), atMs)
      },
    scheduleFor:
      (state) =>
      (name: string, epgId = '', accountId?: string, atMs = state.nowMs) => {
        const id = accountId ?? useWorkspaceStore().activeAccount?.id
        return programmesInWindow(lookup(idxFor(state.byAccount, id), name, epgId), atMs, atMs + DAY_MS)
      },
    hasEpgFor:
      (state) =>
      (name: string, epgId = '', accountId?: string) => {
        const id = accountId ?? useWorkspaceStore().activeAccount?.id
        return lookup(idxFor(state.byAccount, id), name, epgId).length > 0
      },
    guideChannels:
      (state) =>
      (items: ContentItem[], fromMs: number, toMs: number, accountId?: string): { item: ContentItem; programmes: Programme[] }[] => {
        const id = accountId ?? useWorkspaceStore().activeAccount?.id
        const idx = idxFor(state.byAccount, id)
        return items
          .filter((i) => i.kind === 'live' && lookup(idx, i.name, i.epgId).length > 0)
          .map((i) => ({ item: i, programmes: programmesInWindow(lookup(idx, i.name, i.epgId), fromMs, toMs) }))
      },
    // Status for the Settings section (the active account by default).
    loadedAtFor:
      (state) =>
      (accountId?: string) => {
        const id = accountId ?? useWorkspaceStore().activeAccount?.id
        return (id && state.byAccount[id]?.loadedAt) || 0
      },
    errorFor:
      (state) =>
      (accountId?: string) => {
        const id = accountId ?? useWorkspaceStore().activeAccount?.id
        return (id && state.byAccount[id]?.error) || ''
      },
    channelCountFor:
      (state) =>
      (accountId?: string) => {
        const id = accountId ?? useWorkspaceStore().activeAccount?.id
        return Object.keys(idxFor(state.byAccount, id).byName).length
      },
    isLoading:
      (state) =>
      (accountId?: string) => {
        const id = accountId ?? useWorkspaceStore().activeAccount?.id
        return !!id && state.loadingIds.includes(id)
      },
  },
})
