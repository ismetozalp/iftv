<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()

function onInput(e: Event) {
  const n = Number((e.target as HTMLInputElement).value)
  void settings.setBufferSeconds(n)
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
    </div>
  </div>
</template>
