<script setup lang="ts">
import type { ContentItem } from '@/core/content/types'
import { useProxiedImage } from '@/composables/useProxiedImage'

const props = defineProps<{ item: ContentItem }>()
const { url, failed } = useProxiedImage(() => props.item.logo)
</script>

<template>
  <div class="iftv-card card h-100" :class="`iftv-card-${item.kind}`" :title="item.name">
    <div class="iftv-card-img">
      <img v-if="url && !failed" :src="url" alt="" loading="lazy" @error="failed = true" />
      <span v-else class="iftv-card-fallback">{{ item.name.slice(0, 2).toUpperCase() }}</span>
    </div>
    <div class="iftv-card-name text-truncate">{{ item.name }}</div>
  </div>
</template>
