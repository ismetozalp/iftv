import { describe, it, expect } from 'vitest'
import {
  EMPTY_ACCOUNTS, addAccount, removeAccount, findAccount,
  loadAccounts, saveAccounts,
} from './accounts'
import { createMemoryStore } from '@/core/storage/appState'

const NEW = { name: 'P1', url: 'http://h:8080', username: 'u', password: 'p' }

describe('addAccount', () => {
  it('appends a new account', () => {
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 100 })
    expect(s.accounts).toHaveLength(1)
    expect(s.accounts[0]).toEqual({ id: 'a1', createdAt: 100, ...NEW })
  })
  it('appends a second without touching the first', () => {
    let s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 100 })
    s = addAccount(s, { ...NEW, name: 'P2' }, { id: 'a2', createdAt: 200 })
    expect(s.accounts.map((a) => a.id)).toEqual(['a1', 'a2'])
  })
  it('does not mutate input state', () => {
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 100 })
    expect(EMPTY_ACCOUNTS.accounts).toHaveLength(0)
    expect(s).not.toBe(EMPTY_ACCOUNTS)
  })
})

describe('removeAccount', () => {
  it('removes by id without mutating input', () => {
    const s1 = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 1 })
    const s2 = removeAccount(s1, 'a1')
    expect(s2.accounts).toHaveLength(0)
    expect(s1.accounts).toHaveLength(1)
  })
})

describe('findAccount', () => {
  it('returns the matching account or null', () => {
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 1 })
    expect(findAccount(s.accounts, 'a1')?.id).toBe('a1')
    expect(findAccount(s.accounts, 'nope')).toBeNull()
    expect(findAccount(s.accounts, null)).toBeNull()
  })
})

describe('load/save round-trip', () => {
  it('persists via a JsonStore', async () => {
    const store = createMemoryStore()
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 1 })
    await saveAccounts(store, s)
    expect(await loadAccounts(store)).toEqual(s)
  })
  it('returns EMPTY when nothing saved', async () => {
    expect(await loadAccounts(createMemoryStore())).toEqual(EMPTY_ACCOUNTS)
  })
  it('never returns the shared EMPTY_ACCOUNTS singleton on a fresh store', async () => {
    const loaded = await loadAccounts(createMemoryStore())
    expect(loaded).toEqual(EMPTY_ACCOUNTS)
    expect(loaded).not.toBe(EMPTY_ACCOUNTS)
    loaded.accounts.push({ id: 'x', name: '', url: '', username: '', password: '', createdAt: 0 })
    expect(EMPTY_ACCOUNTS.accounts).toHaveLength(0)
  })
})
