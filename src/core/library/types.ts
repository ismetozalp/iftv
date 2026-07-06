import type { ContentItem } from '@/core/content/types'

export interface LibraryEntry {
  item: ContentItem
  accountId: string
  addedAt: number
}

export interface LibraryList {
  id: string
  name: string
  createdAt: number
  entries: LibraryEntry[]
}

export interface ProgressEntry {
  item: ContentItem
  accountId: string
  offsetSeconds: number
  durationSeconds: number | null
  updatedAt: number
}

export interface HistoryEntry {
  durationSeconds: number | null
  item: ContentItem
  accountId: string
  watchedAt: number
}

export interface LibraryData {
  favorites: LibraryEntry[]
  watchLater: LibraryEntry[]
  lists: LibraryList[]
  continueWatching: ProgressEntry[]
  history: HistoryEntry[]
}
