<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ContentItem } from '@/core/content/types'

const props = defineProps<{ item: ContentItem }>()
const failed = ref(false)
watch(() => props.item.id, () => { failed.value = false })
</script>

<template>
  <div class="iftv-card card h-100" :class="`iftv-card-${item.kind}`" :title="item.name">
    <div class="iftv-card-img">
      <img v-if="item.logo && !failed" :src="item.logo" alt="" loading="lazy" @error="failed = true" />
      <span v-else class="iftv-card-fallback">{{ item.name.slice(0, 2).toUpperCase() }}</span>
    </div>
    <div class="iftv-card-name text-truncate">{{ item.name }}</div>
  </div>
</template>
