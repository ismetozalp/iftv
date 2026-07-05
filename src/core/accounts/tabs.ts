import type { JsonStore } from '@/core/storage/appState'

export interface TabsState {
  openTabIds: string[]
  activeTabId: string | null
}

export const EMPTY_TABS: TabsState = { openTabIds: [], activeTabId: null }

export function openTab(state: TabsState, accountId: string): TabsState {
  const openTabIds = state.openTabIds.includes(accountId)
    ? state.openTabIds
    : [...state.openTabIds, accountId]
  return { openTabIds, activeTabId: accountId }
}

export function closeTab(state: TabsState, accountId: string): TabsState {
  const idx = state.openTabIds.indexOf(accountId)
  if (idx === -1) return state
  const openTabIds = state.openTabIds.filter((id) => id !== accountId)
  let activeTabId = state.activeTabId
  if (activeTabId === accountId) {
    // focus the neighbour: the tab that shifted into this slot (right), else the left, else none
    activeTabId = openTabIds[idx] ?? openTabIds[idx - 1] ?? null
  }
  return { openTabIds, activeTabId }
}

export function activateTab(state: TabsState, accountId: string): TabsState {
  if (!state.openTabIds.includes(accountId)) return state
  return { ...state, activeTabId: accountId }
}

// Reconcile persisted tabs against the current accounts: drop tabs for accounts
// that no longer exist, auto-open the sole account when nothing is open, and make
// sure activeTabId points at an open tab.
export function reconcileTabs(state: TabsState, accountIds: string[]): TabsState {
  const ids = new Set(accountIds)
  let openTabIds = state.openTabIds.filter((id) => ids.has(id))
  if (openTabIds.length === 0 && accountIds.length === 1) {
    openTabIds = [accountIds[0]]
  }
  let activeTabId = state.activeTabId
  if (activeTabId === null || !openTabIds.includes(activeTabId)) {
    activeTabId = openTabIds.length ? openTabIds[0] : null
  }
  return { openTabIds, activeTabId }
}

const TABS_KEY = 'tabs.json'

export async function loadTabs(store: JsonStore): Promise<TabsState> {
  const s = await store.load<TabsState>(TABS_KEY, EMPTY_TABS)
  return { openTabIds: [...s.openTabIds], activeTabId: s.activeTabId ?? null }
}

export async function saveTabs(store: JsonStore, state: TabsState): Promise<void> {
  await store.save(TABS_KEY, state)
}
