# In-flight TV — Plan 3c Design: VOD On-Demand Seeking + Full Runtime

## Goal

Movies and series episodes should show their **full runtime** and let the user **seek anywhere** — while never opening more than **one connection** to the panel (a hard constraint of the user's provider). Seeking is bounded: only the watched/seeked regions are ever fetched (no whole-file download).

Live playback and the existing browse/detail/playback flows are unchanged. This is a focused extension of the playback engine + player UI.

## Background / current state

Playback is `curl -L → FIFO → ffmpeg → rolling HLS → hls.js` on the Cockpit host. Movies currently play from 0 with a **growing** seekbar (`-readrate_initial_burst` then realtime pacing, `hls_playlist_type event`, `startPosition 0`). There is no full duration and no seek past what has streamed. The panel `.ts`/movie URL returns a **302 to a different host** — the reason ffmpeg gets the stream via curl (ffmpeg's HTTP demuxer stalls following that redirect).

## Non-goals (separate later plans)

Hardware-accelerated transcoding + device selection, subtitle/audio-track selection, and HEVC video transcode are **out of scope** for 3c — each is its own plan.

## Constraints

- **Exactly one panel connection at any instant.** Only one playback session (one curl/ffmpeg) alive at a time; a seek **stops the current session and waits for teardown before starting the next**. Seeks are serialized (a new seek cancels any in-flight restart).
- `src/core/**` stays pure/DI-tested; cockpit lives in `src/adapters/**`. TDD; per-task commits; no push.
- Live keeps the `curl → FIFO` path unchanged.

## Architecture

### 1. De-risk spike (build step 1)
Before building UI, verify on the user's real panel (via `dev/e2e-playback.mjs` / a shell spike, one connection): resolve a movie's 302 to its final CDN URL, then `ffmpeg -ss <T> -i <resolved-url> -c:v copy -c:a aac …` and confirm it (a) does **not** stall (direct URL, no redirect) and (b) seeks efficiently to `T` (HTTP range) rather than reading from the start. If the panel's movie files are **not** range-seekable, fall back to the "download whole movie" approach for those items and record it. Everything below assumes the spike passes.

### 2. Redirect resolution (`src/core/media/…` + adapter)
A small step that turns a panel URL into its final URL by following the 302 **without** downloading the body (`curl -sIL -o /dev/null -w '%{url_effective}'` or equivalent), returning the effective URL. Pure core takes the raw output → effective URL; the adapter runs curl via `cockpit.spawn`. This is one brief panel hit (not a held connection).

### 3. Engine: offset-aware VOD sessions
`PlaybackEngine.start(account, item, opts?)` gains `opts.startOffsetSeconds` (default 0). VOD path becomes:
1. Resolve the panel URL → final CDN URL (§2).
2. Spawn `ffmpeg -ss <startOffsetSeconds> -i <resolvedUrl> …` producing the same keep-all EVENT HLS (`hls_list_size 0`, `-readrate 1 -readrate_initial_burst <buffer>`), into the session dir. **No curl/FIFO for VOD** — ffmpeg reads the resolved URL directly.
3. `PlaybackSession` gains: `isLive`, `startOffsetSeconds`, and `durationSeconds | null` (the metadata runtime; null ⇒ unknown → growing-seekbar fallback).

Live path is unchanged (curl → FIFO, `isLive: true`, `startOffsetSeconds: 0`, `durationSeconds: null`).

*Regression guard:* the current `curl → FIFO` VOD play-from-0 is already proven working. If the spike shows `ffmpeg -ss 0` direct is any less reliable than curl for offset 0, keep `curl → FIFO` for `startOffsetSeconds === 0` and use `resolve + ffmpeg -ss` only for `> 0` (seeks). Prefer unifying on `ffmpeg -ss` only if the spike is clean.

### 4. Duration source
`get_vod_info.durationSecs` (already fetched for `MovieDetail`) flows into the movie play-item / session as `durationSeconds`. For episodes, use `get_series_info` per-episode duration **if present**; otherwise `durationSeconds: null` (that episode keeps the growing seekbar). The player store carries the value onto the session.

### 5. Player store: seek orchestration (single-flight, single-connection)
- State: `startOffset` (current session's offset), `duration` (metadata), plus existing status.
- `seek(toSeconds)`: guard/serialize — if a restart is in flight, cancel it; **stop the current session** (SIGTERM curl/ffmpeg, `rmrf`) and **await teardown + a short settle delay** so the old TCP connection is released; then `engine.start(account, item, { startOffsetSeconds: toSeconds, bufferSeconds })`, set `startOffset = toSeconds`. Never overlaps two sessions.
- `stop()` unchanged (tears the single session down).

### 6. Custom seekbar (`PlayerView.vue`)
Because the media only reports streamed-so-far duration, native controls can't show the runtime. When `session.duration` is known, render a small custom control bar (hide native `controls`):
- **Scrubber** over `0…duration`; **playhead = `startOffset + video.currentTime`**; dragging/click → `player.seek(target)`.
- Play/pause, `current / total` time labels (mm:ss / h:mm:ss), fullscreen, and the existing **Buffering…** indicator (shows during a seek restart).
- The streamed-ahead region (`startOffset … startOffset + video.duration`) is drawn as a "buffered" band so the user sees how far they can scrub without a re-buffer.
- When `session.duration` is null (live, or an episode without duration) → keep the **current native/growing** behavior unchanged.

### 7. Minor: account-switch closes the detail overlay
On `activeAccount` change, close any open `MovieDetail`/`SeriesDetail` (detail store `close()`), matching the fix noted in 3b review. Small store/watch change.

## Data flow (seek)
`user drags scrubber → player.seek(T) → cancel in-flight → stop current session (release connection, settle) → engine.start({startOffsetSeconds:T}) → resolve redirect → ffmpeg -ss T → EVENT HLS from T → hls.js loads new source (currentTime≈0) → custom bar shows playhead T…, buffered T…T+ahead, total = duration`

## Error handling
- Spike fails / not range-seekable → that item uses whole-file/growing fallback; surface nothing scary, just no arbitrary forward-seek.
- Seek restart error (ffmpeg/redirect fails) → `player.fail(...)` with a clear message; the single connection is already released.
- `durationSeconds` null → growing seekbar (no regression).
- Rapid seeks → serialized; only the latest wins; never two connections.

## Testing
- **Unit (pure/DI):** VOD ffmpeg args include `-ss <offset>` before `-i` and the resolved URL (not the panel URL); redirect-resolution parser; seekbar math (playhead/total/buffered mapping, time formatting); player-store `seek` serialization (stops current before starting next — assert order via mocks); episode-duration passthrough; account-switch closes detail.
- **E2E (`dev/e2e-playback.mjs`, real Cockpit, one connection):** play a movie → assert full `duration` shows immediately; seek forward to ~mid → assert a brief buffer then `currentTime` resumes near the target; assert only one ffmpeg/curl alive across the seek (process check).
- Full `npm run test && typecheck && build && test:smoke` gate per task.

## Rollout
Tasks (subagent-driven-development): (1) spike + redirect-resolve + offset-aware VOD engine (`-ss`, no FIFO for VOD); (2) duration into session + player-store `seek` (single-flight); (3) custom seekbar UI; (4) account-switch closes detail + E2E seek verification. Merge to `main` per the autonomous workflow.
