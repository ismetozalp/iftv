<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import AccountTabBar from '@/components/AccountTabBar.vue'
import PlayerView from '@/components/PlayerView.vue'
import MovieDetail from '@/views/detail/MovieDetail.vue'
import SeriesDetail from '@/views/detail/SeriesDetail.vue'
import SettingsView from '@/views/settings/SettingsView.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSettingsStore } from '@/stores/settings'
import { useCollectionsStore } from '@/stores/collections'

const ws = useWorkspaceStore()
const settings = useSettingsStore()
const collections = useCollectionsStore()
const settingsOpen = ref(false)
onMounted(() => {
  void ws.init()
  void settings.load()
  void collections.load()
})
</script>

<template>
  <div class="iftv-shell">
    <header class="iftv-header d-flex align-items-center gap-3">
      <strong>InFlight TV</strong>
      <AccountTabBar />
      <button class="btn btn-sm btn-link ms-auto" title="Settings" @click="settingsOpen = true">⚙ Settings</button>
    </header>
    <main class="iftv-main">
      <RouterView />
    </main>
    <MovieDetail />
    <SeriesDetail />
    <PlayerView />
    <SettingsView :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>
