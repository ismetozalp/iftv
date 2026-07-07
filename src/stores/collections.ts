import { defineStore } from 'pinia'
import type { JsonStore } from '@/core/storage/appState'
import { createCockpitStore } from '@/adapters/cockpitFile'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { LibraryData } from '@/core/library/types'
import {
  emptyLibrary,
  isFavorite as libIsFavorite,
  toggleFavorite as libToggleFavorite,
  addWatchLater as libAddWatchLater,
  removeWatchLater as libRemoveWatchLater,
  createList as libCreateList,
  renameList as libRenameList,
  deleteList as libDeleteList,
  addToList as libAddToList,
  removeFromList as libRemoveFromList,
  upsertProgress as libUpsertProgress,
  removeProgress as libRemoveProgress,
  recordHistory as libRecordHistory,
  clearHistory as libClearHistory,
} from '@/core/library/library'

interface Deps {
  store: JsonStore
}

export const useCollectionsStore = defineStore('collections', {
  state: () => ({
    data: emptyLibrary() as LibraryData,
    _loaded: null as Promise<void> | null, // in-flight/completed initial load; gates every persist
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
    // Idempotent: the initial read runs once. A transient failure (e.g. cockpit reconnecting after a
    // restart) resets it so the next call retries — and, crucially, a failed load never leaves the
    // store "loaded" as empty for a persist to clobber the file with.
    async load() {
      if (!this._loaded) {
        this._loaded = (async () => {
          const { store } = await this._host()
          const loaded = await store.load('library.json', emptyLibrary())
          this.data = { ...emptyLibrary(), ...loaded }
        })().catch((e) => {
          this._loaded = null
          throw e
        })
      }
      return this._loaded
    },
    // Every mutation loads the on-disk library FIRST, then applies + persists. This is what makes
    // favorites survive: a mutation that races the fire-and-forget initial load (App.vue's
    // `void collections.load()`) — e.g. recordHistory/saveProgress firing on play right after a
    // cockpit restart — can never write an empty library over real data.
    async _mutate(fn: (d: LibraryData) => LibraryData) {
      await this.load()
      this.data = fn(this.data)
      const { store } = await this._host()
      await store.save('library.json', this.data)
    },
    async toggleFavorite(account: Account, item: ContentItem) {
      await this._mutate((d) => libToggleFavorite(d, account, item, Date.now()))
    },
    async addWatchLater(account: Account, item: ContentItem) {
      await this._mutate((d) => libAddWatchLater(d, account, item, Date.now()))
    },
    async removeWatchLater(accountId: string, itemId: string) {
      await this._mutate((d) => libRemoveWatchLater(d, accountId, itemId))
    },
    async createList(name: string) {
      await this._mutate((d) => libCreateList(d, name, Date.now()))
    },
    async renameList(listId: string, name: string) {
      await this._mutate((d) => libRenameList(d, listId, name))
    },
    async deleteList(listId: string) {
      await this._mutate((d) => libDeleteList(d, listId))
    },
    async addToList(listId: string, account: Account, item: ContentItem) {
      await this._mutate((d) => libAddToList(d, listId, account, item, Date.now()))
    },
    async removeFromList(listId: string, itemId: string, accountId: string) {
      await this._mutate((d) => libRemoveFromList(d, listId, itemId, accountId))
    },
    async saveProgress(account: Account, item: ContentItem, offsetSeconds: number, durationSeconds: number | null) {
      await this._mutate((d) => libUpsertProgress(d, account, item, offsetSeconds, durationSeconds, Date.now()))
    },
    async removeProgress(accountId: string, itemId: string) {
      await this._mutate((d) => libRemoveProgress(d, accountId, itemId))
    },
    async recordHistory(account: Account, item: ContentItem, durationSeconds: number | null = null) {
      await this._mutate((d) => libRecordHistory(d, account, item, Date.now(), durationSeconds))
    },
    async clearHistory() {
      await this._mutate((d) => libClearHistory(d))
    },
  },
  getters: {
    favoritesOf: (s) => (accountId: string) => s.data.favorites.filter((e) => e.accountId === accountId),
    watchLaterOf: (s) => (accountId: string) => s.data.watchLater.filter((e) => e.accountId === accountId),
    continueWatchingOf: (s) => (accountId: string) => s.data.continueWatching.filter((e) => e.accountId === accountId),
    historyOf: (s) => (accountId: string) => s.data.history.filter((e) => e.accountId === accountId),
    isFavorite: (s) => (accountId: string, itemId: string) => libIsFavorite(s.data, accountId, itemId),
    listsOf: (s) => (accountId: string) =>
      s.data.lists.map((l) => ({ ...l, count: l.entries.filter((e) => e.accountId === accountId).length })),
  },
})
