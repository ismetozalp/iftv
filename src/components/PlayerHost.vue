<script setup lang="ts">
import PlayerView from '@/components/PlayerView.vue'
import { usePlayerStore } from '@/stores/player'

// Renders one PlayerView per account that has a live/starting/error/playing slot — each keeps its
// own <video>+hls session mounted regardless of which account tab is active (see PlayerView for
// the active/minimized/hidden presentation logic and the mute rule).
const player = usePlayerStore()
</script>

<template>
  <PlayerView v-for="s in player.playingSlots" :key="s.accountId" :account-id="s.accountId" />
</template>
