import type { JsonStore } from '@/core/storage/appState'

export type AccountType = 'xtream' | 'm3u'

export interface Account {
  id: string
  type: AccountType
  name: string
  url: string
  username: string
  password: string
  epgUrl?: string
  createdAt: number
}

export interface AccountsState {
  accounts: Account[]
}

export interface NewAccount {
  type: AccountType
  name: string
  url: string
  username: string
  password: string
  epgUrl?: string
}

export const EMPTY_ACCOUNTS: AccountsState = { accounts: [] }

export function addAccount(state: AccountsState, input: NewAccount, meta: { id: string; createdAt: number }): AccountsState {
  const account: Account = { id: meta.id, createdAt: meta.createdAt, ...input }
  return { accounts: [...state.accounts, account] }
}

export function removeAccount(state: AccountsState, id: string): AccountsState {
  return { accounts: state.accounts.filter((a) => a.id !== id) }
}

export function updateAccount(
  state: AccountsState,
  id: string,
  patch: Partial<Omit<Account, 'id' | 'createdAt'>>,
): AccountsState {
  return { accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }
}

export function findAccount(accounts: Account[], id: string | null): Account | null {
  return accounts.find((a) => a.id === id) ?? null
}

const ACCOUNTS_KEY = 'accounts.json'

// Normalize a raw persisted row (which may predate the `type` field) into an Account.
function migrate(raw: Record<string, unknown>): Account {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    id: str(raw.id),
    type: raw.type === 'm3u' ? 'm3u' : 'xtream',
    name: str(raw.name),
    url: str(raw.url),
    username: str(raw.username),
    password: str(raw.password),
    ...(typeof raw.epgUrl === 'string' ? { epgUrl: raw.epgUrl } : {}),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
  }
}

export async function loadAccounts(store: JsonStore): Promise<AccountsState> {
  const s = await store.load<{ accounts?: unknown[] }>(ACCOUNTS_KEY, EMPTY_ACCOUNTS)
  const rows = Array.isArray(s.accounts) ? s.accounts : []
  return { accounts: rows.map((r) => migrate((r ?? {}) as Record<string, unknown>)) }
}

export async function saveAccounts(store: JsonStore, state: AccountsState): Promise<void> {
  await store.save(ACCOUNTS_KEY, state)
}
