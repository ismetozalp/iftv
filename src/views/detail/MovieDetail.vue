<script setup lang="ts">
import { computed } from 'vue'
import { useDetailStore } from '@/stores/detail'
import { useWorkspaceStore } from '@/stores/workspace'
import { usePlayerStore } from '@/stores/player'
import { useCollectionsStore } from '@/stores/collections'
import { useProxiedImage } from '@/composables/useProxiedImage'
import AnchoredMenu from '@/components/AnchoredMenu.vue'

const detail = useDetailStore()
const ws = useWorkspaceStore()
const player = usePlayerStore()
const collections = useCollectionsStore()
const { url: posterUrl, failed: posterFailed } = useProxiedImage(() => detail.movie?.poster)

const isFav = computed(() => {
  const account = ws.activeAccount
  const item = detail.item
  return !!account && !!item && collections.isFavorite(account.id, item.id)
})
const lists = computed(() => {
  const account = ws.activeAccount
  return account ? collections.listsOf(account.id) : []
})

function toggleFavorite() {
  const account = ws.activeAccount
  const item = detail.item
  if (!account || !item) return
  void collections.toggleFavorite(account, item)
}
function addToWatchLater() {
  const account = ws.activeAccount
  const item = detail.item
  if (!account || !item) return
  void collections.addWatchLater(account, item)
}
function addToExistingList(listId: string) {
  const account = ws.activeAccount
  const item = detail.item
  if (!account || !item) return
  void collections.addToList(listId, account, item)
}
async function addToNewList() {
  const account = ws.activeAccount
  const item = detail.item
  if (!account || !item) return
  const name = window.prompt('New list name')
  if (!name || !name.trim()) return
  await collections.createList(name.trim())
  const created = collections.listsOf(account.id)[0]
  if (created) await collections.addToList(created.id, account, item)
}

const durationLabel = computed(() => {
  const secs = detail.movie?.durationSecs
  if (!secs) return ''
  const mins = Math.round(secs / 60)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
})

function play() {
  const account = ws.activeAccount
  const item = detail.item
  const movie = detail.movie
  if (!account || !item) return
  const playItem = movie ? { ...item, containerExtension: movie.containerExtension || item.containerExtension } : item
  player.play(account, playItem, { durationSeconds: movie?.durationSecs || null })
  detail.close()
}

function close() {
  detail.close()
}
</script>

<template>
  <div v-if="detail.open && detail.mode === 'movie' && detail.movie" class="iftv-detail">
    <div class="iftv-detail-card">
      <button class="btn btn-sm btn-light iftv-detail-close" @click="close">✕ Close</button>
      <div class="iftv-detail-body d-flex gap-3">
        <div class="iftv-detail-poster">
          <img v-if="posterUrl && !posterFailed" :src="posterUrl" alt="" @error="posterFailed = true" />
          <span v-else class="iftv-detail-poster-fallback">{{ detail.movie.name.slice(0, 2).toUpperCase() }}</span>
        </div>
        <div class="iftv-detail-info flex-fill">
          <h4>{{ detail.movie.name }}</h4>
          <p class="text-muted small mb-2">
            <span v-if="detail.movie.genre">{{ detail.movie.genre }}</span>
            <span v-if="detail.movie.genre && durationLabel"> · </span>
            <span v-if="durationLabel">{{ durationLabel }}</span>
          </p>
          <p v-if="detail.movie.plot">{{ detail.movie.plot }}</p>
          <p v-if="detail.movie.cast" class="small"><strong>Cast:</strong> {{ detail.movie.cast }}</p>
          <p v-if="detail.movie.director" class="small"><strong>Director:</strong> {{ detail.movie.director }}</p>
          <div class="d-flex gap-2 mt-2 flex-wrap align-items-start">
            <button class="btn btn-primary" @click="play">▶ Play</button>
            <button
              v-if="ws.activeAccount"
              type="button"
              class="btn btn-outline-secondary"
              :class="{ active: isFav }"
              @click="toggleFavorite"
            >
              <span v-if="isFav">★ Favorited</span>
              <span v-else>☆ Favorite</span>
            </button>
            <button v-if="ws.activeAccount" type="button" class="btn btn-outline-secondary" @click="addToWatchLater">
              ＋ Watch Later
            </button>
            <AnchoredMenu v-if="ws.activeAccount" align="start">
              <template #trigger="{ toggle }">
                <button type="button" class="btn btn-outline-secondary dropdown-toggle" @click="toggle">
                  ＋ Add to list
                </button>
              </template>
              <template #default="{ close: closeMenu }">
                <button
                  v-for="l in lists"
                  :key="l.id"
                  type="button"
                  class="dropdown-item"
                  @click="addToExistingList(l.id); closeMenu()"
                >
                  {{ l.name }}
                </button>
                <button type="button" class="dropdown-item" @click="addToNewList(); closeMenu()">New list…</button>
              </template>
            </AnchoredMenu>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="detail.loading && detail.mode === 'movie'" class="iftv-detail">
    <div class="iftv-detail-card">
      <p class="text-body p-3">Loading…</p>
    </div>
  </div>
  <div v-else-if="detail.error && detail.mode === 'movie'" class="iftv-detail">
    <div class="iftv-detail-card">
      <button class="btn btn-sm btn-light iftv-detail-close" @click="close">✕ Close</button>
      <p class="text-danger p-3">{{ detail.error }}</p>
    </div>
  </div>
</template>
