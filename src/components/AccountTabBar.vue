<script setup lang="ts">
import { useWorkspaceStore } from '@/stores/workspace'
const ws = useWorkspaceStore()
</script>

<template>
  <div class="iftv-tabbar d-flex align-items-center">
    <div
      v-for="acc in ws.openTabs"
      :key="acc.id"
      class="iftv-tab"
      :class="{ active: acc.id === ws.tabs.activeTabId }"
      @click="ws.activate(acc.id)"
    >
      <span class="iftv-tab-label">{{ acc.name }}</span>
      <button class="iftv-tab-close" title="Close tab" @click.stop="ws.close(acc.id)">×</button>
    </div>
    <RouterLink class="iftv-tab-add btn btn-sm btn-link" to="/accounts" title="Manage accounts">＋ Accounts</RouterLink>
  </div>
</template>
