import { resolveTheme, type ThemeMode, type Theme } from '@/core/theme'

const html = () => document.documentElement
// What WE last wrote to data-bs-theme. Used to tell our own writes apart from Cockpit/OS ones — a
// VALUE guard, not a timing flag: the MutationObserver fires ASYNCHRONOUSLY, so a `selfWrite=true`
// flag reset synchronously around setAttribute would already be false by the time the callback runs
// (which caused an observer→apply→observer infinite loop that pinned the tab on every theme change).
let lastApplied: Theme | null = null
let ambientCockpit: Theme | null = null // Cockpit's last-known data-bs-theme (its intent), not our echo

function readAttr(): Theme | null {
  const v = html().getAttribute('data-bs-theme')
  return v === 'dark' || v === 'light' ? v : null
}

export function applyTheme(t: Theme) {
  lastApplied = t
  // Only write when it actually differs — avoids a redundant same-value mutation (and extra work).
  if (html().getAttribute('data-bs-theme') !== t) html().setAttribute('data-bs-theme', t)
}

export function initTheme(getMode: () => ThemeMode): () => void {
  ambientCockpit = readAttr() // whatever Cockpit set before we touched it
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  const recompute = () => applyTheme(resolveTheme(getMode(), ambientCockpit, !!mq?.matches))
  recompute()
  const onMq = () => recompute()
  mq?.addEventListener?.('change', onMq)
  const obs = typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => {
        const cur = readAttr()
        if (cur === lastApplied) return // our own write (or already matches it) → ignore, no loop
        ambientCockpit = cur // an external (Cockpit shell / OS) change → remember its intent
        recompute() // system → follow it; light/dark → re-assert our override
      })
    : null
  obs?.observe(html(), { attributes: true, attributeFilter: ['data-bs-theme'] })
  return () => {
    mq?.removeEventListener?.('change', onMq)
    obs?.disconnect()
  }
}

export function reapplyTheme(mode: ThemeMode) {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  applyTheme(resolveTheme(mode, ambientCockpit, !!mq?.matches))
}
