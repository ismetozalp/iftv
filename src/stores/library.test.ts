import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLibraryStore } from './library'
import type { ContentProvider } from '@/core/content/provider'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const ACCT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h', username: 'u', password: 'p', createdAt: 1 }
const CHANS: ContentItem[] = [
  { id: 'x:live:1', kind: 'live', name: 'CNN', logo: '', categoryId: '1', streamId: '1', seriesId: null, containerExtension: null, url: null },
  { id: 'x:live:2', kind: 'live', name: 'BBC News', logo: '', categoryId: '1', streamId: '2', seriesId: null, containerExtension: null, url: null },
  { id: 'x:live:3', kind: 'live', name: 'ESPN', logo: '', categoryId: '2', streamId: '3', seriesId: null, containerExtension: null, url: null },
]
function fakeProvider(): ContentProvider {
  return {
    getCategories: vi.fn(async () => [{ id: '1', name: 'News' }, { id: '2', name: 'Sports' }]),
    getItems: vi.fn(async (catId) => CHANS.filter((c) => c.categoryId === catId)),
    getAllItems: vi.fn(async () => CHANS),
  }
}

describe('useLibraryStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('setAccount loads categories', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => fakeProvider() })
    await s.setAccount(ACCT)
    expect(s.accountId).toBe('a')
    expect(s.categories.map((c) => c.name)).toEqual(['News', 'Sports'])
  })

  it('loadCategory caches channels and itemsFor reads them', async () => {
    const p = fakeProvider()
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => p })
    await s.setAccount(ACCT)
    await s.loadCategory('1')
    expect(s.itemsFor('1').map((c) => c.name)).toEqual(['CNN', 'BBC News'])
    await s.loadCategory('1') // cached: no second call
    expect((p.getItems as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === '1')).toHaveLength(1)
  })

  it('search filters all channels case-insensitively by name', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => fakeProvider() })
    await s.setAccount(ACCT)
    expect((await s.search('news')).map((c) => c.name)).toEqual(['BBC News'])
    expect(await s.search('')).toEqual([])
  })

  it('switching account resets categories and cache', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => fakeProvider() })
    await s.setAccount(ACCT)
    await s.loadCategory('1')
    await s.setAccount({ ...ACCT, id: 'b' })
    expect(s.accountId).toBe('b')
    expect(s.itemsFor('1')).toEqual([])
  })

  it('setAccount(null) clears everything', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => fakeProvider() })
    await s.setAccount(ACCT)
    await s.setAccount(null)
    expect(s.accountId).toBeNull()
    expect(s.categories).toEqual([])
  })

  it('records an error when the provider throws', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => ({ getCategories: async () => { throw new Error('boom') }, getItems: async () => [], getAllItems: async () => [] }) })
    await s.setAccount(ACCT)
    expect(s.error).toMatch(/boom/)
  })
})
