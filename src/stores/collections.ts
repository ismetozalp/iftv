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
      const loaded = await store.load('library.json', emptyLibrary())
      this.data = { ...emptyLibrary(), ...loaded }
    },
    async _persist() {
      const { store } = await this._host()
      await store.save('library.json', this.data)
    },
    async toggleFavorite(account: Account, item: ContentItem) {
      this.data = libToggleFavorite(this.data, account, item, Date.now())
      await this._persist()
    },
    async addWatchLater(account: Account, item: ContentItem) {
      this.data = libAddWatchLater(this.data, account, item, Date.now())
      await this._persist()
    },
    async removeWatchLater(accountId: string, itemId: string) {
      this.data = libRemoveWatchLater(this.data, accountId, itemId)
      await this._persist()
    },
    async createList(name: string) {
      this.data = libCreateList(this.data, name, Date.now())
      await this._persist()
    },
    async renameList(listId: string, name: string) {
      this.data = libRenameList(this.data, listId, name)
      await this._persist()
    },
    async deleteList(listId: string) {
      this.data = libDeleteList(this.data, listId)
      await this._persist()
    },
    async addToList(listId: string, account: Account, item: ContentItem) {
      this.data = libAddToList(this.data, listId, account, item, Date.now())
      await this._persist()
    },
    async removeFromList(listId: string, itemId: string, accountId: string) {
      this.data = libRemoveFromList(this.data, listId, itemId, accountId)
      await this._persist()
    },
    async saveProgress(account: Account, item: ContentItem, offsetSeconds: number, durationSeconds: number | null) {
      this.data = libUpsertProgress(this.data, account, item, offsetSeconds, durationSeconds, Date.now())
      await this._persist()
    },
    async removeProgress(accountId: string, itemId: string) {
      this.data = libRemoveProgress(this.data, accountId, itemId)
      await this._persist()
    },
    async recordHistory(account: Account, item: ContentItem) {
      this.data = libRecordHistory(this.data, account, item, Date.now())
      await this._persist()
    },
    async clearHistory() {
      this.data = libClearHistory(this.data)
      await this._persist()
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
