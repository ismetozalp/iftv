<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import Hls from 'hls.js'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import { formatTime, clampFraction } from '@/core/media/seekbar'

const player = usePlayerStore()
const settings = useSettingsStore()
const video = ref<HTMLVideoElement | null>(null)
const track = ref<HTMLElement | null>(null)
const subTrack = ref<HTMLTrackElement | null>(null)
const buffering = ref(false)
const now = ref(0)
const bufferedEnd = ref(0)
const paused = ref(false)
let hls: Hls | null = null
let subTimer: ReturnType<typeof setInterval> | null = null
let subBlobUrl: string | null = null

// Undecodable-video detection: hls.js may report a codec/decode error, or (rarely) never report
// one while audio keeps advancing and the video track just never paints. Either path retries
// ONCE per session with a forced transcode (see player.retryWithTranscode).
let triedTranscode = false // copy → transcode, once per session
let triedSoftwareFallback = false // nvenc → x264, once per session
let watchdogTimer: ReturnType<typeof setTimeout> | null = null

function clearWatchdog() {
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null }
}

function armWatchdog() {
  clearWatchdog()
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null
    const v = video.value
    if (!v) return
    const hasVideoTrack = hls?.levels?.some((l) => l.videoCodec) ?? false
    if (!(hasVideoTrack && v.currentTime > 0 && v.videoWidth === 0)) return // audio-only or decoding fine
    if (!player.transcode && !triedTranscode && settings.transcodeMode !== 'off') { triedTranscode = true; void player.retryWithTranscode() }
    else if (player.transcode && player.currentCodec === 'nvenc' && !triedSoftwareFallback) { triedSoftwareFallback = true; void player.fallbackToSoftware() }
  }, 6000)
}

function onLoadedData() {
  clearWatchdog()
}

// Always-on status badge reflecting what the pipeline is actually doing (copy vs GPU/CPU transcode).
// Transcoding is fully automatic (copy → GPU → CPU); there is no manual button.
const transcodeBadge = computed(() => {
  if (player.currentCodec === 'nvenc') return 'Transcoding · GPU'
  if (player.currentCodec === 'x264') return 'Transcoding · CPU'
  return 'No transcode needed'
})

function teardown() {
  clearWatchdog()
  if (hls) { hls.destroy(); hls = null }
  buffering.value = false
  now.value = 0
  bufferedEnd.value = 0
  paused.value = false
  // NOTE: subtitle timer/blob are owned by refreshSub() + its watch, NOT cleared here — the main
  // session watch's teardown() fires AFTER refreshSub's watch on a restart, so clearing them here
  // would kill the timer refreshSub just armed (leaving only the first, empty-.vtt read).
}

function clearSub() {
  if (subTimer) { clearInterval(subTimer); subTimer = null }
  if (subBlobUrl) { URL.revokeObjectURL(subBlobUrl); subBlobUrl = null }
  if (subTrack.value) subTrack.value.src = ''
}

// Poll the (growing) WebVTT subtitle file every ~3s and refresh the <track> blob src so newly
// muxed cues show up. Off/no-session → stop the timer and clear the track.
async function refreshSub() {
  if (player.selectedSubtitle == null || !player.session) {
    clearSub()
    return
  }
  if (subTimer) clearInterval(subTimer)
  const tick = async () => {
    const bytes = await player.session?.readSubtitle()
    if (bytes && bytes.byteLength) {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'text/vtt' }))
      if (subBlobUrl) URL.revokeObjectURL(subBlobUrl)
      subBlobUrl = url
      if (subTrack.value) {
        subTrack.value.src = url
        if (subTrack.value.track) subTrack.value.track.mode = 'showing'
      }
    }
  }
  subTimer = setInterval(() => { void tick() }, 3000)
  await tick()
}

watch([() => player.selectedSubtitle, () => player.session], refreshSub, { immediate: true })

watch(
  () => player.session,
  (session) => {
    teardown()
    triedTranscode = false
    triedSoftwareFallback = false
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
        // Decode/codec-class failure (or a media error that outlived recovery). Escalate once:
        // not transcoding yet → transcode (copy can't be decoded, e.g. HEVC); already on nvenc →
        // drop to software (x264). x264 is the last resort → then surface the error.
        const undecodable = codecErrorDetails.has(data.details) || data.type === Hls.ErrorTypes.MEDIA_ERROR
        if (undecodable) {
          if (!player.transcode && !triedTranscode && settings.transcodeMode !== 'off') { triedTranscode = true; void player.retryWithTranscode(); return }
          if (player.transcode && player.currentCodec === 'nvenc' && !triedSoftwareFallback) { triedSoftwareFallback = true; void player.fallbackToSoftware(); return }
        }
        // (transcodeMode 'off' or already on x264 → fall through to teardown+fail, no zombie session)
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

onBeforeUnmount(() => { teardown(); clearSub() })

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
      <span v-if="player.status === 'playing'" class="iftv-transcoding">{{ transcodeBadge }}</span>
      <select
        v-if="player.audioTracks.length > 1"
        class="form-select form-select-sm iftv-track-select"
        :value="player.selectedAudio"
        @change="player.setAudioTrack(Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="t in player.audioTracks" :key="t.index" :value="t.index">{{ t.language || ('Audio ' + t.index) }}</option>
      </select>
      <select
        v-if="player.subtitleTracks.length"
        class="form-select form-select-sm iftv-track-select"
        :value="player.selectedSubtitle ?? ''"
        @change="player.setSubtitle(($event.target as HTMLSelectElement).value === '' ? null : Number(($event.target as HTMLSelectElement).value))"
      >
        <option value="">Off</option>
        <option v-for="t in player.subtitleTracks" :key="t.index" :value="t.index" :disabled="!t.text">
          {{ (t.language || ('Sub ' + t.index)) + (t.text ? '' : ' (bitmap)') }}
        </option>
      </select>
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
      >
        <track ref="subTrack" kind="subtitles" label="Subtitles" default />
      </video>
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
