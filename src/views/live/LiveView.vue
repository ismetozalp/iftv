<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useLibraryStore } from '@/stores/library'
import type { ContentItem } from '@/core/content/types'
import VirtualGrid from '@/components/VirtualGrid.vue'
import ChannelCard from '@/components/ChannelCard.vue'

const ws = useWorkspaceStore()
const lib = useLibraryStore()

const selectedCat = ref<string | null>(null)
const query = ref('')
const results = ref<ContentItem[]>([])

let syncSeq = 0
async function syncAccount() {
  const seq = ++syncSeq
  query.value = ''
  results.value = []
  await lib.setContext(ws.activeAccount, 'live')
  if (seq !== syncSeq) return // a newer account switch superseded this one
  selectedCat.value = lib.categories[0]?.id ?? null
  if (selectedCat.value) await lib.loadCategory(selectedCat.value)
}
onMounted(syncAccount)
watch(() => ws.activeAccount?.id, syncAccount)

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
      <input v-model="query" class="form-control form-control-sm mb-2" placeholder="Search channels…" />
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
        {{ query.trim() ? 'No channels match.' : 'No channels here.' }}
      </p>
      <VirtualGrid v-else :items="shown">
        <template #default="{ item }">
          <ChannelCard :channel="(item as ContentItem)" />
        </template>
      </VirtualGrid>
    </section>
  </div>
</template>
