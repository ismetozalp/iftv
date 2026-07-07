import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCollectionsStore } from './collections'
import { createMemoryStore } from '@/core/storage/appState'
import { emptyLibrary } from '@/core/library/library'

const A = { id: 'acc1' } as any
const B = { id: 'acc2' } as any
const movie = { id: 'x:movie:9', kind: 'movie', name: 'Zed Film' } as any
const ep = { id: 'x:episode:3', kind: 'episode', name: 'Ep' } as any

describe('useCollectionsStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('defaults to an empty library before loading', () => {
    const c = useCollectionsStore()
    expect(c.data).toEqual(emptyLibrary())
  })

  it('load falls back to an empty library when nothing is persisted yet', async () => {
    const store = createMemoryStore()
    const c = useCollectionsStore()
    c.$configure({ store })
    await c.load()
    expect(c.data).toEqual(emptyLibrary())
  })

  it('a mutation before load() completes does NOT clobber the persisted library (fire-and-forget load race)', async () => {
    // Simulates App.vue firing `void collections.load()` while the file already has favorites, and a
    // play immediately recording history before the load resolves — the persisted favorites must survive.
    const seeded = { ...emptyLibrary(), favorites: [{ item: movie, accountId: 'acc1', addedAt: 5 }] }
    const store = createMemoryStore({ 'library.json': seeded })
    const c = useCollectionsStore()
    c.$configure({ store })
    // NOTE: no explicit `await c.load()` here — recordHistory must load-then-mutate, not persist over empty.
    await c.recordHistory(A, movie, null)
    expect(c.data.favorites).toHaveLength(1) // in-memory kept the favorite
    const persisted = await store.load('library.json', emptyLibrary())
    expect(persisted.favorites).toHaveLength(1) // and it was NOT wiped on disk
    expect(persisted.history).toHaveLength(1) // history still recorded
  })

  it('load reads persisted data', async () => {
    const seeded = { ...emptyLibrary(), favorites: [{ item: movie, accountId: 'acc1', addedAt: 5 }] }
    const store = createMemoryStore({ 'library.json': seeded })
    const c = useCollectionsStore()
    c.$configure({ store })
    await c.load()
    expect(c.data.favorites).toHaveLength(1)
  })

  it('load back-compat: an old library.json missing newer keys gets them defaulted', async () => {
    const store = createMemoryStore({ 'library.json': { favorites: [] } })
    const c = useCollectionsStore()
    c.$configure({ store })
    await c.load()
    expect(c.data).toEqual(emptyLibrary())
  })

  it('toggleFavorite applies the op and persists (verified via a fresh reload)', async () => {
    const store = createMemoryStore()
    const c = useCollectionsStore()
    c.$configure({ store })
    await c.load()
    await c.toggleFavorite(A, movie)
    expect(c.isFavorite('acc1', 'x:movie:9')).toBe(true)

    const c2 = useCollectionsStore()
    c2.$configure({ store })
    await c2.load()
    expect(c2.isFavorite('acc1', 'x:movie:9')).toBe(true)
  })

  it('addWatchLater / removeWatchLater apply and persist', async () => {
    const store = createMemoryStore()
    const c = useCollectionsStore()
    c.$configure({ store })
    await c.load()
    await c.addWatchLater(A, movie)
    expect(c.watchLaterOf('acc1')).toHaveLength(1)
    await c.removeWatchLater('acc1', 'x:movie:9')
    expect(c.watchLaterOf('acc1')).toHaveLength(0)

    const c2 = useCollectionsStore()
    c2.$configure({ store })
    await c2.load()
    expect(c2.watchLaterOf('acc1')).toHaveLength(0)
  })

  it('createList / addToList / removeFromList / renameList / deleteList apply and persist', async () => {
    const store = createMemoryStore()
    const c = useCollectionsStore()
    c.$configure({ store })
    await c.load()
    await c.createList('Weekend')
    const listId = c.data.lists[0].id
    await c.addToList(listId, A, movie)
    expect(c.listsOf('acc1')[0].count).toBe(1)
    await c.renameList(listId, 'Weekend Trip')
    expect(c.data.lists[0].name).toBe('Weekend Trip')
    await c.removeFromList(listId, 'x:movie:9', 'acc1')
    expect(c.listsOf('acc1')[0].count).toBe(0)
    await c.deleteList(listId)
    expect(c.data.lists).toHaveLength(0)

    const c2 = useCollectionsStore()
    c2.$configure({ store })
    await c2.load()
    expect(c2.data.lists).toHaveLength(0)
  })

  it('saveProgress / removeProgress apply and persist', async () => {
    const store = createMemoryStore()
    const c = useCollectionsStore()
    c.$configure({ store })
    await c.load()
    await c.saveProgress(A, movie, 600, 5400)
    expect(c.continueWatchingOf('acc1')).toHaveLength(1)
    await c.removeProgress('acc1', 'x:movie:9')
    expect(c.continueWatchingOf('acc1')).toHaveLength(0)

    const c2 = useCollectionsStore()
    c2.$configure({ store })
    await c2.load()
    expect(c2.continueWatchingOf('acc1')).toHaveLength(0)
  })

  it('saveProgress drops the entry once past the finished threshold and persists the drop', async () => {
    const store = createMemoryStore()
    const c = useCollectionsStore()
    c.$configure({ store })
    await c.load()
    await c.saveProgress(A, movie, 5100, 5400)
    expect(c.continueWatchingOf('acc1')).toHaveLength(0)
  })

  it('recordHistory / clearHistory apply and persist', async () => {
    const store = createMemoryStore()
    const c = useCollectionsStore()
    c.$configure({ store })
    await c.load()
    await c.recordHistory(A, movie)
    expect(c.historyOf('acc1')).toHaveLength(1)
    await c.clearHistory()
    expect(c.historyOf('acc1')).toHaveLength(0)

    const c2 = useCollectionsStore()
    c2.$configure({ store })
    await c2.load()
    expect(c2.historyOf('acc1')).toHaveLength(0)
  })

  it('scoped getters filter entries by account', async () => {
    const store = createMemoryStore()
    const c = useCollectionsStore()
    c.$configure({ store })
    await c.load()
    await c.toggleFavorite(A, movie)
    await c.toggleFavorite(B, ep)
    await c.addWatchLater(A, movie)
    await c.recordHistory(B, ep)
    await c.saveProgress(A, movie, 10, 1000)

    expect(c.favoritesOf('acc1')).toHaveLength(1)
    expect(c.favoritesOf('acc2')).toHaveLength(1)
    expect(c.watchLaterOf('acc1')).toHaveLength(1)
    expect(c.watchLaterOf('acc2')).toHaveLength(0)
    expect(c.historyOf('acc2')).toHaveLength(1)
    expect(c.historyOf('acc1')).toHaveLength(0)
    expect(c.continueWatchingOf('acc1')).toHaveLength(1)
    expect(c.isFavorite('acc1', 'x:movie:9')).toBe(true)
    expect(c.isFavorite('acc2', 'x:movie:9')).toBe(false)
  })
})
