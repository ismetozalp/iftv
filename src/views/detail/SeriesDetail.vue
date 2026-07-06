<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDetailStore } from '@/stores/detail'
import { useWorkspaceStore } from '@/stores/workspace'
import { usePlayerStore } from '@/stores/player'
import type { ContentItem } from '@/core/content/types'
import type { Episode } from '@/core/xtream/seriesInfo'
import { useProxiedImage } from '@/composables/useProxiedImage'

const detail = useDetailStore()
const ws = useWorkspaceStore()
const player = usePlayerStore()
const { url: coverUrl, failed: coverFailed } = useProxiedImage(() => detail.series?.cover)

const selectedSeason = ref<number | null>(null)
watch(
  () => detail.series?.seasons,
  (seasons) => {
    selectedSeason.value = seasons && seasons.length ? seasons[0] : null
  },
  { immediate: true },
)

const episodesForSeason = computed<Episode[]>(() => {
  const all = detail.series?.episodes ?? []
  if (selectedSeason.value === null) return all
  return all.filter((e) => e.season === selectedSeason.value)
})

function selectSeason(season: number) {
  selectedSeason.value = season
}

function playEpisode(episode: Episode) {
  const account = ws.activeAccount
  if (!account) return
  const episodeItem: ContentItem = {
    id: `episode:${episode.episodeId}`,
    kind: 'episode',
    name: episode.title,
    logo: '',
    categoryId: '',
    streamId: episode.episodeId,
    seriesId: null,
    containerExtension: episode.containerExtension,
    url: null,
  }
  player.play(account, episodeItem, { durationSeconds: episode.durationSecs ?? null })
  detail.close()
}

function close() {
  detail.close()
}
</script>

<template>
  <div v-if="detail.open && detail.mode === 'series' && detail.series" class="iftv-detail">
    <div class="iftv-detail-card">
      <button class="btn btn-sm btn-light iftv-detail-close" @click="close">✕ Close</button>
      <div class="iftv-detail-body d-flex gap-3">
        <div class="iftv-detail-poster">
          <img v-if="coverUrl && !coverFailed" :src="coverUrl" alt="" @error="coverFailed = true" />
          <span v-else class="iftv-detail-poster-fallback">{{ detail.series.name.slice(0, 2).toUpperCase() }}</span>
        </div>
        <div class="iftv-detail-info flex-fill">
          <h4>{{ detail.series.name }}</h4>
          <p v-if="detail.series.genre" class="text-muted small mb-2">{{ detail.series.genre }}</p>
          <p v-if="detail.series.plot">{{ detail.series.plot }}</p>
          <p v-if="detail.series.cast" class="small"><strong>Cast:</strong> {{ detail.series.cast }}</p>

          <div v-if="detail.series.seasons.length" class="btn-group btn-group-sm mb-2" role="group">
            <button
              v-for="season in detail.series.seasons"
              :key="season"
              type="button"
              class="btn"
              :class="season === selectedSeason ? 'btn-primary' : 'btn-outline-secondary'"
              @click="selectSeason(season)"
            >
              Season {{ season }}
            </button>
          </div>

          <ul class="list-group iftv-episode-list">
            <li
              v-for="ep in episodesForSeason"
              :key="ep.episodeId"
              class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
              role="button"
              @click="playEpisode(ep)"
            >
              <span>{{ ep.episodeNum }}. {{ ep.title }}</span>
              <span class="text-muted small">▶</span>
            </li>
            <li v-if="!episodesForSeason.length" class="list-group-item text-muted">No episodes.</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="detail.loading && detail.mode === 'series'" class="iftv-detail">
    <div class="iftv-detail-card">
      <p class="text-light p-3">Loading…</p>
    </div>
  </div>
  <div v-else-if="detail.error && detail.mode === 'series'" class="iftv-detail">
    <div class="iftv-detail-card">
      <button class="btn btn-sm btn-light iftv-detail-close" @click="close">✕ Close</button>
      <p class="text-danger p-3">{{ detail.error }}</p>
    </div>
  </div>
</template>

<style scoped>
.iftv-episode-list {
  max-height: 40vh;
  overflow-y: auto;
}
</style>
