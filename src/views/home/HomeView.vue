<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import type { Section } from '@/core/content/provider'
import BrowseView from '@/views/browse/BrowseView.vue'

const ws = useWorkspaceStore()
const section = ref<Section>('live')

// M3U accounts only have live; force back to live when the active account is m3u.
const sections = computed<{ id: Section; label: string }[]>(() =>
  ws.activeAccount?.type === 'm3u'
    ? [{ id: 'live', label: 'Live TV' }]
    : [{ id: 'live', label: 'Live TV' }, { id: 'vod', label: 'Movies' }, { id: 'series', label: 'Series' }],
)
watch(() => ws.activeAccount?.id, () => {
  if (!sections.value.some((s) => s.id === section.value)) section.value = 'live'
})
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
          :class="s.id === section ? 'btn-primary' : 'btn-outline-primary'"
          @click="section = s.id"
        >
          {{ s.label }}
        </button>
      </nav>
      <BrowseView :section="section" class="flex-fill" />
    </template>
    <div v-else>
      <h4>Welcome to InFlight TV</h4>
      <p class="text-muted">No account open. Go to <RouterLink to="/accounts">Accounts</RouterLink> to add or open one.</p>
    </div>
  </div>
</template>
