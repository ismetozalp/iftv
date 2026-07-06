<script setup lang="ts">
import { ref, watch } from 'vue'
import cockpit from 'cockpit'
import { useSettingsStore } from '@/stores/settings'
import { usePlayerStore } from '@/stores/player'
import { resolveCacheRoot } from '@/core/media/session'
import { cacheSizeBytes, clearCache } from '@/adapters/cockpitCache'
import type { TranscodeMode } from '@/core/media/encoder'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const player = usePlayerStore()

function onInput(e: Event) {
  const n = Number((e.target as HTMLInputElement).value)
  void settings.setBufferSeconds(n)
}

function onTranscodeModeChange(e: Event) {
  const m = (e.target as HTMLSelectElement).value as TranscodeMode
  void settings.setTranscodeMode(m)
}

function onTestEncoders() {
  void settings.runEncoderTest(Date.now())
}

// Cache / storage
const cacheDirInput = ref(settings.cacheDir)
const cacheError = ref('')
const cacheSizeLabel = ref('')
const defaultRoot = ref('')
const resolvedRoot = ref('')

function formatBytes(n: number): string {
  const gb = n / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

async function refreshCache() {
  const home = (await cockpit.user()).home
  defaultRoot.value = `${home}/.cache/inflighttv`
  resolvedRoot.value = resolveCacheRoot(home, settings.cacheDir)
  const b = await cacheSizeBytes(resolvedRoot.value)
  cacheSizeLabel.value = formatBytes(b)
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void refreshCache()
  },
  { immediate: true },
)

async function onSaveCacheDir() {
  const r = await settings.setCacheDir(cacheDirInput.value)
  cacheError.value = r.ok ? '' : (r.error ?? 'Invalid')
  if (r.ok) await refreshCache()
}

async function onCacheLimit(e: Event) {
  await settings.setCacheLimitGb(Number((e.target as HTMLInputElement).value))
  await refreshCache()
}

async function onClearCache() {
  await clearCache(resolvedRoot.value)
  await refreshCache()
}

function close() {
  emit('close')
}
</script>

<template>
  <div v-if="open" class="iftv-detail">
    <div class="iftv-detail-card" style="max-width: 420px">
      <button class="btn btn-sm btn-light iftv-detail-close" @click="close">✕ Close</button>
      <h4>Settings</h4>
      <div class="mt-3">
        <label for="iftv-buffer-seconds" class="form-label">Buffer seconds</label>
        <input
          id="iftv-buffer-seconds"
          type="number"
          class="form-control"
          min="5"
          max="120"
          step="5"
          :value="settings.bufferSeconds"
          @change="onInput"
        />
        <p class="text-muted small mt-2 mb-0">
          Seconds of video to buffer before/while playing — higher = smoother, more delay.
        </p>
      </div>
      <div class="mt-3">
        <label for="iftv-transcode-mode" class="form-label">Video transcoding</label>
        <select
          id="iftv-transcode-mode"
          class="form-select"
          :value="settings.transcodeMode"
          @change="onTranscodeModeChange"
        >
          <option value="auto">Auto</option>
          <option value="gpu">GPU (NVENC)</option>
          <option value="software">Software (x264)</option>
          <option value="off">Off</option>
        </select>
        <div class="d-flex align-items-center gap-2 mt-2">
          <button class="btn btn-sm btn-outline-secondary" @click="onTestEncoders">Test encoders</button>
          <span class="text-muted small">
            <template v-if="settings.encoderTest">
              NVENC {{ settings.encoderTest.nvenc ? '✅' : '✗' }} · x264 {{ settings.encoderTest.x264 ? '✅' : '✗' }}
            </template>
            <template v-else>not tested</template>
          </span>
        </div>
        <p class="text-muted small mt-2 mb-0">
          Transcode video to H.264 on the host when the browser can't decode it (e.g. HEVC).
        </p>
      </div>
      <div class="mt-3">
        <h5>Cache / storage</h5>
        <label for="iftv-cache-dir" class="form-label">Cache directory</label>
        <div class="d-flex align-items-center gap-2">
          <input
            id="iftv-cache-dir"
            class="form-control"
            :placeholder="defaultRoot"
            v-model="cacheDirInput"
          />
          <button class="btn btn-sm btn-outline-secondary" @click="onSaveCacheDir">Save</button>
        </div>
        <small class="text-muted">
          Writes to <code>{{ (cacheDirInput || defaultRoot) }}/inflighttv</code>
        </small>
        <div class="text-danger small" v-if="cacheError">{{ cacheError }}</div>
        <label for="iftv-cache-limit" class="form-label mt-3">Max cache size (GB)</label>
        <input
          id="iftv-cache-limit"
          type="number"
          min="1"
          class="form-control"
          :value="settings.cacheLimitGb"
          @change="onCacheLimit"
        />
        <div class="d-flex align-items-center gap-2 mt-2">
          <span class="text-muted small">Current cache: {{ cacheSizeLabel }}</span>
          <button
            class="btn btn-sm btn-outline-secondary"
            :disabled="player.status !== 'idle'"
            @click="onClearCache"
          >
            Clear cache now
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
