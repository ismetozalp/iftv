import { defineStore } from 'pinia'
import type { Account } from '@/core/accounts/accounts'
import type { Category, Channel } from '@/core/content/types'
import { createProvider, type ContentProvider } from '@/core/content/provider'
import { useHost } from '@/composables/useHost'

interface LibDeps { makeProvider: (account: Account) => ContentProvider }

export const useLibraryStore = defineStore('library', {
  state: () => ({
    accountId: null as string | null,
    categories: [] as Category[],
    channelsByCat: {} as Record<string, Channel[]>,
    all: null as Channel[] | null,
    loading: false,
    error: '',
    _provider: null as ContentProvider | null,
    _deps: null as LibDeps | null,
  }),
  getters: {
    channelsFor: (s) => (categoryId: string): Channel[] => s.channelsByCat[categoryId] ?? [],
  },
  actions: {
    $configure(deps: LibDeps) {
      this._deps = deps
    },
    async _factory(): Promise<LibDeps> {
      if (this._deps) return this._deps
      const { transport } = await useHost()
      this._deps = { makeProvider: (account) => createProvider(transport, account) }
      return this._deps
    },
    _reset() {
      this.categories = []
      this.channelsByCat = {}
      this.all = null
      this.error = ''
      this._provider = null
    },
    async setAccount(account: Account | null) {
      if (account?.id === this.accountId) return
      this.accountId = account?.id ?? null
      this._reset()
      if (!account) return
      const { makeProvider } = await this._factory()
      this._provider = makeProvider(account)
      await this.loadCategories()
    },
    async loadCategories() {
      if (!this._provider) return
      this.loading = true
      this.error = ''
      try {
        this.categories = await this._provider.getCategories()
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
      }
    },
    async loadCategory(categoryId: string) {
      if (!this._provider || this.channelsByCat[categoryId]) return
      this.loading = true
      this.error = ''
      try {
        this.channelsByCat = { ...this.channelsByCat, [categoryId]: await this._provider.getChannels(categoryId) }
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
      }
    },
    async search(query: string): Promise<Channel[]> {
      if (!this._provider) return []
      if (!this.all) {
        this.loading = true
        try {
          this.all = await this._provider.getAllChannels()
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e)
          this.all = []
        } finally {
          this.loading = false
        }
      }
      const q = query.trim().toLowerCase()
      if (!q) return []
      return this.all.filter((c) => c.name.toLowerCase().includes(q))
    },
  },
})
