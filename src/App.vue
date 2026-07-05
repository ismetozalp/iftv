<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router'
</script>

<template>
  <div class="iftv-shell">
    <header class="iftv-header d-flex align-items-center gap-3">
      <strong>InFlight TV</strong>
      <nav class="d-flex gap-2">
        <RouterLink class="btn btn-sm btn-link" to="/">Home</RouterLink>
        <RouterLink class="btn btn-sm btn-link" to="/accounts">Accounts</RouterLink>
      </nav>
    </header>
    <main class="iftv-main">
      <RouterView />
    </main>
  </div>
</template>
