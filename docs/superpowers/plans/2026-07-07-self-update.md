# GitHub Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let In-flight TV update itself from its GitHub releases — a header version badge and a Settings "Plugin update" section that check the latest release, and (as root) download the built plugin, install it, and restart Cockpit — mirroring the sibling `explorer` plugin.

**Architecture:** Pure version/repo logic (`core/update/release.ts`, unit-tested) + a thin cockpit adapter (`adapters/cockpitUpdate.ts`, gh-then-curl + a superuser streaming install) + a Pinia store (`stores/updater.ts`, unit-tested with an injected fake) that the Settings section and the header badge both drive. The running plugin learns its own version from a Vite `define` baked from the `VERSION` file.

**Tech Stack:** Vue 3 (runtime), Pinia, TypeScript, Vite, Vitest, `cockpit` (`spawn`/`channel`).

## Global Constraints

- Default update repo: **`ismetozalp/iftv`** (verbatim).
- iftv's release zip is the **built `dist/`** (`inflighttv-<version>.zip` → top-level `inflighttv/…`, no Makefile) → install is **copy**, NOT `make install`.
- Install target: `/usr/share/cockpit/inflighttv/`; installed-version marker: `/etc/cockpit/inflighttv/installed-version`.
- The privileged install runs via `cockpit.channel({ superuser: 'require', err: 'out' })`; the Cockpit restart is **detached** (`systemd-run`/`setsid` + `sleep 2`) so it doesn't kill the streaming channel first.
- **Never** delete settings/accounts as part of an update.
- Never interpolate untrusted text into a shell string; pass repo/tag/paths as separate argv or single-quoted, validated values.
- Follow existing patterns: modular small files, Pinia `defineStore`, adapters under `src/adapters/`, Vitest. All gates must stay green: `npm run test`, `npm run typecheck`, `npm run build`.

---

### Task 1: Bake the app version (`__IFTV_VERSION__`)

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/env.d.ts` (create if absent)
- Create: `src/core/version.ts`
- Test: `src/core/version.test.ts`

**Interfaces:**
- Produces: `APP_VERSION: string` exported from `@/core/version` (the built version, e.g. `"1.0.0"`; empty string if unknown). At build time `__IFTV_VERSION__` is a global string replaced by Vite.

- [ ] **Step 1: Add the Vite define** — in `vite.config.ts`, import `readFileSync` and inject the version.

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import compression from 'vite-plugin-compression'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const APP_VERSION = readFileSync(new URL('./VERSION', import.meta.url), 'utf8').trim()

export default defineConfig({
  base: './',
  define: { __IFTV_VERSION__: JSON.stringify(APP_VERSION) },
  resolve: {
    // ...unchanged...
```

Keep the rest of the config as-is (only add the `readFileSync` import, the `APP_VERSION` const, and the `define` line).

- [ ] **Step 2: Declare the global** — in `src/env.d.ts` add (create the file with this line if it doesn't exist; if it exists, append the line):

```ts
declare const __IFTV_VERSION__: string
```

- [ ] **Step 3: Write the failing test** — `src/core/version.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

describe('APP_VERSION', () => {
  it('exposes the baked __IFTV_VERSION__ (or "" when undefined)', async () => {
    vi.stubGlobal('__IFTV_VERSION__', '9.9.9')
    vi.resetModules()
    const { APP_VERSION } = await import('./version')
    expect(APP_VERSION).toBe('9.9.9')
  })
})
```

- [ ] **Step 4: Run it, expect FAIL** — `npx vitest run src/core/version.test.ts` → fails (`version` module missing).

- [ ] **Step 5: Implement** — `src/core/version.ts`:

```ts
// `__IFTV_VERSION__` is replaced at build time by Vite (from the repo-root VERSION file).
// Falls back to '' in environments where it isn't defined (e.g. bare unit tests without the stub).
export const APP_VERSION: string = typeof __IFTV_VERSION__ === 'string' ? __IFTV_VERSION__ : ''
```

- [ ] **Step 6: Run tests, expect PASS** — `npx vitest run src/core/version.test.ts`.

- [ ] **Step 7: Typecheck + build** — `npm run typecheck && npm run build`. Expected: clean; `dist/index.js` contains `1.0.0`. Verify: `grep -c "1.0.0" dist/index.js` ≥ 1.

- [ ] **Step 8: Commit**

```bash
git add vite.config.ts src/env.d.ts src/core/version.ts src/core/version.test.ts
git commit -m "feat(update): bake app version into the build (__IFTV_VERSION__ → APP_VERSION)"
```

---

### Task 2: Pure release/version logic (`core/update/release.ts`)

**Files:**
- Create: `src/core/update/release.ts`
- Test: `src/core/update/release.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_REPO = 'ismetozalp/iftv'`
  - `normalizeRepo(input: string): string`
  - `parseVersion(v: string): number[]`
  - `isNewer(remote: string, local: string): boolean`
  - `interface ReleaseAsset { name: string; browser_download_url: string }`
  - `pickAsset(assets: ReleaseAsset[]): ReleaseAsset | null` (matches `/^inflighttv-.*\.zip$/`)

- [ ] **Step 1: Write the failing tests** — `src/core/update/release.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeRepo, parseVersion, isNewer, pickAsset, DEFAULT_REPO } from './release'

describe('normalizeRepo', () => {
  it('passes through owner/repo', () => expect(normalizeRepo('ismetozalp/iftv')).toBe('ismetozalp/iftv'))
  it('extracts from an https URL', () => expect(normalizeRepo('https://github.com/ismetozalp/iftv')).toBe('ismetozalp/iftv'))
  it('strips .git and trailing slash', () => expect(normalizeRepo('github.com/a/b.git/')).toBe('a/b'))
  it('extracts from a releases URL', () => expect(normalizeRepo('https://github.com/a/b/releases/latest')).toBe('a/b'))
  it('falls back to the default when empty', () => expect(normalizeRepo('   ')).toBe(DEFAULT_REPO))
})

describe('parseVersion', () => {
  it('strips a leading v and splits', () => expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]))
  it('treats junk as 0', () => expect(parseVersion('1.x.4')).toEqual([1, 0, 4]))
})

describe('isNewer', () => {
  it('true when remote > local', () => expect(isNewer('1.1.0', '1.0.9')).toBe(true))
  it('false when equal', () => expect(isNewer('1.0.0', '1.0.0')).toBe(false))
  it('false when older', () => expect(isNewer('0.9.0', '1.0.0')).toBe(false))
  it('handles v-prefix + differing lengths', () => expect(isNewer('v1.2', '1.1.9')).toBe(true))
})

describe('pickAsset', () => {
  it('picks the inflighttv-*.zip asset', () =>
    expect(pickAsset([{ name: 'x.txt', browser_download_url: 'u1' }, { name: 'inflighttv-1.0.0.zip', browser_download_url: 'u2' }])?.browser_download_url).toBe('u2'))
  it('returns null when none match', () => expect(pickAsset([{ name: 'a.zip', browser_download_url: 'u' }])).toBeNull())
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/core/update/release.test.ts` (module missing).

- [ ] **Step 3: Implement** — `src/core/update/release.ts`:

```ts
export const DEFAULT_REPO = 'ismetozalp/iftv'

export interface ReleaseAsset {
  name: string
  browser_download_url: string
}

// Accept "owner/repo", a github.com URL, or a releases URL → "owner/repo". Empty → default.
export function normalizeRepo(input: string): string {
  let r = String(input ?? '').trim()
  if (!r) return DEFAULT_REPO
  const m = r.match(/github\.com[/:]([^/]+\/[^/#?]+)/i)
  if (m) r = m[1]
  else r = r.split(/[#?]/)[0] // drop any query/hash on a bare owner/repo
  r = r.replace(/\.git$/i, '').replace(/\/+$/, '')
  // If it still isn't a clean owner/repo, keep only the first two path segments.
  const parts = r.split('/').filter(Boolean)
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : DEFAULT_REPO
}

export function parseVersion(v: string): number[] {
  return String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
}

export function isNewer(remote: string, local: string): boolean {
  const a = parseVersion(remote)
  const b = parseVersion(local)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0)
    if (d) return d > 0
  }
  return false
}

export function pickAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  return (assets || []).find((a) => /^inflighttv-.*\.zip$/.test(a.name)) ?? null
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/core/update/release.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/core/update/release.ts src/core/update/release.test.ts
git commit -m "feat(update): pure release/version helpers (normalizeRepo/parseVersion/isNewer/pickAsset)"
```

---

### Task 3: Cockpit update adapter (`adapters/cockpitUpdate.ts`)

**Files:**
- Create: `src/adapters/cockpitUpdate.ts`

**Interfaces:**
- Consumes: `ReleaseAsset`, `pickAsset` from `@/core/update/release`; `cockpit` module.
- Produces:
  - `interface LatestRelease { tag: string; version: string; assets: ReleaseAsset[] }`
  - `interface UpdateAdapter { fetchLatestRelease(repo: string): Promise<LatestRelease | null>; downloadReleaseZip(repo: string, tag: string): Promise<string>; runInstall(zipPath: string, version: string, onLine: (s: string) => void): Promise<number> }`
  - `const cockpitUpdate: UpdateAdapter` (the real implementation)

This adapter is cockpit-bound (no unit test — covered by the E2E in Task 7). Keep it thin; all decisions live in Task 2/Task 4.

- [ ] **Step 1: Implement** — `src/adapters/cockpitUpdate.ts`:

```ts
import cockpit from 'cockpit'
import { pickAsset, type ReleaseAsset } from '@/core/update/release'

export interface LatestRelease {
  tag: string
  version: string
  assets: ReleaseAsset[]
}

export interface UpdateAdapter {
  fetchLatestRelease(repo: string): Promise<LatestRelease | null>
  downloadReleaseZip(repo: string, tag: string): Promise<string>
  runInstall(zipPath: string, version: string, onLine: (s: string) => void): Promise<number>
}

// repo is normalizeRepo()'d "owner/repo" (validated) — safe to place in an argv/URL.
const API = 'https://api.github.com/repos/'

async function ghAvailable(): Promise<boolean> {
  try {
    await cockpit.spawn(['sh', '-c', 'command -v gh'], { err: 'message' })
    return true
  } catch {
    return false
  }
}

function toRelease(json: string): LatestRelease | null {
  const j = JSON.parse(json)
  if (!j || !j.tag_name) return null
  const assets: ReleaseAsset[] = (j.assets || []).map((a: { name: string; browser_download_url: string }) => ({
    name: a.name,
    browser_download_url: a.browser_download_url,
  }))
  return { tag: j.tag_name, version: String(j.tag_name).replace(/^v/i, ''), assets }
}

// The privileged install script: copy the built dist into place + restart Cockpit detached.
// {zip} and {version} are validated (a mktemp path we created; version is digits/dots).
function installScript(zip: string, version: string): string {
  const q = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`
  return [
    'set -e',
    'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'echo "== IF TV plugin self-update =="',
    `echo "Installing v${version} ..."`,
    'command -v unzip >/dev/null 2>&1 || { echo "ERROR: unzip not installed"; exit 1; }',
    'TMP="$(mktemp -d)"',
    `unzip -oq ${q(zip)} -d "$TMP"`,
    '[ -f "$TMP/inflighttv/manifest.json" ] || { echo "ERROR: archive has no inflighttv/manifest.json"; rm -rf "$TMP"; exit 1; }',
    'rm -rf /usr/share/cockpit/inflighttv',
    'mkdir -p /usr/share/cockpit/inflighttv',
    'cp -r "$TMP/inflighttv/." /usr/share/cockpit/inflighttv/',
    'install -d /etc/cockpit/inflighttv',
    `printf '%s\\n' ${q(version)} > /etc/cockpit/inflighttv/installed-version`,
    'rm -rf "$TMP"',
    'echo "Installed. Restarting Cockpit (you will be disconnected briefly)..."',
    'if command -v systemd-run >/dev/null 2>&1; then',
    "  systemd-run --no-block --collect /bin/sh -c 'sleep 2; systemctl restart cockpit || systemctl restart cockpit.socket' >/dev/null 2>&1 || \\",
    "  setsid /bin/sh -c 'sleep 2; systemctl restart cockpit || systemctl restart cockpit.socket' </dev/null >/dev/null 2>&1 &",
    'else',
    "  setsid /bin/sh -c 'sleep 2; systemctl restart cockpit || systemctl restart cockpit.socket' </dev/null >/dev/null 2>&1 &",
    'fi',
    'echo "Done. When Cockpit returns, reload this page (Ctrl+Shift+R)."',
  ].join('\n')
}

export const cockpitUpdate: UpdateAdapter = {
  async fetchLatestRelease(repo) {
    if (await ghAvailable()) {
      try {
        return toRelease(await cockpit.spawn(['gh', 'api', `repos/${repo}/releases/latest`], { err: 'message' }))
      } catch {
        /* fall through to anonymous curl */
      }
    }
    try {
      return toRelease(await cockpit.spawn(['sh', '-c', `curl -fsSL '${API}${repo}/releases/latest'`], { err: 'message' }))
    } catch {
      return null
    }
  },

  async downloadReleaseZip(repo, tag) {
    const tmp = (await cockpit.spawn(['mktemp', '-d'], { err: 'message' })).trim()
    if (await ghAvailable()) {
      await cockpit.spawn(
        ['env', 'GH_PROMPT_DISABLED=1', 'gh', 'release', 'download', tag, '-R', repo,
          '--pattern', 'inflighttv-*.zip', '--dir', tmp, '--clobber'],
        { err: 'message' },
      )
    } else {
      const meta = await cockpit.spawn(['sh', '-c', `curl -fsSL '${API}${repo}/releases/tags/${tag}'`], { err: 'message' })
      const asset = pickAsset(JSON.parse(meta).assets || [])
      if (!asset) throw new Error(`release ${tag} has no inflighttv-*.zip asset`)
      await cockpit.spawn(['sh', '-c', `curl -fsSL -o '${tmp}/${asset.name}' '${asset.browser_download_url}'`], { err: 'message' })
    }
    const found = (await cockpit.spawn(['sh', '-c', `ls -1 '${tmp}'/inflighttv-*.zip 2>/dev/null | head -1`], { err: 'message' })).trim()
    if (!found) throw new Error('no inflighttv-*.zip was downloaded')
    return found
  },

  runInstall(zipPath, version, onLine) {
    return new Promise<number>((resolve) => {
      const channel = cockpit.channel({
        payload: 'stream',
        spawn: ['sh', '-c', installScript(zipPath, version)],
        superuser: 'require',
        err: 'out',
      })
      let buf = ''
      channel.addEventListener('message', (_ev: unknown, data: string | Uint8Array) => {
        buf += typeof data === 'string' ? data : new TextDecoder().decode(data)
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const l of lines) onLine(l)
      })
      channel.addEventListener('close', (_ev: unknown, props: { problem?: string; message?: string; 'exit-status'?: number }) => {
        if (buf) onLine(buf)
        if (props.problem) onLine(`error: ${props.message || props.problem}`)
        resolve(props.problem ? 1 : (props['exit-status'] ?? 0))
      })
    })
  },
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck`. Expected: clean. (Cockpit `channel`/`spawn` types come from `src/cockpit.ts`; if `channel` event signatures differ, cast the listener args to the shapes above.)

- [ ] **Step 3: Commit**

```bash
git add src/adapters/cockpitUpdate.ts
git commit -m "feat(update): cockpit adapter — gh/curl release check, download, superuser streaming copy-install + detached restart"
```

---

### Task 4: Updater store (`stores/updater.ts`)

**Files:**
- Create: `src/stores/updater.ts`
- Test: `src/stores/updater.test.ts`

**Interfaces:**
- Consumes: `APP_VERSION`, `@/core/update/release` (`normalizeRepo`, `isNewer`), `UpdateAdapter`/`LatestRelease` from `@/adapters/cockpitUpdate`, `useSettingsStore` (`updateRepo` — added in Task 5; the store reads `settings.updateRepo` defensively with a fallback so this task compiles before Task 5).
- Produces: `useUpdaterStore` with state `{ checking, installing, current, latest, available, error, log }`, getter `repo`, actions `$configure(adapter)`, `check(manual)`, `update()`, `startupCheck()`.

- [ ] **Step 1: Write the failing tests** — `src/stores/updater.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUpdaterStore } from './updater'
import type { UpdateAdapter, LatestRelease } from '@/adapters/cockpitUpdate'

vi.mock('@/core/version', () => ({ APP_VERSION: '1.0.0' }))

function fakeAdapter(over: Partial<UpdateAdapter> = {}): UpdateAdapter {
  return {
    fetchLatestRelease: async () => null,
    downloadReleaseZip: async () => '/tmp/x/inflighttv-1.1.0.zip',
    runInstall: async (_z, _v, onLine) => { onLine('Installing'); onLine('Done.'); return 0 },
    ...over,
  }
}
const rel = (version: string): LatestRelease => ({ tag: `v${version}`, version, assets: [] })

describe('updater store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('check(): no newer release → not available', async () => {
    const u = useUpdaterStore(); u.$configure(fakeAdapter({ fetchLatestRelease: async () => rel('1.0.0') }))
    await u.check(true)
    expect(u.available).toBe(false)
    expect(u.latest?.version).toBe('1.0.0')
  })

  it('check(): newer release → available + latest set', async () => {
    const u = useUpdaterStore(); u.$configure(fakeAdapter({ fetchLatestRelease: async () => rel('1.1.0') }))
    await u.check(true)
    expect(u.available).toBe(true)
    expect(u.latest?.version).toBe('1.1.0')
  })

  it('check(): no releases → error surfaced only when manual', async () => {
    const u = useUpdaterStore(); u.$configure(fakeAdapter({ fetchLatestRelease: async () => null }))
    await u.check(false); expect(u.error).toBe('')
    await u.check(true); expect(u.error).toMatch(/no releases/i)
  })

  it('update(): streams the install log and marks installing', async () => {
    const u = useUpdaterStore(); u.$configure(fakeAdapter({ fetchLatestRelease: async () => rel('1.1.0') }))
    await u.check(true)
    await u.update()
    expect(u.log.join('\n')).toContain('Done.')
  })

  it('check() is guarded against concurrent runs', async () => {
    let calls = 0
    const u = useUpdaterStore()
    u.$configure(fakeAdapter({ fetchLatestRelease: async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return rel('1.0.0') } }))
    await Promise.all([u.check(false), u.check(false)])
    expect(calls).toBe(1)
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/stores/updater.test.ts` (store missing).

- [ ] **Step 3: Implement** — `src/stores/updater.ts`:

```ts
import { defineStore } from 'pinia'
import { APP_VERSION } from '@/core/version'
import { normalizeRepo, isNewer, DEFAULT_REPO } from '@/core/update/release'
import { cockpitUpdate, type UpdateAdapter, type LatestRelease } from '@/adapters/cockpitUpdate'
import { useSettingsStore } from '@/stores/settings'

export const useUpdaterStore = defineStore('updater', {
  state: () => ({
    checking: false,
    installing: false,
    current: APP_VERSION,
    latest: null as LatestRelease | null,
    available: false,
    error: '',
    log: [] as string[],
    _adapter: cockpitUpdate as UpdateAdapter,
  }),
  getters: {
    repo(): string {
      const raw = (useSettingsStore() as { updateRepo?: string }).updateRepo ?? DEFAULT_REPO
      return normalizeRepo(raw)
    },
  },
  actions: {
    $configure(adapter: UpdateAdapter) {
      this._adapter = adapter
    },
    async check(manual: boolean) {
      if (this.checking || this.installing) return
      this.checking = true
      this.error = ''
      try {
        const rel = await this._adapter.fetchLatestRelease(this.repo)
        this.latest = rel
        this.available = !!rel && !!this.current && isNewer(rel.version, this.current)
        if (manual && !rel) this.error = `No releases found at ${this.repo}.`
      } catch (e) {
        if (manual) this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.checking = false
      }
    },
    async update() {
      if (this.installing || !this.latest) return
      this.installing = true
      this.error = ''
      this.log = []
      try {
        const zip = await this._adapter.downloadReleaseZip(this.repo, this.latest.tag)
        await this._adapter.runInstall(zip, this.latest.version, (line) => this.log.push(line))
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.error = msg
        this.log.push(`error: ${msg}`)
      } finally {
        this.installing = false
      }
    },
    startupCheck() {
      void this.check(false)
    },
  },
})
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/stores/updater.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/stores/updater.ts src/stores/updater.test.ts
git commit -m "feat(update): updater Pinia store — check(manual)/update()/startupCheck with injected adapter"
```

---

### Task 5: Settings `updateRepo` + "Plugin update" section

**Files:**
- Modify: `src/stores/settings.ts` (add `updateRepo` to state + `PersistedSettings` + save/load)
- Modify: `src/views/settings/SettingsView.vue` (add the section)
- Test: `src/stores/settings.test.ts` (add a persistence assertion; if the file doesn't exist, add the case to the nearest existing settings test — search `grep -rl "useSettingsStore" src/stores/*.test.ts`)

**Interfaces:**
- Consumes: `useUpdaterStore` (Task 4), `DEFAULT_REPO` (`@/core/update/release`).
- Produces: `settings.updateRepo: string` (persisted, default `ismetozalp/iftv`).

- [ ] **Step 1: Write the failing test** — add to the settings store test (create `src/stores/settings.test.ts` if none, using the existing test's host/deps pattern — open an existing `*.test.ts` that calls `useSettingsStore().$configure(...)` and mirror its setup):

```ts
it('persists and loads updateRepo (default ismetozalp/iftv)', async () => {
  const store = useSettingsStore()
  // ...$configure with the in-memory JsonStore used by the other settings tests...
  await store.load()
  expect(store.updateRepo).toBe('ismetozalp/iftv')
  store.updateRepo = 'me/fork'
  await store.save()
  // reload a fresh store from the same backing store → updateRepo persisted
})
```

(Match the exact `$configure`/`load`/`save` signatures used by the sibling tests — do not invent new ones.)

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/stores/settings.test.ts`.

- [ ] **Step 3: Implement in the store** — in `src/stores/settings.ts`:
  1. Add to `PersistedSettings`: `updateRepo: string`.
  2. Add a constant near the other defaults: `const DEFAULT_UPDATE_REPO = 'ismetozalp/iftv'`.
  3. Add to `state()`: `updateRepo: DEFAULT_UPDATE_REPO as string,`.
  4. In the `save` path where the persisted object is built, include `updateRepo: this.updateRepo`.
  5. In the `load` path where fields are read back, include `this.updateRepo = loaded.updateRepo || DEFAULT_UPDATE_REPO` (mirror how `epgUrl`/`cacheDir` are read with a fallback).

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/stores/settings.test.ts`.

- [ ] **Step 5: Add the "Plugin update" section** — in `src/views/settings/SettingsView.vue`:
  - In `<script setup>`: `import { useUpdaterStore } from '@/stores/updater'` and `const updater = useUpdaterStore()`.
  - Add near the end of the settings form (after the backup section), following the file's existing markup style (labels `form-label`, inputs `form-control`, ids `#iftv-...`):

```html
<hr />
<h6>Plugin update</h6>
<div class="mb-2">
  <label for="iftv-update-repo" class="form-label">GitHub repo (owner/repo)</label>
  <input id="iftv-update-repo" v-model="settings.updateRepo" class="form-control" placeholder="ismetozalp/iftv" @change="settings.save()" />
  <div class="form-text">Installed version: <strong>v{{ updater.current || '?' }}</strong></div>
</div>
<div class="d-flex align-items-center gap-2 mb-2">
  <button id="iftv-update-check" class="btn btn-sm btn-secondary" :disabled="updater.checking || updater.installing" @click="updater.check(true)">
    {{ updater.checking ? 'Checking…' : 'Check for updates' }}
  </button>
  <button v-if="updater.available" class="btn btn-sm btn-primary" :disabled="updater.installing" @click="updater.update()">
    {{ updater.installing ? 'Updating…' : `Update to v${updater.latest?.version} & restart Cockpit` }}
  </button>
</div>
<p v-if="updater.available" class="text-success small mb-1">Update available: v{{ updater.latest?.version }}.</p>
<p v-else-if="updater.latest && !updater.checking" class="text-muted small mb-1">You are up to date (v{{ updater.current }}).</p>
<p v-if="updater.error" class="text-danger small mb-1">{{ updater.error }}</p>
<pre v-if="updater.log.length" class="iftv-update-log small">{{ updater.log.join('\n') }}</pre>
```

  - Add minimal style (in the component's `<style>` or `src/styles/app.css`): `.iftv-update-log { max-height: 180px; overflow: auto; background: var(--bs-tertiary-bg); padding: 0.5rem; border-radius: 0.3rem; white-space: pre-wrap; }`

- [ ] **Step 6: Typecheck + build** — `npm run typecheck && npm run build`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/stores/settings.ts src/views/settings/SettingsView.vue src/stores/settings.test.ts src/styles/app.css
git commit -m "feat(update): settings updateRepo (default ismetozalp/iftv) + 'Plugin update' section (check/update/log)"
```

---

### Task 6: Header version badge + click-to-check/confirm-to-update

**Files:**
- Modify: `src/App.vue` (badge in the header; startup check; open-settings + confirm wiring)
- Modify: `src/styles/app.css` (badge + dot styles)

**Interfaces:**
- Consumes: `useUpdaterStore`, `APP_VERSION`.
- Produces: a header badge `IF TV v<version>` that (a) shows an "update available" dot after the silent startup check, and (b) on click runs `updater.check(true)` then, if `available`, asks to confirm and on yes runs `updater.update()` with the Settings update section open.

- [ ] **Step 1: Wire the store + startup check + badge handler** — in `src/App.vue` `<script setup>`:

```ts
import { useUpdaterStore } from '@/stores/updater'
const updater = useUpdaterStore()
const updateConfirm = ref(false) // inline confirm shown under the badge

onMounted(() => {
  // ...existing onMounted body...
  setTimeout(() => updater.startupCheck(), 4000) // silent; badge dot reflects updater.available
})

async function onBadgeClick() {
  updateConfirm.value = false
  await updater.check(true)
  if (updater.available) updateConfirm.value = true // ask before updating
}
async function confirmUpdate() {
  updateConfirm.value = false
  settingsOpen.value = true         // reveal the streamed install log in Settings
  await updater.update()
}
```

- [ ] **Step 2: Add the badge markup** — in the `<header>`, before the `⚙ Settings` button (so it sits top-right):

```html
<div class="iftv-verbadge ms-auto position-relative">
  <button class="btn btn-sm btn-link iftv-badge-btn" :title="updater.available ? 'Update available — click to review' : 'Check for updates'" @click="onBadgeClick">
    IF TV v{{ updater.current || '?' }}
    <span v-if="updater.available" class="iftv-badge-dot" aria-label="update available"></span>
    <span v-if="updater.checking" class="small text-muted"> · checking…</span>
  </button>
  <div v-if="updateConfirm && updater.available" class="iftv-badge-pop card p-2">
    <div class="small mb-2">Update available: <strong>v{{ updater.latest?.version }}</strong>. Update now and restart Cockpit?</div>
    <div class="d-flex gap-2 justify-content-end">
      <button class="btn btn-sm btn-light" @click="updateConfirm = false">Later</button>
      <button class="btn btn-sm btn-primary" @click="confirmUpdate">Update &amp; restart</button>
    </div>
  </div>
  <div v-else-if="!updater.available && updater.latest && !updater.checking && updateJustChecked" class="iftv-badge-pop card p-2 small text-muted">Up to date (v{{ updater.current }}).</div>
</div>
```

  Change `ms-auto` on the existing `⚙ Settings` button to just a small left margin (e.g. `ms-2`) since the badge now carries `ms-auto`. Track `updateJustChecked` with a `ref(false)` set true at the end of `onBadgeClick` and false at its start, so the "up to date" note only shows right after a manual click (auto-dismiss it on the next interaction — acceptable to leave until the next click).

- [ ] **Step 3: Add styles** — in `src/styles/app.css`:

```css
.iftv-badge-btn { text-decoration: none; font-weight: 600; }
.iftv-badge-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--bs-warning); margin-left: 0.3rem; vertical-align: middle; }
.iftv-badge-pop { position: absolute; right: 0; top: 100%; z-index: 1080; min-width: 240px; box-shadow: 0 0.3rem 1rem rgba(0,0,0,0.3); }
```

- [ ] **Step 4: Typecheck + build** — `npm run typecheck && npm run build`. Expected: clean.

- [ ] **Step 5: Run the full unit suite** — `npm run test`. Expected: all pass (Task 2 + Task 4 added tests; nothing regressed).

- [ ] **Step 6: Commit**

```bash
git add src/App.vue src/styles/app.css
git commit -m "feat(update): header 'IF TV v<x>' badge — click checks; confirm-to-update; startup dot when an update is available"
```

---

### Task 7: E2E smoke + final verification + merge

**Files:**
- Modify: `dev/smoke.mjs` (add an "update" section) — gitignored dev harness.

**Interfaces:** none (verification only).

- [ ] **Step 1: Add a smoke section** — append to `dev/smoke.mjs` (before the final tally), using the file's `section`/`ok`/`f()` helpers:

```js
await section('Plugin update (badge + settings)', async()=>{
  // badge shows the baked version
  const badge = await f().locator('.iftv-badge-btn').first().innerText().catch(()=>'')
  ok('header shows version badge', /IF TV v\d/.test(badge), badge.replace(/\n/g,' ').slice(0,30))
  // Settings → Plugin update section
  await f().click('button[title="Settings"]',{timeout:8000}).catch(()=>{})
  await f().waitForSelector('#iftv-update-repo',{timeout:8000})
  ok('update repo defaults to ismetozalp/iftv', (await f().inputValue('#iftv-update-repo'))==='ismetozalp/iftv')
  await f().click('#iftv-update-check',{timeout:6000})
  // no release cut yet → reports "no releases found" (not "up to date", not a crash)
  await f().waitForFunction(()=>{const t=document.body.innerText;return /no releases found/i.test(t)||/up to date/i.test(t)},{timeout:20000}).catch(()=>{})
  ok('check runs and reports a result (no crash)', /no releases found|up to date/i.test(await f().evaluate(()=>document.body.innerText)))
})
```

- [ ] **Step 2: Full gates** — run and confirm all pass:

```bash
npm run test        # expect: all pass (≥ 341 + new tests)
npm run typecheck   # expect: clean
npm run build       # expect: built; grep -c '1.0.0' dist/index.js ≥ 1
```

- [ ] **Step 3: Run the E2E smoke** — clear browsers with the SAFE kill first (never `pkill -f`):

```bash
pkill -9 -x headless_shell 2>/dev/null; sleep 2
rm -f /home/ismet/smoke.log
timeout -s KILL 320 node dev/smoke.mjs 2>>/home/ismet/smoke.log; cat /home/ismet/smoke.log
```

Expected: the "Plugin update" section passes — badge shows `IF TV v1.0.0`, repo defaults to `ismetozalp/iftv`, Check reports "no releases found" (no crash). The rest of the smoke stays green.

- [ ] **Step 4: Dispatch the whole-branch review** — build a review package for the feature branch and dispatch a fresh reviewer (per subagent-driven-development), focusing on: the privileged install script (shell-injection safety of the interpolated `zip`/`version`, the copy-not-make install, the detached restart), `superuser: 'require'` usage, no settings/accounts deletion, and the version/repo logic. Fix any Critical/Important findings.

- [ ] **Step 5: Merge to main**

```bash
git checkout main && git merge --no-ff --no-edit feat/self-update
npm run test && npm run typecheck && npm run build
git branch -d feat/self-update
```

- [ ] **Step 6: Commit any review fixes before the merge** (if the reviewer found issues, fix on the branch, re-run gates, then merge).

---

## Notes for the executor
- Create a feature branch first: `git checkout -b feat/self-update`.
- iftv has **no release cut yet**, so a real download+install+restart can't be auto-tested; the E2E verifies the check path ("no releases found") and the UI. The install path is validated by code review + a manual test after the first `make publish`.
- Do not run `make publish` or restart Cockpit as part of this plan.
