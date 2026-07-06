<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useLibraryStore } from '@/stores/library'
import { useEpgStore } from '@/stores/epg'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import type { ContentItem } from '@/core/content/types'
import type { Programme } from '@/core/epg/types'
import { programmeBlocks, timeTicks, nowMarkerPx, type ProgrammeBlock } from '@/core/epg/layout'

const HOUR = 3_600_000
const WINDOW_HOURS = 6
const PX_PER_HOUR = 240
const ROW_H = 56
const TICK_STEP_MIN = 30

const ws = useWorkspaceStore()
const lib = useLibraryStore()
const epg = useEpgStore()
const player = usePlayerStore()
const settings = useSettingsStore()

function floorToHour(ms: number): number {
  return Math.floor(ms / HOUR) * HOUR
}

const liveItems = ref<ContentItem[]>([])
const loading = ref(false)

async function loadChannels() {
  const account = ws.activeAccount
  if (!account) {
    liveItems.value = []
    return
  }
  loading.value = true
  try {
    liveItems.value = await lib.allLiveItems(account)
  } finally {
    loading.value = false
  }
}
onMounted(loadChannels)
watch(() => ws.activeAccount?.id, loadChannels)

// --- time window (pan/now) ---
const windowStartMs = ref(floorToHour(Date.now()))
const windowEndMs = computed(() => windowStartMs.value + WINDOW_HOURS * HOUR)
function pan(deltaHours: number) {
  windowStartMs.value += deltaHours * HOUR
}
function resetNow() {
  windowStartMs.value = floorToHour(Date.now())
}
function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
const rangeLabel = computed(() => `${timeLabel(windowStartMs.value)} – ${timeLabel(windowEndMs.value)}`)

// --- now marker (advances without polluting core/epg with Date.now()) ---
const nowMs = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  nowTimer = setInterval(() => {
    nowMs.value = Date.now()
  }, 30_000)
})
onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer)
})
const nowPx = computed(() => nowMarkerPx(nowMs.value, windowStartMs.value, PX_PER_HOUR))
const showNowMarker = computed(() => nowMs.value >= windowStartMs.value && nowMs.value <= windowEndMs.value)

// --- matched channels × programmes for the window ---
const rows = computed(() => epg.guideChannels(liveItems.value, windowStartMs.value, windowEndMs.value))
const ticks = computed(() => timeTicks(windowStartMs.value, windowEndMs.value, TICK_STEP_MIN, PX_PER_HOUR))
const axisWidthPx = computed(() => ((windowEndMs.value - windowStartMs.value) / HOUR) * PX_PER_HOUR)

function blocksFor(programmes: Programme[]): ProgrammeBlock[] {
  return programmeBlocks(programmes, windowStartMs.value, windowEndMs.value, PX_PER_HOUR)
}

// --- row virtualization (mirrors VirtualGrid.vue: render only the rows near the viewport) ---
const gridEl = ref<HTMLElement | null>(null)
const namesEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportH = ref(0)
let ro: ResizeObserver | null = null
let syncingScroll = false

function measure() {
  viewportH.value = gridEl.value?.clientHeight ?? 0
}
function onGridScroll() {
  if (!gridEl.value) return
  scrollTop.value = gridEl.value.scrollTop
  if (syncingScroll || !namesEl.value) return
  syncingScroll = true
  namesEl.value.scrollTop = gridEl.value.scrollTop
  syncingScroll = false
}
function onNamesScroll() {
  if (!namesEl.value) return
  scrollTop.value = namesEl.value.scrollTop
  if (syncingScroll || !gridEl.value) return
  syncingScroll = true
  gridEl.value.scrollTop = namesEl.value.scrollTop
  syncingScroll = false
}
onMounted(() => {
  measure()
  ro = new ResizeObserver(measure)
  if (gridEl.value) ro.observe(gridEl.value)
})
onBeforeUnmount(() => ro?.disconnect())

// Reset scroll only when the CHANNEL SET changes (e.g. account switch) — NOT on every time-window
// pan (rows is a fresh array each pan, so watching `rows` directly would snap scroll to top).
watch(
  () => rows.value.map((r) => r.item.id).join(','),
  () => {
    scrollTop.value = 0
    if (gridEl.value) gridEl.value.scrollTop = 0
    if (namesEl.value) namesEl.value.scrollTop = 0
  },
)

const firstRow = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - 2))
const rowsInView = computed(() => Math.ceil(viewportH.value / ROW_H) + 4)
const totalHeight = computed(() => rows.value.length * ROW_H)
const visibleRows = computed(() => {
  const end = Math.min(rows.value.length, firstRow.value + rowsInView.value)
  const out: { item: ContentItem; programmes: Programme[]; top: number; blocks: ProgrammeBlock[] }[] = []
  for (let i = firstRow.value; i < end; i++) {
    const r = rows.value[i]
    out.push({ item: r.item, programmes: r.programmes, top: i * ROW_H, blocks: blocksFor(r.programmes) })
  }
  return out
})

// --- programme details popover ---
interface DetailsState { item: ContentItem; title: string; startMs: number; stopMs: number; desc: string }
const details = ref<DetailsState | null>(null)
function openDetails(item: ContentItem, programmes: Programme[], block: ProgrammeBlock) {
  const full = programmes.find((p) => p.startMs === block.startMs && p.stopMs === block.stopMs)
  details.value = { item, title: block.title, startMs: block.startMs, stopMs: block.stopMs, desc: full?.desc ?? '' }
}
function closeDetails() {
  details.value = null
}
function playFromDetails() {
  const account = ws.activeAccount
  if (!account || !details.value) return
  void player.play(account, details.value.item)
  details.value = null
}
</script>

<template>
  <div class="iftv-guide d-flex flex-column h-100">
    <div class="iftv-guide-toolbar d-flex align-items-center gap-2 mb-2">
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="pan(-1)">&#9664;</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="resetNow">Now</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="pan(1)">&#9654;</button>
      <span class="text-muted small">{{ rangeLabel }}</span>
    </div>

    <p v-if="!settings.epgUrl" class="text-muted p-2">Set an EPG URL in Settings.</p>
    <p v-else-if="loading" class="text-muted p-2">Loading&hellip;</p>
    <p v-else-if="!rows.length" class="text-muted p-2">No guide data for your channels.</p>
    <div v-else class="iftv-guide-body flex-fill d-flex">
      <div ref="namesEl" class="iftv-guide-names" @scroll="onNamesScroll">
        <div class="iftv-guide-names-header"></div>
        <div class="iftv-guide-names-inner" :style="{ height: totalHeight + 'px' }">
          <div
            v-for="r in visibleRows"
            :key="r.item.id"
            class="iftv-guide-name-cell text-truncate"
            :style="{ transform: `translateY(${r.top}px)` }"
          >
            {{ r.item.name }}
          </div>
        </div>
      </div>
      <div ref="gridEl" class="iftv-guide-grid" @scroll="onGridScroll">
        <div class="iftv-guide-header" :style="{ width: axisWidthPx + 'px' }">
          <span v-for="t in ticks" :key="t.ms" class="iftv-guide-tick" :style="{ left: t.leftPx + 'px' }">
            {{ timeLabel(t.ms) }}
          </span>
        </div>
        <div class="iftv-guide-rows" :style="{ width: axisWidthPx + 'px', height: totalHeight + 'px' }">
          <div v-if="showNowMarker" class="iftv-guide-now-line" :style="{ left: nowPx + 'px' }"></div>
          <div v-for="r in visibleRows" :key="r.item.id" class="iftv-guide-row" :style="{ transform: `translateY(${r.top}px)` }">
            <div
              v-for="(b, i) in r.blocks"
              :key="i"
              class="iftv-guide-block text-truncate"
              role="button"
              :style="{ left: b.leftPx + 'px', width: b.widthPx + 'px' }"
              @click="openDetails(r.item, r.programmes, b)"
            >
              {{ b.title }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="details" class="iftv-guide-popover" @click.self="closeDetails">
      <div class="iftv-guide-popover-card">
        <h6 class="mb-1">{{ details.title }}</h6>
        <div class="text-muted small mb-2">{{ timeLabel(details.startMs) }} &ndash; {{ timeLabel(details.stopMs) }}</div>
        <p class="small">{{ details.desc || 'No description.' }}</p>
        <div class="d-flex gap-2 justify-content-end">
          <button type="button" class="btn btn-sm btn-outline-secondary" @click="closeDetails">Close</button>
          <button type="button" class="btn btn-sm btn-primary" @click="playFromDetails">Play</button>
        </div>
      </div>
    </div>
  </div>
</template>
