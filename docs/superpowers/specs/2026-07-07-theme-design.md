# In-flight TV — Theme (Light / Dark / System) Design

## Goal
Give In-flight TV a **Light / Dark / System** theme, modeled on the sibling *explorer* plugin. Default **System**, which **follows the Cockpit shell theme** (and the OS as fallback); Light/Dark are an explicit in-app override. Set via a selector in Settings.

## Background / current state
Vue3/Pinia/**Bootstrap 5.3.3** Cockpit plugin loading `../base1/cockpit.js` (the same base explorer uses — Cockpit sets `data-bs-theme` on the plugin `<html>` from its shell Light/Dark/Auto picker). `src/styles/app.css` (111 lines) **already uses Bootstrap `--bs-*` variables** (`--bs-body-bg`, `--bs-border-color`, `--bs-primary`, `--bs-secondary`, `--bs-card-bg`, …) for most chrome — these **auto-flip** with `data-bs-theme="dark"` in BS 5.3. `:root { color-scheme: light dark }` is already declared. The app ignores the theme *today* only because nothing sets `data-bs-theme` from our side and a handful of colors are hardcoded. Settings store (`stores/settings.ts`) + Settings UI (`views/settings/SettingsView.vue`) follow a clear pattern. explorer's model: `--ex-*` vars in `:root` + a `[data-bs-theme="dark"]` override block, driven by Cockpit.

## Non-goals
- No header quick-toggle in v1 (Settings only). No per-account themes. No custom color picker / accent themes. Not restyling video surfaces — the player + guide-details popover **stay dark in both themes** (correct for a TV/video app).

## Architecture

### 1. Setting (`stores/settings.ts`)
- `themeMode: 'system' | 'light' | 'dark'` (default `'system'`), in `PersistedSettings` + `_persist` + `load` (back-compat `?? 'system'`). `setThemeMode(m)` validates the 3 values, persists, and triggers apply (the store calls the injected/App-provided apply, or the App watches `themeMode`).

### 2. Core (pure — `core/theme.ts`)
- `type ThemeMode = 'system'|'light'|'dark'`, `type Theme = 'light'|'dark'`.
- `resolveTheme(mode: ThemeMode, cockpitTheme: Theme | null, prefersDark: boolean): Theme`:
  - `mode==='light'` → `'light'`; `mode==='dark'` → `'dark'`;
  - `mode==='system'` → `cockpitTheme ?? (prefersDark ? 'dark' : 'light')` (follow Cockpit's shell attribute if present, else the OS).
- Pure, no DOM → node-tested exhaustively.

### 3. Apply + reactivity (`composables/useTheme.ts` or App glue — DOM side)
- `applyTheme(effective: Theme)` → `document.documentElement.setAttribute('data-bs-theme', effective)` (drives Bootstrap dark mode + our vars).
- `readCockpitTheme(): Theme|null` → read the CURRENT `<html>` `data-bs-theme` **before we override it** (that's Cockpit's value); track whether the last write was ours so `readCockpitTheme` returns Cockpit's intent, not our echo (store the ambient in a module var, updated by the MutationObserver only for non-self mutations).
- **`initTheme(getMode)`** (called once from `App.vue onMounted`, returns a cleanup): capture the initial ambient Cockpit theme; compute + apply; then wire two listeners that recompute+apply **whenever mode is `system`** (and re-assert our value when mode is light/dark and something else changed it):
  - `matchMedia('(prefers-color-scheme: dark)')` `change` → OS change;
  - `MutationObserver` on `<html>` `data-bs-theme` → Cockpit shell change (ignore mutations we caused via a self-write guard flag).
- A watcher on `settings.themeMode` re-applies on user selection.

### 4. CSS (`src/styles/app.css`)
- Add a light `:root` block of app vars only where Bootstrap's don't fit: `--iftv-overlay` (card-action bg), `--iftv-accent` (progress/guide-block = keep BS primary), `--iftv-schedule-current`, `--iftv-guide-now`, and reference `--bs-*` for bg/fg/border/muted/card everywhere already using them.
- Add a `[data-bs-theme="dark"]` override block for any `--iftv-*` that must differ.
- **Convert the ~27 hardcoded colors**: the accent colors (`#0d6efd`, `#dc3545`, `#ffc107`) → keep or map to BS vars (fine in both themes); the **light-mode-breaking ones** are the ones that ASSUME a dark background — audit each and fix so light mode is readable (e.g. `.iftv-card-name`/EPG lines already use `--bs-*`; the card-action overlay `rgba(0,0,0,.55)`+`#fff` stays — it sits over artwork; `.iftv-cw-progress` bg `rgba(255,255,255,.35)` sits over artwork, fine). **Explicitly keep** `.iftv-player { background:#000 }` and `.iftv-guide-popover-card { background:#1a1a1a; color:#fff }` dark in both (they're video chrome) — document why inline.
- Net: most chrome flips via `--bs-*` once `data-bs-theme` is set; the audit ensures no white-on-white / black-on-black in light mode.

### 5. UI (`SettingsView.vue`)
- A **Theme** section (near the top): a `<select>` or segmented button group with Light / Dark / System bound to `settings.themeMode` → `settings.setThemeMode(...)`. Matches existing section markup.

## Data flow
`App mount → initTheme → resolveTheme(themeMode, ambientCockpit, prefersDark) → applyTheme(data-bs-theme) → Bootstrap + --bs-*/--iftv-* vars repaint`. User picks in Settings → `setThemeMode` persists → watcher → resolve+apply. OS/Cockpit change while in System → listener → resolve+apply.

## Error handling
- No `matchMedia`/`MutationObserver` (SSR/old) → guard with feature checks; fall back to a one-shot apply.
- Unknown persisted `themeMode` → default `'system'`.
- Reading Cockpit's attribute when absent → `null` → OS fallback. Never throws; theme is best-effort visual.

## Testing
- **Pure (unit):** `resolveTheme` truth table — light/dark force; system×(cockpit=light|dark|null)×(prefersDark=t|f) → expected; validate defaults.
- **Store:** `themeMode` persist/load + back-compat; `setThemeMode` validates + persists.
- **E2E (real Cockpit):** Settings → set **Dark** → assert `<html data-bs-theme="dark">` and a chrome color actually changed (e.g. body bg computed style dark); set **Light** → `data-bs-theme="light"` + light bg; set **System** → follows the shell/OS. Player stays black throughout. Record in the report.
- Full `npm test && typecheck && build && test:smoke` per task.

## Rollout (subagent-driven-development)
1. **Mechanism:** `core/theme.ts` `resolveTheme` (+tests); `settings.themeMode` + `setThemeMode` (+tests); `composables/useTheme.ts` `initTheme`/`applyTheme` + listeners; `App.vue` mount wiring + `themeMode` watcher.
2. **CSS + UI + E2E:** `app.css` variable/audit pass (light+dark correct, video stays black); Settings **Theme** selector; E2E toggle verification.
