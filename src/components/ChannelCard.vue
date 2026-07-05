<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Channel } from '@/core/content/types'

const props = defineProps<{ channel: Channel }>()
const failed = ref(false)

watch(() => props.channel.id, () => { failed.value = false })
</script>

<template>
  <div class="iftv-channel card h-100" :title="channel.name">
    <div class="iftv-channel-logo">
      <img v-if="channel.logo && !failed" :src="channel.logo" alt="" loading="lazy" @error="failed = true" />
      <span v-else class="iftv-channel-fallback">{{ channel.name.slice(0, 2).toUpperCase() }}</span>
    </div>
    <div class="iftv-channel-name text-truncate">{{ channel.name }}</div>
  </div>
</template>
