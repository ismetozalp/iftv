# In-flight TV — Plan: Cache / Storage Setting

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Configurable cache directory (segments land on a chosen disk, default `~/.cache/inflighttv`) + a size limit enforced by pruning the oldest leftover session dirs on each new play. Spec: `docs/superpowers/specs/2026-07-06-cache-storage-setting-design.md`.

**Architecture:** Pure `resolveCacheRoot` + `selectDirsToPrune` in `core/`. Two settings (`cacheDir`, `cacheLimitGb`). The engine resolves the root + prunes at session start via injected deps (read the current setting → effective on next play, no recreate). New cockpit adapter `cockpitCache.ts` for writable-probe / size / clear. Settings UI "Cache / storage" section.

**Tech Stack:** unchanged (Vue3/Vite/TS/Bootstrap/Pinia/Vitest).

## Global Constraints
- Branch `feat/cache-setting` (off `main`, which has the SOZCU fixes). `src/core/**` pure/DI; cockpit only in adapters. TDD; per-task commit; merge to `main`.
- **SAFETY (non-negotiable):** a user-supplied `cacheDir` always gets the app's own `/inflighttv` subdir appended before use, so `rm -rf`/clear only ever touch our subdir, never the user's raw folder.
- Adapter shell calls pass paths as **argv / positional `$0`** (never interpolated into `sh -c` script text) — `cacheDir` is user input.
- Keep the single-connection invariant untouched (this plan only changes WHERE files go + cleanup).

## File Structure
- `src/core/media/session.ts` — add `resolveCacheRoot`. (+test)
- `src/core/media/cachePrune.ts` — `selectDirsToPrune`. NEW (+test)
- `src/stores/settings.ts` — `cacheDir`/`cacheLimitGb` + clamp + validation action. (+test)
- `src/core/media/PlaybackEngine.ts` — `EngineDeps` += `cacheDir`/`cacheLimitBytes`/`listSessionDirs`.
- `src/core/media/engine.ts` — resolve root + prune at start. (+test)
- `src/adapters/cockpitCache.ts` — `probeWritable`/`cacheSizeBytes`/`clearCache`. NEW
- `src/adapters/cockpitPlayback.ts` — provide the new engine deps; init cleanup via `resolveCacheRoot`.
- `src/views/settings/SettingsView.vue` — "Cache / storage" section.

---

### Task 1: Pure core (`resolveCacheRoot` + `selectDirsToPrune`) + settings fields & validation

**Files:** modify `src/core/media/session.ts` (+`session.test.ts` if present, else new); create `src/core/media/cachePrune.ts` (+test); modify `src/stores/settings.ts` (+`settings.test.ts`).

- [ ] **Step 1 — failing test** `session.test.ts` for `resolveCacheRoot`:
```ts
import { resolveCacheRoot } from './session'
it('default when cacheDir empty', () => expect(resolveCacheRoot('/home/u', '')).toBe('/home/u/.cache/inflighttv'))
it('appends the app subdir to a custom dir (so cleanup never nukes the raw path)', () => {
  expect(resolveCacheRoot('/home/u', '/data/media')).toBe('/data/media/inflighttv')
  expect(resolveCacheRoot('/home/u', '/data/media/')).toBe('/data/media/inflighttv') // trailing slash tolerated
})
```
- [ ] **Step 2 — implement** in `session.ts`: `export function resolveCacheRoot(home: string, cacheDir: string): string { const d = cacheDir.trim().replace(/\/+$/, ''); return d ? `${d}/inflighttv` : cacheRoot(home) }`. RED→GREEN.
- [ ] **Step 3 — failing test** `cachePrune.test.ts`:
```ts
import { selectDirsToPrune } from './cachePrune'
const GB = 1024 ** 3
it('under limit → prune nothing', () => {
  expect(selectDirsToPrune([{ id: 'a', sizeBytes: GB, mtime: 1 }], 5 * GB, 'new')).toEqual([])
})
it('over limit → delete oldest first until under, never keepId', () => {
  const e = [{ id: 'new', sizeBytes: 2 * GB, mtime: 9 }, { id: 'old1', sizeBytes: 2 * GB, mtime: 1 }, { id: 'old2', sizeBytes: 2 * GB, mtime: 2 }]
  // total 6GB, limit 5GB → must drop 1GB+; oldest is old1 (mtime 1). Dropping old1 → 4GB ≤ 5GB.
  expect(selectDirsToPrune(e, 5 * GB, 'new')).toEqual(['old1'])
})
it('never selects keepId even if it is the biggest/oldest', () => {
  const e = [{ id: 'new', sizeBytes: 10 * GB, mtime: 0 }]
  expect(selectDirsToPrune(e, 1 * GB, 'new')).toEqual([])
})
```
- [ ] **Step 4 — implement** `cachePrune.ts`:
```ts
export interface DirEntry { id: string; sizeBytes: number; mtime: number }
// Delete oldest-first (by mtime) until total <= limit; NEVER the active session (keepId).
export function selectDirsToPrune(entries: DirEntry[], limitBytes: number, keepId: string): string[] {
  let total = entries.reduce((s, e) => s + e.sizeBytes, 0)
  if (total <= limitBytes) return []
  const victims = entries.filter((e) => e.id !== keepId).sort((a, b) => a.mtime - b.mtime)
  const out: string[] = []
  for (const v of victims) { if (total <= limitBytes) break; out.push(v.id); total -= v.sizeBytes }
  return out
}
```
RED→GREEN.
- [ ] **Step 5 — settings fields** in `settings.ts`: add consts `DEFAULT_CACHE_LIMIT_GB = 5`, `MIN_CACHE_LIMIT_GB = 1`; `clampCacheLimitGb(n) = Math.max(MIN, Math.floor(n) || DEFAULT)`. State `cacheDir: '' as string`, `cacheLimitGb: DEFAULT_CACHE_LIMIT_GB`. `PersistedSettings` += both. `_persist` writes them. `load()` back-fills (`loaded.cacheDir ?? ''`, `clampCacheLimitGb(loaded.cacheLimitGb ?? DEFAULT)`). `Deps` += `probeWritable?: (dir: string) => Promise<boolean>` (default from `@/adapters/cockpitCache`).
- [ ] **Step 6 — settings actions + tests**:
```ts
async setCacheLimitGb(n: number) { this.cacheLimitGb = clampCacheLimitGb(n); await this._persist() },
// Validate a chosen dir before persisting: empty = default (always ok); else probe writable.
async setCacheDir(dir: string): Promise<{ ok: boolean; error?: string }> {
  const d = dir.trim()
  if (d) { const { probeWritable } = await this._host(); const ok = await (probeWritable ?? cockpitProbeWritable)(d); if (!ok) return { ok: false, error: 'Directory is not writable' } }
  this.cacheDir = d; await this._persist(); return { ok: true }
},
```
Tests (memory store + injected `probeWritable`): persist/load round-trip incl. back-compat (missing keys → defaults); `setCacheLimitGb` clamps; `setCacheDir('')` ok+persists; `setCacheDir('/x')` with `probeWritable→true` persists; with `→false` returns `{ok:false}` and leaves `cacheDir` unchanged.
- [ ] **Step 7 — gate + commit.** `git commit -am "feat(cache): resolveCacheRoot + selectDirsToPrune (pure) + cacheDir/cacheLimitGb settings with writable validation"`

---

### Task 2: Engine prune + adapters

**Files:** modify `src/core/media/PlaybackEngine.ts`, `src/core/media/engine.ts` (+`engine.test.ts`); create `src/adapters/cockpitCache.ts`; modify `src/adapters/cockpitPlayback.ts`.

- [ ] **Step 1 — EngineDeps** (`PlaybackEngine.ts`): add `cacheDir(): Promise<string>`, `cacheLimitBytes(): Promise<number>`, `listSessionDirs(root: string): Promise<{ id: string; sizeBytes: number; mtime: number }[]>`.
- [ ] **Step 2 — engine test** (`engine.test.ts`, DI fakes): `start` writes the playlist/segments under `resolveCacheRoot(home, cacheDir)` (assert the paths passed to `mkdir`/spawn args use the custom root when `cacheDir` returns `/data`); prune deletes over-limit oldest non-active dirs (fake `listSessionDirs` returns over-limit entries incl. the new id → `rmrf` called for the expected victims, never the new id). RED.
- [ ] **Step 3 — engine.start** (`engine.ts`): replace `const dir = sessionDir(cacheRoot(await deps.home()), id)` with:
```ts
const root = resolveCacheRoot(await deps.home(), await deps.cacheDir())
const id = deps.newId()
const dir = sessionDir(root, id)
await deps.mkdir(dir)
try { // best-effort size cap: drop oldest leftover sessions (never the new one)
  const victims = selectDirsToPrune(await deps.listSessionDirs(root), await deps.cacheLimitBytes(), id)
  for (const vid of victims) await deps.rmrf(sessionDir(root, vid))
} catch { /* pruning must never block playback */ }
```
(import `resolveCacheRoot`, `selectDirsToPrune`.) Keep the rest unchanged. GREEN.
- [ ] **Step 4 — `cockpitCache.ts`** (adapter; paths as argv/positional, never interpolated):
```ts
import cockpit from 'cockpit'
export async function probeWritable(dir: string): Promise<boolean> {
  try { await cockpit.spawn(['sh', '-c', 'd="$0/inflighttv"; mkdir -p "$d" && t="$d/.wtest.$$" && : > "$t" && rm -f "$t"', dir], { err: 'message' }); return true } catch { return false }
}
export async function cacheSizeBytes(root: string): Promise<number> {
  try { const o = await cockpit.spawn(['du', '-sb', root], { err: 'message' }) as unknown as string; return parseInt(String(o).split(/\s+/)[0], 10) || 0 } catch { return 0 }
}
export async function clearCache(root: string): Promise<void> { await cockpit.spawn(['rm', '-rf', root], { err: 'message' }).catch(() => {}) }
export async function listSessionDirs(root: string): Promise<{ id: string; sizeBytes: number; mtime: number }[]> {
  // one dir per line: "<bytes> <mtime-epoch> <name>" — root passed as $0, children globbed (no injection)
  try {
    const o = await cockpit.spawn(['sh', '-c', 'for d in "$0"/*/; do [ -d "$d" ] || continue; printf "%s %s %s\\n" "$(du -sb "$d"|cut -f1)" "$(stat -c %Y "$d")" "$(basename "$d")"; done', root], { err: 'message' }) as unknown as string
    return String(o).trim().split('\n').filter(Boolean).map((l) => { const [b, m, ...n] = l.split(' '); return { id: n.join(' '), sizeBytes: +b || 0, mtime: +m || 0 } })
  } catch { return [] }
}
```
- [ ] **Step 5 — cockpitPlayback wiring** (`cockpitPlayback.ts`): import `useSettingsStore`, `resolveCacheRoot`, and the cache adapter. Init cleanup: `const root = resolveCacheRoot(user.home, useSettingsStore().cacheDir)` (was `cacheRoot(user.home)`) then `rm -rf root`. Add deps: `cacheDir: async () => useSettingsStore().cacheDir`, `cacheLimitBytes: async () => useSettingsStore().cacheLimitGb * 1024 ** 3`, `listSessionDirs: (root) => cacheListSessionDirs(root)`. (Reads the current setting each session → path/limit changes apply on next play. No engine recreate.)
- [ ] **Step 6 — gate + commit.** Note: engine tests must fake the 3 new deps. `git commit -am "feat(cache): engine resolves configured root + prunes oldest leftovers at session start; cockpitCache adapter (probe/size/clear/list)"`

---

### Task 3: Settings UI + E2E

**Files:** modify `src/views/settings/SettingsView.vue`; extend `dev/e2e-*.mjs`.

- [ ] **Step 1 — "Cache / storage" section** in `SettingsView.vue` (mirror the existing buffer/transcode sections). Script: local refs `cacheDirInput`, `cacheError`, `cacheSize` (string), `defaultRoot`; on open compute `defaultRoot` (`~/.cache/inflighttv` via `cockpit.user()` home — or show literal `~/.cache/inflighttv`) and `cacheSize = await cacheSizeBytes(resolvedRoot)`. Handlers: `onSaveCacheDir()` → `const r = await settings.setCacheDir(cacheDirInput.value); cacheError = r.ok ? '' : (r.error ?? 'Invalid')`, then refresh size; `onCacheLimit(e)` → `settings.setCacheLimitGb(Number(...))`; `onClearCache()` → `await clearCache(resolvedRoot); refresh size`. Template:
  - Directory: `<input class="form-control" :placeholder="defaultRoot" v-model="cacheDirInput">` + a Save button + helper `<small>` "The app writes to <code>{{ (cacheDirInput || defaultRoot) }}/…</code>" + `<div class="text-danger" v-if="cacheError">{{ cacheError }}</div>`.
  - Max size: `<input type="number" min="1" class="form-control" :value="settings.cacheLimitGb" @change="onCacheLimit">` (GB).
  - Readout + action: "Current cache: {{ cacheSize }}" + `<button @click="onClearCache">Clear cache now</button>` (disable while `player.status !== 'idle'` to avoid clearing the active session — import the player store for the guard).
- [ ] **Step 2 — resolved-root helper**: compute the display/clear root as `resolveCacheRoot(home, settings.cacheDir)` (home via `cockpit.user()`; cache it on open). Reuse `resolveCacheRoot` from core.
- [ ] **Step 3 — E2E** (`dev/e2e-cache.mjs`, real Cockpit): open Settings → set cache dir to a temp path under `/home` (e.g. `/home/ismet/iftv-cache-test`) → Save (expect no error) → play a movie ~10s → assert segments exist under `<dir>/inflighttv/<session>/*.ts` (check via a shell `ls` in the harness) → Clear cache → assert emptied. Reset the dir to default afterward. Record in `.superpowers/sdd/` report.
- [ ] **Step 4 — gate + commit.** `git commit -am "feat(cache): Settings 'Cache / storage' section — directory + size limit + current size + clear (E2E-verified segments land in the chosen dir)"`

---

## Self-Review
- **Spec coverage:** resolveCacheRoot + safety subdir (T1/T2), selectDirsToPrune (T1) used by engine (T2), settings fields + validation (T1), adapters (T2), UI + E2E (T3).
- **Types/wiring:** `EngineDeps` new methods (T2) faked in engine tests + provided by cockpitPlayback (T2); settings getters read per-session so path/limit changes apply next play.
- **Safety:** every raw `cacheDir` gets `/inflighttv` appended (`resolveCacheRoot`) before any create/rm; adapter shell passes paths as `$0`/argv (no injection); prune is best-effort (never blocks playback) and never deletes the active session; single-connection invariant untouched.
- **No regression:** default (`cacheDir=''`) resolves to the exact current path; live/VOD/seek/transcode/tracks unchanged.
