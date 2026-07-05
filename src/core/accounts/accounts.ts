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
  accounts: Account[]
}

export interface NewAccount {
  name: string
  url: string
  username: string
  password: string
}

export const EMPTY_ACCOUNTS: AccountsState = { accounts: [] }

export function addAccount(state: AccountsState, input: NewAccount, meta: { id: string; createdAt: number }): AccountsState {
  const account: Account = { id: meta.id, createdAt: meta.createdAt, ...input }
  return { accounts: [...state.accounts, account] }
}

export function removeAccount(state: AccountsState, id: string): AccountsState {
  return { accounts: state.accounts.filter((a) => a.id !== id) }
}

export function findAccount(accounts: Account[], id: string | null): Account | null {
  return accounts.find((a) => a.id === id) ?? null
}

const ACCOUNTS_KEY = 'accounts.json'

export async function loadAccounts(store: JsonStore): Promise<AccountsState> {
  const s = await store.load<AccountsState>(ACCOUNTS_KEY, EMPTY_ACCOUNTS)
  // Never hand back the shared singleton (or the loaded object) by reference.
  return { accounts: [...s.accounts] }
}

export async function saveAccounts(store: JsonStore, state: AccountsState): Promise<void> {
  await store.save(ACCOUNTS_KEY, state)
}
