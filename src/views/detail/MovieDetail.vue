<script setup lang="ts">
import { computed } from 'vue'
import { useDetailStore } from '@/stores/detail'
import { useWorkspaceStore } from '@/stores/workspace'
import { usePlayerStore } from '@/stores/player'
import { useProxiedImage } from '@/composables/useProxiedImage'

const detail = useDetailStore()
const ws = useWorkspaceStore()
const player = usePlayerStore()
const { url: posterUrl, failed: posterFailed } = useProxiedImage(() => detail.movie?.poster)

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
  player.play(account, playItem)
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
          <button class="btn btn-primary mt-2" @click="play">▶ Play</button>
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="detail.loading && detail.mode === 'movie'" class="iftv-detail">
    <div class="iftv-detail-card">
      <p class="text-light p-3">Loading…</p>
    </div>
  </div>
  <div v-else-if="detail.error && detail.mode === 'movie'" class="iftv-detail">
    <div class="iftv-detail-card">
      <button class="btn btn-sm btn-light iftv-detail-close" @click="close">✕ Close</button>
      <p class="text-danger p-3">{{ detail.error }}</p>
    </div>
  </div>
</template>
