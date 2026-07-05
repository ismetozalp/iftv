# In-flight TV — Accounts v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the accounts feature so an account can be an **Xtream login** (URL + username + password) *or* a **credential-less M3U playlist** (URL only, e.g. iptv-org), and add an **Edit account** action. Existing Xtream accounts keep working unchanged.

**Architecture:** Builds on Plan 1 (merged to `main`). The account model gains a `type` discriminator and an optional `epgUrl`; a new pure `verifyAccount` orchestrates type-specific verification (Xtream login vs. fetching the M3U and checking it's a valid playlist). All new logic lives in pure `src/core/**` modules with host access injected, so it is unit-tested under Vitest. The Vue layer gains a reusable `AccountForm` (add + edit, with a type toggle) driven by the existing `workspace` store.

**Tech Stack:** Vue 3 (runtime-only), Vite, TypeScript, Bootstrap 5, Pinia, vue-router, Vitest, Playwright.

## Global Constraints

- Builds on Plan 1 on branch `main`. Package `inflighttv`; config under `~/.config/cockpit/inflighttv/` (`accounts.json`, `tabs.json`).
- `src/core/**` must NOT import Vue, Pinia, or `window.cockpit` — host access is injected via interfaces. Adapters under `src/adapters/**` may import `cockpit`.
- Account `type` is `'xtream' | 'm3u'`. Xtream uses `url` + `username` + `password` (+ optional `epgUrl`). M3U uses `url` only (username/password stored as `''`) + optional `epgUrl` (XMLTV). The M3U `url` is opaque — never parse credentials out of it.
- **Verification:** Xtream = `player_api.php` login is active (`auth===1 && status==="Active"`). M3U = HTTP GET the `url` and confirm the body is a valid playlist (starts with `#EXTM3U`). Both must degrade to a clear error on a connectivity/parse failure (NOT a misleading "not active").
- **Migration:** legacy `accounts.json` entries (written by Plan 1, no `type` field) load as `type: 'xtream'`; missing string fields normalize to `''`.
- No monolithic files: one clear responsibility per file. Commit after every task. Do not push to any remote in this plan.
- This plan does NOT implement browsing an M3U's channels — that belongs to the content-browsing plan. Here, M3U support ends at "add/edit/verify an M3U-type account."

---

### Task 1: Account model — `type`, `epgUrl`, `updateAccount`, migration

**Files:**
- Modify: `src/core/accounts/accounts.ts`, `src/core/accounts/accounts.test.ts`

**Interfaces:**
- Consumes: `JsonStore`, `createMemoryStore` (Plan 1).
- Produces:
  - `Account` gains `type: 'xtream' | 'm3u'` and optional `epgUrl?: string` (fields: `id, type, name, url, username, password, epgUrl?, createdAt`).
  - `NewAccount` gains `type: 'xtream' | 'm3u'` and optional `epgUrl?: string`.
  - `updateAccount(state: AccountsState, id: string, patch: Partial<Omit<Account, 'id' | 'createdAt'>>): AccountsState` — pure, immutable; replaces matching account's fields, leaves others untouched; no-op if id absent.
  - `loadAccounts` migrates legacy rows: any row without `type` → `type: 'xtream'`; `name/url/username/password` coerce to `''` if missing; `epgUrl` passed through; `id/createdAt` preserved.

- [ ] **Step 1: Update the tests (add `type`, `updateAccount`, migration cases)**

Replace `src/core/accounts/accounts.test.ts` with:
```ts
import { describe, it, expect } from 'vitest'
import {
  EMPTY_ACCOUNTS, addAccount, removeAccount, updateAccount, findAccount,
  loadAccounts, saveAccounts,
} from './accounts'
import { createMemoryStore } from '@/core/storage/appState'

const XTREAM = { type: 'xtream' as const, name: 'P1', url: 'http://h:8080', username: 'u', password: 'p' }
const M3U = { type: 'm3u' as const, name: 'Free', url: 'http://host/list.m3u', username: '', password: '' }

describe('addAccount', () => {
  it('appends an xtream account with its type', () => {
    const s = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 100 })
    expect(s.accounts[0]).toEqual({ id: 'a1', createdAt: 100, ...XTREAM })
  })
  it('appends an m3u account (no credentials)', () => {
    const s = addAccount(EMPTY_ACCOUNTS, M3U, { id: 'a2', createdAt: 200 })
    expect(s.accounts[0].type).toBe('m3u')
    expect(s.accounts[0].username).toBe('')
  })
  it('does not mutate input', () => {
    const s = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 1 })
    expect(EMPTY_ACCOUNTS.accounts).toHaveLength(0)
    expect(s).not.toBe(EMPTY_ACCOUNTS)
  })
})

describe('updateAccount', () => {
  it('patches the matching account immutably', () => {
    const s1 = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 1 })
    const s2 = updateAccount(s1, 'a1', { name: 'Renamed', password: 'new' })
    expect(s2.accounts[0]).toEqual({ id: 'a1', createdAt: 1, ...XTREAM, name: 'Renamed', password: 'new' })
    expect(s1.accounts[0].name).toBe('P1') // original untouched
    expect(s2).not.toBe(s1)
  })
  it('can change type and add epgUrl', () => {
    const s1 = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 1 })
    const s2 = updateAccount(s1, 'a1', { type: 'm3u', username: '', password: '', epgUrl: 'http://e/xmltv' })
    expect(s2.accounts[0].type).toBe('m3u')
    expect(s2.accounts[0].epgUrl).toBe('http://e/xmltv')
  })
  it('is a no-op when the id is absent', () => {
    const s1 = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 1 })
    const s2 = updateAccount(s1, 'nope', { name: 'x' })
    expect(s2.accounts[0].name).toBe('P1')
  })
})

describe('removeAccount / findAccount', () => {
  it('removes and finds by id', () => {
    const s = addAccount(EMPTY_ACCOUNTS, XTREAM, { id: 'a1', createdAt: 1 })
    expect(findAccount(s.accounts, 'a1')?.id).toBe('a1')
    expect(removeAccount(s, 'a1').accounts).toHaveLength(0)
    expect(findAccount(s.accounts, null)).toBeNull()
  })
})

describe('loadAccounts migration', () => {
  it('defaults legacy rows (no type) to xtream and coerces missing fields', async () => {
    const store = createMemoryStore()
    // Simulate a Plan-1 accounts.json (no `type` field, no epgUrl)
    await store.save('accounts.json', { accounts: [{ id: 'a1', name: 'Old', url: 'http://h', username: 'u', password: 'p', createdAt: 1 }] })
    const s = await loadAccounts(store)
    expect(s.accounts[0]).toEqual({ id: 'a1', type: 'xtream', name: 'Old', url: 'http://h', username: 'u', password: 'p', createdAt: 1 })
  })
  it('preserves an m3u row and its epgUrl', async () => {
    const store = createMemoryStore()
    await store.save('accounts.json', { accounts: [{ id: 'a2', type: 'm3u', name: 'Free', url: 'http://host/list.m3u', username: '', password: '', epgUrl: 'http://e/xmltv', createdAt: 2 }] })
    const s = await loadAccounts(store)
    expect(s.accounts[0].type).toBe('m3u')
    expect(s.accounts[0].epgUrl).toBe('http://e/xmltv')
  })
  it('returns EMPTY (fresh copy) when nothing stored', async () => {
    const loaded = await loadAccounts(createMemoryStore())
    expect(loaded).toEqual(EMPTY_ACCOUNTS)
    expect(loaded).not.toBe(EMPTY_ACCOUNTS)
  })
})

describe('save round-trip', () => {
  it('persists and reloads an m3u account', async () => {
    const store = createMemoryStore()
    const s = addAccount(EMPTY_ACCOUNTS, M3U, { id: 'a2', createdAt: 2 })
    await saveAccounts(store, s)
    expect(await loadAccounts(store)).toEqual(s)
  })
})
```

- [ ] **Step 2: Run the tests → RED**

Run: `npm run test -- accounts`
Expected: FAIL (`updateAccount` not exported; `type` field mismatches).

- [ ] **Step 3: Update `src/core/accounts/accounts.ts`**

```ts
import type { JsonStore } from '@/core/storage/appState'

export type AccountType = 'xtream' | 'm3u'

export interface Account {
  id: string
  type: AccountType
  name: string
  url: string
  username: string
  password: string
  epgUrl?: string
  createdAt: number
}

export interface AccountsState {
  accounts: Account[]
}

export interface NewAccount {
  type: AccountType
  name: string
  url: string
  username: string
  password: string
  epgUrl?: string
}

export const EMPTY_ACCOUNTS: AccountsState = { accounts: [] }

export function addAccount(state: AccountsState, input: NewAccount, meta: { id: string; createdAt: number }): AccountsState {
  const account: Account = { id: meta.id, createdAt: meta.createdAt, ...input }
  return { accounts: [...state.accounts, account] }
}

export function removeAccount(state: AccountsState, id: string): AccountsState {
  return { accounts: state.accounts.filter((a) => a.id !== id) }
}

export function updateAccount(
  state: AccountsState,
  id: string,
  patch: Partial<Omit<Account, 'id' | 'createdAt'>>,
): AccountsState {
  return { accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }
}

export function findAccount(accounts: Account[], id: string | null): Account | null {
  return accounts.find((a) => a.id === id) ?? null
}

const ACCOUNTS_KEY = 'accounts.json'

// Normalize a raw persisted row (which may predate the `type` field) into an Account.
function migrate(raw: Record<string, unknown>): Account {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    id: str(raw.id),
    type: raw.type === 'm3u' ? 'm3u' : 'xtream',
    name: str(raw.name),
    url: str(raw.url),
    username: str(raw.username),
    password: str(raw.password),
    ...(typeof raw.epgUrl === 'string' ? { epgUrl: raw.epgUrl } : {}),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
  }
}

export async function loadAccounts(store: JsonStore): Promise<AccountsState> {
  const s = await store.load<{ accounts?: unknown[] }>(ACCOUNTS_KEY, EMPTY_ACCOUNTS)
  const rows = Array.isArray(s.accounts) ? s.accounts : []
  return { accounts: rows.map((r) => migrate((r ?? {}) as Record<string, unknown>)) }
}

export async function saveAccounts(store: JsonStore, state: AccountsState): Promise<void> {
  await store.save(ACCOUNTS_KEY, state)
}
```

- [ ] **Step 4: Run the tests → GREEN, then typecheck**

Run: `npm run test -- accounts` (all pass), then `npm run typecheck`.
Expected: PASS; typecheck clean. Note: `src/stores/workspace.ts` will now have a type error because `NewAccount` requires `type` — that's fixed in Task 4. If typecheck fails ONLY on `workspace.ts`/`AccountsView.vue` for the missing `type`, that is expected at this step; proceed (Task 4/5 fix the consumers). If it fails inside `accounts.ts` itself, fix that.

- [ ] **Step 5: Commit**

```bash
git add src/core/accounts/accounts.ts src/core/accounts/accounts.test.ts
git commit -m "feat: account type (xtream/m3u) + epgUrl, updateAccount, legacy migration"
```

---

### Task 2: M3U validity check + transport `fetchText`

**Files:**
- Create: `src/core/accounts/m3u.ts`, `src/core/accounts/m3u.test.ts`
- Modify: `src/core/xtream/transport.ts`, `src/adapters/cockpitHttp.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `isValidM3u(text: string): boolean` — true iff the body (ignoring leading whitespace/BOM) starts with `#EXTM3U`.
  - `XtreamTransport` gains `fetchText(url: string): Promise<string>` — GET an arbitrary full URL and return the response body as text.
  - `cockpitHttp` adapter implements `fetchText` via `cockpit.http` (parse the URL for address/port/tls; request `pathname + search`). Not unit-tested (needs Cockpit).

- [ ] **Step 1: Write the failing test for `isValidM3u`**

`src/core/accounts/m3u.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isValidM3u } from './m3u'

describe('isValidM3u', () => {
  it('accepts a body starting with #EXTM3U', () => {
    expect(isValidM3u('#EXTM3U\n#EXTINF:-1,Chan\nhttp://s/1.ts')).toBe(true)
  })
  it('tolerates a leading BOM and whitespace', () => {
    expect(isValidM3u('﻿  \n#EXTM3U\n')).toBe(true)
  })
  it('rejects non-playlist bodies (HTML error page, empty, JSON)', () => {
    expect(isValidM3u('<html>error</html>')).toBe(false)
    expect(isValidM3u('')).toBe(false)
    expect(isValidM3u('{"error":true}')).toBe(false)
  })
})
```

- [ ] **Step 2: Run → RED**

Run: `npm run test -- m3u`
Expected: FAIL — `Cannot find module './m3u'`.

- [ ] **Step 3: Implement `src/core/accounts/m3u.ts`**

```ts
// Minimal M3U validity check used to verify an m3u-type account is reachable and
// actually a playlist. Full channel parsing belongs to the content-browsing plan.
export function isValidM3u(text: string): boolean {
  return text.replace(/^﻿/, '').trimStart().startsWith('#EXTM3U')
}
```

- [ ] **Step 4: Run → GREEN**

Run: `npm run test -- m3u`
Expected: PASS.

- [ ] **Step 5: Add `fetchText` to the transport interface**

In `src/core/xtream/transport.ts`, add to the `XtreamTransport` interface (keep `getJson` as-is):
```ts
export interface XtreamTransport {
  getJson(base: XtreamBase, path: string, params: Record<string, string>): Promise<unknown>
  fetchText(url: string): Promise<string>
}
```

- [ ] **Step 6: Implement `fetchText` in the Cockpit adapter**

In `src/adapters/cockpitHttp.ts`, add a `fetchText` method to the returned object:
```ts
    async fetchText(fullUrl: string): Promise<string> {
      const u = new URL(fullUrl)
      const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
      const options =
        u.protocol === 'https:'
          ? { address: u.hostname, port, tls: {} }
          : { address: u.hostname, port }
      return cockpit.http(options).get(u.pathname + u.search)
    },
```
(Place it alongside the existing `getJson` method in the object literal.)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: any test transports in `auth.test.ts` that implement `XtreamTransport` inline will now be missing `fetchText`. If the compiler flags those test doubles, that's expected — fix them in the SAME step by adding a `fetchText: async () => ''` stub to each inline `XtreamTransport` in `src/core/xtream/auth.test.ts` and `src/core/xtream/transport.test.ts` (search for `getJson` usages), then re-run `npm run test -- auth transport` to confirm green. Do not change production behavior.

- [ ] **Step 8: Commit**

```bash
git add src/core/accounts/m3u.ts src/core/accounts/m3u.test.ts src/core/xtream/transport.ts \
  src/adapters/cockpitHttp.ts src/core/xtream/auth.test.ts src/core/xtream/transport.test.ts
git commit -m "feat: isValidM3u + transport.fetchText for M3U/EPG URL fetching"
```

---

### Task 3: `verifyAccount` — type-aware verification

**Files:**
- Create: `src/core/accounts/verify.ts`, `src/core/accounts/verify.test.ts`

**Interfaces:**
- Consumes: `NewAccount` (Task 1), `XtreamAuth` (Plan 1 `auth.ts`), `isValidM3u` (Task 2).
- Produces:
  - `interface VerifyResult { ok: boolean; detail: string }`
  - `interface VerifyDeps { xtreamLogin(url: string, username: string, password: string): Promise<XtreamAuth>; fetchText(url: string): Promise<string> }`
  - `async function verifyAccount(input: NewAccount, deps: VerifyDeps): Promise<VerifyResult>` —
    - `m3u`: `fetchText(input.url)`; on throw → `{ ok:false, detail:'Could not reach the playlist URL' }`; else `isValidM3u` → ok, or `{ ok:false, detail:'Not a valid M3U playlist (missing #EXTM3U)' }`.
    - `xtream`: `xtreamLogin(...)`; on throw → `{ ok:false, detail:'Could not reach the Xtream panel' }`; else `active` → ok, or `{ ok:false, detail:'Account not active (auth=<a>, status="<s>")' }`.

- [ ] **Step 1: Write the failing test**

`src/core/accounts/verify.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { verifyAccount, type VerifyDeps } from './verify'
import type { XtreamAuth } from '@/core/xtream/auth'

const XTREAM = { type: 'xtream' as const, name: 'P', url: 'http://h:8080', username: 'u', password: 'p' }
const M3U = { type: 'm3u' as const, name: 'F', url: 'http://host/list.m3u', username: '', password: '' }

function deps(over: Partial<VerifyDeps>): VerifyDeps {
  return {
    xtreamLogin: vi.fn(async () => ({ auth: true, status: 'Active', active: true, expDate: null, maxConnections: null, allowedOutputFormats: [] } as XtreamAuth)),
    fetchText: vi.fn(async () => '#EXTM3U\n'),
    ...over,
  }
}

describe('verifyAccount — xtream', () => {
  it('ok when login is active', async () => {
    expect(await verifyAccount(XTREAM, deps({}))).toEqual({ ok: true, detail: expect.any(String) })
  })
  it('fails with status detail when inactive', async () => {
    const d = deps({ xtreamLogin: async () => ({ auth: false, status: 'Disabled', active: false, expDate: null, maxConnections: null, allowedOutputFormats: [] }) })
    const r = await verifyAccount(XTREAM, d)
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/not active/i)
  })
  it('reports connectivity failure clearly (not "not active")', async () => {
    const d = deps({ xtreamLogin: async () => { throw new Error('network') } })
    const r = await verifyAccount(XTREAM, d)
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/could not reach/i)
  })
})

describe('verifyAccount — m3u', () => {
  it('ok for a valid playlist', async () => {
    const r = await verifyAccount(M3U, deps({ fetchText: async () => '#EXTM3U\n#EXTINF:-1,C\nhttp://s/1.ts' }))
    expect(r.ok).toBe(true)
  })
  it('fails for a non-playlist body', async () => {
    const r = await verifyAccount(M3U, deps({ fetchText: async () => '<html>nope</html>' }))
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/not a valid m3u/i)
  })
  it('fails clearly when the URL is unreachable', async () => {
    const r = await verifyAccount(M3U, deps({ fetchText: async () => { throw new Error('dns') } }))
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/could not reach/i)
  })
  it('does not attempt an xtream login for m3u', async () => {
    const login = vi.fn()
    await verifyAccount(M3U, deps({ xtreamLogin: login as never }))
    expect(login).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run → RED**

Run: `npm run test -- verify`
Expected: FAIL — `Cannot find module './verify'`.

- [ ] **Step 3: Implement `src/core/accounts/verify.ts`**

```ts
import type { NewAccount } from './accounts'
import type { XtreamAuth } from '@/core/xtream/auth'
import { isValidM3u } from './m3u'

export interface VerifyResult {
  ok: boolean
  detail: string
}

export interface VerifyDeps {
  xtreamLogin(url: string, username: string, password: string): Promise<XtreamAuth>
  fetchText(url: string): Promise<string>
}

export async function verifyAccount(input: NewAccount, deps: VerifyDeps): Promise<VerifyResult> {
  if (input.type === 'm3u') {
    let text: string
    try {
      text = await deps.fetchText(input.url)
    } catch {
      return { ok: false, detail: 'Could not reach the playlist URL' }
    }
    return isValidM3u(text)
      ? { ok: true, detail: 'Valid M3U playlist' }
      : { ok: false, detail: 'Not a valid M3U playlist (missing #EXTM3U)' }
  }
  let auth: XtreamAuth
  try {
    auth = await deps.xtreamLogin(input.url, input.username, input.password)
  } catch {
    return { ok: false, detail: 'Could not reach the Xtream panel' }
  }
  return auth.active
    ? { ok: true, detail: 'Account active' }
    : { ok: false, detail: `Account not active (auth=${auth.auth}, status="${auth.status}")` }
}
```

- [ ] **Step 4: Run → GREEN, then typecheck**

Run: `npm run test -- verify` (all pass), then `npm run typecheck` (accounts core is clean; store/UI errors from Task 4/5 still expected).

- [ ] **Step 5: Commit**

```bash
git add src/core/accounts/verify.ts src/core/accounts/verify.test.ts
git commit -m "feat: verifyAccount orchestrates xtream login vs m3u playlist check"
```

---

### Task 4: Workspace store — type-aware verify/add + `update`

**Files:**
- Modify: `src/stores/workspace.ts`, `src/stores/workspace.test.ts`

**Interfaces:**
- Consumes: `verifyAccount`/`VerifyResult` (Task 3), `updateAccount` (Task 1), `xtreamLogin` (Plan 1), `transport.fetchText` (Task 2).
- Produces:
  - `verify(input: NewAccount): Promise<VerifyResult>` (replaces the old `XtreamAuth`-returning verify) — delegates to `verifyAccount` with real deps.
  - `add(input: NewAccount, verify: boolean)` — on `verify`, throws `Error(res.detail)` when `!res.ok`.
  - `update(id: string, patch: Partial<Omit<Account,'id'|'createdAt'>>): Promise<void>` — applies `updateAccount` and persists.

- [ ] **Step 1: Update the store tests**

In `src/stores/workspace.test.ts`: (a) the `NEW` fixture gains `type: 'xtream'`; (b) the fake transport gains `fetchText`; (c) add `update` + m3u-add cases. Apply these edits:

Replace the fixture and transport helper near the top with:
```ts
const NEW = { type: 'xtream' as const, name: 'P1', url: 'http://h:8080', username: 'u', password: 'p' }
const M3U = { type: 'm3u' as const, name: 'Free', url: 'http://host/list.m3u', username: '', password: '' }

function transport(auth: number, status = 'Active', m3uBody = '#EXTM3U\n') {
  return {
    getJson: vi.fn(async () => ({ user_info: { auth, status } })),
    fetchText: vi.fn(async () => m3uBody),
  }
}
```
Add these tests inside `describe('useWorkspaceStore', ...)`:
```ts
  it('adds an m3u account (no credentials) after a valid-playlist verify', async () => {
    const s = useWorkspaceStore()
    s.$configure({ store: createMemoryStore(), transport: transport(1), ids: seq() })
    await s.init()
    await s.add(M3U, true)
    expect(s.allAccounts).toHaveLength(1)
    expect(s.allAccounts[0].type).toBe('m3u')
  })

  it('rejects an m3u account whose URL is not a playlist', async () => {
    const s = useWorkspaceStore()
    s.$configure({ store: createMemoryStore(), transport: transport(1, 'Active', '<html>nope</html>'), ids: seq() })
    await s.init()
    await expect(s.add(M3U, true)).rejects.toThrow(/not a valid m3u/i)
    expect(s.allAccounts).toHaveLength(0)
  })

  it('update patches an account and persists it', async () => {
    const store = createMemoryStore()
    const s = useWorkspaceStore()
    s.$configure({ store, transport: transport(1), ids: seq() })
    await s.init()
    await s.add(NEW, false)
    await s.update('id1', { name: 'Renamed' })
    expect(s.allAccounts[0].name).toBe('Renamed')
    const s2 = useWorkspaceStore()
    s2.$configure({ store, transport: transport(1), ids: seq() })
    await s2.init()
    expect(s2.allAccounts[0].name).toBe('Renamed')
  })
```
Also, in the existing `add with verify=true throws` test, its expectation `toThrow(/not active/i)` still holds (Xtream inactive path). Leave it.

- [ ] **Step 2: Run → RED**

Run: `npm run test -- workspace`
Expected: FAIL (`update` missing; `verify` return shape changed; fixtures need `type`).

- [ ] **Step 3: Update `src/stores/workspace.ts`**

Change the imports and the `verify`/`add` actions, and add `update`. Specifically:

Update the accounts import to include `updateAccount`:
```ts
import {
  EMPTY_ACCOUNTS, addAccount, removeAccount, updateAccount, findAccount,
  loadAccounts, saveAccounts, type AccountsState, type Account, type NewAccount,
} from '@/core/accounts/accounts'
```
Add these imports:
```ts
import { xtreamLogin } from '@/core/xtream/auth'
import { verifyAccount, type VerifyResult } from '@/core/accounts/verify'
```
(Remove the old `import { xtreamLogin, type XtreamAuth } from '@/core/xtream/auth'` line — `XtreamAuth` is no longer used here.)

Replace the `verify` and `add` actions and add `update`:
```ts
    async verify(input: NewAccount): Promise<VerifyResult> {
      const { transport } = await this._host()
      return verifyAccount(input, {
        xtreamLogin: (url, username, password) => xtreamLogin(transport, url, username, password),
        fetchText: (url) => transport.fetchText(url),
      })
    },
    async add(input: NewAccount, verify: boolean) {
      const { ids } = await this._host()
      if (verify) {
        const res = await this.verify(input)
        if (!res.ok) throw new Error(res.detail)
      }
      const meta = ids()
      this.accounts = addAccount(this.accounts, input, meta)
      await this._persistAccounts()
      this.tabs = openTab(this.tabs, meta.id)
      await this._persistTabs()
    },
    async update(id: string, patch: Partial<Omit<Account, 'id' | 'createdAt'>>) {
      this.accounts = updateAccount(this.accounts, id, patch)
      await this._persistAccounts()
    },
```

- [ ] **Step 4: Run → GREEN, full suite, typecheck**

Run: `npm run test -- workspace` (pass), then `npm run test` (full suite green), then `npm run typecheck`.
Expected: workspace + all core pass. `typecheck` may still flag `AccountsView.vue` (missing `type` in the form) — fixed in Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/stores/workspace.ts src/stores/workspace.test.ts
git commit -m "feat: type-aware verify/add and update action in workspace store"
```

---

### Task 5: Account form (type toggle) + Edit UI + smoke

**Files:**
- Create: `src/components/AccountForm.vue`
- Modify: `src/views/accounts/AccountsView.vue`, `tests/smoke.mjs`

**Interfaces:**
- Consumes: `useWorkspaceStore` (`add`, `update`, `remove`, `open`), `Account`/`NewAccount`/`AccountType` (Task 1).
- Produces:
  - `AccountForm.vue` — a reusable form with a **type toggle** (Xtream ⟷ M3U). Props: `modelValue?: Account | null` (edit target; null = add mode), `busy: boolean`, `error: string`. Emits `submit` with a `NewAccount` payload and `cancel`. When type = M3U it hides username/password and labels the URL "Playlist URL", showing an optional "EPG URL (XMLTV)" field.
  - `AccountsView.vue` — uses `AccountForm` for both **Add** (top) and inline **Edit** (a row's Edit button opens a pre-filled form); list rows show `type` badge, `Open`, `Edit`, `Remove`, and the "open" badge.

- [ ] **Step 1: Create `src/components/AccountForm.vue`**

```vue
<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { Account, NewAccount, AccountType } from '@/core/accounts/accounts'

const props = defineProps<{ modelValue?: Account | null; busy?: boolean; error?: string }>()
const emit = defineEmits<{ submit: [NewAccount]; cancel: [] }>()

const form = reactive<NewAccount>({ type: 'xtream', name: '', url: '', username: '', password: '', epgUrl: '' })

function load(a: Account | null | undefined) {
  form.type = a?.type ?? 'xtream'
  form.name = a?.name ?? ''
  form.url = a?.url ?? ''
  form.username = a?.username ?? ''
  form.password = a?.password ?? ''
  form.epgUrl = a?.epgUrl ?? ''
}
watch(() => props.modelValue, load, { immediate: true })

function setType(t: AccountType) {
  form.type = t
  if (t === 'm3u') { form.username = ''; form.password = '' }
}

function submit() {
  const payload: NewAccount = {
    type: form.type, name: form.name.trim(), url: form.url.trim(),
    username: form.type === 'xtream' ? form.username : '',
    password: form.type === 'xtream' ? form.password : '',
    ...(form.epgUrl.trim() ? { epgUrl: form.epgUrl.trim() } : {}),
  }
  emit('submit', payload)
}
</script>

<template>
  <form @submit.prevent="submit">
    <div class="btn-group btn-group-sm mb-2" role="group">
      <button type="button" class="btn" :class="form.type === 'xtream' ? 'btn-primary' : 'btn-outline-primary'" @click="setType('xtream')">Xtream Codes</button>
      <button type="button" class="btn" :class="form.type === 'm3u' ? 'btn-primary' : 'btn-outline-primary'" @click="setType('m3u')">M3U playlist (no login)</button>
    </div>
    <input v-model="form.name" class="form-control mb-2" placeholder="Name" required />
    <input v-model="form.url" class="form-control mb-2" :placeholder="form.type === 'm3u' ? 'Playlist URL (http://…/list.m3u)' : 'Server URL (http://host:port)'" required />
    <template v-if="form.type === 'xtream'">
      <input v-model="form.username" class="form-control mb-2" placeholder="Username" required />
      <input v-model="form.password" type="password" class="form-control mb-2" placeholder="Password" required />
    </template>
    <input v-model="form.epgUrl" class="form-control mb-2" placeholder="EPG URL (XMLTV) — optional" />
    <div class="d-flex gap-2">
      <button class="btn btn-primary btn-sm" :disabled="busy">{{ busy ? 'Verifying…' : (modelValue ? 'Save' : 'Add & verify') }}</button>
      <button v-if="modelValue" type="button" class="btn btn-outline-secondary btn-sm" @click="emit('cancel')">Cancel</button>
    </div>
    <div v-if="error" class="alert alert-danger mt-2 py-1">{{ error }}</div>
  </form>
</template>
```

- [ ] **Step 2: Rewrite `src/views/accounts/AccountsView.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import AccountForm from '@/components/AccountForm.vue'
import type { Account, NewAccount } from '@/core/accounts/accounts'

const ws = useWorkspaceStore()
const router = useRouter()
const busy = ref(false)
const error = ref('')
const editing = ref<Account | null>(null)
const editBusy = ref(false)
const editError = ref('')

async function onAdd(payload: NewAccount) {
  busy.value = true; error.value = ''
  try {
    await ws.add(payload, true)
    router.push('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function onSaveEdit(payload: NewAccount) {
  if (!editing.value) return
  editBusy.value = true; editError.value = ''
  try {
    await ws.update(editing.value.id, payload)
    editing.value = null
  } catch (e) {
    editError.value = e instanceof Error ? e.message : String(e)
  } finally {
    editBusy.value = false
  }
}

async function openAccount(id: string) {
  await ws.open(id)
  router.push('/')
}
</script>

<template>
  <div class="row g-4">
    <div class="col-md-5">
      <h5>Add account</h5>
      <AccountForm :busy="busy" :error="error" @submit="onAdd" />
    </div>
    <div class="col-md-7">
      <h5>Accounts</h5>
      <p v-if="!ws.allAccounts.length" class="text-muted">None yet.</p>
      <ul class="list-group">
        <template v-for="a in ws.allAccounts" :key="a.id">
          <li class="list-group-item d-flex justify-content-between align-items-center">
            <span>
              <span class="badge bg-info text-dark me-2">{{ a.type }}</span>
              {{ a.name }} <small class="text-muted">{{ a.url }}</small>
              <span v-if="ws.tabs.openTabIds.includes(a.id)" class="badge bg-secondary ms-2">open</span>
            </span>
            <span class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary" @click="openAccount(a.id)">Open</button>
              <button class="btn btn-outline-secondary" @click="editing = a">Edit</button>
              <button class="btn btn-outline-danger" @click="ws.remove(a.id)">Remove</button>
            </span>
          </li>
          <li v-if="editing && editing.id === a.id" class="list-group-item bg-body-secondary">
            <AccountForm :model-value="editing" :busy="editBusy" :error="editError"
                         @submit="onSaveEdit" @cancel="editing = null" />
          </li>
        </template>
      </ul>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Update the smoke test to assert the type toggle renders**

In `tests/smoke.mjs`, after the existing accounts-form assertion, add:
```js
  await page.waitForSelector('text=M3U playlist (no login)')
```
(Place it right after the line `await page.waitForSelector('input[placeholder="http://host:port"]')`. Note: the Xtream URL placeholder is now `Server URL (http://host:port)` — change that existing selector to `await page.waitForSelector('input[placeholder="Server URL (http://host:port)"]')`.)

- [ ] **Step 4: Typecheck, build, full suite, smoke**

Run: `npm run typecheck && npm run build && npm run test && npm run test:smoke`
Expected: all clean; smoke prints `smoke OK`.

- [ ] **Step 5: Manual verification (needs the mock + a browser)**

With the dev mock running (`node dev/mock-xtream.mjs`, `http://localhost:9191`):
- **Add Xtream:** type=Xtream, URL `http://localhost:9191`, any user/pass → verifies, tab opens.
- **Add M3U:** type=M3U (user/pass hidden), URL `http://localhost:9191/player_api.php?username=x&password=y&action=`… is NOT a playlist → error "Not a valid M3U playlist". Use a real playlist URL (e.g. a reachable `.m3u`) → verifies. *(Note: the dev mock isn't an M3U endpoint; a genuine M3U URL or a small static `#EXTM3U` file is needed to see the success path — confirm the failure path against the mock and the success path against any `#EXTM3U` URL.)*
- **Edit:** click Edit on a row → change the name → Save → list updates and persists (`cat ~/.config/cockpit/inflighttv/accounts.json`).
- Bad Xtream URL now says "Could not reach the Xtream panel" (not "not active").

- [ ] **Step 6: Commit**

```bash
git add src/components/AccountForm.vue src/views/accounts/AccountsView.vue tests/smoke.mjs
git commit -m "feat: account form with xtream/m3u type toggle and edit-account UI"
```

---

## Self-Review

**Spec coverage:**
- Credential-less M3U account type (no username/password) → Tasks 1 (model), 2 (validity + fetch), 3 (verify), 4 (store), 5 (UI toggle). ✓
- Edit account → Tasks 1 (`updateAccount`), 4 (`update` action), 5 (Edit UI). ✓
- Legacy Xtream accounts keep working (migration defaults `type:'xtream'`) → Task 1. ✓
- Clear connectivity errors (fixes the Plan 1 "misleading not active" minor) → Task 3. ✓
- Optional EPG XMLTV URL captured on the account → Tasks 1, 5. ✓ (Consuming it for EPG is the EPG plan's job.)
- Deferred (correctly out of scope): parsing M3U channels into browsable content (content-browsing plan); consuming `epgUrl` (EPG plan).

**Placeholder scan:** No TBD/TODO; every code step shows full code. The two non-unit-tested adapter methods (`cockpitHttp.fetchText`) are exercised manually in Task 5.

**Type consistency:** `Account`/`NewAccount` carry `type: AccountType` + optional `epgUrl` from Task 1 onward; `updateAccount(state, id, patch)`, `verifyAccount(input, deps)`, `VerifyResult`, `VerifyDeps`, `transport.fetchText(url)`, and store actions (`verify` now returns `VerifyResult`, `add`, `update`) are referenced identically across Tasks 1–5. The store's `verify` return type changes from `XtreamAuth` (Plan 1) to `VerifyResult` (Task 4) — no other code consumed the old return value (only `add` did, internally), so the change is contained.

**Cross-task typecheck note:** Tasks 1–3 intentionally leave `workspace.ts`/`AccountsView.vue` temporarily failing typecheck (they still use the old `NewAccount` without `type`); Tasks 4 and 5 fix those consumers. Each task's OWN new/changed files are green; the full `npm run test` + `typecheck` are clean only after Task 5. This is called out in each task's run step.
