import type { JsonStore } from '@/core/storage/appState'

export interface Account {
  id: string
  name: string
  url: string
  username: string
  password: string
  createdAt: number
}

export interface AccountsState {
  activeId: string | null
  accounts: Account[]
}

export interface NewAccount {
  name: string
  url: string
  username: string
  password: string
}

export const EMPTY_ACCOUNTS: AccountsState = { activeId: null, accounts: [] }

export function addAccount(state: AccountsState, input: NewAccount, meta: { id: string; createdAt: number }): AccountsState {
  const account: Account = { id: meta.id, createdAt: meta.createdAt, ...input }
  const accounts = [...state.accounts, account]
  return { accounts, activeId: state.activeId ?? account.id }
}

export function removeAccount(state: AccountsState, id: string): AccountsState {
  const accounts = state.accounts.filter((a) => a.id !== id)
  let activeId = state.activeId
  if (activeId === id) activeId = accounts.length ? accounts[0].id : null
  return { accounts, activeId }
}

export function setActive(state: AccountsState, id: string): AccountsState {
  if (!state.accounts.some((a) => a.id === id)) return state
  return { ...state, activeId: id }
}

export function getActive(state: AccountsState): Account | null {
  return state.accounts.find((a) => a.id === state.activeId) ?? null
}

const ACCOUNTS_KEY = 'accounts.json'

export async function loadAccounts(store: JsonStore): Promise<AccountsState> {
  const s = await store.load<AccountsState>(ACCOUNTS_KEY, EMPTY_ACCOUNTS)
  // Never hand back the shared EMPTY_ACCOUNTS singleton (or the loaded object) by
  // reference — return a fresh copy so consumers can't corrupt shared state.
  return { activeId: s.activeId ?? null, accounts: [...s.accounts] }
}

export async function saveAccounts(store: JsonStore, state: AccountsState): Promise<void> {
  await store.save(ACCOUNTS_KEY, state)
}
