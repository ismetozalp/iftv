import { describe, it, expect } from 'vitest'
import {
  emptyLibrary,
  isFavorite,
  toggleFavorite,
  addWatchLater,
  removeWatchLater,
  createList,
  renameList,
  deleteList,
  addToList,
  removeFromList,
  upsertProgress,
  removeProgress,
  recordHistory,
  clearHistory,
  filterSortWatchLater,
} from './library'

const A = { id: 'acc1' } as any
const B = { id: 'acc2' } as any
const movie = { id: 'x:movie:9', kind: 'movie', name: 'Zed Film' } as any
const ep = { id: 'x:episode:3', kind: 'episode', name: 'Ep' } as any
const series = { id: 'x:series:7', kind: 'series', name: 'A Series' } as any
const live = { id: 'x:live:1', kind: 'live', name: 'Live Ch' } as any

describe('emptyLibrary', () => {
  it('returns all-empty collections', () => {
    expect(emptyLibrary()).toEqual({
      favorites: [],
      watchLater: [],
      lists: [],
      continueWatching: [],
      history: [],
    })
  })
})

describe('toggleFavorite / isFavorite', () => {
  it('toggleFavorite adds then removes, newest first, immutable', () => {
    const d0 = emptyLibrary()
    const d1 = toggleFavorite(d0, A, movie, 100)
    expect(isFavorite(d1, 'acc1', 'x:movie:9')).toBe(true)
    expect(d1.favorites[0]).toMatchObject({ accountId: 'acc1', addedAt: 100 })
    expect(d0.favorites.length).toBe(0) // original untouched
    expect(isFavorite(toggleFavorite(d1, A, movie, 200), 'acc1', 'x:movie:9')).toBe(false)
  })

  it('scopes favorites per account', () => {
    let d = toggleFavorite(emptyLibrary(), A, movie, 1)
    d = toggleFavorite(d, B, movie, 2)
    expect(isFavorite(d, 'acc1', 'x:movie:9')).toBe(true)
    expect(isFavorite(d, 'acc2', 'x:movie:9')).toBe(true)
    d = toggleFavorite(d, A, movie, 3)
    expect(isFavorite(d, 'acc1', 'x:movie:9')).toBe(false)
    expect(isFavorite(d, 'acc2', 'x:movie:9')).toBe(true)
  })

  it('newest favorite is prepended to the front', () => {
    let d = toggleFavorite(emptyLibrary(), A, movie, 1)
    d = toggleFavorite(d, A, ep, 2)
    expect(d.favorites[0].item.id).toBe('x:episode:3')
    expect(d.favorites[1].item.id).toBe('x:movie:9')
  })
})

describe('watch later', () => {
  it('addWatchLater adds and dedups (no-op if already present)', () => {
    let d = addWatchLater(emptyLibrary(), A, movie, 1)
    expect(d.watchLater.length).toBe(1)
    d = addWatchLater(d, A, movie, 2)
    expect(d.watchLater.length).toBe(1)
    expect(d.watchLater[0].addedAt).toBe(1) // no-op, unchanged
  })

  it('removeWatchLater removes matching entry, is a no-op otherwise', () => {
    let d = addWatchLater(emptyLibrary(), A, movie, 1)
    d = removeWatchLater(d, 'acc1', 'x:movie:9')
    expect(d.watchLater.length).toBe(0)
    expect(() => removeWatchLater(d, 'acc1', 'x:movie:9')).not.toThrow()
  })
})

describe('lists', () => {
  it('create, add, dedup', () => {
    let d = createList(emptyLibrary(), 'Weekend', 1)
    const id = d.lists[0].id
    d = addToList(d, id, A, movie, 2)
    d = addToList(d, id, A, movie, 3) // dedup
    expect(d.lists[0].entries.length).toBe(1)
  })

  it('createList derives id from now + name (no Math.random)', () => {
    const d1 = createList(emptyLibrary(), 'Weekend', 42)
    const d2 = createList(emptyLibrary(), 'Weekend', 42)
    expect(d1.lists[0].id).toBe(d2.lists[0].id)
    expect(d1.lists[0].name).toBe('Weekend')
    expect(d1.lists[0].createdAt).toBe(42)
  })

  it('renameList updates only the matching list', () => {
    let d = createList(emptyLibrary(), 'Weekend', 1)
    d = createList(d, 'Other', 2)
    const targetId = d.lists.find((l) => l.name === 'Weekend')!.id
    d = renameList(d, targetId, 'Weekend Trip')
    expect(d.lists.find((l) => l.id === targetId)!.name).toBe('Weekend Trip')
    expect(d.lists.find((l) => l.name === 'Other')).toBeTruthy()
  })

  it('deleteList removes the list', () => {
    let d = createList(emptyLibrary(), 'Weekend', 1)
    const id = d.lists[0].id
    d = deleteList(d, id)
    expect(d.lists.length).toBe(0)
  })

  it('removeFromList removes only the matching item for the matching account', () => {
    let d = createList(emptyLibrary(), 'Weekend', 1)
    const id = d.lists[0].id
    d = addToList(d, id, A, movie, 2)
    d = addToList(d, id, B, movie, 3)
    d = removeFromList(d, id, 'x:movie:9', 'acc1')
    const entries = d.lists[0].entries
    expect(entries.length).toBe(1)
    expect(entries[0].accountId).toBe('acc2')
  })
})

describe('continue watching / upsertProgress', () => {
  it('upsertProgress dedups, drops at >=92% watched, caps 100', () => {
    let d = upsertProgress(emptyLibrary(), A, movie, 600, 5400, 1) // 11%
    expect(d.continueWatching.length).toBe(1)
    d = upsertProgress(d, A, movie, 1200, 5400, 2) // same item -> update
    expect(d.continueWatching.length).toBe(1)
    expect(d.continueWatching[0].offsetSeconds).toBe(1200)
    d = upsertProgress(d, A, movie, 5100, 5400, 3) // 94% -> finished, dropped
    expect(d.continueWatching.length).toBe(0)
  })

  it('does not drop progress when durationSeconds is null (unknown duration)', () => {
    const d = upsertProgress(emptyLibrary(), A, movie, 999999, null, 1)
    expect(d.continueWatching.length).toBe(1)
    expect(d.continueWatching[0].durationSeconds).toBeNull()
  })

  it('caps continueWatching at 100 newest entries', () => {
    let d = emptyLibrary()
    for (let i = 0; i < 105; i++) {
      const item = { id: `x:movie:${i}`, kind: 'movie', name: `M${i}` } as any
      d = upsertProgress(d, A, item, 10, 1000, i)
    }
    expect(d.continueWatching.length).toBe(100)
    expect(d.continueWatching[0].item.id).toBe('x:movie:104')
  })

  it('removeProgress removes the matching entry', () => {
    let d = upsertProgress(emptyLibrary(), A, movie, 10, 1000, 1)
    d = removeProgress(d, 'acc1', 'x:movie:9')
    expect(d.continueWatching.length).toBe(0)
  })
})

describe('history', () => {
  it('recordHistory prepends, dedups consecutive same item, caps 300', () => {
    let d = recordHistory(emptyLibrary(), A, movie, 1)
    d = recordHistory(d, A, movie, 2) // consecutive same -> still one
    expect(d.history.length).toBe(1)
    expect(d.history[0].watchedAt).toBe(2)
  })

  it('recordHistory stores durationSeconds (so an episode can be replayed with a seekbar)', () => {
    let d = recordHistory(emptyLibrary(), A, movie, 1, 5400)
    expect(d.history[0].durationSeconds).toBe(5400)
    // a later consecutive play refreshes both timestamp and duration
    d = recordHistory(d, A, movie, 2, 5401)
    expect(d.history.length).toBe(1)
    expect(d.history[0]).toMatchObject({ watchedAt: 2, durationSeconds: 5401 })
    // duration is optional (default null) for items recorded without a known runtime
    expect(recordHistory(emptyLibrary(), A, series, 1).history[0].durationSeconds).toBeNull()
  })

  it('records a new entry when the most recent item differs', () => {
    let d = recordHistory(emptyLibrary(), A, movie, 1)
    d = recordHistory(d, A, series, 2)
    expect(d.history.length).toBe(2)
    expect(d.history[0].item.id).toBe('x:series:7')
    expect(d.history[1].item.id).toBe('x:movie:9')
  })

  it('caps history at 300 newest entries', () => {
    let d = emptyLibrary()
    for (let i = 0; i < 305; i++) {
      const item = { id: `x:movie:${i}`, kind: 'movie', name: `M${i}` } as any
      d = recordHistory(d, A, item, i)
    }
    expect(d.history.length).toBe(300)
    expect(d.history[0].item.id).toBe('x:movie:304')
  })

  it('clearHistory empties history only', () => {
    let d = recordHistory(emptyLibrary(), A, movie, 1)
    d = toggleFavorite(d, A, movie, 2)
    d = clearHistory(d)
    expect(d.history.length).toBe(0)
    expect(d.favorites.length).toBe(1)
  })
})

describe('filterSortWatchLater', () => {
  const entries = [
    { item: movie, accountId: 'acc1', addedAt: 2 },
    { item: ep, accountId: 'acc1', addedAt: 1 },
  ] as any

  it('filters by kind', () => {
    expect(filterSortWatchLater(entries, { kind: 'movie', query: '', sort: 'added' })).toHaveLength(1)
  })

  it('kind "series" matches both episode and series items', () => {
    const mixed = [
      { item: series, accountId: 'acc1', addedAt: 1 },
      { item: ep, accountId: 'acc1', addedAt: 2 },
      { item: live, accountId: 'acc1', addedAt: 3 },
    ] as any
    expect(filterSortWatchLater(mixed, { kind: 'series', query: '', sort: 'added' })).toHaveLength(2)
  })

  it('filters by case-insensitive search query', () => {
    expect(filterSortWatchLater(entries, { kind: 'all', query: 'zed', sort: 'added' })).toHaveLength(1)
    expect(filterSortWatchLater(entries, { kind: 'all', query: 'ZED', sort: 'added' })).toHaveLength(1)
    expect(filterSortWatchLater(entries, { kind: 'all', query: 'nomatch', sort: 'added' })).toHaveLength(0)
  })

  it('sorts by added desc by default and by name otherwise', () => {
    expect(filterSortWatchLater(entries, { kind: 'all', query: '', sort: 'added' })[0].item.name).toBe('Zed Film')
    expect(filterSortWatchLater(entries, { kind: 'all', query: '', sort: 'name' })[0].item.name).toBe('Ep')
  })

  it('does not mutate the input array', () => {
    const copy = [...entries]
    filterSortWatchLater(entries, { kind: 'all', query: '', sort: 'name' })
    expect(entries).toEqual(copy)
  })
})
