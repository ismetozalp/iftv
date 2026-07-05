import { describe, it, expect } from 'vitest'
import {
  EMPTY_ACCOUNTS, addAccount, removeAccount, setActive, getActive,
  loadAccounts, saveAccounts, type AccountsState,
} from './accounts'
import { createMemoryStore } from '@/core/storage/appState'

const NEW = { name: 'P1', url: 'http://h:8080', username: 'u', password: 'p' }

describe('addAccount', () => {
  it('appends and sets first as active', () => {
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 100 })
    expect(s.accounts).toHaveLength(1)
    expect(s.accounts[0]).toEqual({ id: 'a1', createdAt: 100, ...NEW })
    expect(s.activeId).toBe('a1')
  })
  it('keeps existing active when adding a second', () => {
    let s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 100 })
    s = addAccount(s, { ...NEW, name: 'P2' }, { id: 'a2', createdAt: 200 })
    expect(s.accounts).toHaveLength(2)
    expect(s.activeId).toBe('a1')
  })
  it('does not mutate input state', () => {
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 100 })
    expect(EMPTY_ACCOUNTS.accounts).toHaveLength(0)
    expect(s).not.toBe(EMPTY_ACCOUNTS)
  })
})

describe('removeAccount', () => {
  it('removes and repoints active to first remaining', () => {
    let s: AccountsState = { activeId: null, accounts: [] }
    s = addAccount(s, NEW, { id: 'a1', createdAt: 1 })
    s = addAccount(s, NEW, { id: 'a2', createdAt: 2 })
    s = setActive(s, 'a1')
    s = removeAccount(s, 'a1')
    expect(s.accounts.map((a) => a.id)).toEqual(['a2'])
    expect(s.activeId).toBe('a2')
  })
  it('active becomes null when last removed', () => {
    let s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 1 })
    s = removeAccount(s, 'a1')
    expect(s.activeId).toBeNull()
    expect(s.accounts).toHaveLength(0)
  })
})

describe('setActive', () => {
  it('sets when id exists, ignores when not', () => {
    let s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 1 })
    s = addAccount(s, NEW, { id: 'a2', createdAt: 2 })
    expect(setActive(s, 'a2').activeId).toBe('a2')
    expect(setActive(s, 'nope').activeId).toBe('a1')
  })
})

describe('getActive', () => {
  it('returns the active account or null', () => {
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 1 })
    expect(getActive(s)?.id).toBe('a1')
    expect(getActive(EMPTY_ACCOUNTS)).toBeNull()
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
})
