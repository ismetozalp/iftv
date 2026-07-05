# In-flight TV — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installable Cockpit plugin (Vue 3 + Vite + TypeScript + Bootstrap) that loads under Tools → InFlight TV, lets the user add/switch multiple Xtream accounts, authenticates them via `cockpit.http`, and persists accounts to `~/.config/inflighttv/accounts.json`.

**Architecture:** A Cockpit static package built by Vite. Framework-agnostic core logic (`src/core/**`) is pure TypeScript with all host access injected via small interfaces, so it is unit-testable under Vitest without a browser or Cockpit. Vue views/stores sit on top. Host access (HTTP, file, user) is reached through `window.cockpit`, wrapped in typed adapters that implement the core interfaces.

**Tech Stack:** Vue 3 (runtime-only), Vite, TypeScript, Bootstrap 5, Pinia, vue-router, Vitest (unit), Playwright (smoke), ffmpeg (later plans).

## Global Constraints

- Cockpit package name: `inflighttv`. Install dir: `/usr/share/cockpit/inflighttv`. Dev dir: `~/.local/share/cockpit/inflighttv`.
- `manifest.json`: `"requires": { "cockpit": "215" }`, entry `tools.index → index.html`, label `InFlight TV`.
- CSP (manifest): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; worker-src 'self' blob:; object-src 'self'`.
- Vite: `base: './'`, `modulePreload.polyfill: false`, `external: ['cockpit']`, Vue runtime-only, `build.cssCodeSplit: false`.
- `cockpit` is never bundled: loaded via `<script src="../base1/cockpit.js">`; `import cockpit from 'cockpit'` is aliased to `window.cockpit`.
- Core modules under `src/core/**` must NOT import Vue, Pinia, or `window.cockpit` directly — all host access is injected via interfaces. This keeps them unit-testable.
- No monolithic files: one clear responsibility per file (per project preference).
- Persisted state dir: `~/.config/inflighttv/`. Accounts file: `accounts.json`.
- License: Apache-2.0 chosen on GitHub at first release; do NOT commit a `LICENSE` file.
- Commit after every task. Do not push to any remote in this plan.

---

### Task 1: Project scaffold — buildable, loadable Cockpit package

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `manifest.json`, `cockpit.d.ts`, `VERSION`, `src/main.ts`, `src/App.vue`, `src/cockpit.ts`, `src/styles/app.css`
- Test: `src/core/__smoke__/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `src/cockpit.ts` default export `cockpit` (typed `window.cockpit`).
  - `VERSION` file containing `0.1.0`.
  - `npm run build` → `dist/` containing `index.html`, `index.js`, `index.css`, `manifest.json`, plus `.gz` siblings.
  - `npm run test` runs Vitest.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "inflighttv",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev:watch": "vite build --watch",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:smoke": "node tests/smoke.mjs",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "bootstrap": "^5.3.3",
    "pinia": "^2.2.0",
    "vue": "^3.5.0",
    "vue-router": "^4.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vite-plugin-compression": "^0.5.1",
    "vite-plugin-static-copy": "^1.0.6",
    "vitest": "^2.1.0",
    "vue-tsc": "^2.1.0",
    "playwright": "^1.49.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` and `tsconfig.node.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"], "cockpit": ["src/cockpit.ts"] },
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src", "cockpit.d.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"]
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import compression from 'vite-plugin-compression'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      cockpit: fileURLToPath(new URL('./src/cockpit.ts', import.meta.url)),
    },
  },
  plugins: [
    vue(),
    viteStaticCopy({ targets: [{ src: 'manifest.json', dest: '.' }] }),
    compression({ deleteOriginFile: false, algorithm: 'gzip', ext: '.gz' }),
  ],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      external: ['cockpit'],
      output: {
        entryFileNames: 'index.js',
        assetFileNames: 'index[extname]',
        globals: { cockpit: 'cockpit' },
      },
    },
  },
})
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      cockpit: fileURLToPath(new URL('./src/cockpit.ts', import.meta.url)),
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
```

- [ ] **Step 5: Create `manifest.json`, `index.html`, `cockpit.d.ts`, `VERSION`**

`manifest.json`:
```json
{
  "version": 0,
  "name": "inflighttv",
  "requires": { "cockpit": "215" },
  "tools": { "index": { "label": "InFlight TV", "path": "index.html", "order": 50 } },
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; worker-src 'self' blob:; object-src 'self'"
}
```

`index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>InFlight TV</title>
  <script src="../base1/cockpit.js"></script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`cockpit.d.ts`:
```ts
declare module 'cockpit' {
  interface CockpitHttpOptions {
    address?: string
    port?: number
    tls?: Record<string, unknown>
    superuser?: 'require' | 'try'
  }
  interface CockpitHttpRequest extends Promise<string> {
    stream(cb: (data: string) => void): CockpitHttpRequest
    response(cb: (status: number, headers: Record<string, string>) => void): CockpitHttpRequest
  }
  interface CockpitHttpClient {
    get(path: string, params?: Record<string, string>, headers?: Record<string, string>): CockpitHttpRequest
    post(path: string, body?: unknown, headers?: Record<string, string>): CockpitHttpRequest
  }
  interface CockpitFileHandle<T> {
    read(): Promise<T | null>
    replace(content: T | null, expectedTag?: string): Promise<string>
    modify(cb: (current: T | null) => T | null): Promise<string>
    watch(cb: (content: T | null, tag: string) => void): { remove(): void }
    close(): void
  }
  interface CockpitUser {
    id: number; gid: number; name: string; full_name: string
    home: string; shell: string; groups: string[]
  }
  interface CockpitSpawnOptions { superuser?: 'require' | 'try'; err?: 'message' | 'out' }
  interface Cockpit {
    http(endpoint: string | number | CockpitHttpOptions): CockpitHttpClient
    file<T = string>(path: string, options?: { syntax?: { parse(s: string): T; stringify(o: T): string }; binary?: boolean; superuser?: 'require' | 'try' }): CockpitFileHandle<T>
    spawn(argv: string[], options?: CockpitSpawnOptions): Promise<string> & { stream(cb: (data: string) => void): unknown }
    user(): Promise<CockpitUser>
    location: { go(path: string): void; path: string[] }
  }
  const cockpit: Cockpit
  export default cockpit
}

interface Window { cockpit: import('cockpit').default }
```

`VERSION`:
```
0.1.0
```

- [ ] **Step 6: Create `src/cockpit.ts`, `src/styles/app.css`, `src/App.vue`, `src/main.ts`**

`src/cockpit.ts`:
```ts
// The real cockpit object is provided by <script src="../base1/cockpit.js"> at runtime.
// This module re-exports it so app code can `import cockpit from 'cockpit'`.
// In unit tests this file is aliased and never touched — core code takes host access via injected interfaces.
import type Cockpit from 'cockpit'
const cockpit = (globalThis as unknown as { cockpit: Cockpit }).cockpit
export default cockpit
```

`src/styles/app.css`:
```css
@import 'bootstrap/dist/css/bootstrap.min.css';

:root { color-scheme: light dark; }
body { margin: 0; }
.iftv-shell { min-height: 100vh; display: flex; flex-direction: column; }
.iftv-header { padding: 0.5rem 1rem; border-bottom: 1px solid var(--bs-border-color); }
.iftv-main { flex: 1; padding: 1rem; }
```

`src/App.vue`:
```vue
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
```

`src/main.ts`:
```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './styles/app.css'

createApp(App).use(createPinia()).use(router).mount('#app')
```

- [ ] **Step 7: Create minimal `src/router.ts` and a Home view so the app mounts**

`src/router.ts`:
```ts
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./views/home/HomeView.vue') },
  { path: '/accounts', name: 'accounts', component: () => import('./views/accounts/AccountsView.vue') },
]

export const router = createRouter({ history: createWebHashHistory(), routes })
```

`src/views/home/HomeView.vue`:
```vue
<template>
  <div>
    <h4>Welcome to InFlight TV</h4>
    <p class="text-muted">Add an Xtream account to get started.</p>
  </div>
</template>
```

`src/views/accounts/AccountsView.vue` (placeholder, replaced in Task 7):
```vue
<template><div><h4>Accounts</h4></div></template>
```

- [ ] **Step 8: Write the scaffold smoke unit test**

`src/core/__smoke__/scaffold.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('scaffold', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 9: Install deps and run the test to verify tooling**

Run: `npm install && npm run test`
Expected: Vitest runs, `scaffold` suite PASSES (1 test).

- [ ] **Step 10: Build and verify output**

Run: `npm run build && ls dist`
Expected: `dist/` contains `index.html`, `index.js`, `index.css`, `manifest.json`, and matching `.gz` files. No errors.

- [ ] **Step 11: Load in Cockpit (manual verification)**

Run:
```bash
mkdir -p ~/.local/share/cockpit
ln -sfn "$PWD/dist" ~/.local/share/cockpit/inflighttv
cockpit-bridge --packages | grep inflighttv
```
Expected: `inflighttv` listed. Open `https://localhost:9090` → Tools → **InFlight TV** shows the shell with "Welcome to InFlight TV". No console CSP errors.

- [ ] **Step 12: Commit**

```bash
git add package.json tsconfig.json tsconfig.node.json vite.config.ts vitest.config.ts \
  index.html manifest.json cockpit.d.ts VERSION src package-lock.json
git commit -m "feat: scaffold Vue+Vite+TS Cockpit package that builds and loads"
```

---

### Task 2: Xtream value normalization helpers

**Files:**
- Create: `src/core/xtream/normalize.ts`
- Test: `src/core/xtream/normalize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `toStr(v: unknown): string` — `""` for null/undefined, else `String(v)`.
  - `toNum(v: unknown): number | null` — parses numeric strings/numbers; `null` if not finite.
  - `toBool01(v: unknown): boolean` — true iff value is `1`, `"1"`, `true`, or `"true"`.
  - `decodeB64(v: unknown): string` — base64-decode a string (EPG titles); returns `""` on empty; returns the raw string if it is not valid base64.
  - `parseXtreamUrl(url: string): { scheme: 'http' | 'https'; host: string; port: number }` — parses a user-entered base URL; default port 80 for http, 443 for https when absent.

- [ ] **Step 1: Write the failing test**

`src/core/xtream/normalize.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toStr, toNum, toBool01, decodeB64, parseXtreamUrl } from './normalize'

describe('toStr', () => {
  it('maps nullish to empty string', () => {
    expect(toStr(null)).toBe('')
    expect(toStr(undefined)).toBe('')
    expect(toStr(5)).toBe('5')
    expect(toStr('x')).toBe('x')
  })
})

describe('toNum', () => {
  it('parses numeric strings and numbers', () => {
    expect(toNum('42')).toBe(42)
    expect(toNum(42)).toBe(42)
    expect(toNum('3.5')).toBe(3.5)
  })
  it('returns null for non-numeric', () => {
    expect(toNum('abc')).toBeNull()
    expect(toNum(null)).toBeNull()
    expect(toNum('')).toBeNull()
  })
})

describe('toBool01', () => {
  it('treats 1/"1"/true as true, else false', () => {
    expect(toBool01(1)).toBe(true)
    expect(toBool01('1')).toBe(true)
    expect(toBool01(true)).toBe(true)
    expect(toBool01(0)).toBe(false)
    expect(toBool01('0')).toBe(false)
    expect(toBool01(null)).toBe(false)
  })
})

describe('decodeB64', () => {
  it('decodes base64 to utf-8', () => {
    // "Hello" base64 = SGVsbG8=
    expect(decodeB64('SGVsbG8=')).toBe('Hello')
  })
  it('returns empty for empty input', () => {
    expect(decodeB64('')).toBe('')
    expect(decodeB64(null)).toBe('')
  })
})

describe('parseXtreamUrl', () => {
  it('parses scheme/host/port', () => {
    expect(parseXtreamUrl('http://host.example:8080')).toEqual({ scheme: 'http', host: 'host.example', port: 8080 })
  })
  it('defaults ports by scheme', () => {
    expect(parseXtreamUrl('http://host')).toEqual({ scheme: 'http', host: 'host', port: 80 })
    expect(parseXtreamUrl('https://host')).toEqual({ scheme: 'https', host: 'host', port: 443 })
  })
  it('tolerates trailing slash and path', () => {
    expect(parseXtreamUrl('http://host:8000/')).toEqual({ scheme: 'http', host: 'host', port: 8000 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- normalize`
Expected: FAIL — `Cannot find module './normalize'`.

- [ ] **Step 3: Write minimal implementation**

`src/core/xtream/normalize.ts`:
```ts
export function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function toBool01(v: unknown): boolean {
  return v === 1 || v === '1' || v === true || v === 'true'
}

export function decodeB64(v: unknown): string {
  const s = toStr(v)
  if (!s) return ''
  try {
    const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return s
  }
}

export function parseXtreamUrl(url: string): { scheme: 'http' | 'https'; host: string; port: number } {
  const u = new URL(url)
  const scheme = u.protocol === 'https:' ? 'https' : 'http'
  const port = u.port ? Number(u.port) : scheme === 'https' ? 443 : 80
  return { scheme, host: u.hostname, port }
}
```

Note: `atob`/`TextDecoder` exist in the browser and in Node ≥ 18 (Vitest), so tests run without polyfills.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- normalize`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/xtream/normalize.ts src/core/xtream/normalize.test.ts
git commit -m "feat: add Xtream value normalization helpers"
```

---

### Task 3: Xtream transport interface + Cockpit adapter

**Files:**
- Create: `src/core/xtream/transport.ts`, `src/adapters/cockpitHttp.ts`
- Test: `src/core/xtream/transport.test.ts`

**Interfaces:**
- Consumes: `parseXtreamUrl` from `normalize.ts`.
- Produces:
  - `interface XtreamTransport { getJson(base: { scheme: 'http' | 'https'; host: string; port: number }, path: string, params: Record<string, string>): Promise<unknown> }`
  - `buildPlayerApiParams(username, password, extra?): Record<string, string>` — merges `{ username, password }` with `extra`.
  - `src/adapters/cockpitHttp.ts` exports `createCockpitTransport(): XtreamTransport` (wraps `cockpit.http`). Not unit-tested (needs Cockpit); exercised manually in Task 6/7.

- [ ] **Step 1: Write the failing test (transport is an interface; test the param builder + a fake transport contract)**

`src/core/xtream/transport.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildPlayerApiParams, type XtreamTransport } from './transport'

describe('buildPlayerApiParams', () => {
  it('includes credentials', () => {
    expect(buildPlayerApiParams('u', 'p')).toEqual({ username: 'u', password: 'p' })
  })
  it('merges extra params', () => {
    expect(buildPlayerApiParams('u', 'p', { action: 'get_live_streams' })).toEqual({
      username: 'u', password: 'p', action: 'get_live_streams',
    })
  })
})

describe('XtreamTransport contract', () => {
  it('a fake transport can satisfy the interface', async () => {
    const fake: XtreamTransport = {
      async getJson(base, path, params) {
        return { base, path, params }
      },
    }
    const out = await fake.getJson({ scheme: 'http', host: 'h', port: 80 }, '/player_api.php', { username: 'u' })
    expect(out).toEqual({ base: { scheme: 'http', host: 'h', port: 80 }, path: '/player_api.php', params: { username: 'u' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- transport`
Expected: FAIL — `Cannot find module './transport'`.

- [ ] **Step 3: Write minimal implementation**

`src/core/xtream/transport.ts`:
```ts
export interface XtreamBase {
  scheme: 'http' | 'https'
  host: string
  port: number
}

export interface XtreamTransport {
  getJson(base: XtreamBase, path: string, params: Record<string, string>): Promise<unknown>
}

export function buildPlayerApiParams(
  username: string,
  password: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { username, password, ...extra }
}
```

`src/adapters/cockpitHttp.ts`:
```ts
import cockpit from 'cockpit'
import type { XtreamBase, XtreamTransport } from '@/core/xtream/transport'

export function createCockpitTransport(): XtreamTransport {
  return {
    async getJson(base: XtreamBase, path: string, params: Record<string, string>): Promise<unknown> {
      const options =
        base.scheme === 'https'
          ? { address: base.host, port: base.port, tls: {} }
          : { address: base.host, port: base.port }
      const text = await cockpit.http(options).get(path, params)
      try {
        return JSON.parse(text)
      } catch {
        return null
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- transport`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/xtream/transport.ts src/core/xtream/transport.test.ts src/adapters/cockpitHttp.ts
git commit -m "feat: add Xtream transport interface and Cockpit HTTP adapter"
```

---

### Task 4: Xtream login (auth) against the transport

**Files:**
- Create: `src/core/xtream/auth.ts`
- Test: `src/core/xtream/auth.test.ts`

**Interfaces:**
- Consumes: `XtreamTransport`, `XtreamBase` from `transport.ts`; `parseXtreamUrl`, `toNum`, `toStr` from `normalize.ts`; `buildPlayerApiParams`.
- Produces:
  - `interface XtreamAuth { auth: boolean; status: string; active: boolean; expDate: number | null; maxConnections: number | null; allowedOutputFormats: string[] }`
  - `async function xtreamLogin(transport: XtreamTransport, url: string, username: string, password: string): Promise<XtreamAuth>` — calls `/player_api.php` with credentials; `active` is true iff `auth === 1 && status === "Active"`.

- [ ] **Step 1: Write the failing test**

`src/core/xtream/auth.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { xtreamLogin } from './auth'
import type { XtreamTransport } from './transport'

function transportReturning(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload) }
}

describe('xtreamLogin', () => {
  it('reports active on auth=1 + status Active', async () => {
    const t = transportReturning({
      user_info: { auth: 1, status: 'Active', exp_date: '1735689600', max_connections: '2', allowed_output_formats: ['ts', 'm3u8'] },
      server_info: {},
    })
    const res = await xtreamLogin(t, 'http://host:8080', 'u', 'p')
    expect(res).toEqual({
      auth: true, status: 'Active', active: true,
      expDate: 1735689600, maxConnections: 2, allowedOutputFormats: ['ts', 'm3u8'],
    })
  })

  it('reports inactive on auth=0', async () => {
    const t = transportReturning({ user_info: { auth: 0, status: 'Disabled' } })
    const res = await xtreamLogin(t, 'http://host', 'u', 'bad')
    expect(res.active).toBe(false)
    expect(res.auth).toBe(false)
  })

  it('reports inactive on Expired status even if auth=1', async () => {
    const t = transportReturning({ user_info: { auth: 1, status: 'Expired' } })
    const res = await xtreamLogin(t, 'http://host', 'u', 'p')
    expect(res.active).toBe(false)
  })

  it('treats empty/garbage body as inactive', async () => {
    const t = transportReturning(null)
    const res = await xtreamLogin(t, 'http://host', 'u', 'p')
    expect(res.active).toBe(false)
    expect(res.allowedOutputFormats).toEqual([])
  })

  it('calls the transport with parsed base and credentials', async () => {
    const t = transportReturning({ user_info: { auth: 1, status: 'Active' } })
    await xtreamLogin(t, 'https://host.example:443', 'u', 'p')
    expect(t.getJson).toHaveBeenCalledWith(
      { scheme: 'https', host: 'host.example', port: 443 },
      '/player_api.php',
      { username: 'u', password: 'p' },
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- auth`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Write minimal implementation**

`src/core/xtream/auth.ts`:
```ts
import type { XtreamTransport } from './transport'
import { buildPlayerApiParams } from './transport'
import { parseXtreamUrl, toNum, toStr } from './normalize'

export interface XtreamAuth {
  auth: boolean
  status: string
  active: boolean
  expDate: number | null
  maxConnections: number | null
  allowedOutputFormats: string[]
}

export async function xtreamLogin(
  transport: XtreamTransport,
  url: string,
  username: string,
  password: string,
): Promise<XtreamAuth> {
  const base = parseXtreamUrl(url)
  const body = (await transport.getJson(base, '/player_api.php', buildPlayerApiParams(username, password))) as
    | { user_info?: Record<string, unknown> }
    | null
  const info = (body && body.user_info) || {}
  const auth = info.auth === 1 || info.auth === '1'
  const status = toStr(info.status)
  const formats = Array.isArray(info.allowed_output_formats)
    ? (info.allowed_output_formats as unknown[]).map(toStr)
    : []
  return {
    auth,
    status,
    active: auth && status === 'Active',
    expDate: toNum(info.exp_date),
    maxConnections: toNum(info.max_connections),
    allowedOutputFormats: formats,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- auth`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/xtream/auth.ts src/core/xtream/auth.test.ts
git commit -m "feat: add Xtream login with normalized auth result"
```

---

### Task 5: Persistence — key/value store interface + Cockpit file adapter

**Files:**
- Create: `src/core/storage/appState.ts`, `src/adapters/cockpitFile.ts`
- Test: `src/core/storage/appState.test.ts`

**Interfaces:**
- Consumes: nothing from earlier core tasks.
- Produces:
  - `interface JsonStore { load<T>(name: string, fallback: T): Promise<T>; save<T>(name: string, value: T): Promise<void> }`
  - `createMemoryStore(seed?: Record<string, unknown>): JsonStore` — in-memory implementation (used in tests and by later tasks' tests).
  - `src/adapters/cockpitFile.ts` exports `async function createCockpitStore(): Promise<JsonStore>` — resolves the user's home via `cockpit.user()`, reads/writes `~/.config/inflighttv/<name>` via `cockpit.file(path, { syntax: JSON })`. Not unit-tested (needs Cockpit).

- [ ] **Step 1: Write the failing test**

`src/core/storage/appState.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createMemoryStore } from './appState'

describe('createMemoryStore', () => {
  it('returns fallback when key is absent', async () => {
    const s = createMemoryStore()
    expect(await s.load('accounts', { x: 1 })).toEqual({ x: 1 })
  })

  it('persists and reloads a value', async () => {
    const s = createMemoryStore()
    await s.save('accounts', { list: ['a'] })
    expect(await s.load('accounts', null)).toEqual({ list: ['a'] })
  })

  it('deep-clones on save and load (no shared references)', async () => {
    const s = createMemoryStore()
    const obj = { n: 1 }
    await s.save('k', obj)
    obj.n = 2
    const loaded = await s.load<{ n: number }>('k', { n: 0 })
    expect(loaded.n).toBe(1)
  })

  it('honors seed data', async () => {
    const s = createMemoryStore({ settings: { theme: 'auto' } })
    expect(await s.load('settings', null)).toEqual({ theme: 'auto' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- appState`
Expected: FAIL — `Cannot find module './appState'`.

- [ ] **Step 3: Write minimal implementation**

`src/core/storage/appState.ts`:
```ts
export interface JsonStore {
  load<T>(name: string, fallback: T): Promise<T>
  save<T>(name: string, value: T): Promise<void>
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

export function createMemoryStore(seed: Record<string, unknown> = {}): JsonStore {
  const data: Record<string, unknown> = clone(seed)
  return {
    async load<T>(name: string, fallback: T): Promise<T> {
      return name in data ? clone(data[name] as T) : fallback
    },
    async save<T>(name: string, value: T): Promise<void> {
      data[name] = clone(value)
    },
  }
}
```

`src/adapters/cockpitFile.ts`:
```ts
import cockpit from 'cockpit'
import type { JsonStore } from '@/core/storage/appState'

const JSON_SYNTAX = { parse: (s: string) => JSON.parse(s), stringify: (o: unknown) => JSON.stringify(o, null, 2) }

export async function createCockpitStore(): Promise<JsonStore> {
  const user = await cockpit.user()
  const dir = `${user.home}/.config/inflighttv`
  await cockpit.spawn(['mkdir', '-p', dir])
  const pathOf = (name: string) => `${dir}/${name}`
  return {
    async load<T>(name: string, fallback: T): Promise<T> {
      const handle = cockpit.file<T>(pathOf(name), { syntax: JSON_SYNTAX as never })
      try {
        const content = await handle.read()
        return content ?? fallback
      } finally {
        handle.close()
      }
    },
    async save<T>(name: string, value: T): Promise<void> {
      const handle = cockpit.file<T>(pathOf(name), { syntax: JSON_SYNTAX as never })
      try {
        await handle.replace(value)
      } finally {
        handle.close()
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- appState`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/storage/appState.ts src/core/storage/appState.test.ts src/adapters/cockpitFile.ts
git commit -m "feat: add JsonStore interface, memory store, and Cockpit file adapter"
```

---

### Task 6: Accounts core — CRUD + active selection

**Files:**
- Create: `src/core/accounts/accounts.ts`
- Test: `src/core/accounts/accounts.test.ts`

**Interfaces:**
- Consumes: `JsonStore` from `appState.ts`.
- Produces:
  - `interface Account { id: string; name: string; url: string; username: string; password: string; createdAt: number }`
  - `interface AccountsState { activeId: string | null; accounts: Account[] }`
  - `const EMPTY_ACCOUNTS: AccountsState = { activeId: null, accounts: [] }`
  - `interface NewAccount { name: string; url: string; username: string; password: string }`
  - `function addAccount(state: AccountsState, input: NewAccount, meta: { id: string; createdAt: number }): AccountsState` — appends; if it is the first account, sets it active. Pure.
  - `function removeAccount(state: AccountsState, id: string): AccountsState` — removes; if the removed one was active, active becomes the first remaining account or `null`. Pure.
  - `function setActive(state: AccountsState, id: string): AccountsState` — sets `activeId` only if `id` exists; otherwise unchanged. Pure.
  - `function getActive(state: AccountsState): Account | null`.
  - `async function loadAccounts(store: JsonStore): Promise<AccountsState>` — `store.load('accounts.json', EMPTY_ACCOUNTS)`.
  - `async function saveAccounts(store: JsonStore, state: AccountsState): Promise<void>` — `store.save('accounts.json', state)`.

- [ ] **Step 1: Write the failing test**

`src/core/accounts/accounts.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  EMPTY_ACCOUNTS, addAccount, removeAccount, setActive, getActive,
  loadAccounts, saveAccounts, type AccountsState,
} from './accounts'
import { createMemoryStore } from '@/core/storage/appState'

const NEW = { name: 'P1', url: 'http://h:8080', username: 'u', password: 'p' }

describe('addAccount', () => {
  it('appends and sets first as active', () => {
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 100 })
    expect(s.accounts).toHaveLength(1)
    expect(s.accounts[0]).toEqual({ id: 'a1', createdAt: 100, ...NEW })
    expect(s.activeId).toBe('a1')
  })
  it('keeps existing active when adding a second', () => {
    let s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 100 })
    s = addAccount(s, { ...NEW, name: 'P2' }, { id: 'a2', createdAt: 200 })
    expect(s.accounts).toHaveLength(2)
    expect(s.activeId).toBe('a1')
  })
  it('does not mutate input state', () => {
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 100 })
    expect(EMPTY_ACCOUNTS.accounts).toHaveLength(0)
    expect(s).not.toBe(EMPTY_ACCOUNTS)
  })
})

describe('removeAccount', () => {
  it('removes and repoints active to first remaining', () => {
    let s: AccountsState = { activeId: null, accounts: [] }
    s = addAccount(s, NEW, { id: 'a1', createdAt: 1 })
    s = addAccount(s, NEW, { id: 'a2', createdAt: 2 })
    s = setActive(s, 'a1')
    s = removeAccount(s, 'a1')
    expect(s.accounts.map((a) => a.id)).toEqual(['a2'])
    expect(s.activeId).toBe('a2')
  })
  it('active becomes null when last removed', () => {
    let s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 1 })
    s = removeAccount(s, 'a1')
    expect(s.activeId).toBeNull()
    expect(s.accounts).toHaveLength(0)
  })
})

describe('setActive', () => {
  it('sets when id exists, ignores when not', () => {
    let s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 1 })
    s = addAccount(s, NEW, { id: 'a2', createdAt: 2 })
    expect(setActive(s, 'a2').activeId).toBe('a2')
    expect(setActive(s, 'nope').activeId).toBe('a1')
  })
})

describe('getActive', () => {
  it('returns the active account or null', () => {
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 1 })
    expect(getActive(s)?.id).toBe('a1')
    expect(getActive(EMPTY_ACCOUNTS)).toBeNull()
  })
})

describe('load/save round-trip', () => {
  it('persists via a JsonStore', async () => {
    const store = createMemoryStore()
    const s = addAccount(EMPTY_ACCOUNTS, NEW, { id: 'a1', createdAt: 1 })
    await saveAccounts(store, s)
    expect(await loadAccounts(store)).toEqual(s)
  })
  it('returns EMPTY when nothing saved', async () => {
    expect(await loadAccounts(createMemoryStore())).toEqual(EMPTY_ACCOUNTS)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- accounts`
Expected: FAIL — `Cannot find module './accounts'`.

- [ ] **Step 3: Write minimal implementation**

`src/core/accounts/accounts.ts`:
```ts
import type { JsonStore } from '@/core/storage/appState'

export interface Account {
  id: string
  name: string
  url: string
  username: string
  password: string
  createdAt: number
}

export interface AccountsState {
  activeId: string | null
  accounts: Account[]
}

export interface NewAccount {
  name: string
  url: string
  username: string
  password: string
}

export const EMPTY_ACCOUNTS: AccountsState = { activeId: null, accounts: [] }

export function addAccount(state: AccountsState, input: NewAccount, meta: { id: string; createdAt: number }): AccountsState {
  const account: Account = { id: meta.id, createdAt: meta.createdAt, ...input }
  const accounts = [...state.accounts, account]
  return { accounts, activeId: state.activeId ?? account.id }
}

export function removeAccount(state: AccountsState, id: string): AccountsState {
  const accounts = state.accounts.filter((a) => a.id !== id)
  let activeId = state.activeId
  if (activeId === id) activeId = accounts.length ? accounts[0].id : null
  return { accounts, activeId }
}

export function setActive(state: AccountsState, id: string): AccountsState {
  if (!state.accounts.some((a) => a.id === id)) return state
  return { ...state, activeId: id }
}

export function getActive(state: AccountsState): Account | null {
  return state.accounts.find((a) => a.id === state.activeId) ?? null
}

const ACCOUNTS_KEY = 'accounts.json'

export async function loadAccounts(store: JsonStore): Promise<AccountsState> {
  return store.load(ACCOUNTS_KEY, EMPTY_ACCOUNTS)
}

export async function saveAccounts(store: JsonStore, state: AccountsState): Promise<void> {
  await store.save(ACCOUNTS_KEY, state)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- accounts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/accounts/accounts.ts src/core/accounts/accounts.test.ts
git commit -m "feat: add accounts core CRUD, active selection, and persistence"
```

---

### Task 7: Accounts store + UI (add / switch / verify), wired to Cockpit

**Files:**
- Create: `src/stores/accounts.ts`, `src/composables/useHost.ts`
- Modify: `src/views/accounts/AccountsView.vue` (replace placeholder), `src/views/home/HomeView.vue`
- Test: `src/stores/accounts.test.ts`

**Interfaces:**
- Consumes: accounts core (Task 6), `xtreamLogin` (Task 4), `createMemoryStore`/`JsonStore` (Task 5), `XtreamTransport` (Task 3), Cockpit adapters (Tasks 3, 5).
- Produces:
  - `useHost()` composable returning `{ store: JsonStore; transport: XtreamTransport }`, lazily constructing the Cockpit-backed implementations once. Injectable for tests.
  - Pinia store `useAccountsStore` with state `{ state: AccountsState; loading: boolean }`, getters `active`, and actions `init()`, `add(input, verify)`, `remove(id)`, `select(id)`, `verify(input): Promise<XtreamAuth>`.
  - The store accepts an injected `{ store, transport, ids }` for tests; in the app it defaults to `useHost()` + real id/date generators.

- [ ] **Step 1: Write the failing test for the store (with injected deps)**

`src/stores/accounts.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAccountsStore } from './accounts'
import { createMemoryStore } from '@/core/storage/appState'
import type { XtreamTransport } from '@/core/xtream/transport'

const NEW = { name: 'P1', url: 'http://h:8080', username: 'u', password: 'p' }

function activeTransport(auth: number, status = 'Active'): XtreamTransport {
  return { getJson: vi.fn(async () => ({ user_info: { auth, status } })) }
}

describe('useAccountsStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads empty state on init', async () => {
    const s = useAccountsStore()
    s.$configure({ store: createMemoryStore(), transport: activeTransport(1), ids: seq() })
    await s.init()
    expect(s.state.accounts).toHaveLength(0)
    expect(s.active).toBeNull()
  })

  it('adds an account, persists it, and makes it active', async () => {
    const store = createMemoryStore()
    const s = useAccountsStore()
    s.$configure({ store, transport: activeTransport(1), ids: seq() })
    await s.init()
    await s.add(NEW, false)
    expect(s.state.accounts).toHaveLength(1)
    expect(s.active?.name).toBe('P1')
    // reload a fresh store from the same backing store
    const s2 = useAccountsStore()
    s2.$configure({ store, transport: activeTransport(1), ids: seq() })
    await s2.init()
    expect(s2.state.accounts).toHaveLength(1)
  })

  it('verify returns active=false for auth=0', async () => {
    const s = useAccountsStore()
    s.$configure({ store: createMemoryStore(), transport: activeTransport(0, 'Disabled'), ids: seq() })
    await s.init()
    const res = await s.verify(NEW)
    expect(res.active).toBe(false)
  })

  it('add with verify=true throws when credentials are inactive', async () => {
    const s = useAccountsStore()
    s.$configure({ store: createMemoryStore(), transport: activeTransport(0), ids: seq() })
    await s.init()
    await expect(s.add(NEW, true)).rejects.toThrow(/not active/i)
    expect(s.state.accounts).toHaveLength(0)
  })

  it('select switches active only to existing ids', async () => {
    const s = useAccountsStore()
    s.$configure({ store: createMemoryStore(), transport: activeTransport(1), ids: seq() })
    await s.init()
    await s.add(NEW, false)
    await s.add({ ...NEW, name: 'P2' }, false)
    s.select(s.state.accounts[1].id)
    expect(s.active?.name).toBe('P2')
  })
})

function seq() {
  let n = 0
  return () => ({ id: `id${++n}`, createdAt: n })
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- stores/accounts`
Expected: FAIL — `Cannot find module './accounts'` (the store).

- [ ] **Step 3: Write the composable and the store**

`src/composables/useHost.ts`:
```ts
import type { JsonStore } from '@/core/storage/appState'
import type { XtreamTransport } from '@/core/xtream/transport'
import { createCockpitStore } from '@/adapters/cockpitFile'
import { createCockpitTransport } from '@/adapters/cockpitHttp'

let cached: { store: JsonStore; transport: XtreamTransport } | null = null

export async function useHost(): Promise<{ store: JsonStore; transport: XtreamTransport }> {
  if (!cached) {
    cached = { store: await createCockpitStore(), transport: createCockpitTransport() }
  }
  return cached
}
```

`src/stores/accounts.ts`:
```ts
import { defineStore } from 'pinia'
import type { JsonStore } from '@/core/storage/appState'
import type { XtreamTransport } from '@/core/xtream/transport'
import { xtreamLogin, type XtreamAuth } from '@/core/xtream/auth'
import {
  EMPTY_ACCOUNTS, addAccount, removeAccount, setActive, getActive,
  loadAccounts, saveAccounts, type AccountsState, type NewAccount,
} from '@/core/accounts/accounts'
import { useHost } from '@/composables/useHost'

type IdGen = () => { id: string; createdAt: number }
interface Deps { store: JsonStore; transport: XtreamTransport; ids: IdGen }

const defaultIds: IdGen = () => ({ id: crypto.randomUUID(), createdAt: Date.now() })

export const useAccountsStore = defineStore('accounts', {
  state: () => ({
    state: structuredClone(EMPTY_ACCOUNTS) as AccountsState,
    loading: false,
    _deps: null as Deps | null,
  }),
  getters: {
    active: (s) => getActive(s.state),
  },
  actions: {
    $configure(deps: Deps) {
      this._deps = deps
    },
    async _host(): Promise<Deps> {
      if (this._deps) return this._deps
      const host = await useHost()
      this._deps = { ...host, ids: defaultIds }
      return this._deps
    },
    async init() {
      this.loading = true
      try {
        const { store } = await this._host()
        this.state = await loadAccounts(store)
      } finally {
        this.loading = false
      }
    },
    async verify(input: NewAccount): Promise<XtreamAuth> {
      const { transport } = await this._host()
      return xtreamLogin(transport, input.url, input.username, input.password)
    },
    async add(input: NewAccount, verify: boolean) {
      const { store, ids } = await this._host()
      if (verify) {
        const res = await this.verify(input)
        if (!res.active) throw new Error(`Account not active (auth=${res.auth}, status="${res.status}")`)
      }
      this.state = addAccount(this.state, input, ids())
      await saveAccounts(store, this.state)
    },
    async remove(id: string) {
      const { store } = await this._host()
      this.state = removeAccount(this.state, id)
      await saveAccounts(store, this.state)
    },
    async select(id: string) {
      const { store } = await this._host()
      this.state = setActive(this.state, id)
      await saveAccounts(store, this.state)
    },
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- stores/accounts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Build the Accounts view UI**

`src/views/accounts/AccountsView.vue`:
```vue
<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useAccountsStore } from '@/stores/accounts'

const accounts = useAccountsStore()
const form = reactive({ name: '', url: '', username: '', password: '' })
const busy = ref(false)
const error = ref('')
const ok = ref('')

onMounted(() => accounts.init())

async function submit() {
  busy.value = true; error.value = ''; ok.value = ''
  try {
    await accounts.add({ ...form }, true)
    ok.value = 'Account added and verified.'
    form.name = form.url = form.username = form.password = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="row g-4">
    <div class="col-md-5">
      <h5>Add account</h5>
      <form @submit.prevent="submit">
        <input v-model="form.name" class="form-control mb-2" placeholder="Name" required />
        <input v-model="form.url" class="form-control mb-2" placeholder="http://host:port" required />
        <input v-model="form.username" class="form-control mb-2" placeholder="Username" required />
        <input v-model="form.password" type="password" class="form-control mb-2" placeholder="Password" required />
        <button class="btn btn-primary" :disabled="busy">{{ busy ? 'Verifying…' : 'Add & verify' }}</button>
      </form>
      <div v-if="error" class="alert alert-danger mt-2">{{ error }}</div>
      <div v-if="ok" class="alert alert-success mt-2">{{ ok }}</div>
    </div>
    <div class="col-md-7">
      <h5>Accounts</h5>
      <p v-if="!accounts.state.accounts.length" class="text-muted">None yet.</p>
      <ul class="list-group">
        <li v-for="a in accounts.state.accounts" :key="a.id"
            class="list-group-item d-flex justify-content-between align-items-center"
            :class="{ active: a.id === accounts.state.activeId }">
          <span>{{ a.name }} <small class="text-muted">{{ a.url }}</small></span>
          <span class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" @click="accounts.select(a.id)"
                    :disabled="a.id === accounts.state.activeId">Use</button>
            <button class="btn btn-outline-danger" @click="accounts.remove(a.id)">Remove</button>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
```

Update `src/views/home/HomeView.vue`:
```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useAccountsStore } from '@/stores/accounts'
const accounts = useAccountsStore()
onMounted(() => accounts.init())
</script>

<template>
  <div>
    <h4>Welcome to InFlight TV</h4>
    <p v-if="accounts.active" class="text-success">Active account: {{ accounts.active.name }}</p>
    <p v-else class="text-muted">No active account. Go to <RouterLink to="/accounts">Accounts</RouterLink> to add one.</p>
  </div>
</template>
```

- [ ] **Step 6: Typecheck, build, and verify in Cockpit (manual, needs a real Xtream account)**

Run: `npm run typecheck && npm run build`
Expected: no type errors; `dist/` rebuilt.

Manual: reload Cockpit → InFlight TV → Accounts. Enter a real Xtream URL/user/pass → "Add & verify" → account appears and Home shows it active. Enter bad creds → red "Account not active" error, account NOT added. Confirm the file exists:
```bash
cat ~/.config/inflighttv/accounts.json
```
Expected: JSON with your account (no console CSP errors).

- [ ] **Step 7: Commit**

```bash
git add src/stores/accounts.ts src/stores/accounts.test.ts src/composables/useHost.ts \
  src/views/accounts/AccountsView.vue src/views/home/HomeView.vue
git commit -m "feat: accounts store and add/switch/verify UI wired to Cockpit"
```

---

### Task 8: Packaging (Makefile) + smoke test + README

**Files:**
- Create: `Makefile`, `tests/smoke.mjs`, `README.md`

**Interfaces:**
- Consumes: the build (`npm run build` → `dist/`).
- Produces: `make install`, `make zip`, `make dev-link`; a Playwright smoke test; project README.

- [ ] **Step 1: Create the Makefile**

`Makefile`:
```make
PREFIX ?= /usr/share/cockpit
NAME = inflighttv
INSTALL_DIR = $(PREFIX)/$(NAME)
VERSION := $(shell cat VERSION)
TAG := v$(VERSION)

.PHONY: all help build install uninstall dev-link zip clean version

all: help

help:
	@echo "inflighttv plugin — version $(VERSION)"
	@echo "  make build      Build dist/ with Vite"
	@echo "  make dev-link   Symlink dist/ into ~/.local/share/cockpit (no root)"
	@echo "  make install    Build and copy to $(INSTALL_DIR) (use sudo)"
	@echo "  make uninstall  Remove $(INSTALL_DIR) (use sudo)"
	@echo "  make zip        Produce inflighttv-$(VERSION).zip"

version:
	@echo $(VERSION)

build:
	npm ci
	npm run build

dev-link: build
	mkdir -p $(HOME)/.local/share/cockpit
	ln -sfn $(CURDIR)/dist $(HOME)/.local/share/cockpit/$(NAME)
	@echo "Linked. Reload Cockpit; look under Tools → InFlight TV."

install: build
	@if [ "$$(id -u)" != "0" ]; then echo "install requires root (use sudo)"; exit 1; fi
	rm -rf $(INSTALL_DIR)
	install -d $(INSTALL_DIR)
	cp -r dist/. $(INSTALL_DIR)/
	@echo "Installed $(NAME) $(VERSION). Restart Cockpit: systemctl try-restart cockpit"

uninstall:
	@if [ "$$(id -u)" != "0" ]; then echo "uninstall requires root (use sudo)"; exit 1; fi
	rm -rf $(INSTALL_DIR)

zip: build
	@tmp=$$(mktemp -d); mkdir "$$tmp/$(NAME)"; cp -r dist/. "$$tmp/$(NAME)/"; \
	(cd "$$tmp" && zip -rq "$(NAME)-$(VERSION).zip" $(NAME)); \
	mv "$$tmp/$(NAME)-$(VERSION).zip" .; rm -rf "$$tmp"; \
	echo "Wrote $(NAME)-$(VERSION).zip"

clean:
	rm -rf dist $(NAME)-*.zip
```

- [ ] **Step 2: Create the Playwright smoke test**

`tests/smoke.mjs`:
```js
// Smoke test: serves dist/ as a plain static site with a stubbed cockpit.js and
// asserts the SPA mounts and renders the shell + accounts form. Does NOT touch a real Cockpit.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const COCKPIT_STUB = `window.cockpit = {
  user: async () => ({ home: '/tmp', name: 'test' }),
  file: () => ({ read: async () => null, replace: async () => '', close() {} }),
  http: () => ({ get: async () => '{}' }),
  spawn: async () => '',
};`

const server = createServer(async (req, res) => {
  let path = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  if (path === '/../base1/cockpit.js' || path.endsWith('/base1/cockpit.js')) {
    res.setHeader('content-type', 'text/javascript'); res.end(COCKPIT_STUB); return
  }
  try {
    const body = await readFile(join(DIST, path))
    res.setHeader('content-type', TYPES[extname(path)] || 'application/octet-stream')
    res.end(body)
  } catch { res.statusCode = 404; res.end('not found') }
})

await new Promise((r) => server.listen(0, r))
const port = server.address().port
const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(`http://localhost:${port}/index.html`)
await page.waitForSelector('text=InFlight TV')
await page.goto(`http://localhost:${port}/index.html#/accounts`)
await page.waitForSelector('input[placeholder="http://host:port"]')
await browser.close()
server.close()
if (errors.length) { console.error('Console errors:', errors); process.exit(1) }
console.log('smoke OK')
```

- [ ] **Step 3: Run the smoke test**

Run: `npm run build && npx playwright install chromium && npm run test:smoke`
Expected: prints `smoke OK`, exit 0. (The stubbed `cockpit.js` replaces the `../base1/cockpit.js` include; the SPA mounts and the accounts form renders.)

- [ ] **Step 4: Write the README**

`README.md`:
```markdown
# InFlight TV

A Cockpit plugin that turns any Xtream Codes IPTV subscription into a browser TV client
(Live TV, VOD, Series, EPG) with favorites, custom lists, watch-later, continue-watching,
multiple accounts, GPU-accelerated transcoding, and encrypted cloud backup.

> Named for Cockpit ("in-flight") — it is not for aircraft use.

## Requirements
- Cockpit ≥ 215
- `ffmpeg` on the host (used for stream remux/transcode; added in a later milestone)
- Node ≥ 20 to build

## Develop
```bash
npm install
make dev-link      # builds dist/ and symlinks it into ~/.local/share/cockpit/inflighttv
npm run dev:watch  # rebuild on save; reload the Cockpit tab
```
Open Cockpit → Tools → **InFlight TV**.

## Install (system-wide)
```bash
sudo make install
sudo systemctl try-restart cockpit
```

## Test
```bash
npm run test        # unit (Vitest)
npm run test:smoke  # SPA smoke (Playwright)
```

## License
Apache-2.0 (applied at first public release).
```

- [ ] **Step 5: Commit**

```bash
git add Makefile tests/smoke.mjs README.md
git commit -m "chore: add Makefile packaging, smoke test, and README"
```

---

## Self-Review

**Spec coverage (Plan 1 slice):**
- Cockpit package + Vue/Vite/TS/Bootstrap build & load → Task 1. ✓
- `cockpit.http` metadata path + auth → Tasks 3, 4. ✓
- Persistence via `cockpit.file` JSON in `~/.config/inflighttv/` → Task 5. ✓
- Multi-account save/switch (spec §5 accounts.json, §6 multi-account) → Tasks 6, 7. ✓
- Xtream normalization/null-guarding (spec §7 robustness) → Task 2. ✓
- Packaging/Makefile/CSP/manifest (spec §8) → Tasks 1, 8. ✓
- Testing approach (spec §11: Vitest core + Playwright smoke, mocked Xtream) → all core tasks + Task 8. ✓
- Feature-sliced structure, no monoliths (spec §4) → directory layout across tasks. ✓
- Deferred to later plans (correctly out of this slice): browsing, EPG, media engine, favorites/lists/watch-later/history, backup, hardware settings.

**Placeholder scan:** No "TBD/TODO/handle edge cases" in steps; every code step shows full code. The two non-unit-tested adapters (`cockpitHttp.ts`, `cockpitFile.ts`) are exercised by manual verification in Tasks 6–7 (documented), which is correct since they require a live Cockpit.

**Type consistency:** `XtreamTransport.getJson`, `XtreamAuth`, `Account`/`AccountsState`/`NewAccount`, `JsonStore.load/save`, and store actions (`init/add/remove/select/verify/$configure`) are referenced identically across Tasks 3–7. `createMemoryStore` is defined in Task 5 and reused in Tasks 6–7 tests. `useHost()` returns `{ store, transport }` consumed by the store's `_host()`.

**Note on `$configure`/`_deps`:** the store exposes a test seam (`$configure`) so unit tests inject in-memory `store`/`transport` and a deterministic id generator; the app path lazily builds Cockpit-backed deps via `useHost()`.
