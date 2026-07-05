# In-flight TV — Plan 2: Live TV Browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse **Live TV** for the active account — Xtream (`get_live_categories`/`get_live_streams`) *and* credential-less M3U playlists (parsed into grouped channels) — through a category sidebar, a **virtualized** channel grid, and a **search** box. No playback yet (Plan 3).

**Architecture:** A unified content model (`Category`, `Channel`) feeds both account types via a `ContentProvider` interface with two implementations (Xtream-live API vs. parsed-M3U). A Pinia `library` store builds the right provider for the active account, lazily loads categories/channels, caches them, and powers search. The UI reuses a generic `VirtualGrid` and a `ChannelCard`. All fetch/parse logic is pure `src/core/**` (transport injected), unit-tested under Vitest. These pieces (provider, store, grid, search) are designed so VOD/Series (Plan 2b) reuse them.

**Tech Stack:** Vue 3 (runtime-only), Vite, TypeScript, Bootstrap 5, Pinia, vue-router, Vitest, Playwright.

## Global Constraints

- Builds on `main` (Plan 1 + Accounts v2 merged). Package `inflighttv`; config under `~/.config/cockpit/inflighttv/`.
- `src/core/**` must NOT import Vue/Pinia/window.cockpit — host access injected via `XtreamTransport` (has `getJson` and `fetchText`). Adapters under `src/adapters/**` may import `cockpit`.
- Account model (from Accounts v2): `Account { id, type:'xtream'|'m3u', name, url, username, password, epgUrl?, createdAt }`. Xtream fetches via `player_api.php`; M3U fetches the `url` and parses it.
- Content model: `Category { id, name }`; `Channel { id, name, logo, categoryId, streamId: string|null, url: string|null }`. Xtream channels carry `streamId` (for Plan 3 playback URL building); M3U channels carry the direct `url`.
- No monolithic files; one responsibility per file. TDD. Commit after every task. Do not push to any remote.
- No playback in this plan: clicking a channel selects it (visual) but does not play — Plan 3 wires playback using `streamId`/`url`.
- Robustness: Xtream responses have inconsistent types — normalize via `toStr`; guard non-array bodies. M3U parsing tolerates missing attributes.

---

### Task 1: Content model + Xtream live client

**Files:**
- Create: `src/core/content/types.ts`, `src/core/xtream/live.ts`, `src/core/xtream/live.test.ts`

**Interfaces:**
- Consumes: `XtreamTransport`, `buildPlayerApiParams` (transport.ts); `parseXtreamUrl`, `toStr` (normalize.ts).
- Produces:
  - `Category { id: string; name: string }`, `Channel { id: string; name: string; logo: string; categoryId: string; streamId: string | null; url: string | null }`.
  - `getLiveCategories(t: XtreamTransport, url: string, username: string, password: string): Promise<Category[]>` — calls `action=get_live_categories`; maps `{category_id, category_name}` → `Category`; drops entries with empty id.
  - `getLiveStreams(t, url, username, password, categoryId?: string): Promise<Channel[]>` — calls `action=get_live_streams` (+ `category_id` when given); maps `{stream_id, name, stream_icon, category_id}` → `Channel` with `id: 'x:'+stream_id`, `streamId: stream_id`, `url: null`; drops entries with empty `streamId`.

- [ ] **Step 1: Create `src/core/content/types.ts`**

```ts
export interface Category {
  id: string
  name: string
}

export interface Channel {
  id: string
  name: string
  logo: string
  categoryId: string
  streamId: string | null // Xtream live stream id (used to build the play URL in Plan 3)
  url: string | null // direct stream URL (M3U channels)
}
```

- [ ] **Step 2: Write the failing test**

`src/core/xtream/live.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { getLiveCategories, getLiveStreams } from './live'
import type { XtreamTransport } from './transport'

function transport(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload), fetchText: vi.fn(async () => '') }
}

describe('getLiveCategories', () => {
  it('maps category_id/category_name and drops empty ids', async () => {
    const t = transport([
      { category_id: '1', category_name: 'News', parent_id: 0 },
      { category_id: '', category_name: 'Bad' },
    ])
    expect(await getLiveCategories(t, 'http://h:8080', 'u', 'p')).toEqual([{ id: '1', name: 'News' }])
  })
  it('returns [] for a non-array body', async () => {
    expect(await getLiveCategories(transport(null), 'http://h', 'u', 'p')).toEqual([])
  })
  it('calls get_live_categories with credentials', async () => {
    const t = transport([])
    await getLiveCategories(t, 'http://h:8080', 'u', 'p')
    expect(t.getJson).toHaveBeenCalledWith(
      { scheme: 'http', host: 'h', port: 8080 }, '/player_api.php',
      { username: 'u', password: 'p', action: 'get_live_categories' },
    )
  })
})

describe('getLiveStreams', () => {
  it('maps stream fields and drops entries without a stream_id', async () => {
    const t = transport([
      { stream_id: 101, name: 'CNN', stream_icon: 'http://l/cnn.png', category_id: '1' },
      { name: 'No id', category_id: '1' },
    ])
    expect(await getLiveStreams(t, 'http://h', 'u', 'p')).toEqual([
      { id: 'x:101', name: 'CNN', logo: 'http://l/cnn.png', categoryId: '1', streamId: '101', url: null },
    ])
  })
  it('includes category_id param when given', async () => {
    const t = transport([])
    await getLiveStreams(t, 'http://h', 'u', 'p', '5')
    expect(t.getJson).toHaveBeenCalledWith(expect.anything(), '/player_api.php', {
      username: 'u', password: 'p', action: 'get_live_streams', category_id: '5',
    })
  })
  it('omits category_id when not given', async () => {
    const t = transport([])
    await getLiveStreams(t, 'http://h', 'u', 'p')
    expect(t.getJson).toHaveBeenCalledWith(expect.anything(), '/player_api.php', {
      username: 'u', password: 'p', action: 'get_live_streams',
    })
  })
})
```

- [ ] **Step 3: Run → RED**

Run: `npm run test -- live`
Expected: FAIL — `Cannot find module './live'`.

- [ ] **Step 4: Implement `src/core/xtream/live.ts`**

```ts
import type { XtreamTransport } from './transport'
import { buildPlayerApiParams } from './transport'
import { parseXtreamUrl, toStr } from './normalize'
import type { Category, Channel } from '@/core/content/types'

export async function getLiveCategories(
  t: XtreamTransport, url: string, username: string, password: string,
): Promise<Category[]> {
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, { action: 'get_live_categories' }))
  const arr = Array.isArray(body) ? body : []
  return arr
    .map((c) => ({ id: toStr((c as Record<string, unknown>).category_id), name: toStr((c as Record<string, unknown>).category_name) }))
    .filter((c) => c.id !== '')
}

export async function getLiveStreams(
  t: XtreamTransport, url: string, username: string, password: string, categoryId?: string,
): Promise<Channel[]> {
  const extra: Record<string, string> = { action: 'get_live_streams' }
  if (categoryId) extra.category_id = categoryId
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, extra))
  const arr = Array.isArray(body) ? body : []
  return arr
    .map((s) => {
      const r = s as Record<string, unknown>
      const streamId = toStr(r.stream_id)
      return {
        id: `x:${streamId}`,
        name: toStr(r.name),
        logo: toStr(r.stream_icon),
        categoryId: toStr(r.category_id),
        streamId: streamId || null,
        url: null as string | null,
      }
    })
    .filter((c) => c.streamId !== null)
}
```

- [ ] **Step 5: Run → GREEN, typecheck**

Run: `npm run test -- live` (pass), then `npm run typecheck` (clean).

- [ ] **Step 6: Commit**

```bash
git add src/core/content/types.ts src/core/xtream/live.ts src/core/xtream/live.test.ts
git commit -m "feat: content model + Xtream live categories/streams client"
```

---

### Task 2: M3U playlist parser

**Files:**
- Create: `src/core/content/m3u.ts`, `src/core/content/m3u.test.ts`

**Interfaces:**
- Consumes: `Category`, `Channel` (content/types.ts).
- Produces:
  - `parseM3u(text: string): { categories: Category[]; channels: Channel[] }` — parses `#EXTINF` lines + the following URL line. Per channel: name = the text after the comma (fallback `tvg-name`, else "Unnamed"); `logo` from `tvg-logo`; `categoryId` from `group-title` (fallback "Uncategorized"). Channel `id: 'm:'+index`, `streamId: null`, `url` = the stream line. Categories are the distinct `group-title` values in first-seen order.

- [ ] **Step 1: Write the failing test**

`src/core/content/m3u.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseM3u } from './m3u'

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="cnn" tvg-name="CNN" tvg-logo="http://l/cnn.png" group-title="News",CNN HD
http://s/cnn.m3u8
#EXTINF:-1 tvg-logo="http://l/bbc.png" group-title="News",BBC
http://s/bbc.ts
#EXTINF:-1 tvg-name="ESPN",ESPN
http://s/espn.m3u8
`

describe('parseM3u', () => {
  it('parses channels with name/logo/group and the stream url', () => {
    const { channels } = parseM3u(SAMPLE)
    expect(channels).toHaveLength(3)
    expect(channels[0]).toEqual({ id: 'm:0', name: 'CNN HD', logo: 'http://l/cnn.png', categoryId: 'News', streamId: null, url: 'http://s/cnn.m3u8' })
    expect(channels[1].categoryId).toBe('News')
    expect(channels[1].url).toBe('http://s/bbc.ts')
  })
  it('defaults missing group-title to Uncategorized', () => {
    const { channels } = parseM3u(SAMPLE)
    expect(channels[2].categoryId).toBe('Uncategorized')
    expect(channels[2].name).toBe('ESPN')
  })
  it('derives distinct categories in first-seen order', () => {
    const { categories } = parseM3u(SAMPLE)
    expect(categories).toEqual([{ id: 'News', name: 'News' }, { id: 'Uncategorized', name: 'Uncategorized' }])
  })
  it('tolerates blank lines, CRLF, and comments; ignores an #EXTINF with no url', () => {
    const { channels } = parseM3u('#EXTM3U\r\n\r\n#EXTINF:-1,Orphan\r\n#EXTINF:-1,Real\r\nhttp://s/x\r\n')
    expect(channels).toHaveLength(1)
    expect(channels[0].name).toBe('Real')
  })
  it('returns empty for a body with no entries', () => {
    expect(parseM3u('#EXTM3U\n')).toEqual({ categories: [], channels: [] })
  })
})
```

- [ ] **Step 2: Run → RED**

Run: `npm run test -- content/m3u`
Expected: FAIL — `Cannot find module './m3u'`.

- [ ] **Step 3: Implement `src/core/content/m3u.ts`**

```ts
import type { Category, Channel } from './types'

function attr(line: string, name: string): string {
  return new RegExp(`${name}="([^"]*)"`, 'i').exec(line)?.[1] ?? ''
}

export function parseM3u(text: string): { categories: Category[]; channels: Channel[] } {
  const channels: Channel[] = []
  const order: string[] = []
  const seen = new Set<string>()
  let pending: { name: string; logo: string; group: string } | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#EXTINF')) {
      const comma = line.indexOf(',')
      const display = comma >= 0 ? line.slice(comma + 1).trim() : ''
      const name = display || attr(line, 'tvg-name') || 'Unnamed'
      pending = { name, logo: attr(line, 'tvg-logo'), group: attr(line, 'group-title') || 'Uncategorized' }
    } else if (line !== '' && !line.startsWith('#') && pending) {
      if (!seen.has(pending.group)) { seen.add(pending.group); order.push(pending.group) }
      channels.push({
        id: `m:${channels.length}`,
        name: pending.name,
        logo: pending.logo,
        categoryId: pending.group,
        streamId: null,
        url: line,
      })
      pending = null
    }
  }

  return { categories: order.map((g) => ({ id: g, name: g })), channels }
}
```

- [ ] **Step 4: Run → GREEN, typecheck**

Run: `npm run test -- content/m3u` (pass), then `npm run typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/core/content/m3u.ts src/core/content/m3u.test.ts
git commit -m "feat: M3U playlist parser (channels grouped by group-title)"
```

---

### Task 3: Content providers (Xtream-live + M3U) + factory

**Files:**
- Create: `src/core/content/provider.ts`, `src/core/content/provider.test.ts`

**Interfaces:**
- Consumes: `Category`/`Channel` (types.ts); `getLiveCategories`/`getLiveStreams` (Task 1); `parseM3u` (Task 2); `XtreamTransport` (transport.ts); `Account` (accounts.ts).
- Produces:
  - `interface ContentProvider { getCategories(): Promise<Category[]>; getChannels(categoryId: string): Promise<Channel[]>; getAllChannels(): Promise<Channel[]> }`
  - `createXtreamLiveProvider(t, account): ContentProvider` — categories/streams via the API; `getAllChannels` caches the full (no-category) stream list.
  - `createM3uProvider(t, account): ContentProvider` — fetches + parses the playlist once (cached); serves categories/all from memory; `getChannels(catId)` filters by `categoryId`.
  - `createProvider(t: XtreamTransport, account: Account): ContentProvider` — picks by `account.type`.

- [ ] **Step 1: Write the failing test**

`src/core/content/provider.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createProvider } from './provider'
import type { XtreamTransport } from '@/core/xtream/transport'
import type { Account } from '@/core/accounts/accounts'

const XT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h:8080', username: 'u', password: 'p', createdAt: 1 }
const M3: Account = { id: 'b', type: 'm3u', name: 'M', url: 'http://host/list.m3u', username: '', password: '', createdAt: 2 }

const M3U_BODY = `#EXTM3U
#EXTINF:-1 group-title="News",CNN
http://s/cnn
#EXTINF:-1 group-title="Sports",ESPN
http://s/espn
`

function xtreamTransport(): XtreamTransport {
  return {
    getJson: vi.fn(async (_b, _p, params: Record<string, string>) => {
      if (params.action === 'get_live_categories') return [{ category_id: '1', category_name: 'News' }]
      if (params.action === 'get_live_streams') return [{ stream_id: 1, name: 'CNN', stream_icon: '', category_id: params.category_id ?? '1' }]
      return []
    }),
    fetchText: vi.fn(async () => ''),
  }
}
function m3uTransport(): XtreamTransport {
  return { getJson: vi.fn(async () => []), fetchText: vi.fn(async () => M3U_BODY) }
}

describe('createProvider — xtream', () => {
  it('fetches categories and streams via the API', async () => {
    const p = createProvider(xtreamTransport(), XT)
    expect(await p.getCategories()).toEqual([{ id: '1', name: 'News' }])
    const chans = await p.getChannels('1')
    expect(chans[0]).toMatchObject({ id: 'x:1', name: 'CNN', categoryId: '1', streamId: '1' })
  })
  it('caches getAllChannels (one API call)', async () => {
    const t = xtreamTransport()
    const p = createProvider(t, XT)
    await p.getAllChannels(); await p.getAllChannels()
    const allCalls = (t.getJson as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[2] as Record<string, string>).action === 'get_live_streams' && !(c[2] as Record<string, string>).category_id)
    expect(allCalls).toHaveLength(1)
  })
})

describe('createProvider — m3u', () => {
  it('parses the playlist and serves categories/channels from memory', async () => {
    const t = m3uTransport()
    const p = createProvider(t, M3)
    expect(await p.getCategories()).toEqual([{ id: 'News', name: 'News' }, { id: 'Sports', name: 'Sports' }])
    expect((await p.getChannels('Sports')).map((c) => c.name)).toEqual(['ESPN'])
    expect(await p.getAllChannels()).toHaveLength(2)
  })
  it('fetches + parses the playlist only once', async () => {
    const t = m3uTransport()
    const p = createProvider(t, M3)
    await p.getCategories(); await p.getAllChannels(); await p.getChannels('News')
    expect(t.fetchText).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run → RED**

Run: `npm run test -- provider`
Expected: FAIL — `Cannot find module './provider'`.

- [ ] **Step 3: Implement `src/core/content/provider.ts`**

```ts
import type { Category, Channel } from './types'
import type { XtreamTransport } from '@/core/xtream/transport'
import type { Account } from '@/core/accounts/accounts'
import { getLiveCategories, getLiveStreams } from '@/core/xtream/live'
import { parseM3u } from './m3u'

export interface ContentProvider {
  getCategories(): Promise<Category[]>
  getChannels(categoryId: string): Promise<Channel[]>
  getAllChannels(): Promise<Channel[]>
}

export function createXtreamLiveProvider(t: XtreamTransport, account: Account): ContentProvider {
  const { url, username, password } = account
  let allCache: Channel[] | null = null
  return {
    getCategories: () => getLiveCategories(t, url, username, password),
    getChannels: (categoryId) => getLiveStreams(t, url, username, password, categoryId),
    async getAllChannels() {
      if (!allCache) allCache = await getLiveStreams(t, url, username, password)
      return allCache
    },
  }
}

export function createM3uProvider(t: XtreamTransport, account: Account): ContentProvider {
  let parsed: { categories: Category[]; channels: Channel[] } | null = null
  async function ensure() {
    if (!parsed) parsed = parseM3u(await t.fetchText(account.url))
    return parsed
  }
  return {
    async getCategories() {
      return (await ensure()).categories
    },
    async getChannels(categoryId) {
      return (await ensure()).channels.filter((c) => c.categoryId === categoryId)
    },
    async getAllChannels() {
      return (await ensure()).channels
    },
  }
}

export function createProvider(t: XtreamTransport, account: Account): ContentProvider {
  return account.type === 'm3u' ? createM3uProvider(t, account) : createXtreamLiveProvider(t, account)
}
```

- [ ] **Step 4: Run → GREEN, typecheck**

Run: `npm run test -- provider` (pass), then `npm run typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/core/content/provider.ts src/core/content/provider.test.ts
git commit -m "feat: content providers for Xtream-live and M3U with a type factory"
```

---

### Task 4: Library store

**Files:**
- Create: `src/stores/library.ts`, `src/stores/library.test.ts`

**Interfaces:**
- Consumes: `createProvider`/`ContentProvider` (Task 3); `Account` (accounts.ts); `Category`/`Channel` (types.ts); `useHost` (Plan 1).
- Produces: Pinia `useLibraryStore` with state `{ accountId, categories, channelsByCat, all, loading, error }`, getter `channelsFor(categoryId)`, and actions `$configure(deps)`, `setAccount(account)`, `loadCategories()`, `loadCategory(categoryId)`, `search(query): Promise<Channel[]>`. `$configure` injects `{ makeProvider(account): ContentProvider }` for tests; the app default builds it from `useHost()`'s transport via `createProvider`.

- [ ] **Step 1: Write the failing test**

`src/stores/library.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLibraryStore } from './library'
import type { ContentProvider } from '@/core/content/provider'
import type { Account } from '@/core/accounts/accounts'
import type { Channel } from '@/core/content/types'

const ACCT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h', username: 'u', password: 'p', createdAt: 1 }
const CHANS: Channel[] = [
  { id: 'x:1', name: 'CNN', logo: '', categoryId: '1', streamId: '1', url: null },
  { id: 'x:2', name: 'BBC News', logo: '', categoryId: '1', streamId: '2', url: null },
  { id: 'x:3', name: 'ESPN', logo: '', categoryId: '2', streamId: '3', url: null },
]
function fakeProvider(): ContentProvider {
  return {
    getCategories: vi.fn(async () => [{ id: '1', name: 'News' }, { id: '2', name: 'Sports' }]),
    getChannels: vi.fn(async (catId) => CHANS.filter((c) => c.categoryId === catId)),
    getAllChannels: vi.fn(async () => CHANS),
  }
}

describe('useLibraryStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('setAccount loads categories', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => fakeProvider() })
    await s.setAccount(ACCT)
    expect(s.accountId).toBe('a')
    expect(s.categories.map((c) => c.name)).toEqual(['News', 'Sports'])
  })

  it('loadCategory caches channels and channelsFor reads them', async () => {
    const p = fakeProvider()
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => p })
    await s.setAccount(ACCT)
    await s.loadCategory('1')
    expect(s.channelsFor('1').map((c) => c.name)).toEqual(['CNN', 'BBC News'])
    await s.loadCategory('1') // cached: no second call
    expect((p.getChannels as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === '1')).toHaveLength(1)
  })

  it('search filters all channels case-insensitively by name', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => fakeProvider() })
    await s.setAccount(ACCT)
    expect((await s.search('news')).map((c) => c.name)).toEqual(['BBC News'])
    expect(await s.search('')).toEqual([])
  })

  it('switching account resets categories and cache', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => fakeProvider() })
    await s.setAccount(ACCT)
    await s.loadCategory('1')
    await s.setAccount({ ...ACCT, id: 'b' })
    expect(s.accountId).toBe('b')
    expect(s.channelsFor('1')).toEqual([])
  })

  it('setAccount(null) clears everything', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => fakeProvider() })
    await s.setAccount(ACCT)
    await s.setAccount(null)
    expect(s.accountId).toBeNull()
    expect(s.categories).toEqual([])
  })

  it('records an error when the provider throws', async () => {
    const s = useLibraryStore()
    s.$configure({ makeProvider: () => ({ getCategories: async () => { throw new Error('boom') }, getChannels: async () => [], getAllChannels: async () => [] }) })
    await s.setAccount(ACCT)
    expect(s.error).toMatch(/boom/)
  })
})
```

- [ ] **Step 2: Run → RED**

Run: `npm run test -- library`
Expected: FAIL — `Cannot find module './library'`.

- [ ] **Step 3: Implement `src/stores/library.ts`**

```ts
import { defineStore } from 'pinia'
import type { Account } from '@/core/accounts/accounts'
import type { Category, Channel } from '@/core/content/types'
import { createProvider, type ContentProvider } from '@/core/content/provider'
import { useHost } from '@/composables/useHost'

interface LibDeps { makeProvider: (account: Account) => ContentProvider }

export const useLibraryStore = defineStore('library', {
  state: () => ({
    accountId: null as string | null,
    categories: [] as Category[],
    channelsByCat: {} as Record<string, Channel[]>,
    all: null as Channel[] | null,
    loading: false,
    error: '',
    _provider: null as ContentProvider | null,
    _deps: null as LibDeps | null,
  }),
  getters: {
    channelsFor: (s) => (categoryId: string): Channel[] => s.channelsByCat[categoryId] ?? [],
  },
  actions: {
    $configure(deps: LibDeps) {
      this._deps = deps
    },
    async _factory(): Promise<LibDeps> {
      if (this._deps) return this._deps
      const { transport } = await useHost()
      this._deps = { makeProvider: (account) => createProvider(transport, account) }
      return this._deps
    },
    _reset() {
      this.categories = []
      this.channelsByCat = {}
      this.all = null
      this.error = ''
      this._provider = null
    },
    async setAccount(account: Account | null) {
      if (account?.id === this.accountId) return
      this.accountId = account?.id ?? null
      this._reset()
      if (!account) return
      const { makeProvider } = await this._factory()
      this._provider = makeProvider(account)
      await this.loadCategories()
    },
    async loadCategories() {
      if (!this._provider) return
      this.loading = true
      this.error = ''
      try {
        this.categories = await this._provider.getCategories()
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
      }
    },
    async loadCategory(categoryId: string) {
      if (!this._provider || this.channelsByCat[categoryId]) return
      this.loading = true
      this.error = ''
      try {
        this.channelsByCat = { ...this.channelsByCat, [categoryId]: await this._provider.getChannels(categoryId) }
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
      }
    },
    async search(query: string): Promise<Channel[]> {
      if (!this._provider) return []
      if (!this.all) {
        this.loading = true
        try {
          this.all = await this._provider.getAllChannels()
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e)
          this.all = []
        } finally {
          this.loading = false
        }
      }
      const q = query.trim().toLowerCase()
      if (!q) return []
      return this.all.filter((c) => c.name.toLowerCase().includes(q))
    },
  },
})
```

- [ ] **Step 4: Run → GREEN, full suite, typecheck**

Run: `npm run test -- library` (pass), then `npm run test` (full suite green), then `npm run typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/stores/library.ts src/stores/library.test.ts
git commit -m "feat: library store — provider-backed live categories, channels, search"
```

---

### Task 5: Live browsing UI — sidebar, virtual grid, search

**Files:**
- Create: `src/components/VirtualGrid.vue`, `src/components/ChannelCard.vue`, `src/views/live/LiveView.vue`
- Modify: `src/views/home/HomeView.vue`, `src/styles/app.css`, `tests/smoke.mjs`

**Interfaces:**
- Consumes: `useLibraryStore` (Task 4), `useWorkspaceStore` (`activeAccount`), `Channel` (types.ts).
- Produces: a generic `VirtualGrid` (fixed-size windowed grid, scoped slot per item), a `ChannelCard`, and `LiveView` (category sidebar + grid + search) shown by `HomeView` when an account is active.

- [ ] **Step 1: Create `src/components/VirtualGrid.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(defineProps<{ items: unknown[]; itemWidth?: number; itemHeight?: number; gap?: number }>(), {
  itemWidth: 180, itemHeight: 130, gap: 12,
})

const container = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const width = ref(0)
const height = ref(0)
let ro: ResizeObserver | null = null

function measure() {
  if (!container.value) return
  width.value = container.value.clientWidth
  height.value = container.value.clientHeight
}
function onScroll() {
  if (container.value) scrollTop.value = container.value.scrollTop
}
onMounted(() => {
  measure()
  ro = new ResizeObserver(measure)
  if (container.value) ro.observe(container.value)
})
onBeforeUnmount(() => ro?.disconnect())

const cols = computed(() => Math.max(1, Math.floor((width.value + props.gap) / (props.itemWidth + props.gap))))
const rowH = computed(() => props.itemHeight + props.gap)
const totalHeight = computed(() => Math.ceil(props.items.length / cols.value) * rowH.value)
const firstRow = computed(() => Math.max(0, Math.floor(scrollTop.value / rowH.value) - 2))
const rowsInView = computed(() => Math.ceil(height.value / rowH.value) + 4)
const start = computed(() => firstRow.value * cols.value)
const end = computed(() => Math.min(props.items.length, (firstRow.value + rowsInView.value) * cols.value))
const visible = computed(() => {
  const out: { item: unknown; index: number; top: number; left: number }[] = []
  for (let i = start.value; i < end.value; i++) {
    const r = Math.floor(i / cols.value)
    const c = i % cols.value
    out.push({ item: props.items[i], index: i, top: r * rowH.value, left: c * (props.itemWidth + props.gap) })
  }
  return out
})
</script>

<template>
  <div ref="container" class="iftv-vgrid" @scroll="onScroll">
    <div class="iftv-vgrid-inner" :style="{ height: totalHeight + 'px' }">
      <div
        v-for="v in visible"
        :key="v.index"
        class="iftv-vgrid-cell"
        :style="{ transform: `translate(${v.left}px, ${v.top}px)`, width: props.itemWidth + 'px', height: props.itemHeight + 'px' }"
      >
        <slot :item="v.item" :index="v.index" />
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `src/components/ChannelCard.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { Channel } from '@/core/content/types'

defineProps<{ channel: Channel }>()
const failed = ref(false)
</script>

<template>
  <div class="iftv-channel card h-100" :title="channel.name">
    <div class="iftv-channel-logo">
      <img v-if="channel.logo && !failed" :src="channel.logo" alt="" loading="lazy" @error="failed = true" />
      <span v-else class="iftv-channel-fallback">{{ channel.name.slice(0, 2).toUpperCase() }}</span>
    </div>
    <div class="iftv-channel-name text-truncate">{{ channel.name }}</div>
  </div>
</template>
```

- [ ] **Step 3: Create `src/views/live/LiveView.vue`**

```vue
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useLibraryStore } from '@/stores/library'
import type { Channel } from '@/core/content/types'
import VirtualGrid from '@/components/VirtualGrid.vue'
import ChannelCard from '@/components/ChannelCard.vue'

const ws = useWorkspaceStore()
const lib = useLibraryStore()

const selectedCat = ref<string | null>(null)
const query = ref('')
const results = ref<Channel[]>([])

async function syncAccount() {
  await lib.setAccount(ws.activeAccount)
  selectedCat.value = lib.categories[0]?.id ?? null
  if (selectedCat.value) await lib.loadCategory(selectedCat.value)
}
onMounted(syncAccount)
watch(() => ws.activeAccount?.id, syncAccount)

async function selectCat(id: string) {
  query.value = ''
  selectedCat.value = id
  await lib.loadCategory(id)
}

let searchSeq = 0
watch(query, async (q) => {
  const seq = ++searchSeq
  const r = await lib.search(q)
  if (seq === searchSeq) results.value = r
})

const shown = computed<Channel[]>(() =>
  query.value.trim() ? results.value : selectedCat.value ? lib.channelsFor(selectedCat.value) : [],
)
</script>

<template>
  <div class="iftv-live d-flex">
    <aside class="iftv-cats">
      <input v-model="query" class="form-control form-control-sm mb-2" placeholder="Search channels…" />
      <div v-if="lib.error" class="text-danger small">{{ lib.error }}</div>
      <ul class="list-group list-group-flush" :class="{ 'opacity-50': query.trim() }">
        <li
          v-for="c in lib.categories"
          :key="c.id"
          class="list-group-item list-group-item-action py-1"
          :class="{ active: c.id === selectedCat && !query.trim() }"
          role="button"
          @click="selectCat(c.id)"
        >
          {{ c.name }}
        </li>
      </ul>
    </aside>
    <section class="iftv-grid-wrap flex-fill">
      <p v-if="lib.loading" class="text-muted p-2">Loading…</p>
      <p v-else-if="!shown.length" class="text-muted p-2">
        {{ query.trim() ? 'No channels match.' : 'No channels here.' }}
      </p>
      <VirtualGrid v-else :items="shown">
        <template #default="{ item }">
          <ChannelCard :channel="(item as Channel)" />
        </template>
      </VirtualGrid>
    </section>
  </div>
</template>
```

- [ ] **Step 4: Replace `src/views/home/HomeView.vue`**

```vue
<script setup lang="ts">
import { useWorkspaceStore } from '@/stores/workspace'
import LiveView from '@/views/live/LiveView.vue'
const ws = useWorkspaceStore()
</script>

<template>
  <div class="h-100">
    <LiveView v-if="ws.activeAccount" />
    <div v-else>
      <h4>Welcome to InFlight TV</h4>
      <p class="text-muted">No account open. Go to <RouterLink to="/accounts">Accounts</RouterLink> to add or open one.</p>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Append styles to `src/styles/app.css`**

```css
.iftv-live { gap: 1rem; height: calc(100vh - 120px); }
.iftv-cats { width: 220px; flex: 0 0 220px; overflow-y: auto; }
.iftv-cats .list-group-item.active { background: var(--bs-primary); border-color: var(--bs-primary); }
.iftv-grid-wrap { min-width: 0; }
.iftv-vgrid { height: 100%; overflow-y: auto; position: relative; }
.iftv-vgrid-inner { position: relative; width: 100%; }
.iftv-vgrid-cell { position: absolute; top: 0; left: 0; }
.iftv-channel { align-items: center; justify-content: center; padding: 0.5rem; cursor: pointer; overflow: hidden; }
.iftv-channel-logo { height: 72px; display: flex; align-items: center; justify-content: center; }
.iftv-channel-logo img { max-height: 72px; max-width: 100%; object-fit: contain; }
.iftv-channel-fallback { font-size: 1.5rem; font-weight: 600; color: var(--bs-secondary); }
.iftv-channel-name { width: 100%; text-align: center; font-size: 0.85rem; margin-top: 0.25rem; }
```

- [ ] **Step 6: Update the smoke test (seed one Xtream account so LiveView renders)**

In `tests/smoke.mjs`, update the cockpit stub so `file.read('accounts.json'/'tabs.json')` returns a seeded account + open tab and `http().get` returns a small live payload. Replace the `COCKPIT_STUB` constant with:
```js
const COCKPIT_STUB = `
const files = {
  'accounts.json': { accounts: [{ id: 'a1', type: 'xtream', name: 'Seed', url: 'http://localhost:1/', username: 'u', password: 'p', createdAt: 1 }] },
  'tabs.json': { openTabIds: ['a1'], activeTabId: 'a1' },
};
window.cockpit = {
  user: async () => ({ home: '/tmp', name: 'test' }),
  spawn: async () => '',
  http: () => ({ get: async (path, params) => {
    if (params && params.action === 'get_live_categories') return JSON.stringify([{ category_id: '1', category_name: 'News' }]);
    if (params && params.action === 'get_live_streams') return JSON.stringify([{ stream_id: 1, name: 'Seed CNN', stream_icon: '', category_id: '1' }]);
    return '{}';
  }}),
  file: (p) => { const k = p.split('/').pop(); return { read: async () => (k in files ? files[k] : null), replace: async () => '', close() {} }; },
};`
```
Then, after the existing shell/tab-bar assertions, add:
```js
  await page.waitForSelector('input[placeholder="Search channels…"]')
  await page.waitForSelector('text=Seed CNN')
```
(Keep the `#/accounts` navigation + account-form assertions.)

- [ ] **Step 7: Typecheck, build, full suite, smoke**

Run: `npm run typecheck && npm run build && npm run test && npm run test:smoke`
Expected: clean; smoke prints `smoke OK` (the seeded account makes LiveView render "News" + "Seed CNN").

- [ ] **Step 8: Manual verification (dev mock + browser)**

With `node dev/mock-xtream.mjs` running (`http://localhost:9191` serves categories + one live channel):
- Open an **Xtream** account tab → LiveView shows the "Mock News" category and "Mock Channel One" in the grid.
- Type in **Search** → grid filters by channel name across categories; clearing search restores the category view.
- Switch tabs between accounts → the grid reloads for the newly active account.
- For an **M3U** account (add one with a real `.m3u` URL, or a small local `#EXTM3U` file) → categories come from `group-title`, channels list under them.
- Scroll a large category → only visible cards are in the DOM (virtualized).

- [ ] **Step 9: Commit**

```bash
git add src/components/VirtualGrid.vue src/components/ChannelCard.vue src/views/live/LiveView.vue \
  src/views/home/HomeView.vue src/styles/app.css tests/smoke.mjs
git commit -m "feat: live browsing UI — category sidebar, virtual grid, channel search"
```

---

## Self-Review

**Spec coverage (Plan 2 / Live TV slice):**
- Xtream live categories + streams via `cockpit.http` → Tasks 1, 3. ✓
- M3U playlist → grouped channels → Tasks 2, 3. ✓
- Unified content model (Category/Channel) feeding both account types → Task 1 + provider (Task 3). ✓
- Cached library store, lazy per-category load, account-switch reset → Task 4. ✓
- Category sidebar + virtualized grid → Task 5 (`VirtualGrid`). ✓
- Global search over live → Task 4 (`search`) + Task 5 (search box). ✓
- No playback (deferred to Plan 3): channels carry `streamId`/`url` for Plan 3 to consume; clicking does not play. ✓
- Deferred to Plan 2b: VOD + Series catalogs (reuse provider/store/grid/search patterns). Deferred to Plan 3: playback, detail views.

**Placeholder scan:** No TBD/TODO; every code step has full code. The non-unit-tested adapter behavior (`cockpit.http`/`fetchText`) is exercised by the seeded smoke test (Task 5 Step 6) and manual verification (Step 8).

**Type consistency:** `Category`/`Channel` (Task 1) are used identically in `live.ts`, `m3u.ts`, `provider.ts`, `library.ts`, and the UI. `ContentProvider` (`getCategories`/`getChannels`/`getAllChannels`) is defined in Task 3 and consumed by Task 4's store and its test's fake provider. The store's public surface (`setAccount`, `loadCategories`, `loadCategory`, `channelsFor`, `search`, `$configure`) is referenced identically in Tasks 4–5. `createProvider(transport, account)` matches the store's default factory.

**Notes:** `VirtualGrid` is a generic fixed-size windowed grid (no new dependency); it renders only the visible window, satisfying virtualization for large channel lists. Search is debounced-by-sequence in `LiveView` (stale results discarded via `searchSeq`). The store keys everything by the active account and resets on switch, so mixed Xtream/M3U accounts stay isolated.
