import { defineStore } from 'pinia'
import type { Account } from '@/core/accounts/accounts'
import type { Category, ContentItem } from '@/core/content/types'
import { createProvider, type ContentProvider, type Section } from '@/core/content/provider'
import { useHost } from '@/composables/useHost'

interface LibDeps { makeProvider: (account: Account, section: Section) => ContentProvider }

export const useLibraryStore = defineStore('library', {
  state: () => ({
    accountId: null as string | null,
    section: 'live' as Section,
    _account: null as Account | null,
    categories: [] as Category[],
    itemsByCat: {} as Record<string, ContentItem[]>,
    all: null as ContentItem[] | null,
    loading: false,
    error: '',
    _provider: null as ContentProvider | null,
    _deps: null as LibDeps | null,
  }),
  getters: {
    itemsFor: (s) => (categoryId: string): ContentItem[] => s.itemsByCat[categoryId] ?? [],
  },
  actions: {
    $configure(deps: LibDeps) {
      this._deps = deps
    },
    async _factory(): Promise<LibDeps> {
      if (this._deps) return this._deps
      const { transport } = await useHost()
      this._deps = { makeProvider: (account, section) => createProvider(transport, account, section) }
      return this._deps
    },
    _reset() {
      this.categories = []
      this.itemsByCat = {}
      this.all = null
      this.error = ''
      this._provider = null
    },
    async setContext(account: Account | null, section: Section) {
      if (account?.id === this.accountId && section === this.section) return
      this.accountId = account?.id ?? null
      this.section = section
      this._account = account
      this._reset()
      if (!account) return
      const { makeProvider } = await this._factory()
      this._provider = makeProvider(account, section)
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
      if (!this._provider || this.itemsByCat[categoryId]) return
      this.loading = true
      this.error = ''
      try {
        this.itemsByCat = { ...this.itemsByCat, [categoryId]: await this._provider.getItems(categoryId) }
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
      }
    },
    async search(query: string): Promise<ContentItem[]> {
      if (!this._provider) return []
      if (!this.all) {
        this.loading = true
        try {
          this.all = await this._provider.getAllItems()
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
