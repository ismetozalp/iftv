<script setup lang="ts">
import { computed } from 'vue'
import { useEpgStore } from '@/stores/epg'

const props = defineProps<{ channelName: string }>()

const epg = useEpgStore()

const rows = computed(() => epg.scheduleFor(props.channelName))

function isCurrent(startMs: number, stopMs: number): boolean {
  const t = Date.now()
  return startMs <= t && t < stopMs
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="iftv-epg-schedule">
    <div v-if="!rows.length" class="iftv-epg-schedule-empty text-muted">No guide for this channel.</div>
    <div
      v-for="p in rows"
      :key="p.startMs"
      class="iftv-epg-schedule-row"
      :class="{ 'iftv-epg-schedule-current': isCurrent(p.startMs, p.stopMs) }"
    >
      <span class="iftv-epg-schedule-time">{{ timeLabel(p.startMs) }}</span>
      <span class="iftv-epg-schedule-title text-truncate">{{ p.title }}</span>
    </div>
  </div>
</template>
