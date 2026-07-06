<script setup lang="ts">
import { ref, computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useCollectionsStore } from '@/stores/collections'
import { usePlayerStore } from '@/stores/player'
import { useDetailStore } from '@/stores/detail'
import { filterSortWatchLater, type WatchLaterFilter } from '@/core/library/library'
import type { ContentItem } from '@/core/content/types'
import type { ProgressEntry, HistoryEntry } from '@/core/library/types'
import VirtualGrid from '@/components/VirtualGrid.vue'
import ContentCard from '@/components/ContentCard.vue'

const ws = useWorkspaceStore()
const collections = useCollectionsStore()
const player = usePlayerStore()
const detail = useDetailStore()

type Tab = 'continue' | 'favorites' | 'watchlater' | 'lists' | 'history'
const tab = ref<Tab>('favorites')
const tabs: { id: Tab; label: string }[] = [
  { id: 'continue', label: 'Continue Watching' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'watchlater', label: 'Watch Later' },
  { id: 'lists', label: 'My Lists' },
  { id: 'history', label: 'History' },
]

function onPlay(item: ContentItem, durationSeconds: number | null = null) {
  const account = ws.activeAccount
  if (!account) return
  if (item.kind === 'live') player.play(account, item)
  else if (item.kind === 'movie') detail.openMovie(account, item)
  else if (item.kind === 'series') detail.openSeries(account, item)
  // Episodes have no detail route to re-fetch duration; pass the runtime captured at play time
  // (from a History entry) so the replay keeps its seekbar + progress tracking.
  else if (item.kind === 'episode') player.play(account, item, { durationSeconds: durationSeconds ?? undefined })
}

// --- Favorites ---
const favoriteItems = computed<ContentItem[]>(() => {
  const account = ws.activeAccount
  return account ? collections.favoritesOf(account.id).map((e) => e.item) : []
})
function removeFavorite(item: ContentItem) {
  const account = ws.activeAccount
  if (!account) return
  void collections.toggleFavorite(account, item)
}

// --- Watch later ---
const wlKind = ref<WatchLaterFilter['kind']>('all')
const wlQuery = ref('')
const wlSort = ref<WatchLaterFilter['sort']>('added')
const watchLaterItems = computed<ContentItem[]>(() => {
  const account = ws.activeAccount
  if (!account) return []
  const entries = collections.watchLaterOf(account.id)
  return filterSortWatchLater(entries, { kind: wlKind.value, query: wlQuery.value, sort: wlSort.value }).map(
    (e) => e.item,
  )
})
function removeWatchLater(item: ContentItem) {
  const account = ws.activeAccount
  if (!account) return
  void collections.removeWatchLater(account.id, item.id)
}

// --- Lists ---
const selectedListId = ref<string | null>(null)
const myLists = computed(() => {
  const account = ws.activeAccount
  return account ? collections.listsOf(account.id) : []
})
const selectedList = computed(() => collections.data.lists.find((l) => l.id === selectedListId.value) ?? null)
const selectedListItems = computed<ContentItem[]>(() => {
  const account = ws.activeAccount
  if (!account || !selectedList.value) return []
  return selectedList.value.entries.filter((e) => e.accountId === account.id).map((e) => e.item)
})
function openList(id: string) {
  selectedListId.value = id
}
function backToLists() {
  selectedListId.value = null
}
async function createNewList() {
  const name = window.prompt('New list name')
  if (!name || !name.trim()) return
  await collections.createList(name.trim())
}
async function renameList(id: string, currentName: string) {
  const name = window.prompt('Rename list', currentName)
  if (!name || !name.trim()) return
  await collections.renameList(id, name.trim())
}
async function deleteList(id: string) {
  if (!window.confirm('Delete this list?')) return
  await collections.deleteList(id)
  if (selectedListId.value === id) selectedListId.value = null
}
function removeFromSelectedList(item: ContentItem) {
  const account = ws.activeAccount
  if (!account || !selectedListId.value) return
  void collections.removeFromList(selectedListId.value, item.id, account.id)
}

// --- Continue watching ---
const continueWatchingEntries = computed<ProgressEntry[]>(() => {
  const account = ws.activeAccount
  return account ? collections.continueWatchingOf(account.id) : []
})
function progressPct(e: ProgressEntry): number {
  if (!e.durationSeconds || e.durationSeconds <= 0) return 0
  return Math.min(100, Math.max(0, (e.offsetSeconds / e.durationSeconds) * 100))
}
function resumeEntry(e: ProgressEntry) {
  const account = ws.activeAccount
  if (!account) return
  void player.play(account, e.item, { durationSeconds: e.durationSeconds, startOffsetSeconds: e.offsetSeconds })
}
function removeContinueWatching(e: ProgressEntry) {
  const account = ws.activeAccount
  if (!account) return
  void collections.removeProgress(account.id, e.item.id)
}

// --- History ---
const historyEntries = computed<HistoryEntry[]>(() => {
  const account = ws.activeAccount
  return account ? collections.historyOf(account.id) : []
})
function relativeTime(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}
async function onClearHistory() {
  if (!historyEntries.value.length) return
  if (!window.confirm('Clear all watch history?')) return
  await collections.clearHistory()
}
</script>

<template>
  <div class="h-100 d-flex flex-column">
    <nav class="btn-group btn-group-sm mb-2 align-self-start flex-wrap" role="group">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="btn"
        :class="t.id === tab ? 'btn-primary' : 'btn-outline-primary'"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </nav>

    <section v-if="tab === 'favorites'" class="iftv-grid-wrap flex-fill">
      <p v-if="!favoriteItems.length" class="text-muted p-2">No favorites yet.</p>
      <VirtualGrid v-else :items="favoriteItems" :item-width="150" :item-height="230">
        <template #default="{ item }">
          <ContentCard
            :item="(item as ContentItem)"
            context="library"
            @click="onPlay(item as ContentItem)"
            @remove="removeFavorite(item as ContentItem)"
          />
        </template>
      </VirtualGrid>
    </section>

    <section v-else-if="tab === 'watchlater'" class="iftv-grid-wrap flex-fill d-flex flex-column">
      <div class="d-flex gap-2 mb-2 flex-wrap">
        <select v-model="wlKind" class="form-select form-select-sm w-auto">
          <option value="all">Both</option>
          <option value="movie">Movies</option>
          <option value="series">Series</option>
        </select>
        <input v-model="wlQuery" class="form-control form-control-sm w-auto" placeholder="Search…" />
        <select v-model="wlSort" class="form-select form-select-sm w-auto">
          <option value="added">Added</option>
          <option value="name">Name</option>
        </select>
      </div>
      <p v-if="!watchLaterItems.length" class="text-muted p-2">Nothing in Watch Later.</p>
      <VirtualGrid v-else :items="watchLaterItems" :item-width="150" :item-height="230" class="flex-fill">
        <template #default="{ item }">
          <ContentCard
            :item="(item as ContentItem)"
            context="library"
            @click="onPlay(item as ContentItem)"
            @remove="removeWatchLater(item as ContentItem)"
          />
        </template>
      </VirtualGrid>
    </section>

    <section v-else-if="tab === 'lists'" class="iftv-grid-wrap flex-fill d-flex flex-column">
      <template v-if="!selectedList">
        <button type="button" class="btn btn-sm btn-outline-primary mb-2 align-self-start" @click="createNewList">
          ＋ New list
        </button>
        <p v-if="!myLists.length" class="text-muted p-2">No lists yet.</p>
        <ul v-else class="list-group">
          <li
            v-for="l in myLists"
            :key="l.id"
            class="list-group-item d-flex justify-content-between align-items-center"
          >
            <span role="button" class="flex-fill" @click="openList(l.id)">{{ l.name }} ({{ l.count }})</span>
            <span class="d-flex gap-1">
              <button type="button" class="btn btn-sm btn-outline-secondary" @click="renameList(l.id, l.name)">
                Rename
              </button>
              <button type="button" class="btn btn-sm btn-outline-danger" @click="deleteList(l.id)">Delete</button>
            </span>
          </li>
        </ul>
      </template>
      <template v-else>
        <button type="button" class="btn btn-sm btn-outline-secondary mb-2 align-self-start" @click="backToLists">
          ← Back to lists
        </button>
        <h5>{{ selectedList.name }}</h5>
        <p v-if="!selectedListItems.length" class="text-muted p-2">This list is empty.</p>
        <VirtualGrid v-else :items="selectedListItems" :item-width="150" :item-height="230" class="flex-fill">
          <template #default="{ item }">
            <ContentCard
              :item="(item as ContentItem)"
              context="library"
              @click="onPlay(item as ContentItem)"
              @remove="removeFromSelectedList(item as ContentItem)"
            />
          </template>
        </VirtualGrid>
      </template>
    </section>

    <section v-else-if="tab === 'continue'" class="iftv-grid-wrap flex-fill">
      <p v-if="!continueWatchingEntries.length" class="text-muted p-2">Nothing in progress.</p>
      <VirtualGrid v-else :items="continueWatchingEntries" :item-width="150" :item-height="230">
        <template #default="{ item }">
          <div class="iftv-cw-cell">
            <ContentCard
              :item="(item as ProgressEntry).item"
              context="library"
              @click="resumeEntry(item as ProgressEntry)"
              @remove="removeContinueWatching(item as ProgressEntry)"
            />
            <div class="iftv-cw-progress">
              <div class="iftv-cw-progress-bar" :style="{ width: progressPct(item as ProgressEntry) + '%' }"></div>
            </div>
          </div>
        </template>
      </VirtualGrid>
    </section>

    <section v-else-if="tab === 'history'" class="p-2 flex-fill d-flex flex-column">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h5 class="mb-0">History</h5>
        <button
          type="button"
          class="btn btn-sm btn-outline-danger"
          :disabled="!historyEntries.length"
          @click="onClearHistory"
        >
          Clear history
        </button>
      </div>
      <p v-if="!historyEntries.length" class="text-muted p-2">No history yet.</p>
      <ul v-else class="list-group iftv-history-list overflow-auto flex-fill">
        <li
          v-for="(h, i) in historyEntries"
          :key="h.accountId + ':' + h.item.id + ':' + i"
          class="list-group-item d-flex justify-content-between align-items-center"
          role="button"
          @click="onPlay(h.item, h.durationSeconds)"
        >
          <span class="text-truncate">{{ h.item.name }}</span>
          <span class="text-muted small ms-2 flex-shrink-0">{{ relativeTime(h.watchedAt) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
