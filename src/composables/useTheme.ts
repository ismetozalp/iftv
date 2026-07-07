import { resolveTheme, type ThemeMode, type Theme } from '@/core/theme'

const html = () => document.documentElement
let selfWrite = false
let ambientCockpit: Theme | null = null // Cockpit's last-known data-bs-theme (its intent), not our echo

function readAttr(): Theme | null {
  const v = html().getAttribute('data-bs-theme')
  return v === 'dark' || v === 'light' ? v : null
}

export function applyTheme(t: Theme) {
  selfWrite = true
  html().setAttribute('data-bs-theme', t)
  selfWrite = false
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
        if (selfWrite) return // ignore our own writes
        ambientCockpit = readAttr() // Cockpit (or shell) changed it → remember its intent
        recompute() // system → follow it; light/dark → re-assert ours
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
