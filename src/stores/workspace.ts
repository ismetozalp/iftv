import { defineStore } from 'pinia'
import type { JsonStore } from '@/core/storage/appState'
import type { XtreamTransport } from '@/core/xtream/transport'
import { xtreamLogin, type XtreamAuth } from '@/core/xtream/auth'
import {
  EMPTY_ACCOUNTS, addAccount, removeAccount, findAccount,
  loadAccounts, saveAccounts, type AccountsState, type Account, type NewAccount,
} from '@/core/accounts/accounts'
import {
  EMPTY_TABS, openTab, closeTab, activateTab, reconcileTabs,
  loadTabs, saveTabs, type TabsState,
} from '@/core/accounts/tabs'
import { useHost } from '@/composables/useHost'

type IdGen = () => { id: string; createdAt: number }
interface Deps { store: JsonStore; transport: XtreamTransport; ids: IdGen }

const defaultIds: IdGen = () => ({ id: crypto.randomUUID(), createdAt: Date.now() })

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    accounts: structuredClone(EMPTY_ACCOUNTS) as AccountsState,
    tabs: structuredClone(EMPTY_TABS) as TabsState,
    loading: false,
    _deps: null as Deps | null,
  }),
  getters: {
    allAccounts: (s): Account[] => s.accounts.accounts,
    openTabs(s): Account[] {
      return s.tabs.openTabIds
        .map((id) => findAccount(s.accounts.accounts, id))
        .filter((a): a is Account => a !== null)
    },
    activeAccount: (s): Account | null => findAccount(s.accounts.accounts, s.tabs.activeTabId),
  },
  actions: {
    $configure(deps: Deps) {
      this._deps = deps
    },
    async _host(): Promise<Deps> {
      if (this._deps) return this._deps
      const host = await useHost()
      this._deps = { ...host, ids: defaultIds }
      return this._deps
    },
    async _persistAccounts() {
      const { store } = await this._host()
      await saveAccounts(store, this.accounts)
    },
    async _persistTabs() {
      const { store } = await this._host()
      await saveTabs(store, this.tabs)
    },
    async init() {
      this.loading = true
      try {
        const { store } = await this._host()
        this.accounts = await loadAccounts(store)
        const loaded = await loadTabs(store)
        const reconciled = reconcileTabs(loaded, this.accounts.accounts.map((a) => a.id))
        this.tabs = reconciled
        if (JSON.stringify(reconciled) !== JSON.stringify(loaded)) {
          await saveTabs(store, reconciled)
        }
      } finally {
        this.loading = false
      }
    },
    async verify(input: NewAccount): Promise<XtreamAuth> {
      const { transport } = await this._host()
      return xtreamLogin(transport, input.url, input.username, input.password)
    },
    async add(input: NewAccount, verify: boolean) {
      const { ids } = await this._host()
      if (verify) {
        const res = await this.verify(input)
        if (!res.active) throw new Error(`Account not active (auth=${res.auth}, status="${res.status}")`)
      }
      const meta = ids()
      this.accounts = addAccount(this.accounts, input, meta)
      await this._persistAccounts()
      this.tabs = openTab(this.tabs, meta.id)
      await this._persistTabs()
    },
    async remove(id: string) {
      this.accounts = removeAccount(this.accounts, id)
      await this._persistAccounts()
      this.tabs = closeTab(this.tabs, id)
      await this._persistTabs()
    },
    async open(id: string) {
      this.tabs = openTab(this.tabs, id)
      await this._persistTabs()
    },
    async close(id: string) {
      this.tabs = closeTab(this.tabs, id)
      await this._persistTabs()
    },
    async activate(id: string) {
      this.tabs = activateTab(this.tabs, id)
      await this._persistTabs()
    },
  },
})
