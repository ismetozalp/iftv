<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { RouterView } from 'vue-router'
import AccountTabBar from '@/components/AccountTabBar.vue'
import PlayerHost from '@/components/PlayerHost.vue'
import MovieDetail from '@/views/detail/MovieDetail.vue'
import SeriesDetail from '@/views/detail/SeriesDetail.vue'
import SettingsView from '@/views/settings/SettingsView.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSettingsStore } from '@/stores/settings'
import { useCollectionsStore } from '@/stores/collections'
import { useEpgStore } from '@/stores/epg'
import { initTheme, reapplyTheme } from '@/composables/useTheme'

const ws = useWorkspaceStore()
const settings = useSettingsStore()
const collections = useCollectionsStore()
const epg = useEpgStore()
const settingsOpen = ref(false)
// The full player overlays below the header so the account tabs stay reachable while playing.
// Header height varies (tabs wrap with many accounts), so publish it as a CSS var the player reads.
const headerEl = ref<HTMLElement>()
onMounted(() => {
  void ws.init()
  void settings.load()
  void collections.load()
  void epg.load().then(() => epg.ensureFresh())
  const stopTheme = initTheme(() => settings.themeMode)
  onBeforeUnmount(stopTheme)
  if (headerEl.value) {
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--iftv-header-h', `${headerEl.value!.offsetHeight}px`),
    )
    ro.observe(headerEl.value)
    onBeforeUnmount(() => ro.disconnect())
  }
})
watch(() => settings.themeMode, (m) => reapplyTheme(m))
// One shared clock (not one per card) so EPG now/next lines roll over without a full refresh.
const epgClock = setInterval(() => epg.tick(), 60000)
onBeforeUnmount(() => clearInterval(epgClock))
</script>

<template>
  <div class="iftv-shell">
    <header ref="headerEl" class="iftv-header d-flex align-items-center gap-3">
      <strong>InFlight TV</strong>
      <AccountTabBar />
      <button class="btn btn-sm btn-link ms-auto" title="Settings" @click="settingsOpen = true">⚙ Settings</button>
    </header>
    <main class="iftv-main">
      <RouterView />
    </main>
    <MovieDetail />
    <SeriesDetail />
    <PlayerHost />
    <SettingsView :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>
