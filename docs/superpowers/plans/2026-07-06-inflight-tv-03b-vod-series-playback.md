# In-flight TV — Plan 3b: VOD + Series Playback + Detail Views

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Play **movies** and **series episodes** through the existing playback engine (curl→FIFO→ffmpeg→HLS→hls.js, proven for live). Add **detail views**: a movie click opens info (poster/plot) + Play; a series click opens seasons/episodes → Play an episode. Reuses the whole media engine; only the *upstream URL* differs per kind.

**Architecture:** Generalize `liveStreamUrl` → `playbackUrl(account, item, opts?)` handling `movie` (`/movie/{u}/{p}/{streamId}.{ext}`) and `episode` (`/series/{u}/{p}/{episodeId}.{ext}`). Add Xtream detail clients (`get_vod_info`, `get_series_info`) returning normalized info/seasons/episodes. Add `MovieDetail` + `SeriesDetail` views; wire ContentCard clicks by kind. The player store/engine/PlayerView are unchanged (movies/episodes are finite streams the same pipeline handles).

**Tech Stack:** unchanged (Vue3/Vite/TS/Bootstrap/Pinia/hls.js/Vitest/Playwright; ffmpeg on host).

## Global Constraints
- Builds on `main` (Plans 1, AccountsV2, 2, 2b, 3 merged; live playback verified). `src/core/**` pure; adapters may import cockpit. TDD; commit per task; no push.
- Upstream URLs: movie `{scheme}://{host}:{port}/movie/{username}/{password}/{streamId}.{containerExtension}`; episode `.../series/{username}/{password}/{episodeId}.{containerExtension}`. Default ext `mp4`/`mkv` fallback to `mp4` when missing. M3U accounts have no VOD/Series (already Live-only).
- Detail is Xtream-only: `get_vod_info&vod_id=`, `get_series_info&series_id=`. EPG title base64 note doesn't apply here. Series episodes come keyed by season number (object) — flatten to `{ episodeId, title, season, episodeNum, containerExtension }`.
- Deferred to Plan 3c: VOD seeking (`-ss` restart), hardware-accel settings, subtitle/audio-track selection, resume/continue-watching (Plan 4).

---

### Task 1: Generalize playback URL + play movies on click
**Files:** modify `src/core/media/streamUrl.ts` (+test), `src/core/media/engine.ts`, `src/views/browse/BrowseView.vue`.
**Produces:** `playbackUrl(account, item): string | null` (replaces/renames `liveStreamUrl`, keeping live behavior):
- `item.url` → return it (M3U direct).
- `live` + `streamId` + xtream → `/live/{u}/{p}/{streamId}.ts`.
- `movie` + `streamId` + xtream → `/movie/{u}/{p}/{streamId}.{containerExtension||'mp4'}`.
- `episode` (kind used for episodes) + `streamId` (episode id) + xtream → `/series/{u}/{p}/{streamId}.{containerExtension||'mp4'}`.
- else null.
- [ ] Write `streamUrl.test.ts` cases for movie + episode URL building (+ keep live cases), rename import `liveStreamUrl`→`playbackUrl` in `engine.ts`. RED→GREEN.
- [ ] In `BrowseView.vue` `onPlay`: allow `item.kind === 'live' || item.kind === 'movie'` to `player.play(...)` directly (episodes play from SeriesDetail in Task 3; movies also get a detail view in Task 2 but direct-play-on-click is fine as a first cut — Task 2 refines to open detail). typecheck+build+smoke+full suite green. Commit.

### Task 2: VOD detail (get_vod_info) + MovieDetail view
**Files:** create `src/core/xtream/vodInfo.ts` (+test), `src/stores/detail.ts` (+test) OR extend library store, `src/views/detail/MovieDetail.vue`; modify BrowseView (movie click → open detail).
**Produces:**
- `getVodInfo(t, url, user, pass, vodId): Promise<MovieInfo>` where `MovieInfo = { name, poster, plot, cast, genre, durationSecs, streamId, containerExtension }` (from `{info, movie_data}`; normalize via `toStr`/`toNum`).
- A small store or composable to hold the opened detail (movie) + loading/error.
- `MovieDetail.vue`: poster + title + plot/cast/genre + a **Play** button → `player.play(account, movieItem)` (build a ContentItem-ish with streamId+containerExtension so `playbackUrl` makes the movie URL).
- BrowseView: clicking a `movie` card opens MovieDetail (overlay/modal) instead of instant play.
- [ ] TDD `getVodInfo` (fake transport). Build the view. Manual verify (real account). Commit.

### Task 3: Series detail (get_series_info) + SeriesDetail view + episode play
**Files:** create `src/core/xtream/seriesInfo.ts` (+test), `src/views/detail/SeriesDetail.vue`; modify BrowseView (series click → open series detail).
**Produces:**
- `getSeriesInfo(t, url, user, pass, seriesId): Promise<{ info: SeriesInfo; seasons: {season:number}[]; episodes: Episode[] }>` where `Episode = { episodeId, title, season, episodeNum, containerExtension }` — flatten the `episodes` object (keyed by season number) into a sorted array.
- `SeriesDetail.vue`: series poster/plot + a season selector + episode list; clicking an episode → `player.play(account, episodeItem)` (kind `episode`, streamId=episodeId, containerExtension → `playbackUrl` builds `/series/...`).
- BrowseView: clicking a `series` card opens SeriesDetail.
- [ ] TDD `getSeriesInfo` (fake transport, incl. the season-keyed episodes flatten). Build the view. Manual verify. Commit.

---

## Self-Review
- VOD/Series play reuse the proven engine (only the URL differs) → Task 1. Detail (info/seasons/episodes) → Tasks 2,3. M3U unaffected (Live-only). Deferred: seeking, hardware-accel, tracks, continue-watching (noted).
- Type consistency: `playbackUrl` consumed by `engine.ts`; `MovieInfo`/`Episode` by their views; `ContentItem.kind` gains effective use of `'movie'`/`'series'` and a new `'episode'` playback item shape (episodes are built ad-hoc for `player.play`, not stored). Ensure `ContentKind` includes `'episode'` OR build episode play-items with `kind:'episode'` added to the union (update `content/types.ts` `ContentKind` to `'live'|'movie'|'series'|'episode'` in Task 1 if needed — small, keeps `playbackUrl` switch exhaustive).
- Manual verification needs a real Xtream account with VOD/Series (mock returns empty for those). H.264 plays; HEVC needs Plan 3c transcode.
