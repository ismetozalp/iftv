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
import { useUpdaterStore } from '@/stores/updater'
import { usePlayerStore } from '@/stores/player'
import { initTheme, reapplyTheme } from '@/composables/useTheme'

const ws = useWorkspaceStore()
const settings = useSettingsStore()
const collections = useCollectionsStore()
const epg = useEpgStore()
const updater = useUpdaterStore()
const player = usePlayerStore()
const settingsOpen = ref(false)
const updateConfirm = ref(false) // inline confirm popover under the badge
const updateJustChecked = ref(false) // show the "up to date" note only right after a manual click

async function onBadgeClick() {
  updateConfirm.value = false
  updateJustChecked.value = false
  await updater.check(true)
  updateJustChecked.value = true
  if (updater.available) updateConfirm.value = true // ask before updating
}
async function confirmUpdate() {
  updateConfirm.value = false
  settingsOpen.value = true // reveal the streamed install log in Settings
  await updater.update()
}
// The full player overlays below the header so the account tabs stay reachable while playing.
// Header height varies (tabs wrap with many accounts), so publish it as a CSS var the player reads.
const headerEl = ref<HTMLElement>()
onMounted(() => {
  void collections.load()
  // EPG is per-account now: wait for accounts/tabs + settings (both feed URL resolution), rebuild
  // every account's cached index, then refresh each OPEN account (each resolves its own guide —
  // manual URL / panel xmltv.php / M3U url-tvg / global fallback).
  void Promise.all([ws.init(), settings.load()])
    .then(() => epg.load())
    .then(() => {
      for (const acc of ws.openTabs) void epg.ensureFresh(acc)
    })
  const stopTheme = initTheme(() => settings.themeMode)
  onBeforeUnmount(stopTheme)
  if (headerEl.value) {
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--iftv-header-h', `${headerEl.value!.offsetHeight}px`),
    )
    ro.observe(headerEl.value)
    onBeforeUnmount(() => ro.disconnect())
  }
  // Silent update check ~4s after load — the badge shows a dot if a newer release exists.
  const t = setTimeout(() => updater.startupCheck(), 4000)
  onBeforeUnmount(() => clearTimeout(t))
  // Proactively tear down all playback when the page is being unloaded (tab close, navigate away,
  // refresh) so no ffmpeg/curl lingers. `pagehide` is more reliable than `beforeunload` here.
  const onHide = () => { void player.stopAll() }
  window.addEventListener('pagehide', onHide)
  onBeforeUnmount(() => window.removeEventListener('pagehide', onHide))
})
watch(() => settings.themeMode, (m) => reapplyTheme(m))
// Opening / switching to an account ensures its guide is loaded (TTL-cached).
watch(() => ws.activeAccount?.id, () => { if (ws.activeAccount) void epg.ensureFresh(ws.activeAccount) })
// One shared clock (not one per card) so EPG now/next lines roll over without a full refresh.
const epgClock = setInterval(() => epg.tick(), 60000)
onBeforeUnmount(() => clearInterval(epgClock))
</script>

<template>
  <div class="iftv-shell">
    <header ref="headerEl" class="iftv-header d-flex align-items-center gap-3">
      <strong>InFlight TV</strong>
      <AccountTabBar />
      <div class="iftv-verbadge ms-auto position-relative">
        <button
          class="btn btn-sm btn-link iftv-badge-btn"
          :title="updater.available ? 'Update available — click to review' : 'Check for updates'"
          @click="onBadgeClick"
        >
          IF TV v{{ updater.current || '?' }}
          <span v-if="updater.available" class="iftv-badge-dot" aria-label="update available"></span>
          <span v-if="updater.checking" class="small text-muted"> · checking…</span>
        </button>
        <div v-if="updateConfirm && updater.available" class="iftv-badge-pop card p-2">
          <div class="small mb-2">Update available: <strong>v{{ updater.latest?.version }}</strong>. Update now and restart Cockpit?</div>
          <div class="d-flex gap-2 justify-content-end">
            <button class="btn btn-sm btn-light" @click="updateConfirm = false">Later</button>
            <button class="btn btn-sm btn-primary" @click="confirmUpdate">Update &amp; restart</button>
          </div>
        </div>
        <div
          v-else-if="updateJustChecked && !updater.available && updater.latest && !updater.checking"
          class="iftv-badge-pop card p-2 small text-muted"
          @click="updateJustChecked = false"
        >
          Up to date (v{{ updater.current }}).
        </div>
      </div>
      <button class="btn btn-sm btn-link ms-2" title="Settings" @click="settingsOpen = true">⚙ Settings</button>
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
