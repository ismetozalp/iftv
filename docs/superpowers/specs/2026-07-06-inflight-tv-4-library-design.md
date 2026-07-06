# In-flight TV — Plan 4 Design: Personal Library

## Goal

Let the user organize content: **Favorites**, **custom named Lists**, **Watch Later** (filter/search/sort), **Continue Watching** (auto-resume), and **History** — all local, account-scoped, no ffmpeg/panel/system dependencies. This is the last of the originally-requested core features.

## Background / current state
Vue3/Pinia/Bootstrap Cockpit plugin. `HomeView` shows a Live TV / Movies / Series selector → `BrowseView` (a `VirtualGrid` of `ContentCard`s per active account). `ContentItem = {id,kind:'live'|'movie'|'series'|'episode',name,logo,categoryId,streamId,seriesId,containerExtension,url}` with stable ids (`x:live:7`, `x:movie:9`, `m:…`). Persistence: `core/storage/appState.ts` `JsonStore` + `adapters/cockpitFile.ts` `createCockpitStore()` (JSON under `~/.config/cockpit/inflighttv/`), already used by `settings`. `player.play(account, item, opts?)` plays; `startOffset` tracks VOD position (Plan 3c). NOTE: `stores/library.ts` already exists as the **content-browse** store — the personal-library store is named **`collections`** to avoid the clash.

## Non-goals
Cloud/Claude backup (v1 = local encrypted file only, separate Plan 6). Cross-account/global library (v1 is active-account-scoped). Sharing/social. Auto-resume from *browse* (only the Continue Watching view resumes; browse plays fresh) — keeps behavior predictable.

## Constraints
- `src/core/**` pure/DI-tested; cockpit only in adapters. TDD; per-task commit; merge to `main`.
- One `library.json` file (JsonStore). Bound growth: history capped (e.g. 300 newest), continueWatching capped (e.g. 100).
- Account-scoped: entries carry `accountId`; the Library views filter to `workspace.activeAccount`.

## Architecture

### 1. Data model + pure ops (`src/core/library/`)
`types.ts`:
```
interface LibraryEntry { item: ContentItem; accountId: string; addedAt: number }
interface LibraryList { id: string; name: string; createdAt: number; entries: LibraryEntry[] }
interface ProgressEntry { item: ContentItem; accountId: string; offsetSeconds: number; durationSeconds: number | null; updatedAt: number }
interface HistoryEntry { item: ContentItem; accountId: string; watchedAt: number }
interface LibraryData { favorites: LibraryEntry[]; watchLater: LibraryEntry[]; lists: LibraryList[]; continueWatching: ProgressEntry[]; history: HistoryEntry[] }
```
Entries store a **snapshot** of the ContentItem (so it renders/replays without the browse cache). `library.ts` — pure, immutable-update functions returning a new `LibraryData` (all DI-tested): `emptyLibrary()`, `toggleFavorite(data, account, item)`, `isFavorite(data, accountId, itemId)`, `addWatchLater`/`removeWatchLater`, `createList(data, name)`/`renameList`/`deleteList`/`addToList(data, listId, account, item)`/`removeFromList`, `upsertProgress(data, account, item, offset, duration)` (dedup by accountId+itemId; drop when `offset >= 0.92*duration`; cap 100 newest), `removeProgress`, `recordHistory(data, account, item)` (prepend, dedup consecutive, cap 300), `clearHistory`. Item identity = `accountId + item.id`.

### 2. `collections` store (`src/stores/collections.ts`)
Pinia `useCollectionsStore`, holds `LibraryData`, `$configure({ store })` (default `createCockpitStore()`), `load()` reads `library.json` (fallback `emptyLibrary()`), and every mutator applies the matching pure op then persists the whole `LibraryData`. Getters scoped to an account id: `favoritesOf(accountId)`, `watchLaterOf`, `continueWatchingOf`, `historyOf`, `listsWithCounts`. Called on app mount (`App.vue`, alongside settings.load()).

### 3. Adding items (UI hooks)
- **`ContentCard`**: a **★ toggle** (top-right corner) → `collections.toggleFavorite(activeAccount, item)`, filled when `isFavorite`. Plus a small **"＋" menu** → Add to Watch Later (movie/episode only) · Add to list ▸ (each list + "New list…"). `@click.stop` so it doesn't trigger play/detail.
- **`MovieDetail`/`SeriesDetail`**: the same ★ + "Add to…" actions as buttons (more room).
- Removal: toggle the star, or the ✕ on entries in the Library views.

### 4. Library tab (`src/views/library/LibraryView.vue`)
New **★ Library** button in the `HomeView` selector (after Series; shown for any active account). Inside, sub-tabs (account-scoped to `activeAccount`):
- **Continue Watching** — `continueWatchingOf(account)` newest-first, a progress bar per card (`offset/duration`); click → `player.play(account, item, { durationSeconds, startOffsetSeconds: offset })` (resume); ✕ to dismiss.
- **Favorites** — `favoritesOf(account)` grid (reuses `ContentCard`); click behaves like browse (live→play, movie/series→detail).
- **Watch Later** — `watchLaterOf(account)` with the **filter (Movies/Series/Both) + search box + sort (Added ↕ / Name)** (pure helper in `core/library/` for filter+sort, tested).
- **My Lists** — list of lists (name + count); create (name prompt) / rename / delete; open a list → its entries grid.
- **History** — `historyOf(account)` newest-first with timestamps; "Clear history".
Reuses `ContentCard` + `VirtualGrid`; each card gets a ✕/remove affordance in library contexts.

### 5. Continue Watching + History auto-tracking (`PlayerView` + `player` store)
- `player.play(account, item, opts?)` gains `startOffsetSeconds?: number` (already flows to `engine.start`); default 0. Resume path uses it.
- **History**: on a VOD/live session becoming `playing`, `PlayerView` calls `collections.recordHistory(account, item)` once per session.
- **Progress** (VOD/episodes only, i.e. `player.duration != null`): `PlayerView` on a ~15s interval and in `teardown()`/`close()` calls `collections.saveProgress(account, item, now, player.duration)` (`now` = `startOffset + currentTime`). `saveProgress` upserts / drops-when-finished. Live TV → no progress.
- These hooks read `player.account`/`player.item`; guarded so a missing account/item is a no-op.

## Data flow (resume a movie)
`Library → Continue Watching → click → player.play(account, item, {durationSeconds, startOffsetSeconds: 47*60}) → engine -ss → plays at 47:00; PlayerView keeps upserting progress; at ≥92% it's dropped from Continue Watching`.

## Error handling
- Persistence failure (cockpit.file) → in-memory state still updates; surface nothing blocking (best-effort save, like settings).
- A library item whose account was deleted → still shows (snapshot) but playing it fails gracefully via the existing player error path; a stale entry can be removed with ✕.
- Empty states per sub-tab ("No favorites yet", etc.).
- Back-compat: `load()` fills any missing `LibraryData` keys with empty arrays.

## Testing
- **Unit (pure/DI):** every `library.ts` op (toggle/add/remove/list CRUD/progress upsert+finish-threshold+cap/history dedup+cap); the watch-later filter+sort helper; `collections` store (mutator → pure op → persist; scoped getters; back-compat load) with a memory store.
- **Component-light:** none required (repo convention: logic in core/store).
- **E2E (`dev/e2e-*.mjs`, real Cockpit):** favorite a movie → it appears under Library ▸ Favorites; play a movie ~20s, close, reopen → it's in Continue Watching and resumes near the saved offset; add to Watch Later + a new list → appears; History logs the play. Record in the task report.
- Full `npm test && typecheck && build && test:smoke` per task.

## Rollout (subagent-driven-development)
1. **Data model + store**: `core/library/{types,library}.ts` (pure ops + tests) + `stores/collections.ts` (+ tests) + `App.vue` load-on-mount.
2. **Add + browse views**: `ContentCard` ★ + "＋" menu; detail-view actions; `LibraryView` shell + Favorites + Watch Later (filter/search/sort) + My Lists; the ★ Library selector button.
3. **Continue Watching + History**: `player.play` `startOffsetSeconds`; `PlayerView` history + progress hooks; Continue Watching (resume) + History sub-views; E2E verification.
