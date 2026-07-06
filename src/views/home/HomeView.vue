<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import type { Section } from '@/core/content/provider'
import BrowseView from '@/views/browse/BrowseView.vue'
import LibraryView from '@/views/library/LibraryView.vue'
import GuideView from '@/views/guide/GuideView.vue'

const ws = useWorkspaceStore()
const section = ref<Section>('live')
const view = ref<'browse' | 'library' | 'guide'>('browse')

// M3U accounts only have live; force back to live when the active account is m3u.
const sections = computed<{ id: Section; label: string }[]>(() =>
  ws.activeAccount?.type === 'm3u'
    ? [{ id: 'live', label: 'Live TV' }]
    : [{ id: 'live', label: 'Live TV' }, { id: 'vod', label: 'Movies' }, { id: 'series', label: 'Series' }],
)
watch(() => ws.activeAccount?.id, () => {
  if (!sections.value.some((s) => s.id === section.value)) section.value = 'live'
  view.value = 'browse'
})

function selectSection(id: Section) {
  view.value = 'browse'
  section.value = id
}
</script>

<template>
  <div class="h-100 d-flex flex-column">
    <template v-if="ws.activeAccount">
      <nav class="btn-group btn-group-sm mb-2 align-self-start" role="group">
        <button
          v-for="s in sections"
          :key="s.id"
          type="button"
          class="btn"
          :class="s.id === section && view === 'browse' ? 'btn-primary' : 'btn-outline-primary'"
          @click="selectSection(s.id)"
        >
          {{ s.label }}
        </button>
        <button
          type="button"
          class="btn"
          :class="view === 'library' ? 'btn-primary' : 'btn-outline-primary'"
          @click="view = 'library'"
        >
          ★ Library
        </button>
        <button
          type="button"
          class="btn"
          :class="view === 'guide' ? 'btn-primary' : 'btn-outline-primary'"
          @click="view = 'guide'"
        >
          📺 Guide
        </button>
      </nav>
      <BrowseView v-if="view === 'browse'" :section="section" class="flex-fill" />
      <LibraryView v-else-if="view === 'library'" class="flex-fill" />
      <GuideView v-else class="flex-fill" />
    </template>
    <div v-else>
      <h4>Welcome to InFlight TV</h4>
      <p class="text-muted">No account open. Go to <RouterLink to="/accounts">Accounts</RouterLink> to add or open one.</p>
    </div>
  </div>
</template>
