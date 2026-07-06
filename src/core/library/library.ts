import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { LibraryData, LibraryEntry, LibraryList, ProgressEntry, HistoryEntry } from './types'

const HISTORY_CAP = 300
const CONTINUE_WATCHING_CAP = 100
const FINISHED_RATIO = 0.92

export interface WatchLaterFilter {
  kind: 'all' | 'movie' | 'series'
  query: string
  sort: 'added' | 'name'
}

export function emptyLibrary(): LibraryData {
  return { favorites: [], watchLater: [], lists: [], continueWatching: [], history: [] }
}

function isMatch(e: { accountId: string; item: ContentItem }, accountId: string, itemId: string): boolean {
  return e.accountId === accountId && e.item.id === itemId
}

function slugify(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'list'
}

// --- Favorites ---

export function isFavorite(d: LibraryData, accountId: string, itemId: string): boolean {
  return d.favorites.some((e) => isMatch(e, accountId, itemId))
}

export function toggleFavorite(d: LibraryData, account: Account, item: ContentItem, now: number): LibraryData {
  const present = d.favorites.some((e) => isMatch(e, account.id, item.id))
  const favorites = present
    ? d.favorites.filter((e) => !isMatch(e, account.id, item.id))
    : [{ item, accountId: account.id, addedAt: now }, ...d.favorites]
  return { ...d, favorites }
}

// --- Watch later ---

function addDedup(list: LibraryEntry[], account: Account, item: ContentItem, now: number): LibraryEntry[] {
  if (list.some((e) => isMatch(e, account.id, item.id))) return list
  return [{ item, accountId: account.id, addedAt: now }, ...list]
}

export function addWatchLater(d: LibraryData, account: Account, item: ContentItem, now: number): LibraryData {
  return { ...d, watchLater: addDedup(d.watchLater, account, item, now) }
}

export function removeWatchLater(d: LibraryData, accountId: string, itemId: string): LibraryData {
  return { ...d, watchLater: d.watchLater.filter((e) => !isMatch(e, accountId, itemId)) }
}

// --- Lists ---

export function createList(d: LibraryData, name: string, now: number): LibraryData {
  const list: LibraryList = { id: `list_${now}_${slugify(name)}`, name, createdAt: now, entries: [] }
  return { ...d, lists: [list, ...d.lists] }
}

export function renameList(d: LibraryData, listId: string, name: string): LibraryData {
  return { ...d, lists: d.lists.map((l) => (l.id === listId ? { ...l, name } : l)) }
}

export function deleteList(d: LibraryData, listId: string): LibraryData {
  return { ...d, lists: d.lists.filter((l) => l.id !== listId) }
}

export function addToList(d: LibraryData, listId: string, account: Account, item: ContentItem, now: number): LibraryData {
  return {
    ...d,
    lists: d.lists.map((l) => (l.id === listId ? { ...l, entries: addDedup(l.entries, account, item, now) } : l)),
  }
}

export function removeFromList(d: LibraryData, listId: string, itemId: string, accountId: string): LibraryData {
  return {
    ...d,
    lists: d.lists.map((l) =>
      l.id === listId ? { ...l, entries: l.entries.filter((e) => !isMatch(e, accountId, itemId)) } : l,
    ),
  }
}

// --- Continue watching / progress ---

export function removeProgress(d: LibraryData, accountId: string, itemId: string): LibraryData {
  return { ...d, continueWatching: d.continueWatching.filter((e) => !isMatch(e, accountId, itemId)) }
}

export function upsertProgress(
  d: LibraryData,
  account: Account,
  item: ContentItem,
  offsetSeconds: number,
  durationSeconds: number | null,
  now: number,
): LibraryData {
  const rest = d.continueWatching.filter((e) => !isMatch(e, account.id, item.id))
  const entry: ProgressEntry = { item, accountId: account.id, offsetSeconds, durationSeconds, updatedAt: now }
  const next = { ...d, continueWatching: [entry, ...rest] }
  if (durationSeconds != null && durationSeconds > 0 && offsetSeconds >= FINISHED_RATIO * durationSeconds) {
    return removeProgress(next, account.id, item.id)
  }
  return { ...next, continueWatching: next.continueWatching.slice(0, CONTINUE_WATCHING_CAP) }
}

// --- History ---

export function recordHistory(d: LibraryData, account: Account, item: ContentItem, now: number): LibraryData {
  const [first, ...rest] = d.history
  if (first && isMatch(first, account.id, item.id)) {
    return { ...d, history: [{ ...first, watchedAt: now }, ...rest] }
  }
  const entry: HistoryEntry = { item, accountId: account.id, watchedAt: now }
  return { ...d, history: [entry, ...d.history].slice(0, HISTORY_CAP) }
}

export function clearHistory(d: LibraryData): LibraryData {
  return { ...d, history: [] }
}

// --- Watch later filter/sort ---

export function filterSortWatchLater(entries: LibraryEntry[], opts: WatchLaterFilter): LibraryEntry[] {
  const query = opts.query.trim().toLowerCase()
  const filtered = entries.filter((e) => {
    const kindOk =
      opts.kind === 'all' ||
      (opts.kind === 'movie' && e.item.kind === 'movie') ||
      (opts.kind === 'series' && (e.item.kind === 'episode' || e.item.kind === 'series'))
    if (!kindOk) return false
    if (query && !e.item.name.toLowerCase().includes(query)) return false
    return true
  })
  return filtered.sort((a, b) => (opts.sort === 'name' ? a.item.name.localeCompare(b.item.name) : b.addedAt - a.addedAt))
}
