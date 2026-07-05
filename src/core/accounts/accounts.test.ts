import { describe, it, expect } from 'vitest'
import {
  EMPTY_ACCOUNTS, addAccount, removeAccount, updateAccount, findAccount,
  loadAccounts, saveAccounts,
} from './accounts'
import { createMemoryStore } from '@/core/storage/appState'

const XTREAM = { type: 'xtream' as const, name: 'P1', url: 'http://h:8080', username: 'u', password: 'p' }
const M3U = { type: 'm3u' as const, name: 'Free', url: 'http://host/list.m3u', username: '', password: '' }

describe('addAccount', () => {
  it('appends an xtream account with its type', () => {
    const s = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 100 })
    expect(s.accounts[0]).toEqual({ id: 'a1', createdAt: 100, ...XTREAM })
  })
  it('appends an m3u account (no credentials)', () => {
    const s = addAccount(EMPTY_ACCOUNTS, M3U, { id: 'a2', createdAt: 200 })
    expect(s.accounts[0].type).toBe('m3u')
    expect(s.accounts[0].username).toBe('')
  })
  it('does not mutate input', () => {
    const s = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 1 })
    expect(EMPTY_ACCOUNTS.accounts).toHaveLength(0)
    expect(s).not.toBe(EMPTY_ACCOUNTS)
  })
})

describe('updateAccount', () => {
  it('patches the matching account immutably', () => {
    const s1 = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 1 })
    const s2 = updateAccount(s1, 'a1', { name: 'Renamed', password: 'new' })
    expect(s2.accounts[0]).toEqual({ id: 'a1', createdAt: 1, ...XTREAM, name: 'Renamed', password: 'new' })
    expect(s1.accounts[0].name).toBe('P1') // original untouched
    expect(s2).not.toBe(s1)
  })
  it('can change type and add epgUrl', () => {
    const s1 = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 1 })
    const s2 = updateAccount(s1, 'a1', { type: 'm3u', username: '', password: '', epgUrl: 'http://e/xmltv' })
    expect(s2.accounts[0].type).toBe('m3u')
    expect(s2.accounts[0].epgUrl).toBe('http://e/xmltv')
  })
  it('is a no-op when the id is absent', () => {
    const s1 = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 1 })
    const s2 = updateAccount(s1, 'nope', { name: 'x' })
    expect(s2.accounts[0].name).toBe('P1')
  })
})

describe('removeAccount / findAccount', () => {
  it('removes and finds by id', () => {
    const s = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 1 })
    expect(findAccount(s.accounts, 'a1')?.id).toBe('a1')
    expect(removeAccount(s, 'a1').accounts).toHaveLength(0)
    expect(findAccount(s.accounts, null)).toBeNull()
  })
})

describe('loadAccounts migration', () => {
  it('defaults legacy rows (no type) to xtream and coerces missing fields', async () => {
    const store = createMemoryStore()
    // Simulate a Plan-1 accounts.json (no `type` field, no epgUrl)
    await store.save('accounts.json', { accounts: [{ id: 'a1', name: 'Old', url: 'http://h', username: 'u', password: 'p', createdAt: 1 }] })
    const s = await loadAccounts(store)
    expect(s.accounts[0]).toEqual({ id: 'a1', type: 'xtream', name: 'Old', url: 'http://h', username: 'u', password: 'p', createdAt: 1 })
  })
  it('preserves an m3u row and its epgUrl', async () => {
    const store = createMemoryStore()
    await store.save('accounts.json', { accounts: [{ id: 'a2', type: 'm3u', name: 'Free', url: 'http://host/list.m3u', username: '', password: '', epgUrl: 'http://e/xmltv', createdAt: 2 }] })
    const s = await loadAccounts(store)
    expect(s.accounts[0].type).toBe('m3u')
    expect(s.accounts[0].epgUrl).toBe('http://e/xmltv')
  })
  it('returns EMPTY (fresh copy) when nothing stored', async () => {
    const loaded = await loadAccounts(createMemoryStore())
    expect(loaded).toEqual(EMPTY_ACCOUNTS)
    expect(loaded).not.toBe(EMPTY_ACCOUNTS)
  })
})

describe('save round-trip', () => {
  it('persists and reloads an m3u account', async () => {
    const store = createMemoryStore()
    const s = addAccount(EMPTY_ACCOUNTS, M3U, { id: 'a2', createdAt: 2 })
    await saveAccounts(store, s)
    expect(await loadAccounts(store)).toEqual(s)
  })
})
