<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import Hls from 'hls.js'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import { formatTime, clampFraction } from '@/core/media/seekbar'
import { resolveEncoder } from '@/core/media/encoder'

const player = usePlayerStore()
const settings = useSettingsStore()
const video = ref<HTMLVideoElement | null>(null)
const track = ref<HTMLElement | null>(null)
const buffering = ref(false)
const now = ref(0)
const bufferedEnd = ref(0)
const paused = ref(false)
let hls: Hls | null = null

// Undecodable-video detection: hls.js may report a codec/decode error, or (rarely) never report
// one while audio keeps advancing and the video track just never paints. Either path retries
// ONCE per session with a forced transcode (see player.retryWithTranscode).
let triedTranscode = false
let watchdogTimer: ReturnType<typeof setTimeout> | null = null

function clearWatchdog() {
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null }
}

function armWatchdog() {
  clearWatchdog()
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null
    const v = video.value
    if (!v || player.transcode || triedTranscode) return
    const hasVideoTrack = hls?.levels?.some((l) => l.videoCodec) ?? false
    if (hasVideoTrack && v.currentTime > 0 && v.videoWidth === 0) {
      triedTranscode = true
      void player.retryWithTranscode()
    }
  }, 6000)
}

function onLoadedData() {
  clearWatchdog()
}

const isGpuTranscode = computed(() => resolveEncoder(settings.transcodeMode, settings.encoderTest) === 'nvenc')

function teardown() {
  clearWatchdog()
  if (hls) { hls.destroy(); hls = null }
  buffering.value = false
  now.value = 0
  bufferedEnd.value = 0
  paused.value = false
}

watch(
  () => player.session,
  (session) => {
    teardown()
    triedTranscode = false
    if (!session || !video.value) return
    if (Hls.isSupported()) {
      const Loader = session.createLoader() as never
      const bufferSeconds = settings.bufferSeconds || 30
      hls = new Hls({
        pLoader: Loader,
        fLoader: Loader,
        enableWorker: false,
        // Known-good live tuning — do NOT set an absolute liveSyncDuration on top of these
        // (mixing it in stalled playback). Keep the edge sync count-based.
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 20,
        // The buffer setting: how many seconds to hold ahead of the playhead. Safe for both
        // live (caps buffer) and VOD (smoother playback / seeking).
        maxBufferLength: bufferSeconds,
        maxMaxBufferLength: Math.max(120, bufferSeconds * 2),
        fragLoadingMaxRetry: 10,
        levelLoadingMaxRetry: 10,
        // VOD (movie/episode): start at the very beginning. Live: -1 = start at the live edge.
        startPosition: session.isLive ? -1 : 0,
      })
      let mediaRecoveries = 0
      const codecErrorDetails = new Set(['bufferAppendError', 'bufferAddCodecError', 'fragParsingError'])
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        // Recover from transient live errors rather than killing the whole session.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { hls?.startLoad(); return }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 3) { hls?.recoverMediaError(); return }
        // Decode/codec-class failure (or a media error that outlived recovery) — the browser
        // can't decode this stream as-is. Force a transcode instead of failing, once per session.
        if (!player.transcode && !triedTranscode && (codecErrorDetails.has(data.details) || data.type === Hls.ErrorTypes.MEDIA_ERROR)) {
          triedTranscode = true
          void player.retryWithTranscode()
          return
        }
        teardown()
        void player.fail(`Playback error: ${data.details}`)
      })
      buffering.value = true // loading first segments
      hls.loadSource(session.sourceUrl)
      hls.attachMedia(video.value)
      hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.value?.play().catch(() => {}) })
      armWatchdog()
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

function updatePlayhead() {
  if (!video.value) return
  now.value = player.startOffset + (video.value.currentTime || 0)
  const buffered = video.value.buffered
  bufferedEnd.value = player.startOffset + (buffered.length ? buffered.end(buffered.length - 1) : 0)
}

function togglePlay() {
  if (!video.value) return
  if (video.value.paused) void video.value.play().catch(() => {})
  else video.value.pause()
}

function onScrub(e: MouseEvent) {
  if (!track.value || player.duration == null) return
  const r = track.value.getBoundingClientRect()
  const frac = clampFraction((e.clientX - r.left) / r.width)
  void player.seek(frac * player.duration)
}
</script>

<template>
  <div v-if="player.status !== 'idle'" class="iftv-player">
    <div class="iftv-player-bar">
      <span class="iftv-player-title text-truncate">{{ player.item?.name }}</span>
      <span v-if="player.transcode" class="iftv-transcoding">Transcoding · {{ isGpuTranscode ? 'GPU' : 'CPU' }}</span>
      <button
        v-else-if="settings.transcodeMode !== 'off'"
        class="btn btn-sm btn-light"
        @click="player.retryWithTranscode()"
      >⤵ Transcode</button>
      <button class="btn btn-sm btn-light" @click="close">✕ Close</button>
    </div>
    <div class="iftv-player-body">
      <p v-if="player.status === 'starting'" class="text-light p-3">Starting stream…</p>
      <p v-else-if="player.status === 'error'" class="text-danger p-3">{{ player.error }}</p>
      <div v-else-if="buffering" class="iftv-player-buffering">
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        Buffering…
      </div>
      <video
        ref="video"
        class="iftv-player-video"
        :controls="player.duration == null"
        autoplay
        playsinline
        @waiting="buffering = true"
        @stalled="buffering = true"
        @playing="buffering = false"
        @canplay="buffering = false"
        @timeupdate="updatePlayhead"
        @progress="updatePlayhead"
        @play="paused = false"
        @pause="paused = true"
        @loadeddata="onLoadedData"
      ></video>
    </div>
    <div v-if="player.duration != null" class="iftv-seekbar">
      <button class="btn btn-sm btn-light" @click="togglePlay">{{ paused ? '▶' : '⏸' }}</button>
      <span class="iftv-seek-time">{{ formatTime(now) }}</span>
      <div ref="track" class="iftv-seek-track" @click="onScrub">
        <div class="iftv-seek-buffered" :style="{ width: clampFraction(bufferedEnd / player.duration) * 100 + '%' }"></div>
        <div class="iftv-seek-played" :style="{ width: clampFraction(now / player.duration) * 100 + '%' }"></div>
      </div>
      <span class="iftv-seek-time">{{ formatTime(player.duration) }}</span>
    </div>
  </div>
</template>
