<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import Hls from 'hls.js'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import { useCollectionsStore } from '@/stores/collections'
import { useEpgStore } from '@/stores/epg'
import { useWorkspaceStore } from '@/stores/workspace'
import { formatTime, clampFraction } from '@/core/media/seekbar'

// One PlayerView per playing account (mounted by PlayerHost). Everything below reads/writes THIS
// account's slot only — never the global back-compat proxies — so N accounts can each run their
// own <video>+hls session concurrently, fully independent of one another.
const props = defineProps<{ accountId: string }>()

const player = usePlayerStore()
const settings = useSettingsStore()
const collections = useCollectionsStore()
const epg = useEpgStore()
const ws = useWorkspaceStore()
const slot = computed(() => player.slots[props.accountId])

const video = ref<HTMLVideoElement | null>(null)
const track = ref<HTMLElement | null>(null)
const subTrack = ref<HTMLTrackElement | null>(null)
const buffering = ref(false)
const now = ref(0)
const nowMs = ref(Date.now())
const bufferedEnd = ref(0)
const paused = ref(false)
let hls: Hls | null = null
let subTimer: ReturnType<typeof setInterval> | null = null
let subBlobUrl: string | null = null
const PROGRESS_SAVE_MS = 15000

// History (once per session) + progress (VOD only, periodic) auto-tracking. Both flags/timers are
// owned by the main session watch below (armed/reset there), mirroring triedTranscode/watchdog.
let recordedHistory = false // reset per session so History logs once per play(), not spammed
let progressTimer: ReturnType<typeof setInterval> | null = null

// Undecodable-video detection: hls.js may report a codec/decode error, or (rarely) never report
// one while audio keeps advancing and the video track just never paints. Either path retries
// ONCE per session with a forced transcode (see player.retryWithTranscode).
let triedTranscode = false // copy → transcode, once per session
let triedSoftwareFallback = false // nvenc → x264, once per session
let watchdogTimer: ReturnType<typeof setTimeout> | null = null

// Debounce the buffering indicator: only show it if a stall actually lasts, so the constant
// sub-second micro-stalls of a live stream don't flicker the spinner on and off.
let bufferTimer: ReturnType<typeof setTimeout> | null = null
const BUFFER_SHOW_MS = 800

// Presentation: this account's slot is visible (and unmuted) only while its tab is the active one.
// Non-active accounts keep playing (muted, off-screen) so switching tabs is instant. `minimized`
// docks THIS account's own video to the bottom bar (Task 3); `full` is the normal overlay chrome.
const isActive = computed(() => props.accountId === ws.activeAccount?.id)
const full = computed(() => isActive.value && !!slot.value && !slot.value.minimized && slot.value.status !== 'idle')
const minimizedActive = computed(() => isActive.value && !!slot.value && slot.value.minimized)

function clearWatchdog() {
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null }
}

function armWatchdog() {
  clearWatchdog()
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null
    const v = video.value
    if (!v || !slot.value) return
    const hasVideoTrack = hls?.levels?.some((l) => l.videoCodec) ?? false
    if (!(hasVideoTrack && v.currentTime > 0 && v.videoWidth === 0)) return // audio-only or decoding fine
    if (!slot.value.transcode && !triedTranscode && settings.transcodeMode !== 'off') { triedTranscode = true; void player.retryWithTranscode(slot.value.account) }
    else if (slot.value.transcode && slot.value.currentCodec === 'nvenc' && !triedSoftwareFallback) { triedSoftwareFallback = true; void player.fallbackToSoftware(slot.value.account) }
  }, 6000)
}

function onLoadedData() {
  clearWatchdog()
}

// Always-on status badge reflecting what the pipeline is actually doing (copy vs GPU/CPU transcode).
// Transcoding is fully automatic (copy → GPU → CPU); there is no manual button.
const transcodeBadge = computed(() => {
  if (slot.value?.currentCodec === 'nvenc') return 'Transcoding · GPU'
  if (slot.value?.currentCodec === 'x264') return 'Transcoding · CPU'
  return 'No transcode needed'
})

function clearProgressTimer() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
}

// Persist the last known VOD position for the item that's ACTIVE right now. Safe to call whenever
// teardown() runs (mid-session restart, close, or unmount) because play()/seek()/etc. always null
// `session` — and thus fire this — BEFORE they touch `item`/`account`/`duration` for a new item, so
// this always sees the outgoing item's own state, never a just-switched-to one.
function saveProgressNow() {
  const s = slot.value
  if (!s || !s.account || !s.item || s.duration == null || now.value <= 0) return
  void collections.saveProgress(s.account, s.item, now.value, s.duration)
}

function teardown() {
  clearWatchdog()
  saveProgressNow() // last-chance persist before the session/offsets reset below
  clearProgressTimer()
  if (hls) { hls.destroy(); hls = null }
  clearBuffering() // cancels any pending debounce timer + hides the spinner
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
  const s = slot.value
  if (!s || s.selectedSubtitle == null || !s.session) {
    clearSub()
    return
  }
  if (subTimer) clearInterval(subTimer)
  const tick = async () => {
    const bytes = await slot.value?.session?.readSubtitle()
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

watch([() => slot.value?.selectedSubtitle, () => slot.value?.session], refreshSub, { immediate: true })

watch(
  () => slot.value?.session,
  (session) => {
    teardown()
    triedTranscode = false
    triedSoftwareFallback = false
    recordedHistory = false
    const s = slot.value
    if (!session || !s || !video.value) return
    if (s.duration != null) progressTimer = setInterval(saveProgressNow, PROGRESS_SAVE_MS) // VOD only — live has no meaningful "resume" offset
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
        const cur = slot.value
        if (!cur) return
        // Recover from transient live errors rather than killing the whole session.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { hls?.startLoad(); return }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 3) { hls?.recoverMediaError(); return }
        // Decode/codec-class failure (or a media error that outlived recovery). Escalate once:
        // not transcoding yet → transcode (copy can't be decoded, e.g. HEVC); already on nvenc →
        // drop to software (x264). x264 is the last resort → then surface the error.
        const undecodable = codecErrorDetails.has(data.details) || data.type === Hls.ErrorTypes.MEDIA_ERROR
        if (undecodable) {
          if (!cur.transcode && !triedTranscode && settings.transcodeMode !== 'off') { triedTranscode = true; void player.retryWithTranscode(cur.account); return }
          if (cur.transcode && cur.currentCodec === 'nvenc' && !triedSoftwareFallback) { triedSoftwareFallback = true; void player.fallbackToSoftware(cur.account); return }
        }
        // (transcodeMode 'off' or already on x264 → fall through to teardown+fail, no zombie session)
        teardown()
        void player.fail(`Playback error: ${data.details}`, cur.account)
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

// Log to History once per session, as soon as playback actually starts — driven off `status`
// (rather than the hls.js-only MANIFEST_PARSED event) so it also covers the native-Safari fallback.
watch(
  () => slot.value?.status,
  (status) => {
    const s = slot.value
    if (status === 'playing' && !recordedHistory && s?.item && s.account) {
      recordedHistory = true
      // pass the current runtime so an episode replayed from History keeps its seekbar + progress
      // tracking (movies re-fetch duration via their detail view; episodes have no such route)
      void collections.recordHistory(s.account, s.item, s.duration)
    }
  },
)

onBeforeUnmount(() => { teardown(); clearSub() })

function close() {
  teardown()
  const s = slot.value
  if (s) void player.stop(s.account)
}

function updatePlayhead() {
  const s = slot.value
  if (!video.value || !s) return
  now.value = s.startOffset + (video.value.currentTime || 0)
  const buffered = video.value.buffered
  bufferedEnd.value = s.startOffset + (buffered.length ? buffered.end(buffered.length - 1) : 0)
  nowMs.value = Date.now()
}

// A stall (@waiting/@stalled) arms a timer; the spinner only shows if the stall outlasts it.
// Any sign of playback (timeupdate advancing, playing, canplay) cancels it and hides the spinner —
// so momentary hiccups never flicker the indicator, and it never sticks once playback resumes.
function armBuffering() {
  if (bufferTimer || buffering.value) return
  bufferTimer = setTimeout(() => {
    bufferTimer = null
    buffering.value = true
  }, BUFFER_SHOW_MS)
}
function clearBuffering() {
  if (bufferTimer) {
    clearTimeout(bufferTimer)
    bufferTimer = null
  }
  if (buffering.value) buffering.value = false
}
function onTimeupdate() {
  clearBuffering() // currentTime advanced ⇒ actively playing
  updatePlayhead()
}

// Live now-playing strip: matched programme + progress, recomputed off nowMs (bumped each
// timeupdate/progress tick above) so the bar advances roughly once per second while playing.
const liveNowNext = computed(() => {
  if (slot.value?.item?.kind !== 'live') return null
  return epg.nowNextFor(slot.value.item.name, slot.value.item.epgId, slot.value.account.id, nowMs.value)
})
const liveProgressPct = computed(() => {
  const p = liveNowNext.value?.now
  if (!p) return 0
  return clampFraction((nowMs.value - p.startMs) / (p.stopMs - p.startMs)) * 100
})

function togglePlay() {
  if (!video.value) return
  if (video.value.paused) void video.value.play().catch(() => {})
  else video.value.pause()
}

function onScrub(e: MouseEvent) {
  const s = slot.value
  if (!track.value || !s || s.duration == null) return
  const r = track.value.getBoundingClientRect()
  const frac = clampFraction((e.clientX - r.left) / r.width)
  void player.seek(frac * s.duration, s.account)
}
</script>

<template>
  <div v-if="slot" class="iftv-player" :class="{ minimized: minimizedActive, 'iftv-player-hidden': !isActive }">
    <div v-if="full" class="iftv-player-bar">
      <span class="iftv-player-title text-truncate">{{ slot.item?.name }}</span>
      <span v-if="slot.status === 'playing'" class="iftv-transcoding">{{ transcodeBadge }}</span>
      <select
        v-if="slot.audioTracks.length > 1"
        class="form-select form-select-sm iftv-track-select"
        :value="slot.selectedAudio"
        @change="player.setAudioTrack(Number(($event.target as HTMLSelectElement).value), slot.account)"
      >
        <option v-for="t in slot.audioTracks" :key="t.index" :value="t.index">{{ t.language || ('Audio ' + t.index) }}</option>
      </select>
      <select
        v-if="slot.subtitleTracks.length"
        class="form-select form-select-sm iftv-track-select"
        :value="slot.selectedSubtitle ?? ''"
        @change="player.setSubtitle(($event.target as HTMLSelectElement).value === '' ? null : Number(($event.target as HTMLSelectElement).value), slot.account)"
      >
        <option value="">Off</option>
        <option v-for="t in slot.subtitleTracks" :key="t.index" :value="t.index" :disabled="!t.text">
          {{ (t.language || ('Sub ' + t.index)) + (t.text ? '' : ' (bitmap)') }}
        </option>
      </select>
      <button class="btn btn-sm btn-light" title="Minimize" @click="player.minimize(slot.account)">—</button>
      <button class="btn btn-sm btn-light" @click="close">✕ Close</button>
    </div>
    <div v-if="full && liveNowNext?.now" class="iftv-epg-strip">
      <span class="iftv-epg-strip-title text-truncate">{{ liveNowNext.now.title }}</span>
      <div class="iftv-epg-progress">
        <div class="iftv-epg-progress-bar" :style="{ width: liveProgressPct + '%' }"></div>
      </div>
    </div>
    <div class="iftv-player-body">
      <template v-if="full">
        <p v-if="slot.status === 'starting'" class="text-light p-3">Starting stream…</p>
        <p v-else-if="slot.status === 'error'" class="text-danger p-3">{{ slot.error }}</p>
      </template>
      <video
        ref="video"
        class="iftv-player-video"
        :controls="slot.duration == null"
        :muted="!isActive"
        autoplay
        playsinline
        @waiting="armBuffering"
        @stalled="armBuffering"
        @playing="clearBuffering"
        @canplay="clearBuffering"
        @timeupdate="onTimeupdate"
        @progress="updatePlayhead"
        @play="paused = false"
        @pause="paused = true"
        @loadeddata="onLoadedData"
      >
        <track ref="subTrack" kind="subtitles" label="Subtitles" default />
      </video>
      <!-- Compact indicator in the bottom-right corner (over the video), not a centered overlay. -->
      <div v-if="full && buffering && slot.status === 'playing'" class="iftv-buffering-corner">
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        Buffering…
      </div>
    </div>
    <div v-if="minimizedActive" class="iftv-bar-chrome">
      <span class="iftv-bar-title text-truncate">
        {{ slot.item?.name }}<template v-if="liveNowNext?.now"> · {{ liveNowNext.now.title }}</template>
      </span>
      <button class="btn btn-sm btn-light" :title="paused ? 'Play' : 'Pause'" @click="togglePlay">{{ paused ? '▶' : '⏸' }}</button>
      <button class="btn btn-sm btn-light" title="Restore" @click="player.restore(slot.account)">⤢</button>
      <button class="btn btn-sm btn-light" title="Close" @click="close">✕</button>
    </div>
    <div v-if="full && slot.duration != null" class="iftv-seekbar">
      <button class="btn btn-sm btn-light" @click="togglePlay">{{ paused ? '▶' : '⏸' }}</button>
      <span class="iftv-seek-time">{{ formatTime(now) }}</span>
      <div ref="track" class="iftv-seek-track" @click="onScrub">
        <div class="iftv-seek-buffered" :style="{ width: clampFraction(bufferedEnd / slot.duration) * 100 + '%' }"></div>
        <div class="iftv-seek-played" :style="{ width: clampFraction(now / slot.duration) * 100 + '%' }"></div>
      </div>
      <span class="iftv-seek-time">{{ formatTime(slot.duration) }}</span>
    </div>
  </div>
</template>
