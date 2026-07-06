<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useDetailStore } from '@/stores/detail'
import type { ContentItem } from '@/core/content/types'
import type { Section } from '@/core/content/provider'
import VirtualGrid from '@/components/VirtualGrid.vue'
import ContentCard from '@/components/ContentCard.vue'

const props = defineProps<{ section: Section }>()
const ws = useWorkspaceStore()
const lib = useLibraryStore()
const player = usePlayerStore()
const detail = useDetailStore()
function onPlay(item: ContentItem) {
  if (!ws.activeAccount) return
  if (item.kind === 'live') player.play(ws.activeAccount, item)
  else if (item.kind === 'movie') detail.openMovie(ws.activeAccount, item)
}

const selectedCat = ref<string | null>(null)
const query = ref('')
const results = ref<ContentItem[]>([])

const gridDims = computed(() =>
  props.section === 'live' ? { itemWidth: 180, itemHeight: 130 } : { itemWidth: 150, itemHeight: 230 },
)
const searchPlaceholder = computed(() =>
  props.section === 'vod' ? 'Search movies…' : props.section === 'series' ? 'Search series…' : 'Search channels…',
)

let syncSeq = 0
async function sync() {
  const seq = ++syncSeq
  query.value = ''
  results.value = []
  await lib.setContext(ws.activeAccount, props.section)
  if (seq !== syncSeq) return
  selectedCat.value = lib.categories[0]?.id ?? null
  if (selectedCat.value) await lib.loadCategory(selectedCat.value)
}
onMounted(sync)
watch(() => [ws.activeAccount?.id, props.section], sync)

async function selectCat(id: string) {
  query.value = ''
  selectedCat.value = id
  await lib.loadCategory(id)
}

let searchSeq = 0
watch(query, async (q) => {
  const seq = ++searchSeq
  const r = await lib.search(q)
  if (seq === searchSeq) results.value = r
})

const shown = computed<ContentItem[]>(() =>
  query.value.trim() ? results.value : selectedCat.value ? lib.itemsFor(selectedCat.value) : [],
)
</script>

<template>
  <div class="iftv-live d-flex">
    <aside class="iftv-cats">
      <input v-model="query" class="form-control form-control-sm mb-2" :placeholder="searchPlaceholder" />
      <div v-if="lib.error" class="text-danger small">{{ lib.error }}</div>
      <ul class="list-group list-group-flush" :class="{ 'opacity-50': query.trim() }">
        <li
          v-for="c in lib.categories"
          :key="c.id"
          class="list-group-item list-group-item-action py-1"
          :class="{ active: c.id === selectedCat && !query.trim() }"
          role="button"
          @click="selectCat(c.id)"
        >
          {{ c.name }}
        </li>
      </ul>
    </aside>
    <section class="iftv-grid-wrap flex-fill">
      <p v-if="lib.loading" class="text-muted p-2">Loading…</p>
      <p v-else-if="!shown.length" class="text-muted p-2">
        {{ query.trim() ? 'Nothing matches.' : 'Nothing here.' }}
      </p>
      <VirtualGrid v-else :items="shown" :item-width="gridDims.itemWidth" :item-height="gridDims.itemHeight">
        <template #default="{ item }">
          <ContentCard :item="(item as ContentItem)" @click="onPlay(item as ContentItem)" />
        </template>
      </VirtualGrid>
    </section>
  </div>
</template>
