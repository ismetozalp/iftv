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

  it('setContext loads categories', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: (_account, _section) => fakeProvider() })
    await s.setContext(ACCT, 'live')
    expect(s.accountId).toBe('a')
    expect(s.categories.map((c) => c.name)).toEqual(['News', 'Sports'])
  })

  it('loadCategory caches channels and itemsFor reads them', async () => {
    const p = fakeProvider()
    const s = useLibraryStore()
    s.$configure({ makeProvider: (_account, _section) => p })
    await s.setContext(ACCT, 'live')
    await s.loadCategory('1')
    expect(s.itemsFor('1').map((c) => c.name)).toEqual(['CNN', 'BBC News'])
    await s.loadCategory('1') // cached: no second call
    expect((p.getItems as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === '1')).toHaveLength(1)
  })

  it('search filters all channels case-insensitively by name', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: (_account, _section) => fakeProvider() })
    await s.setContext(ACCT, 'live')
    expect((await s.search('news')).map((c) => c.name)).toEqual(['BBC News'])
    expect(await s.search('')).toEqual([])
  })

  it('switching account resets categories and cache', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: (_account, _section) => fakeProvider() })
    await s.setContext(ACCT, 'live')
    await s.loadCategory('1')
    await s.setContext({ ...ACCT, id: 'b' }, 'live')
    expect(s.accountId).toBe('b')
    expect(s.itemsFor('1')).toEqual([])
  })

  it('switching section resets and rebuilds', async () => {
    const s = useLibraryStore()
    let built = 0
    s.$configure({ makeProvider: () => { built++; return fakeProvider() } })
    await s.setContext(ACCT, 'live')
    await s.loadCategory('1')
    await s.setContext(ACCT, 'vod')
    expect(s.section).toBe('vod')
    expect(s.itemsFor('1')).toEqual([])
    expect(built).toBe(2)
  })

  it('setContext(null) clears everything', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: (_account, _section) => fakeProvider() })
    await s.setContext(ACCT, 'live')
    await s.setContext(null, 'live')
    expect(s.accountId).toBeNull()
    expect(s.categories).toEqual([])
  })

  it('records an error when the provider throws', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => ({ getCategories: async () => { throw new Error('boom') }, getItems: async () => [], getAllItems: async () => [] }) })
    await s.setContext(ACCT, 'live')
    expect(s.error).toMatch(/boom/)
  })

  it('allLiveItems fetches all live channels for the account via the "live" section provider, independent of setContext state', async () => {
    const s = useLibraryStore()
    let seenSection: string | null = null
    s.$configure({
      makeProvider: (_account, section) => {
        seenSection = section
        return fakeProvider()
      },
    })
    // Not in "live" context — allLiveItems must still force the live section and must not
    // disturb the browse-context state (categories/itemsByCat/accountId).
    await s.setContext(ACCT, 'vod')
    const items = await s.allLiveItems(ACCT)
    expect(items.map((c) => c.name)).toEqual(['CNN', 'BBC News', 'ESPN'])
    expect(seenSection).toBe('live')
    expect(s.section).toBe('vod')
  })
})
