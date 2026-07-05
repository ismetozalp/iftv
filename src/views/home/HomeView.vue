<script setup lang="ts">
import { useWorkspaceStore } from '@/stores/workspace'
import LiveView from '@/views/live/LiveView.vue'
const ws = useWorkspaceStore()
</script>

<template>
  <div class="h-100">
    <LiveView v-if="ws.activeAccount" />
    <div v-else>
      <h4>Welcome to InFlight TV</h4>
      <p class="text-muted">No account open. Go to <RouterLink to="/accounts">Accounts</RouterLink> to add or open one.</p>
    </div>
  </div>
</template>
