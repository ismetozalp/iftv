<script setup lang="ts">
import { ref, computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useCollectionsStore } from '@/stores/collections'
import { usePlayerStore } from '@/stores/player'
import { useDetailStore } from '@/stores/detail'
import { filterSortWatchLater, type WatchLaterFilter } from '@/core/library/library'
import type { ContentItem } from '@/core/content/types'
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

function onPlay(item: ContentItem) {
  const account = ws.activeAccount
  if (!account) return
  if (item.kind === 'live') player.play(account, item)
  else if (item.kind === 'movie') detail.openMovie(account, item)
  else if (item.kind === 'series') detail.openSeries(account, item)
  else if (item.kind === 'episode') player.play(account, item)
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

    <section v-else-if="tab === 'continue'" class="p-2">
      <p class="text-muted">Continue Watching is coming in the next step.</p>
    </section>

    <section v-else-if="tab === 'history'" class="p-2">
      <p class="text-muted">History is coming in the next step.</p>
    </section>
  </div>
</template>
