<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings'
import type { TranscodeMode } from '@/core/media/encoder'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()

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
    </div>
  </div>
</template>
