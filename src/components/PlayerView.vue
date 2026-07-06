<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import Hls from 'hls.js'
import { usePlayerStore } from '@/stores/player'

const player = usePlayerStore()
const video = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null

function teardown() {
  if (hls) { hls.destroy(); hls = null }
}

watch(
  () => player.session,
  (session) => {
    teardown()
    if (!session || !video.value) return
    if (Hls.isSupported()) {
      const Loader = session.createLoader() as never
      hls = new Hls({
        pLoader: Loader,
        fLoader: Loader,
        enableWorker: false,
        // live tuning so playback keeps following the rolling window instead of stalling ~10s in
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 20,
        maxBufferLength: 30,
        maxMaxBufferLength: 120,
        fragLoadingMaxRetry: 10,
        levelLoadingMaxRetry: 10,
      })
      let mediaRecoveries = 0
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        // Recover from transient live errors rather than killing the whole session.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { hls?.startLoad(); return }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 3) { hls?.recoverMediaError(); return }
        teardown()
        void player.fail(`Playback error: ${data.details}`)
      })
      hls.loadSource(session.sourceUrl)
      hls.attachMedia(video.value)
      hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.value?.play().catch(() => {}) })
    } else if (video.value.canPlayType('application/vnd.apple.mpegurl')) {
      video.value.src = session.sourceUrl // native HLS (Safari) — fallback, unlikely for iftv://
    }
  },
)

onBeforeUnmount(teardown)

function close() {
  teardown()
  void player.stop()
}
</script>

<template>
  <div v-if="player.status !== 'idle'" class="iftv-player">
    <div class="iftv-player-bar">
      <span class="iftv-player-title text-truncate">{{ player.item?.name }}</span>
      <button class="btn btn-sm btn-light" @click="close">✕ Close</button>
    </div>
    <div class="iftv-player-body">
      <p v-if="player.status === 'starting'" class="text-light p-3">Starting stream…</p>
      <p v-else-if="player.status === 'error'" class="text-danger p-3">{{ player.error }}</p>
      <video ref="video" class="iftv-player-video" controls autoplay playsinline></video>
    </div>
  </div>
</template>
