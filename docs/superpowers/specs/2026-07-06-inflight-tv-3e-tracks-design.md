# In-flight TV — Plan 3e Design: Audio-Track + Subtitle Selection

## Goal

Let the viewer pick the **audio track** (language) and turn on/pick a **subtitle** in the player. Restart-based, single-connection, reusing the proven playback pipeline. Text subtitles only (bitmap/DVB shown-but-disabled). Everything else (playback, seek, transcode, M3U-HLS) unchanged.

## Background / spike (done 2026-07-06, real panel)
Pipeline: live = `curl→FIFO→ffmpeg→HLS` (direct `.ts`) or `ffmpeg -i url` (HLS `.m3u8`); VOD = `ffmpeg -ss url`. **Spike verified**: one ffmpeg can emit the HLS (video + a chosen audio via `-map 0:v:0 -map 0:a:N`) **and** a WebVTT subtitle (`-map 0:s:M -c:s webvtt -f webvtt sub.vtt`) in a single process/connection; `subrip`→WebVTT converts cleanly; `-ss` rebases subtitle timestamps to match the video. A sampled movie had audio(tur) + subs(eng, tur) + an embedded PNG poster (so map `0:v:0`, not `0:v`, to skip attachments). On this panel audio is usually single-track but text subs occur; the machinery is generically useful (live/dual-audio elsewhere).

## Non-goals
Bitmap/DVB subtitle rendering (needs OCR/burn-in) — listed but disabled. Instant client-side switching (would need a master+variant HLS restructure — rejected for regression risk). Audio/subtitle *upload* of external files. Live subtitle discovery beyond best-effort.

## Constraints
- **One panel connection at any instant** — a track change restarts the single session through the existing mutex+gen single-flight (like seek/transcode); never overlaps.
- `src/core/**` pure/DI-tested; cockpit/ffprobe in `src/adapters/**`. TDD; per-task commit; merge to `main`.
- Track changes are a *different ffmpeg arg set on the same pipeline*, not a new pipeline.

## Architecture

### 1. Track discovery
`adapters/cockpitProbe.ts` `probeStreams(inputUrl): Promise<RawStream[]>` runs `ffprobe -show_streams -of json` via `cockpit.spawn`. A pure `core/media/tracks.ts` `parseTracks(rawStreams)` → `{ audio: AudioTrack[]; subtitles: SubtitleTrack[] }` where `AudioTrack = { index: number /*type-relative a:N*/; language: string; codec: string }` and `SubtitleTrack = { index: number /*s:N*/; language: string; codec: string; text: boolean }` (`text` = codec ∈ {subrip, mov_text, webvtt, ass, ssa, text}; bitmap dvb_subtitle/hdmv_pgs → `text:false`). Discovery: **VOD** probes the movie URL directly (spike-proven); **live** best-effort (probe the URL — works for `.m3u8`; direct-`.ts` may fail → return the single default audio, no subs). Cache per item id. Non-blocking: playback starts on defaults; the menus populate when discovery resolves.

### 2. Engine: track-aware ffmpeg args
`PlaybackEngine.start(account, item, opts?)` opts gain `audioIndex?: number` (default 0) and `subtitleIndex?: number | null` (default null). The **engine owns the subtitle path** — it already creates the session dir, so it uses `${dir}/sub.vtt` and exposes a reader on the session: `PlaybackSession.readSubtitle(): Promise<Uint8Array | null>` (null when no subtitle selected), implemented via `deps.readFile(${dir}/sub.vtt)`. All three builders (`buildLiveRemuxArgs`, `buildLiveUrlRemuxArgs`, `buildVodRemuxArgs`) gain `audioIndex` + `subtitleIndex` + `subtitlePath`, via shared helpers in `ffmpegArgs.ts`:
- `mapArgs(audioIndex)` → `['-map','0:v:0','-map',`0:a:${audioIndex}`]` inserted before the video codec args (skips embedded-image streams).
- If `subtitleIndex != null`, append a **second output** after the playlist: `['-map',`0:s:${subtitleIndex}`,'-c:s','webvtt','-f','webvtt', subtitlePath]`.
Fallback: if a bad map makes ffmpeg fail to start, the engine/player already surfaces "did not start" → the player retries once on defaults (`audioIndex:0`, no sub).

### 3. Player store: selection state + restart
State: `audioTracks`, `subtitleTracks`, `selectedAudio: number`, `selectedSubtitle: number | null`. Actions:
- On `play`, kick off discovery (via an injected `probe`), set defaults (`selectedAudio: 0`, `selectedSubtitle: null`).
- `setAudioTrack(i)` / `setSubtitle(i | null)` → set state, then **restart at the current offset** through the same single-flight as `retryWithTranscode` (mutex+gen, stop→settle→start), passing `audioIndex: selectedAudio` + `subtitleIndex: selectedSubtitle`. `play`/`seek`/`transcode` restarts all carry the current audio/subtitle selection so they persist.
- Reset selections + tracks on `stop`/`fail`/new `play`.

### 4. Subtitle rendering (PlayerView)
When `selectedSubtitle != null`, add a `<track kind="subtitles" default>` to the `<video>` whose `src` is a `blob:` built from `player.session.readSubtitle()` (bytes→Blob). Because the .vtt **grows** as ffmpeg processes, a ~3s timer re-reads it and refreshes the track (revoke old blob, set new) so new cues appear. Remove the track when subtitle is off / on teardown. (Timeline aligns: the .vtt is `-ss`-rebased like the HLS.)

### 5. UI
Player bar gets an **Audio** menu (languages; hidden if ≤1 track) and a **CC** menu (Off + each **text** subtitle; bitmap entries disabled with a hint). Selecting calls the store actions. A brief "switching…" state during the restart (reuse the Buffering indicator).

## Data flow (pick English subtitle)
`user picks CC:eng → player.setSubtitle(engIdx) → single-flight restart at offset with subtitle={index, path:<dir>/sub.vtt} → ffmpeg emits HLS + sub.vtt → PlayerView adds <track> from blob(sub.vtt), refreshed every ~3s → cues render`. One connection throughout.

## Error handling
- Discovery fails (live direct-`.ts`, or ffprobe error) → menus show only the default audio, no subs; no crash.
- A selected map fails at start → engine throws → player retries once on defaults; if that also fails, surface the error.
- `.vtt` not yet written when the track loads → empty track, filled on the next refresh tick.
- Bitmap subs are non-selectable (disabled), so no failed webvtt conversion.

## Testing
- **Unit (pure/DI):** `parseTracks` (audio/sub type-relative indices, language tags, text-vs-bitmap classification, skips video/image); `mapArgs` + the subtitle-output args in all three builders (correct `-map`/`-c:s webvtt` placement; absent when no subtitle); player store `setAudioTrack`/`setSubtitle` restart once via single-flight at the current offset and carry the selection through a later seek (assert maxActive===1). 
- **Spike:** DONE (one ffmpeg → HLS + WebVTT + audio map, verified).
- **E2E (`dev/e2e-*.mjs`, real Cockpit):** play the subrip movie (id 222601) → open CC → pick English → assert a `<track>`/cues appear and the video keeps playing, one ffmpeg. Audio menu verified present when >1 track (best-effort — panel is mostly single-audio).
- Full `npm test && typecheck && build && test:smoke` per task.

## Rollout (subagent-driven-development)
1. **Discovery**: `probeStreams` adapter + pure `parseTracks` (+ tests).
2. **Engine args**: `mapArgs` + subtitle-output in the 3 builders; `start` opts `audioIndex`/`subtitle` (+ tests).
3. **Player store**: track state + discovery-on-play + `setAudioTrack`/`setSubtitle` single-flight restarts, selections carried through play/seek/transcode (+ tests).
4. **PlayerView UI**: Audio + CC menus + WebVTT `<track>` blob rendering with refresh timer; E2E verification.
