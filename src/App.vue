<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import AccountTabBar from '@/components/AccountTabBar.vue'
import PlayerView from '@/components/PlayerView.vue'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
onMounted(() => ws.init())
</script>

<template>
  <div class="iftv-shell">
    <header class="iftv-header d-flex align-items-center gap-3">
      <strong>InFlight TV</strong>
      <AccountTabBar />
    </header>
    <main class="iftv-main">
      <RouterView />
    </main>
    <PlayerView />
  </div>
</template>
