<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { ContentItem } from '@/core/content/types'
import { useProxiedImage } from '@/composables/useProxiedImage'
import { useWorkspaceStore } from '@/stores/workspace'
import { useCollectionsStore } from '@/stores/collections'
import { useEpgStore } from '@/stores/epg'
import EpgSchedule from '@/components/EpgSchedule.vue'

const props = withDefaults(defineProps<{ item: ContentItem; context?: 'browse' | 'library' }>(), {
  context: 'browse',
})
const emit = defineEmits<{ remove: [] }>()

const { url, failed } = useProxiedImage(() => props.item.logo)

const ws = useWorkspaceStore()
const collections = useCollectionsStore()
const epg = useEpgStore()

const menuOpen = ref(false)
const scheduleOpen = ref(false)

const isLive = computed(() => props.item.kind === 'live')
const nn = computed(() => (isLive.value ? epg.nowNextFor(props.item.name, props.item.epgId) : { now: null, next: null }))
const hasSchedule = computed(() => isLive.value && epg.hasEpgFor(props.item.name, props.item.epgId))

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
function toggleSchedule() {
  scheduleOpen.value = !scheduleOpen.value
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
  scheduleOpen.value = false
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
    <div v-if="nn.now" class="iftv-card-epg text-truncate">
      ● {{ nn.now.title }}<span v-if="nn.next" class="text-muted"> · {{ nn.next.title }}</span>
    </div>

    <div v-if="ws.activeAccount || hasSchedule" class="iftv-card-actions" @click.stop>
      <div v-if="hasSchedule" class="iftv-card-schedule">
        <button type="button" class="btn btn-sm iftv-card-info-btn" title="Schedule" @click.stop="toggleSchedule">🕐</button>
        <div v-if="scheduleOpen" class="iftv-card-menu iftv-card-schedule-panel dropdown-menu show" @click.stop>
          <EpgSchedule :channel-name="item.name" />
        </div>
      </div>
      <button
        v-if="ws.activeAccount"
        type="button"
        class="btn btn-sm iftv-card-fav"
        :class="{ 'iftv-card-fav-active': isFav }"
        :title="isFav ? 'Remove favorite' : 'Add to favorites'"
        @click.stop="toggleFavorite"
      >
        <span v-if="isFav">★</span>
        <span v-else>☆</span>
      </button>

      <div v-if="ws.activeAccount && context === 'browse'" class="iftv-card-add">
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
      <button v-else-if="ws.activeAccount" type="button" class="btn btn-sm iftv-card-remove" title="Remove" @click.stop="remove">✕</button>
    </div>
  </div>
</template>
