<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { ContentItem } from '@/core/content/types'
import { useProxiedImage } from '@/composables/useProxiedImage'
import { useWorkspaceStore } from '@/stores/workspace'
import { useCollectionsStore } from '@/stores/collections'

const props = withDefaults(defineProps<{ item: ContentItem; context?: 'browse' | 'library' }>(), {
  context: 'browse',
})
const emit = defineEmits<{ remove: [] }>()

const { url, failed } = useProxiedImage(() => props.item.logo)

const ws = useWorkspaceStore()
const collections = useCollectionsStore()

const menuOpen = ref(false)

const canWatchLater = computed(
  () => props.item.kind === 'movie' || props.item.kind === 'series' || props.item.kind === 'episode',
)
const isFav = computed(() => {
  const account = ws.activeAccount
  return !!account && collections.isFavorite(account.id, props.item.id)
})
const lists = computed(() => {
  const account = ws.activeAccount
  return account ? collections.listsOf(account.id) : []
})

function toggleFavorite() {
  const account = ws.activeAccount
  if (!account) return
  void collections.toggleFavorite(account, props.item)
}
function toggleMenu() {
  menuOpen.value = !menuOpen.value
}
function closeMenu() {
  menuOpen.value = false
}
function addToWatchLater() {
  const account = ws.activeAccount
  if (!account) return
  void collections.addWatchLater(account, props.item)
  closeMenu()
}
function addToExistingList(listId: string) {
  const account = ws.activeAccount
  if (!account) return
  void collections.addToList(listId, account, props.item)
  closeMenu()
}
async function addToNewList() {
  const account = ws.activeAccount
  if (!account) return
  const name = window.prompt('New list name')
  if (!name || !name.trim()) return
  await collections.createList(name.trim())
  const created = collections.listsOf(account.id)[0]
  if (created) await collections.addToList(created.id, account, props.item)
  closeMenu()
}
function remove() {
  emit('remove')
}

function onDocClick() {
  menuOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="iftv-card card h-100" :class="`iftv-card-${item.kind}`" :title="item.name">
    <div class="iftv-card-img">
      <img v-if="url && !failed" :src="url" alt="" loading="lazy" @error="failed = true" />
      <span v-else class="iftv-card-fallback">{{ item.name.slice(0, 2).toUpperCase() }}</span>
    </div>
    <div class="iftv-card-name text-truncate">{{ item.name }}</div>

    <div v-if="ws.activeAccount" class="iftv-card-actions" @click.stop>
      <button
        type="button"
        class="btn btn-sm iftv-card-fav"
        :class="{ 'iftv-card-fav-active': isFav }"
        :title="isFav ? 'Remove favorite' : 'Add to favorites'"
        @click.stop="toggleFavorite"
      >
        <span v-if="isFav">★</span>
        <span v-else>☆</span>
      </button>

      <div v-if="context === 'browse'" class="iftv-card-add">
        <button type="button" class="btn btn-sm iftv-card-add-btn" title="Add to…" @click.stop="toggleMenu">＋</button>
        <div v-if="menuOpen" class="iftv-card-menu dropdown-menu show" @click.stop>
          <button v-if="canWatchLater" type="button" class="dropdown-item" @click="addToWatchLater">
            Add to Watch Later
          </button>
          <h6 class="dropdown-header">Add to list ▸</h6>
          <button v-for="l in lists" :key="l.id" type="button" class="dropdown-item" @click="addToExistingList(l.id)">
            {{ l.name }}
          </button>
          <button type="button" class="dropdown-item" @click="addToNewList">New list…</button>
        </div>
      </div>
      <button v-else type="button" class="btn btn-sm iftv-card-remove" title="Remove" @click.stop="remove">✕</button>
    </div>
  </div>
</template>
