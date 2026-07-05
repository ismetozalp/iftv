# In-flight TV — Plan 2b: VOD + Series Browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend browsing from Live-only to **Live / VOD (movies) / Series** for Xtream accounts, reusing the category-sidebar + virtualized grid + search from Plan 2. A section selector switches between the three. M3U accounts stay Live-only (M3U has no VOD/Series structure). No playback/detail yet (Plan 3).

**Architecture:** Generalize the Plan 2 content model `Channel` → **`ContentItem`** (adds `kind`, `seriesId`, `containerExtension`) so movies/series carry the refs Plan 3 needs. Make the `ContentProvider` and `library` store **section-aware**: `createProvider(transport, account, section)` and `store.setContext(account, section)`. Add VOD/Series Xtream clients mirroring the live client. The UI generalizes `ChannelCard`→`ContentCard` and `LiveView`→`BrowseView` (a `section` prop), with a Live/VOD/Series selector in `HomeView`.

**Tech Stack:** Vue 3 (runtime-only), Vite, TypeScript, Bootstrap 5, Pinia, vue-router, Vitest, Playwright.

## Global Constraints

- Builds on `main` (Plans 1, Accounts v2, 2 merged). Package `inflighttv`; config `~/.config/cockpit/inflighttv/`.
- `src/core/**` pure (host access via injected `XtreamTransport`). Adapters may import `cockpit`.
- Content model: `ContentItem { id, kind:'live'|'movie'|'series', name, logo, categoryId, streamId:string|null, seriesId:string|null, containerExtension:string|null, url:string|null }`. `logo` holds a live logo OR a movie/series poster. Live/movie carry `streamId`; movie carries `containerExtension`; series carries `seriesId`; M3U live carries `url`. Item ids: `x:live:<id>`, `x:movie:<id>`, `x:series:<id>`, `m:<index>`.
- Section = `'live' | 'vod' | 'series'`. Xtream supports all three; M3U supports only `live` (an empty provider for vod/series).
- No playback/detail in this plan: items carry the refs (`streamId`/`containerExtension`/`seriesId`/`url`) for Plan 3; clicking does not play.
- No monolithic files; TDD; commit after every task; do not push.

---

### Task 1: Generalize `Channel` → `ContentItem` (refactor; Live still works, all tests green)

Pure rename/reshape refactor. No new user behavior. Every existing test is updated to the new shape and must pass.

**Files:**
- Modify: `src/core/content/types.ts`, `src/core/xtream/live.ts`, `src/core/xtream/live.test.ts`, `src/core/content/m3u.ts`, `src/core/content/m3u.test.ts`, `src/core/content/provider.ts`, `src/core/content/provider.test.ts`, `src/stores/library.ts`, `src/stores/library.test.ts`, `src/components/ChannelCard.vue`, `src/views/live/LiveView.vue`

**Interfaces produced:**
- `ContentItem` (replaces `Channel`); `ContentKind = 'live'|'movie'|'series'`.
- `ContentProvider { getCategories(); getItems(categoryId); getAllItems() }` (renamed from getChannels/getAllChannels).
- Store: `itemsByCat`, `itemsFor(categoryId)`, `all: ContentItem[]`, `getItems`/`getAllItems` usage.

- [ ] **Step 1: Replace `src/core/content/types.ts`**

```ts
export interface Category {
  id: string
  name: string
}

export type ContentKind = 'live' | 'movie' | 'series'

export interface ContentItem {
  id: string
  kind: ContentKind
  name: string
  logo: string // live logo or movie/series poster; '' if none
  categoryId: string
  streamId: string | null // live/movie stream id (play URL, Plan 3)
  seriesId: string | null // series id (series detail, Plan 3)
  containerExtension: string | null // movie container ext (play URL, Plan 3)
  url: string | null // M3U direct URL
}
```

- [ ] **Step 2: Replace `getLiveStreams` mapping in `src/core/xtream/live.ts`**

Change the import line `import type { Category, Channel }` → `import type { Category, ContentItem }`, change `getLiveStreams`'s return type to `Promise<ContentItem[]>`, and replace its `.map(...)` body:
```ts
    .map((s) => {
      const r = s as Record<string, unknown>
      const streamId = toStr(r.stream_id)
      return {
        id: `x:live:${streamId}`,
        kind: 'live' as const,
        name: toStr(r.name),
        logo: toStr(r.stream_icon),
        categoryId: toStr(r.category_id),
        streamId: streamId || null,
        seriesId: null,
        containerExtension: null,
        url: null as string | null,
      }
    })
    .filter((c) => c.streamId !== null)
```
(`getLiveCategories` is unchanged.)

- [ ] **Step 3: Update `src/core/xtream/live.test.ts`**

Change the `getLiveStreams` mapping test's expected object to the new shape (note the id is now `x:live:101`):
```ts
  it('maps stream fields and drops entries without a stream_id', async () => {
    const t = transport([
      { stream_id: 101, name: 'CNN', stream_icon: 'http://l/cnn.png', category_id: '1' },
      { name: 'No id', category_id: '1' },
    ])
    expect(await getLiveStreams(t, 'http://h', 'u', 'p')).toEqual([
      { id: 'x:live:101', kind: 'live', name: 'CNN', logo: 'http://l/cnn.png', categoryId: '1', streamId: '101', seriesId: null, containerExtension: null, url: null },
    ])
  })
```
(Leave the category/param tests unchanged.)

- [ ] **Step 4: Update `src/core/content/m3u.ts`** — rename `channels`→`items`, emit `ContentItem`

Change `import type { Category, Channel }` → `import type { Category, ContentItem }`, the return type to `{ categories: Category[]; items: ContentItem[] }`, and the body:
```ts
export function parseM3u(text: string): { categories: Category[]; items: ContentItem[] } {
  const items: ContentItem[] = []
  const order: string[] = []
  const seen = new Set<string>()
  let pending: { name: string; logo: string; group: string } | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#EXTINF')) {
      const name = displayName(line) || attr(line, 'tvg-name') || 'Unnamed'
      pending = { name, logo: attr(line, 'tvg-logo'), group: attr(line, 'group-title') || 'Uncategorized' }
    } else if (line !== '' && !line.startsWith('#') && pending) {
      if (!seen.has(pending.group)) { seen.add(pending.group); order.push(pending.group) }
      items.push({
        id: `m:${items.length}`,
        kind: 'live',
        name: pending.name,
        logo: pending.logo,
        categoryId: pending.group,
        streamId: null,
        seriesId: null,
        containerExtension: null,
        url: line,
      })
      pending = null
    }
  }

  return { categories: order.map((g) => ({ id: g, name: g })), items }
}
```
(`attr`/`displayName` unchanged.)

- [ ] **Step 5: Update `src/core/content/m3u.test.ts`** — destructure `items`, new shape

Replace the assertions that used `channels`:
```ts
  it('parses channels with name/logo/group and the stream url', () => {
    const { items } = parseM3u(SAMPLE)
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({ id: 'm:0', kind: 'live', name: 'CNN HD', logo: 'http://l/cnn.png', categoryId: 'News', streamId: null, seriesId: null, containerExtension: null, url: 'http://s/cnn.m3u8' })
    expect(items[1].categoryId).toBe('News')
    expect(items[1].url).toBe('http://s/bbc.ts')
  })
  it('defaults missing group-title to Uncategorized', () => {
    const { items } = parseM3u(SAMPLE)
    expect(items[2].categoryId).toBe('Uncategorized')
    expect(items[2].name).toBe('ESPN')
  })
```
In the remaining tests, replace `channels` with `items` (the "derives distinct categories" test uses `categories` — unchanged; the "tolerates blank lines…" test: `const { items } = ...; expect(items).toHaveLength(1); expect(items[0].name).toBe('Real')`; the "empty" test: `expect(parseM3u('#EXTM3U\n')).toEqual({ categories: [], items: [] })`; the comma test: `const { channels }` → `const { items }` and assert `items[0]`).

- [ ] **Step 6: Update `src/core/content/provider.ts`** — rename methods, use `items`

```ts
import type { Category, ContentItem } from './types'
import type { XtreamTransport } from '@/core/xtream/transport'
import type { Account } from '@/core/accounts/accounts'
import { getLiveCategories, getLiveStreams } from '@/core/xtream/live'
import { parseM3u } from './m3u'

export interface ContentProvider {
  getCategories(): Promise<Category[]>
  getItems(categoryId: string): Promise<ContentItem[]>
  getAllItems(): Promise<ContentItem[]>
}

export function createXtreamLiveProvider(t: XtreamTransport, account: Account): ContentProvider {
  const { url, username, password } = account
  let allCache: ContentItem[] | null = null
  return {
    getCategories: () => getLiveCategories(t, url, username, password),
    getItems: (categoryId) => getLiveStreams(t, url, username, password, categoryId),
    async getAllItems() {
      if (!allCache) allCache = await getLiveStreams(t, url, username, password)
      return allCache
    },
  }
}

export function createM3uProvider(t: XtreamTransport, account: Account): ContentProvider {
  let parsed: { categories: Category[]; items: ContentItem[] } | null = null
  async function ensure() {
    if (!parsed) parsed = parseM3u(await t.fetchText(account.url))
    return parsed
  }
  return {
    async getCategories() {
      return (await ensure()).categories
    },
    async getItems(categoryId) {
      return (await ensure()).items.filter((c) => c.categoryId === categoryId)
    },
    async getAllItems() {
      return (await ensure()).items
    },
  }
}

export function createProvider(t: XtreamTransport, account: Account): ContentProvider {
  return account.type === 'm3u' ? createM3uProvider(t, account) : createXtreamLiveProvider(t, account)
}
```

- [ ] **Step 7: Update `src/core/content/provider.test.ts`** — `getItems`/`getAllItems`, new ids

In the xtream tests: replace `p.getChannels('1')` → `p.getItems('1')`, `p.getAllChannels()` → `p.getAllItems()`, and the channel assertion `id: 'x:1'` → `id: 'x:live:1'` (i.e. `expect(chans[0]).toMatchObject({ id: 'x:live:1', name: 'CNN', categoryId: '1', streamId: '1' })`). In the m3u tests: `p.getChannels('Sports')` → `p.getItems('Sports')`, `p.getAllChannels()` → `p.getAllItems()`. The `getAllItems` cache test's filter on `get_live_streams` calls is unchanged.

- [ ] **Step 8: Update `src/stores/library.ts`** — `itemsByCat`/`itemsFor`/`getItems`/`getAllItems`, `ContentItem`

Change `import type { Category, Channel }` → `import type { Category, ContentItem }`; in state rename `channelsByCat: {} as Record<string, Channel[]>` → `itemsByCat: {} as Record<string, ContentItem[]>` and `all: null as Channel[] | null` → `all: null as ContentItem[] | null`; getter `channelsFor` → `itemsFor` returning `ContentItem[]` from `s.itemsByCat`; in `_reset()` `this.channelsByCat = {}` → `this.itemsByCat = {}`; in `loadCategory` use `this.itemsByCat[categoryId]` and `this._provider.getItems(categoryId)`; in `search` use `this._provider.getAllItems()` and return `Promise<ContentItem[]>`. (Structure/logic otherwise unchanged.)

- [ ] **Step 9: Update `src/stores/library.test.ts`** — new type + method names

Replace `import type { Channel }` → `import type { ContentItem }`; rename the `CHANS` fixture type to `ContentItem[]` and give each entry the full shape, e.g.:
```ts
const CHANS: ContentItem[] = [
  { id: 'x:live:1', kind: 'live', name: 'CNN', logo: '', categoryId: '1', streamId: '1', seriesId: null, containerExtension: null, url: null },
  { id: 'x:live:2', kind: 'live', name: 'BBC News', logo: '', categoryId: '1', streamId: '2', seriesId: null, containerExtension: null, url: null },
  { id: 'x:live:3', kind: 'live', name: 'ESPN', logo: '', categoryId: '2', streamId: '3', seriesId: null, containerExtension: null, url: null },
]
```
In `fakeProvider()` rename `getChannels`→`getItems`, `getAllChannels`→`getAllItems`. In the tests replace `s.channelsFor(...)`→`s.itemsFor(...)` and `p.getChannels`→`p.getItems`. (The error-provider test's inline object also needs `getItems`/`getAllItems`.)

- [ ] **Step 10: Update `src/components/ChannelCard.vue`** — `ContentItem` type

Change `import type { Channel }` → `import type { ContentItem }` and `defineProps<{ channel: Channel }>()` → `defineProps<{ channel: ContentItem }>()`. Template unchanged (still uses `channel.logo`/`channel.name`).

- [ ] **Step 11: Update `src/views/live/LiveView.vue`** — `ContentItem`, `itemsFor`

Change `import type { Channel }` → `import type { ContentItem }`; `results = ref<Channel[]>([])` → `ref<ContentItem[]>([])`; `lib.channelsFor(selectedCat.value)` → `lib.itemsFor(selectedCat.value)`; the `shown` computed generic `<Channel[]>` → `<ContentItem[]>`; and `:channel="(item as Channel)"` → `:channel="(item as ContentItem)"`.

- [ ] **Step 12: Full suite + typecheck + build + smoke**

Run: `npm run test && npm run typecheck && npm run build && npm run test:smoke`
Expected: all green (92 tests), `smoke OK`. This task changed shapes only — behavior (live browsing) is identical.

- [ ] **Step 13: Commit**

```bash
git add src/core/content/types.ts src/core/xtream/live.ts src/core/xtream/live.test.ts \
  src/core/content/m3u.ts src/core/content/m3u.test.ts src/core/content/provider.ts \
  src/core/content/provider.test.ts src/stores/library.ts src/stores/library.test.ts \
  src/components/ChannelCard.vue src/views/live/LiveView.vue
git commit -m "refactor: generalize Channel to ContentItem (kind/seriesId/containerExtension)"
```

---

### Task 2: VOD (movies) Xtream client

**Files:**
- Create: `src/core/xtream/vod.ts`, `src/core/xtream/vod.test.ts`

**Interfaces:**
- `getVodCategories(t, url, username, password): Promise<Category[]>` — `action=get_vod_categories`.
- `getVodStreams(t, url, username, password, categoryId?): Promise<ContentItem[]>` — `action=get_vod_streams` (+ `category_id`); maps `{stream_id, name, stream_icon, category_id, container_extension}` → `ContentItem` with `id:'x:movie:<id>'`, `kind:'movie'`, `logo:stream_icon`, `streamId:<id>`, `containerExtension`, `seriesId:null`, `url:null`; drops empty streamId.

- [ ] **Step 1: Write the failing test**

`src/core/xtream/vod.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { getVodCategories, getVodStreams } from './vod'
import type { XtreamTransport } from './transport'

function transport(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload), fetchText: vi.fn(async () => '') }
}

describe('getVodCategories', () => {
  it('maps categories and calls get_vod_categories', async () => {
    const t = transport([{ category_id: '10', category_name: 'Action' }])
    expect(await getVodCategories(t, 'http://h:8080', 'u', 'p')).toEqual([{ id: '10', name: 'Action' }])
    expect(t.getJson).toHaveBeenCalledWith({ scheme: 'http', host: 'h', port: 8080 }, '/player_api.php', { username: 'u', password: 'p', action: 'get_vod_categories' })
  })
})

describe('getVodStreams', () => {
  it('maps movie fields incl. container_extension, drops empty stream_id', async () => {
    const t = transport([
      { stream_id: 55, name: 'The Movie', stream_icon: 'http://p/m.jpg', category_id: '10', container_extension: 'mp4' },
      { name: 'no id', category_id: '10' },
    ])
    expect(await getVodStreams(t, 'http://h', 'u', 'p')).toEqual([
      { id: 'x:movie:55', kind: 'movie', name: 'The Movie', logo: 'http://p/m.jpg', categoryId: '10', streamId: '55', seriesId: null, containerExtension: 'mp4', url: null },
    ])
  })
  it('includes category_id param when given; omits otherwise', async () => {
    const t = transport([])
    await getVodStreams(t, 'http://h', 'u', 'p', '10')
    expect(t.getJson).toHaveBeenCalledWith(expect.anything(), '/player_api.php', { username: 'u', password: 'p', action: 'get_vod_streams', category_id: '10' })
    await getVodStreams(t, 'http://h', 'u', 'p')
    expect(t.getJson).toHaveBeenLastCalledWith(expect.anything(), '/player_api.php', { username: 'u', password: 'p', action: 'get_vod_streams' })
  })
  it('returns [] for a non-array body', async () => {
    expect(await getVodStreams(transport(null), 'http://h', 'u', 'p')).toEqual([])
  })
})
```

- [ ] **Step 2: Run → RED** — `npm run test -- vod` → `Cannot find module './vod'`.

- [ ] **Step 3: Implement `src/core/xtream/vod.ts`**

```ts
import type { XtreamTransport } from './transport'
import { buildPlayerApiParams } from './transport'
import { parseXtreamUrl, toStr } from './normalize'
import type { Category, ContentItem } from '@/core/content/types'

export async function getVodCategories(
  t: XtreamTransport, url: string, username: string, password: string,
): Promise<Category[]> {
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, { action: 'get_vod_categories' }))
  const arr = Array.isArray(body) ? body : []
  return arr
    .map((c) => ({ id: toStr((c as Record<string, unknown>).category_id), name: toStr((c as Record<string, unknown>).category_name) }))
    .filter((c) => c.id !== '')
}

export async function getVodStreams(
  t: XtreamTransport, url: string, username: string, password: string, categoryId?: string,
): Promise<ContentItem[]> {
  const extra: Record<string, string> = { action: 'get_vod_streams' }
  if (categoryId) extra.category_id = categoryId
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, extra))
  const arr = Array.isArray(body) ? body : []
  return arr
    .map((s) => {
      const r = s as Record<string, unknown>
      const streamId = toStr(r.stream_id)
      const ext = toStr(r.container_extension)
      return {
        id: `x:movie:${streamId}`,
        kind: 'movie' as const,
        name: toStr(r.name),
        logo: toStr(r.stream_icon),
        categoryId: toStr(r.category_id),
        streamId: streamId || null,
        seriesId: null,
        containerExtension: ext || null,
        url: null as string | null,
      }
    })
    .filter((c) => c.streamId !== null)
}
```

- [ ] **Step 4: Run → GREEN + typecheck** — `npm run test -- vod` (pass), `npm run typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/core/xtream/vod.ts src/core/xtream/vod.test.ts
git commit -m "feat: Xtream VOD categories/streams client"
```

---

### Task 3: Series Xtream client

**Files:**
- Create: `src/core/xtream/series.ts`, `src/core/xtream/series.test.ts`

**Interfaces:**
- `getSeriesCategories(t, url, username, password): Promise<Category[]>` — `action=get_series_categories`.
- `getSeries(t, url, username, password, categoryId?): Promise<ContentItem[]>` — `action=get_series` (+ `category_id`); maps `{series_id, name, cover, category_id}` → `ContentItem` with `id:'x:series:<id>'`, `kind:'series'`, `logo:cover`, `seriesId:<id>`, `streamId:null`, `containerExtension:null`, `url:null`; drops empty seriesId.

- [ ] **Step 1: Write the failing test**

`src/core/xtream/series.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { getSeriesCategories, getSeries } from './series'
import type { XtreamTransport } from './transport'

function transport(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload), fetchText: vi.fn(async () => '') }
}

describe('getSeriesCategories', () => {
  it('maps categories and calls get_series_categories', async () => {
    const t = transport([{ category_id: '20', category_name: 'Drama' }])
    expect(await getSeriesCategories(t, 'http://h:8080', 'u', 'p')).toEqual([{ id: '20', name: 'Drama' }])
    expect(t.getJson).toHaveBeenCalledWith({ scheme: 'http', host: 'h', port: 8080 }, '/player_api.php', { username: 'u', password: 'p', action: 'get_series_categories' })
  })
})

describe('getSeries', () => {
  it('maps series fields (cover→logo, series_id→seriesId), drops empty series_id', async () => {
    const t = transport([
      { series_id: 77, name: 'The Show', cover: 'http://p/s.jpg', category_id: '20' },
      { name: 'no id', category_id: '20' },
    ])
    expect(await getSeries(t, 'http://h', 'u', 'p')).toEqual([
      { id: 'x:series:77', kind: 'series', name: 'The Show', logo: 'http://p/s.jpg', categoryId: '20', streamId: null, seriesId: '77', containerExtension: null, url: null },
    ])
  })
  it('includes category_id param when given; omits otherwise', async () => {
    const t = transport([])
    await getSeries(t, 'http://h', 'u', 'p', '20')
    expect(t.getJson).toHaveBeenCalledWith(expect.anything(), '/player_api.php', { username: 'u', password: 'p', action: 'get_series', category_id: '20' })
    await getSeries(t, 'http://h', 'u', 'p')
    expect(t.getJson).toHaveBeenLastCalledWith(expect.anything(), '/player_api.php', { username: 'u', password: 'p', action: 'get_series' })
  })
  it('returns [] for a non-array body', async () => {
    expect(await getSeries(transport(null), 'http://h', 'u', 'p')).toEqual([])
  })
})
```

- [ ] **Step 2: Run → RED** — `npm run test -- series` → `Cannot find module './series'`.

- [ ] **Step 3: Implement `src/core/xtream/series.ts`**

```ts
import type { XtreamTransport } from './transport'
import { buildPlayerApiParams } from './transport'
import { parseXtreamUrl, toStr } from './normalize'
import type { Category, ContentItem } from '@/core/content/types'

export async function getSeriesCategories(
  t: XtreamTransport, url: string, username: string, password: string,
): Promise<Category[]> {
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, { action: 'get_series_categories' }))
  const arr = Array.isArray(body) ? body : []
  return arr
    .map((c) => ({ id: toStr((c as Record<string, unknown>).category_id), name: toStr((c as Record<string, unknown>).category_name) }))
    .filter((c) => c.id !== '')
}

export async function getSeries(
  t: XtreamTransport, url: string, username: string, password: string, categoryId?: string,
): Promise<ContentItem[]> {
  const extra: Record<string, string> = { action: 'get_series' }
  if (categoryId) extra.category_id = categoryId
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, extra))
  const arr = Array.isArray(body) ? body : []
  return arr
    .map((s) => {
      const r = s as Record<string, unknown>
      const seriesId = toStr(r.series_id)
      return {
        id: `x:series:${seriesId}`,
        kind: 'series' as const,
        name: toStr(r.name),
        logo: toStr(r.cover),
        categoryId: toStr(r.category_id),
        streamId: null,
        seriesId: seriesId || null,
        containerExtension: null,
        url: null as string | null,
      }
    })
    .filter((c) => c.seriesId !== null)
}
```

- [ ] **Step 4: Run → GREEN + typecheck** — `npm run test -- series` (pass), `npm run typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/core/xtream/series.ts src/core/xtream/series.test.ts
git commit -m "feat: Xtream Series categories/list client"
```

---

### Task 4: Section-aware provider + library store

**Files:**
- Modify: `src/core/content/provider.ts`, `src/core/content/provider.test.ts`, `src/stores/library.ts`, `src/stores/library.test.ts`, `src/views/live/LiveView.vue`

**Interfaces:**
- `Section = 'live' | 'vod' | 'series'`.
- `createProvider(t, account, section): ContentProvider` — Xtream: section-specific client; M3U: `live` → parsed playlist, `vod`/`series` → empty provider.
- Store: state gains `section`; `setContext(account, section)` (rebuilds provider when account OR section changes). `LibDeps.makeProvider(account, section)`.

- [ ] **Step 1: Make the provider section-aware — edit `src/core/content/provider.ts`**

Add imports and a `Section` type + `createXtreamProvider`; replace `createXtreamLiveProvider` with a generic section version and update `createProvider`:
```ts
import type { Category, ContentItem } from './types'
import type { XtreamTransport } from '@/core/xtream/transport'
import type { Account } from '@/core/accounts/accounts'
import { getLiveCategories, getLiveStreams } from '@/core/xtream/live'
import { getVodCategories, getVodStreams } from '@/core/xtream/vod'
import { getSeriesCategories, getSeries } from '@/core/xtream/series'
import { parseM3u } from './m3u'

export type Section = 'live' | 'vod' | 'series'

export interface ContentProvider {
  getCategories(): Promise<Category[]>
  getItems(categoryId: string): Promise<ContentItem[]>
  getAllItems(): Promise<ContentItem[]>
}

type Cats = (t: XtreamTransport, url: string, u: string, p: string) => Promise<Category[]>
type Items = (t: XtreamTransport, url: string, u: string, p: string, categoryId?: string) => Promise<ContentItem[]>

function xtreamSection(section: Section): { cats: Cats; items: Items } {
  if (section === 'vod') return { cats: getVodCategories, items: getVodStreams }
  if (section === 'series') return { cats: getSeriesCategories, items: getSeries }
  return { cats: getLiveCategories, items: getLiveStreams }
}

export function createXtreamProvider(t: XtreamTransport, account: Account, section: Section): ContentProvider {
  const { url, username, password } = account
  const { cats, items } = xtreamSection(section)
  let allCache: ContentItem[] | null = null
  return {
    getCategories: () => cats(t, url, username, password),
    getItems: (categoryId) => items(t, url, username, password, categoryId),
    async getAllItems() {
      if (!allCache) allCache = await items(t, url, username, password)
      return allCache
    },
  }
}

export function createM3uProvider(t: XtreamTransport, account: Account): ContentProvider {
  let parsed: { categories: Category[]; items: ContentItem[] } | null = null
  async function ensure() {
    if (!parsed) parsed = parseM3u(await t.fetchText(account.url))
    return parsed
  }
  return {
    async getCategories() {
      return (await ensure()).categories
    },
    async getItems(categoryId) {
      return (await ensure()).items.filter((c) => c.categoryId === categoryId)
    },
    async getAllItems() {
      return (await ensure()).items
    },
  }
}

const EMPTY_PROVIDER: ContentProvider = {
  getCategories: async () => [],
  getItems: async () => [],
  getAllItems: async () => [],
}

export function createProvider(t: XtreamTransport, account: Account, section: Section): ContentProvider {
  if (account.type === 'm3u') return section === 'live' ? createM3uProvider(t, account) : EMPTY_PROVIDER
  return createXtreamProvider(t, account, section)
}
```
(Remove the old `createXtreamLiveProvider` export — replaced by `createXtreamProvider`.)

- [ ] **Step 2: Update `src/core/content/provider.test.ts`** — pass a section, add vod/series + m3u-empty cases

Update every `createProvider(t, XT)` → `createProvider(t, XT, 'live')` and `createProvider(t, M3)` → `createProvider(t, M3, 'live')`. The `xtreamTransport()` fake already returns live payloads for the live actions; extend it to also answer vod/series so the new cases work:
```ts
function xtreamTransport(): XtreamTransport {
  return {
    getJson: vi.fn(async (_b, _p, params: Record<string, string>) => {
      if (params.action === 'get_live_categories') return [{ category_id: '1', category_name: 'News' }]
      if (params.action === 'get_live_streams') return [{ stream_id: 1, name: 'CNN', stream_icon: '', category_id: params.category_id ?? '1' }]
      if (params.action === 'get_vod_categories') return [{ category_id: '10', category_name: 'Action' }]
      if (params.action === 'get_vod_streams') return [{ stream_id: 5, name: 'Film', stream_icon: '', category_id: '10', container_extension: 'mkv' }]
      if (params.action === 'get_series_categories') return [{ category_id: '20', category_name: 'Drama' }]
      if (params.action === 'get_series') return [{ series_id: 9, name: 'Show', cover: '', category_id: '20' }]
      return []
    }),
    fetchText: vi.fn(async () => M3U_BODY),
  }
}
```
Add these tests:
```ts
describe('createProvider — xtream sections', () => {
  it('vod section fetches movies with container_extension', async () => {
    const p = createProvider(xtreamTransport(), XT, 'vod')
    expect(await p.getCategories()).toEqual([{ id: '10', name: 'Action' }])
    expect((await p.getItems('10'))[0]).toMatchObject({ id: 'x:movie:5', kind: 'movie', containerExtension: 'mkv', seriesId: null })
  })
  it('series section fetches series with seriesId', async () => {
    const p = createProvider(xtreamTransport(), XT, 'series')
    expect(await p.getCategories()).toEqual([{ id: '20', name: 'Drama' }])
    expect((await p.getItems('20'))[0]).toMatchObject({ id: 'x:series:9', kind: 'series', seriesId: '9', streamId: null })
  })
})

describe('createProvider — m3u non-live', () => {
  it('returns an empty provider for vod/series on an m3u account', async () => {
    const t = m3uTransport()
    const vod = createProvider(t, M3, 'vod')
    expect(await vod.getCategories()).toEqual([])
    expect(await vod.getAllItems()).toEqual([])
    expect(t.fetchText).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Update `src/stores/library.ts`** — add `section` + `setContext`

Change imports to include `Section`; add `section` + `_account` to state; replace `setAccount` with `setContext`; update `_factory`/`makeProvider` to take a section:
```ts
import type { Account } from '@/core/accounts/accounts'
import type { Category, ContentItem } from '@/core/content/types'
import { createProvider, type ContentProvider, type Section } from '@/core/content/provider'
import { useHost } from '@/composables/useHost'

interface LibDeps { makeProvider: (account: Account, section: Section) => ContentProvider }
```
In `state()` add: `section: 'live' as Section,` and `_account: null as Account | null,`. Update `_factory`:
```ts
    async _factory(): Promise<LibDeps> {
      if (this._deps) return this._deps
      const { transport } = await useHost()
      this._deps = { makeProvider: (account, section) => createProvider(transport, account, section) }
      return this._deps
    },
```
Replace `setAccount` with:
```ts
    async setContext(account: Account | null, section: Section) {
      if (account?.id === this.accountId && section === this.section) return
      this.accountId = account?.id ?? null
      this.section = section
      this._account = account
      this._reset()
      if (!account) return
      const { makeProvider } = await this._factory()
      this._provider = makeProvider(account, section)
      await this.loadCategories()
    },
```
(Keep `loadCategories`/`loadCategory`/`search`/`_reset` unchanged from Task 1's item-generic versions.)

- [ ] **Step 4: Update `src/stores/library.test.ts`** — `setContext(account, 'live')` + a section-switch test

Replace every `s.setAccount(ACCT)` → `s.setContext(ACCT, 'live')` and `s.setAccount(null)` → `s.setContext(null, 'live')`; `s.setAccount({ ...ACCT, id: 'b' })` → `s.setContext({ ...ACCT, id: 'b' }, 'live')`; and `makeProvider: () => fakeProvider()` → `makeProvider: (_account, _section) => fakeProvider()`. Add a section-switch reset test:
```ts
  it('switching section resets and rebuilds', async () => {
    const s = useLibraryStore()
    let built = 0
    s.$configure({ makeProvider: () => { built++; return fakeProvider() } })
    await s.setContext(ACCT, 'live')
    await s.loadCategory('1')
    await s.setContext(ACCT, 'vod')
    expect(s.section).toBe('vod')
    expect(s.itemsFor('1')).toEqual([])
    expect(built).toBe(2)
  })
```

- [ ] **Step 5: Update `src/views/live/LiveView.vue`** — call `setContext`

Change `await lib.setAccount(ws.activeAccount)` → `await lib.setContext(ws.activeAccount, 'live')`. (LiveView is still Live-only; Task 5 replaces it with the section-aware BrowseView.)

- [ ] **Step 6: Full suite + typecheck + build + smoke**

Run: `npm run test && npm run typecheck && npm run build && npm run test:smoke`
Expected: all green; `smoke OK`.

- [ ] **Step 7: Commit**

```bash
git add src/core/content/provider.ts src/core/content/provider.test.ts src/stores/library.ts \
  src/stores/library.test.ts src/views/live/LiveView.vue
git commit -m "feat: section-aware content provider and library store (live/vod/series)"
```

---

### Task 5: UI — section selector + generalized card/view

**Files:**
- Create: `src/components/ContentCard.vue`, `src/views/browse/BrowseView.vue`
- Modify: `src/views/home/HomeView.vue`, `src/styles/app.css`, `tests/smoke.mjs`
- Delete: `src/components/ChannelCard.vue`, `src/views/live/LiveView.vue` (replaced)

**Interfaces:**
- `ContentCard { item: ContentItem }` — poster/logo per kind (portrait for movie/series, contained logo for live).
- `BrowseView { section: Section }` — the Plan 2 LiveView generalized: sidebar + grid + search bound to `lib.setContext(activeAccount, section)`; grid item size adapts (live landscape vs movie/series portrait).
- `HomeView` — a Live/VOD/Series selector (VOD/Series hidden for m3u accounts) + `BrowseView` for the chosen section.

- [ ] **Step 1: Create `src/components/ContentCard.vue`**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ContentItem } from '@/core/content/types'

const props = defineProps<{ item: ContentItem }>()
const failed = ref(false)
watch(() => props.item.id, () => { failed.value = false })
</script>

<template>
  <div class="iftv-card card h-100" :class="`iftv-card-${item.kind}`" :title="item.name">
    <div class="iftv-card-img">
      <img v-if="item.logo && !failed" :src="item.logo" alt="" loading="lazy" @error="failed = true" />
      <span v-else class="iftv-card-fallback">{{ item.name.slice(0, 2).toUpperCase() }}</span>
    </div>
    <div class="iftv-card-name text-truncate">{{ item.name }}</div>
  </div>
</template>
```

- [ ] **Step 2: Create `src/views/browse/BrowseView.vue`** (generalized from LiveView)

```vue
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useLibraryStore } from '@/stores/library'
import type { ContentItem } from '@/core/content/types'
import type { Section } from '@/core/content/provider'
import VirtualGrid from '@/components/VirtualGrid.vue'
import ContentCard from '@/components/ContentCard.vue'

const props = defineProps<{ section: Section }>()
const ws = useWorkspaceStore()
const lib = useLibraryStore()

const selectedCat = ref<string | null>(null)
const query = ref('')
const results = ref<ContentItem[]>([])

const gridDims = computed(() =>
  props.section === 'live' ? { itemWidth: 180, itemHeight: 130 } : { itemWidth: 150, itemHeight: 230 },
)
const searchPlaceholder = computed(() =>
  props.section === 'vod' ? 'Search movies…' : props.section === 'series' ? 'Search series…' : 'Search channels…',
)

let syncSeq = 0
async function sync() {
  const seq = ++syncSeq
  query.value = ''
  results.value = []
  await lib.setContext(ws.activeAccount, props.section)
  if (seq !== syncSeq) return
  selectedCat.value = lib.categories[0]?.id ?? null
  if (selectedCat.value) await lib.loadCategory(selectedCat.value)
}
onMounted(sync)
watch(() => [ws.activeAccount?.id, props.section], sync)

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

const shown = computed<ContentItem[]>(() =>
  query.value.trim() ? results.value : selectedCat.value ? lib.itemsFor(selectedCat.value) : [],
)
</script>

<template>
  <div class="iftv-live d-flex">
    <aside class="iftv-cats">
      <input v-model="query" class="form-control form-control-sm mb-2" :placeholder="searchPlaceholder" />
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
        {{ query.trim() ? 'Nothing matches.' : 'Nothing here.' }}
      </p>
      <VirtualGrid v-else :items="shown" :item-width="gridDims.itemWidth" :item-height="gridDims.itemHeight">
        <template #default="{ item }">
          <ContentCard :item="(item as ContentItem)" />
        </template>
      </VirtualGrid>
    </section>
  </div>
</template>
```

- [ ] **Step 3: Replace `src/views/home/HomeView.vue`** with a section selector

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import type { Section } from '@/core/content/provider'
import BrowseView from '@/views/browse/BrowseView.vue'

const ws = useWorkspaceStore()
const section = ref<Section>('live')

// M3U accounts only have live; force back to live when the active account is m3u.
const sections = computed<{ id: Section; label: string }[]>(() =>
  ws.activeAccount?.type === 'm3u'
    ? [{ id: 'live', label: 'Live TV' }]
    : [{ id: 'live', label: 'Live TV' }, { id: 'vod', label: 'Movies' }, { id: 'series', label: 'Series' }],
)
watch(() => ws.activeAccount?.id, () => {
  if (!sections.value.some((s) => s.id === section.value)) section.value = 'live'
})
</script>

<template>
  <div class="h-100 d-flex flex-column">
    <template v-if="ws.activeAccount">
      <nav class="btn-group btn-group-sm mb-2 align-self-start" role="group">
        <button
          v-for="s in sections"
          :key="s.id"
          type="button"
          class="btn"
          :class="s.id === section ? 'btn-primary' : 'btn-outline-primary'"
          @click="section = s.id"
        >
          {{ s.label }}
        </button>
      </nav>
      <BrowseView :section="section" class="flex-fill" />
    </template>
    <div v-else>
      <h4>Welcome to InFlight TV</h4>
      <p class="text-muted">No account open. Go to <RouterLink to="/accounts">Accounts</RouterLink> to add or open one.</p>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Append poster/card styles to `src/styles/app.css`**

Replace the existing `.iftv-channel*` rules (from Plan 2) with generalized `.iftv-card*` rules (append these; the old `.iftv-channel*` rules can be left or removed — they're now unused):
```css
.iftv-card { align-items: center; justify-content: center; padding: 0.4rem; cursor: pointer; overflow: hidden; }
.iftv-card-img { flex: 1; width: 100%; display: flex; align-items: center; justify-content: center; min-height: 0; }
.iftv-card-img img { max-height: 100%; max-width: 100%; object-fit: contain; }
.iftv-card-live .iftv-card-img img { object-fit: contain; }
.iftv-card-movie .iftv-card-img img, .iftv-card-series .iftv-card-img img { object-fit: cover; height: 100%; width: 100%; border-radius: 4px; }
.iftv-card-fallback { font-size: 1.4rem; font-weight: 600; color: var(--bs-secondary); }
.iftv-card-name { width: 100%; text-align: center; font-size: 0.82rem; margin-top: 0.25rem; }
```

- [ ] **Step 5: Delete the replaced files**

```bash
git rm src/components/ChannelCard.vue src/views/live/LiveView.vue
```

- [ ] **Step 6: Update `tests/smoke.mjs`** — seed vod too and assert the section selector

Extend the stub's `http().get` to answer vod actions, and add assertions for the "Movies" section button and a movie after clicking it. In the `COCKPIT_STUB`'s `http().get`, add before the final `return '{}'`:
```js
    if (params && params.action === 'get_vod_categories') return JSON.stringify([{ category_id: '10', category_name: 'Films' }]);
    if (params && params.action === 'get_vod_streams') return JSON.stringify([{ stream_id: 5, name: 'Seed Movie', stream_icon: '', category_id: '10', container_extension: 'mp4' }]);
```
After the existing `text=Seed CNN` assertion, add:
```js
  await page.click('text=Movies')
  await page.waitForSelector('text=Seed Movie')
```

- [ ] **Step 7: Typecheck, build, full suite, smoke**

Run: `npm run typecheck && npm run build && npm run test && npm run test:smoke`
Expected: all green; `smoke OK` (seeded account renders Live "Seed CNN", switching to Movies renders "Seed Movie").

- [ ] **Step 8: Manual verification (dev mock + browser)**

The dev mock (`node dev/mock-xtream.mjs`) currently answers only live actions. It's enough to confirm Live still works and the section selector renders; VOD/Series against the mock will show "Nothing here." (mock returns `[]` for vod/series categories). For real VOD/Series, use a real Xtream account:
- Live/VOD/Series buttons switch sections; each shows its categories + grid; movies/series render as portrait posters, live as logos.
- Search within each section filters that section's items.
- An **M3U** account shows only the Live button.
- Switching account tabs reloads the current section.

- [ ] **Step 9: Commit**

```bash
git add src/components/ContentCard.vue src/views/browse/BrowseView.vue src/views/home/HomeView.vue \
  src/styles/app.css tests/smoke.mjs
git commit -m "feat: Live/VOD/Series section selector with poster grid (ContentCard/BrowseView)"
```

---

## Self-Review

**Spec coverage (Plan 2b):**
- VOD categories/streams via `cockpit.http` → Task 2 (client) + Task 4 (provider). ✓
- Series categories/list → Task 3 + Task 4. ✓
- Unified `ContentItem` carrying `kind`/`streamId`/`seriesId`/`containerExtension` for Plan 3 → Task 1. ✓
- Section-aware provider + store reusing lazy-load/cache/search → Task 4. ✓
- Live/VOD/Series selector + poster grid reusing VirtualGrid/search → Task 5. ✓
- M3U stays Live-only (empty provider for vod/series; selector hides them) → Tasks 4, 5. ✓
- No playback/detail (Plan 3): items carry refs; clicking is inert. ✓
- Deferred to Plan 3: movie/series detail (get_vod_info/get_series_info), seasons/episodes, playback.

**Placeholder scan:** No TBD/TODO; every code step has full code. Task 1 is a pure refactor keeping all existing tests green; adapters/real-cockpit path is exercised by the seeded smoke test (Task 5).

**Type consistency:** `ContentItem` (Task 1) is used across live/vod/series clients, m3u, provider, store, and UI. `ContentProvider.getItems/getAllItems` (Task 1) and `Section` + `createProvider(t, account, section)` (Task 4) are referenced identically in the store and its tests. `store.setContext(account, section)` (Task 4) is called by `BrowseView` (Task 5). `getVodStreams`/`getSeries` signatures match the `Items` type the provider's `xtreamSection` expects. Item ids are namespaced by kind (`x:live:` / `x:movie:` / `x:series:` / `m:`), so no cross-kind collisions.

**Notes:** VirtualGrid item size is passed per section (portrait for movie/series). The library store rebuilds its provider whenever account OR section changes (single-context; no cross-section cache — acceptable, categories lists are small). The known Plan 2 deferrals (provider/store concurrency race under very rapid switches) still apply and are unchanged by this plan.
