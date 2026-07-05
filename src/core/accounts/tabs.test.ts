import { describe, it, expect } from 'vitest'
import {
  EMPTY_TABS, openTab, closeTab, activateTab, reconcileTabs,
  loadTabs, saveTabs,
} from './tabs'
import { createMemoryStore } from '@/core/storage/appState'

describe('openTab', () => {
  it('opens a new tab and focuses it', () => {
    const s = openTab(EMPTY_TABS, 'a1')
    expect(s.openTabIds).toEqual(['a1'])
    expect(s.activeTabId).toBe('a1')
  })
  it('does not duplicate an open tab but refocuses it', () => {
    let s = openTab(EMPTY_TABS, 'a1')
    s = openTab(s, 'a2')
    s = openTab(s, 'a1')
    expect(s.openTabIds).toEqual(['a1', 'a2'])
    expect(s.activeTabId).toBe('a1')
  })
  it('does not mutate input', () => {
    const s = openTab(EMPTY_TABS, 'a1')
    expect(EMPTY_TABS.openTabIds).toHaveLength(0)
    expect(s).not.toBe(EMPTY_TABS)
  })
})

describe('closeTab', () => {
  it('removes the tab and focuses the right neighbour', () => {
    let s = openTab(EMPTY_TABS, 'a1')
    s = openTab(s, 'a2')
    s = openTab(s, 'a3')
    s = activateTab(s, 'a2')
    s = closeTab(s, 'a2')
    expect(s.openTabIds).toEqual(['a1', 'a3'])
    expect(s.activeTabId).toBe('a3')
  })
  it('focuses the left neighbour when closing the last (active) tab', () => {
    let s = openTab(EMPTY_TABS, 'a1')
    s = openTab(s, 'a2')
    s = closeTab(s, 'a2')
    expect(s.openTabIds).toEqual(['a1'])
    expect(s.activeTabId).toBe('a1')
  })
  it('active becomes null when the only tab is closed', () => {
    let s = openTab(EMPTY_TABS, 'a1')
    s = closeTab(s, 'a1')
    expect(s.openTabIds).toEqual([])
    expect(s.activeTabId).toBeNull()
  })
  it('keeps active unchanged when closing a non-active tab', () => {
    let s = openTab(EMPTY_TABS, 'a1')
    s = openTab(s, 'a2')
    s = closeTab(s, 'a1')
    expect(s.openTabIds).toEqual(['a2'])
    expect(s.activeTabId).toBe('a2')
  })
  it('is a no-op for a tab that is not open', () => {
    const s = openTab(EMPTY_TABS, 'a1')
    expect(closeTab(s, 'nope')).toBe(s)
  })
})

describe('activateTab', () => {
  it('activates only an open tab', () => {
    let s = openTab(EMPTY_TABS, 'a1')
    s = openTab(s, 'a2')
    expect(activateTab(s, 'a1').activeTabId).toBe('a1')
    expect(activateTab(s, 'nope')).toBe(s)
  })
})

describe('reconcileTabs', () => {
  it('drops tabs whose account no longer exists', () => {
    let s = openTab(EMPTY_TABS, 'a1')
    s = openTab(s, 'a2')
    const r = reconcileTabs(s, ['a1'])
    expect(r.openTabIds).toEqual(['a1'])
    expect(r.activeTabId).toBe('a1')
  })
  it('auto-opens the sole account when nothing is open', () => {
    const r = reconcileTabs(EMPTY_TABS, ['only'])
    expect(r.openTabIds).toEqual(['only'])
    expect(r.activeTabId).toBe('only')
  })
  it('does not auto-open when several accounts exist and none are open', () => {
    const r = reconcileTabs(EMPTY_TABS, ['a1', 'a2'])
    expect(r.openTabIds).toEqual([])
    expect(r.activeTabId).toBeNull()
  })
  it('repairs an invalid activeTabId to the first open tab', () => {
    const s = { openTabIds: ['a1', 'a2'], activeTabId: 'gone' }
    expect(reconcileTabs(s, ['a1', 'a2']).activeTabId).toBe('a1')
  })
})

describe('loadTabs/saveTabs', () => {
  it('persists under tabs.json and reloads', async () => {
    const store = createMemoryStore()
    const s = openTab(EMPTY_TABS, 'a1')
    await saveTabs(store, s)
    expect(await loadTabs(store)).toEqual(s)
  })
  it('returns a fresh EMPTY_TABS shape when nothing saved', async () => {
    const loaded = await loadTabs(createMemoryStore())
    expect(loaded).toEqual(EMPTY_TABS)
    expect(loaded.openTabIds).not.toBe(EMPTY_TABS.openTabIds)
  })
})
