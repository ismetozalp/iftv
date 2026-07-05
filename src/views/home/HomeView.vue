<script setup lang="ts">
import { useWorkspaceStore } from '@/stores/workspace'
const ws = useWorkspaceStore()
</script>

<template>
  <div>
    <template v-if="ws.activeAccount">
      <h4>{{ ws.activeAccount.name }}</h4>
      <p class="text-muted">{{ ws.activeAccount.url }}</p>
      <p class="text-muted">Live TV, VOD, and Series for this account arrive in the next milestone.</p>
    </template>
    <template v-else>
      <h4>Welcome to InFlight TV</h4>
      <p class="text-muted">No account open. Go to <RouterLink to="/accounts">Accounts</RouterLink> to add or open one.</p>
    </template>
  </div>
</template>
