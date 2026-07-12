<script setup lang="ts">
// A dropdown/menu that can never be clipped by an ancestor's overflow (cards use overflow:hidden,
// modals + the grid use overflow:auto). The trigger renders inline; the menu teleports to <body> and
// positions itself as a fixed overlay anchored to the trigger — right- or left-aligned, flipped above
// when there isn't room below. Closes on outside click, scroll, resize, or Escape. Use this for ANY
// popup so the clipping bug can't come back.
//
//   <AnchoredMenu menu-class="dropdown-menu">
//     <template #trigger="{ toggle }"><button @click="toggle">＋</button></template>
//     <template #default="{ close }"><button class="dropdown-item" @click="close">…</button></template>
//   </AnchoredMenu>
import { ref, onBeforeUnmount, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 'end' right-aligns the menu to the trigger's right edge (default); 'start' left-aligns it. */
    align?: 'start' | 'end'
    /** Classes for the floating menu container (e.g. 'dropdown-menu iftv-card-menu'). */
    menuClass?: string
    /** Rough menu height (px) used to decide whether to open upward near the viewport bottom. */
    estHeight?: number
  }>(),
  { align: 'end', menuClass: 'dropdown-menu', estHeight: 240 },
)

const open = ref(false)
const menuStyle = ref<Record<string, string>>({})

function position(anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect()
  const spaceBelow = window.innerHeight - r.bottom
  const openUp = spaceBelow < props.estHeight && r.top > spaceBelow
  const style: Record<string, string> = {
    position: 'fixed',
    top: openUp ? `${r.top}px` : `${r.bottom}px`,
    right: 'auto',
    zIndex: '1080', // above app chrome (header z-1060, modals z-1070) once teleported to <body>
  }
  if (props.align === 'end') {
    style.left = `${r.right}px`
    style.transform = openUp ? 'translate(-100%, -100%)' : 'translateX(-100%)'
  } else {
    style.left = `${r.left}px`
    style.transform = openUp ? 'translateY(-100%)' : 'none'
  }
  menuStyle.value = style
}

function toggle(e: MouseEvent) {
  e.stopPropagation() // don't let this click reach the document handler that would close it
  open.value = !open.value
  if (open.value) position(e.currentTarget as HTMLElement)
}
function close() {
  open.value = false
}

function onKey(e: Event) {
  if ((e as KeyboardEvent).key === 'Escape') close()
}
// A fixed overlay doesn't track its anchor when anything scrolls; capture:true catches inner
// (virtual-grid / modal) scrolls that don't bubble to window. Dismiss on any of them.
function bindGlobal(on: boolean) {
  const m = on ? 'addEventListener' : 'removeEventListener'
  document[m]('click', close)
  window[m]('scroll', close, true)
  window[m]('resize', close)
  document[m]('keydown', onKey)
}
watch(open, (isOpen) => bindGlobal(isOpen))
onBeforeUnmount(() => bindGlobal(false))

defineExpose({ close })
</script>

<template>
  <slot name="trigger" :toggle="toggle" :open="open" />
  <Teleport to="body">
    <div v-if="open" :class="[menuClass, 'show']" :style="menuStyle" @click.stop>
      <slot :close="close" />
    </div>
  </Teleport>
</template>
