<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

const props = withDefaults(defineProps<{ items: unknown[]; itemWidth?: number; itemHeight?: number; gap?: number }>(), {
  itemWidth: 180, itemHeight: 130, gap: 12,
})

const container = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const width = ref(0)
const height = ref(0)
let ro: ResizeObserver | null = null

function measure() {
  if (!container.value) return
  width.value = container.value.clientWidth
  height.value = container.value.clientHeight
}
function onScroll() {
  if (container.value) scrollTop.value = container.value.scrollTop
}
onMounted(() => {
  measure()
  ro = new ResizeObserver(measure)
  if (container.value) ro.observe(container.value)
})
onBeforeUnmount(() => ro?.disconnect())

watch(() => props.items, () => {
  if (container.value) container.value.scrollTop = 0
  scrollTop.value = 0
})

const cols = computed(() => Math.max(1, Math.floor((width.value + props.gap) / (props.itemWidth + props.gap))))
const rowH = computed(() => props.itemHeight + props.gap)
const totalHeight = computed(() => Math.ceil(props.items.length / cols.value) * rowH.value)
const firstRow = computed(() => Math.max(0, Math.floor(scrollTop.value / rowH.value) - 2))
const rowsInView = computed(() => Math.ceil(height.value / rowH.value) + 4)
const start = computed(() => firstRow.value * cols.value)
const end = computed(() => Math.min(props.items.length, (firstRow.value + rowsInView.value) * cols.value))
const visible = computed(() => {
  const out: { item: unknown; index: number; top: number; left: number }[] = []
  for (let i = start.value; i < end.value; i++) {
    const r = Math.floor(i / cols.value)
    const c = i % cols.value
    out.push({ item: props.items[i], index: i, top: r * rowH.value, left: c * (props.itemWidth + props.gap) })
  }
  return out
})
</script>

<template>
  <div ref="container" class="iftv-vgrid" @scroll="onScroll">
    <div class="iftv-vgrid-inner" :style="{ height: totalHeight + 'px' }">
      <div
        v-for="v in visible"
        :key="v.index"
        class="iftv-vgrid-cell"
        :style="{ transform: `translate(${v.left}px, ${v.top}px)`, width: props.itemWidth + 'px', height: props.itemHeight + 'px' }"
      >
        <slot :item="v.item" :index="v.index" />
      </div>
    </div>
  </div>
</template>
