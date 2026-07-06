# In-flight TV — Plan 4: Personal Library

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Favorites, custom Lists, Watch Later (filter/search/sort), Continue Watching (auto-resume), and History — local, account-scoped, no system deps.

**Architecture:** Pure immutable data ops in `core/library/` (timestamps passed in). A Pinia **`collections`** store (JsonStore-backed `library.json`) applies each op + persists. UI: a **★ Library** tab in the Home selector with sub-tabs; a ★/＋ affordance on `ContentCard` + detail views. Continue Watching + History auto-tracked via `PlayerView` hooks; resume via a new `player.play` offset param.

**Tech Stack:** unchanged (Vue3/Vite/TS/Bootstrap/Pinia/Vitest).

## Global Constraints
- Builds on `main` (Plan 3e merged). `src/core/**` pure/DI; cockpit in adapters. TDD; per-task commit; merge to `main`.
- Pure ops take a `now: number` param wherever a timestamp is stored (Date.now() is unavailable in the pure layer / tests pass fixed values); the store passes `Date.now()`.
- Store `collections` (NOT `library` — that name is the existing content-browse store).
- Item identity = `accountId` + `item.id`. Snapshots stored so entries render without the browse cache.
- Bound growth: `history` cap 300 newest, `continueWatching` cap 100 newest.

## File Structure
- `src/core/library/types.ts` — interfaces. NEW
- `src/core/library/library.ts` — pure ops + watch-later filter/sort. NEW (+test)
- `src/stores/collections.ts` — Pinia store. NEW (+test)
- `src/App.vue` — `collections.load()` on mount.
- `src/components/ContentCard.vue` — ★ + "＋ Add to…" menu; optional `removable` context.
- `src/views/detail/MovieDetail.vue`, `SeriesDetail.vue` — ★ + Add-to actions.
- `src/views/library/LibraryView.vue` — sub-tab shell + all sub-views. NEW
- `src/views/home/HomeView.vue` — ★ Library selector button.
- `src/stores/player.ts` — `play` opts `startOffsetSeconds`.
- `src/components/PlayerView.vue` — history + progress hooks.

---

### Task 1: Data model + pure ops + `collections` store

**Files:** Create `src/core/library/types.ts`, `src/core/library/library.ts` (+ `library.test.ts`), `src/stores/collections.ts` (+ `collections.test.ts`); modify `src/App.vue`.

**Produces:** the interfaces from the spec; pure ops `emptyLibrary()`, `isFavorite(d, accountId, itemId)`, `toggleFavorite(d, account, item, now)`, `addWatchLater(d, account, item, now)`, `removeWatchLater(d, accountId, itemId)`, `createList(d, name, now)`, `renameList(d, listId, name)`, `deleteList(d, listId)`, `addToList(d, listId, account, item, now)`, `removeFromList(d, listId, itemId, accountId)`, `upsertProgress(d, account, item, offset, duration, now)`, `removeProgress(d, accountId, itemId)`, `recordHistory(d, account, item, now)`, `clearHistory(d)`, `filterSortWatchLater(entries, opts)`; `useCollectionsStore`.

- [ ] **Step 1 — types** `src/core/library/types.ts`:
```ts
import type { ContentItem } from '@/core/content/types'
export interface LibraryEntry { item: ContentItem; accountId: string; addedAt: number }
export interface LibraryList { id: string; name: string; createdAt: number; entries: LibraryEntry[] }
export interface ProgressEntry { item: ContentItem; accountId: string; offsetSeconds: number; durationSeconds: number | null; updatedAt: number }
export interface HistoryEntry { item: ContentItem; accountId: string; watchedAt: number }
export interface LibraryData { favorites: LibraryEntry[]; watchLater: LibraryEntry[]; lists: LibraryList[]; continueWatching: ProgressEntry[]; history: HistoryEntry[] }
```
- [ ] **Step 2 — failing test** `library.test.ts` (representative — cover every op):
```ts
import { emptyLibrary, toggleFavorite, isFavorite, addWatchLater, createList, addToList, upsertProgress, recordHistory, filterSortWatchLater } from './library'
const A = { id: 'acc1' } as any
const movie = { id: 'x:movie:9', kind: 'movie', name: 'Zed Film' } as any
const ep = { id: 'x:episode:3', kind: 'episode', name: 'Ep' } as any

it('toggleFavorite adds then removes, newest first, immutable', () => {
  const d0 = emptyLibrary()
  const d1 = toggleFavorite(d0, A, movie, 100)
  expect(isFavorite(d1, 'acc1', 'x:movie:9')).toBe(true)
  expect(d1.favorites[0]).toMatchObject({ accountId: 'acc1', addedAt: 100 })
  expect(d0.favorites.length).toBe(0) // original untouched
  expect(isFavorite(toggleFavorite(d1, A, movie, 200), 'acc1', 'x:movie:9')).toBe(false)
})
it('lists: create, add, dedup', () => {
  let d = createList(emptyLibrary(), 'Weekend', 1)
  const id = d.lists[0].id
  d = addToList(d, id, A, movie, 2); d = addToList(d, id, A, movie, 3) // dedup
  expect(d.lists[0].entries.length).toBe(1)
})
it('upsertProgress dedups, drops at >=92% watched, caps 100', () => {
  let d = upsertProgress(emptyLibrary(), A, movie, 600, 5400, 1) // 11%
  expect(d.continueWatching.length).toBe(1)
  d = upsertProgress(d, A, movie, 1200, 5400, 2) // same item → update
  expect(d.continueWatching.length).toBe(1); expect(d.continueWatching[0].offsetSeconds).toBe(1200)
  d = upsertProgress(d, A, movie, 5100, 5400, 3) // 94% → finished, dropped
  expect(d.continueWatching.length).toBe(0)
})
it('recordHistory prepends, dedups consecutive same item, caps 300', () => {
  let d = recordHistory(emptyLibrary(), A, movie, 1)
  d = recordHistory(d, A, movie, 2) // consecutive same → still one
  expect(d.history.length).toBe(1); expect(d.history[0].watchedAt).toBe(2)
})
it('filterSortWatchLater: kind filter + search + sort', () => {
  const entries = [{ item: movie, accountId: 'acc1', addedAt: 2 }, { item: ep, accountId: 'acc1', addedAt: 1 }] as any
  expect(filterSortWatchLater(entries, { kind: 'movie', query: '', sort: 'added' })).toHaveLength(1)
  expect(filterSortWatchLater(entries, { kind: 'all', query: 'zed', sort: 'added' })).toHaveLength(1)
  expect(filterSortWatchLater(entries, { kind: 'all', query: '', sort: 'name' })[0].item.name).toBe('Ep')
})
```
- [ ] **Step 3 — run FAIL.** `npm run test -- library`
- [ ] **Step 4 — implement `library.ts`** — pure, immutable. Key details: identity match `e.accountId===accountId && e.item.id===itemId`; `toggleFavorite`/`addWatchLater`/`addToList` prepend `{ item, accountId: account.id, addedAt: now }` (dedup — no-op if present); `createList` prepends `{ id: 'list_'+now+'_'+name-slug or a counter, name, createdAt: now, entries: [] }` (id derived from now+name, NOT Math.random); `upsertProgress` replaces the matching entry (or prepends), then `if (duration && offset >= 0.92*duration) removeProgress`, then cap `.slice(0,100)`; `recordHistory` → if `history[0]` is same item skip the timestamp bump only (still update), else prepend `{item,accountId,watchedAt:now}`, cap `.slice(0,300)`; `filterSortWatchLater(entries, {kind,query,sort})` → filter `kind==='all' || (kind==='movie'&&e.item.kind==='movie') || (kind==='series'&&(e.item.kind==='episode'||e.item.kind==='series'))`, then `query` case-insensitive substring on `item.name`, then sort by `addedAt` desc (`'added'`) or `item.name` (`'name'`). No `Math.random`/`Date.now` anywhere.
- [ ] **Step 5 — run PASS.**
- [ ] **Step 6 — `collections` store** (+ `collections.test.ts`), mirroring `settings.ts`'s `$configure({store})`/`_host()`/`load()`/`_persist()`:
```ts
export const useCollectionsStore = defineStore('collections', {
  state: () => ({ data: emptyLibrary() as LibraryData, _deps: null as { store: JsonStore } | null }),
  actions: {
    $configure(deps) { this._deps = deps },
    async _host() { if (!this._deps) this._deps = { store: await createCockpitStore() }; return this._deps },
    async load() { const { store } = await this._host(); const d = await store.load('library.json', emptyLibrary()); this.data = { ...emptyLibrary(), ...d } },
    async _persist() { const { store } = await this._host(); await store.save('library.json', this.data) },
    async toggleFavorite(account, item) { this.data = libToggleFavorite(this.data, account, item, Date.now()); await this._persist() },
    /* …one wrapper per pure op: addWatchLater/removeWatchLater/createList/renameList/deleteList/addToList/removeFromList/saveProgress→upsertProgress/removeProgress/recordHistory/clearHistory… */
  },
  getters: {
    favoritesOf: (s) => (accountId: string) => s.data.favorites.filter(e => e.accountId === accountId),
    watchLaterOf: (s) => (accountId: string) => s.data.watchLater.filter(e => e.accountId === accountId),
    continueWatchingOf: (s) => (accountId: string) => s.data.continueWatching.filter(e => e.accountId === accountId),
    historyOf: (s) => (accountId: string) => s.data.history.filter(e => e.accountId === accountId),
    isFavorite: (s) => (accountId: string, itemId: string) => libIsFavorite(s.data, accountId, itemId),
    listsOf: (s) => (accountId: string) => s.data.lists.map(l => ({ ...l, count: l.entries.filter(e => e.accountId === accountId).length })),
  },
})
```
Tests (memory store): a mutator applies + persists (assert via reload); `load()` back-compat fills missing keys; scoped getters filter by account.
- [ ] **Step 7 — App.vue:** add `void collections.load()` in `onMounted` next to `settings.load()`.
- [ ] **Step 8 — gate + commit.** `git commit -am "feat(library): data model + pure ops + collections store (favorites/lists/watch-later/progress/history)"`

---

### Task 2: Add affordances + Favorites / Watch Later / Lists views + Library tab

**Files:** Modify `ContentCard.vue`, `MovieDetail.vue`, `SeriesDetail.vue`, `HomeView.vue`; create `src/views/library/LibraryView.vue`.

- [ ] **Step 1 — `ContentCard` actions.** Add (reads `useWorkspaceStore().activeAccount` + `useCollectionsStore`): a **★ button** top-right (`@click.stop`, filled when `collections.isFavorite(account.id, item.id)`, calls `collections.toggleFavorite(account, item)`); a small **"＋" button** (`@click.stop`) opening a tiny menu — *Add to Watch Later* (only if `item.kind` is 'movie'|'series'|'episode'), *Add to list ▸* (each `collections.listsOf(account.id)` → `addToList`; *New list…* → `prompt` name → `createList` then `addToList`). Add an optional prop `context?: 'browse' | 'library'` — in `'library'` show a **✕ remove** affordance instead (emits `@remove`). Guard everything on `activeAccount` existing.
- [ ] **Step 2 — detail views.** In `MovieDetail`/`SeriesDetail`, add the same **★ favorite** toggle + **Add to Watch Later** + **Add to list** buttons for `detail.item` (using the active account). (Series: the series item; episodes get ＋ from the episode list rows if feasible, else series-level only — keep to series-level for v1.)
- [ ] **Step 3 — `LibraryView.vue`** (`props: { section: 'library' }` not needed; it's shown by HomeView). Local `tab` ref: `'continue' | 'favorites' | 'watchlater' | 'lists' | 'history'` (default `favorites`). Sub-tab buttons. For this task implement **Favorites**, **Watch Later**, **My Lists** (Continue Watching + History are Task 3 — leave their tabs as stubs "coming in the next step" or hide until Task 3 — implement then). Uses `useWorkspaceStore().activeAccount`:
  - **Favorites:** `collections.favoritesOf(account.id).map(e => e.item)` → `VirtualGrid` of `ContentCard :context="'library'"`; card click routes like BrowseView (live→`player.play`, movie→`detail.openMovie`, series→`detail.openSeries`), `@remove` → `collections.removeFavorite`/`toggleFavorite`.
  - **Watch Later:** a filter row (`<select>` Movies/Series/Both, search `<input>`, sort `<select>` Added/Name) bound to local refs; `filterSortWatchLater(collections.watchLaterOf(account.id), {kind,query,sort})` → grid; `@remove` → `removeWatchLater`.
  - **My Lists:** `collections.listsOf(account.id)` list (name + count) with rename (prompt)/delete buttons + a "New list" button; selecting a list shows its entries (filtered to account) in a grid with `@remove` → `removeFromList`.
- [ ] **Step 4 — HomeView selector.** Add a **★ Library** button after the section buttons (always shown when `activeAccount`). Track a local `view: 'browse' | 'library'`; the section buttons set `view='browse'` + `section`, the Library button sets `view='library'`. Render `<BrowseView v-if="view==='browse'" :section>` else `<LibraryView>`. Reset `view='browse'` on account change (extend the existing `watch(activeAccount)`).
- [ ] **Step 5 — gate + commit.** `git commit -am "feat(library): card ★/add-to-list affordances + Library tab with Favorites, Watch Later (filter/search/sort), My Lists"`

---

### Task 3: Continue Watching + History auto-tracking + resume + E2E

**Files:** Modify `src/stores/player.ts` (+test), `src/components/PlayerView.vue`, `src/views/library/LibraryView.vue`; extend `dev/e2e-*.mjs`.

- [ ] **Step 1 — resume offset.** `player.play(account, item, opts?)` opts gain `startOffsetSeconds?: number`. In `play`'s body set `this.startOffset = opts?.startOffsetSeconds ?? 0` (instead of hardcoded 0) and pass it to the first `engine.start(...)` (currently `startOffsetSeconds: 0`). Add a test: `play(A, MOVIE, { startOffsetSeconds: 300 })` → `engine.start` called with `startOffsetSeconds: 300` and `p.startOffset===300`. Keep all single-flight tests green.
- [ ] **Step 2 — PlayerView hooks.** Inject `useCollectionsStore()`. (a) **History:** on the first `MANIFEST_PARSED` (or when status becomes 'playing') per session, if `player.item && player.account`, call `collections.recordHistory(player.account, player.item)` once (a `recordedHistory` flag reset per session). (b) **Progress:** when `player.duration != null` (VOD), start a ~15s `setInterval` and also call it in `teardown()`/`close()`: `collections.saveProgress(player.account, player.item, now.value, player.duration)` (guard account/item/`now.value>0`). Clear the interval in teardown. Live (`duration==null`) → no progress.
- [ ] **Step 3 — Library Continue Watching + History sub-views** (fill the Task-2 stubs):
  - **Continue Watching:** `collections.continueWatchingOf(account.id)` (already newest-first) → grid; each card shows a progress bar (`offsetSeconds/durationSeconds`); click → `player.play(account, entry.item, { durationSeconds: entry.durationSeconds, startOffsetSeconds: entry.offsetSeconds })`; `@remove` → `removeProgress`.
  - **History:** `collections.historyOf(account.id)` → grid/list with relative time; a **Clear history** button → `clearHistory`.
- [ ] **Step 4 — gate + commit.** `git commit -am "feat(library): Continue Watching (auto-resume) + History auto-tracking + player resume offset"`
- [ ] **Step 5 — E2E** (`dev/e2e-*.mjs`, real Cockpit, JetIPTV): favorite a movie → appears under Library ▸ Favorites; play a movie ~20s → close → Library ▸ Continue Watching shows it → click → resumes near the saved offset (`currentTime`/played-label > 0); add to a new list + Watch Later → appears; History logs it. Record in `.superpowers/sdd/task-3-report.md`.

---

## Self-Review
- **Spec coverage:** data model+store → T1; favorites/watch-later/lists + add affordances + Library tab → T2; continue-watching/history + resume + E2E → T3.
- **Types:** `LibraryData`/entries (T1) consumed by store getters + all views; pure ops (T1) wrapped by store (T1) used by ContentCard/detail/LibraryView (T2/T3); `player.play` `startOffsetSeconds` (T3) used by Continue Watching resume (T3).
- **No system deps / no regression:** pure state + persistence only; `player.play` default offset stays 0 (browse unaffected); `collections` store distinct from `library` browse store; Date.now only in the store layer.
- **Purity:** `core/library` takes `now`, no Date.now/Math.random; list ids derived from `now`+name.
- Bound growth (history 300 / continueWatching 100). Account-scoped throughout. Cloud backup out (Plan 6).
