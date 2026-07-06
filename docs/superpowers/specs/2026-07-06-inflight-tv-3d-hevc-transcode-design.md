# In-flight TV — Plan 3d Design: HEVC Transcode + Hardware-Accel

## Goal

Channels/movies whose video the browser can't decode (chiefly **HEVC**) should **play**, by transcoding the video to H.264 on the host — **GPU-accelerated via NVENC** (verified working) with a **software (libx264) fallback**. A Settings picker chooses the encoder, with a live self-test so it only offers what actually works. All existing playback (H.264 live + VOD, seeking, single-connection) is unchanged.

## Background / current state

Playback: live = `curl → FIFO → ffmpeg (copy) → HLS → hls.js`; VOD = `ffmpeg -ss <offset> -i <url> (copy) → HLS`. `-c:v copy` on HEVC yields an HLS the browser can't play (no MSE HEVC in Chromium here). Host: NVIDIA GTX 1080, driver 580.159.04 — `h264_nvenc`/`hevc_nvenc` encode verified; `libx264` verified. 8-core i7-7700HQ.

## Non-goals (later plans)
Audio/subtitle-track selection (Plan 3e). Per-title codec probing (rejected — a live probe means a second connection + the redirect stall). AV1/other output codecs.

## Constraints
- **One panel connection at any instant** (unchanged): a transcode switch restarts the session through the existing stop→settle→start path, never overlapping.
- `src/core/**` pure/DI-tested; cockpit/ffmpeg detection in `src/adapters/**`. TDD; per-task commits; merge to `main`.
- Transcode is a *different ffmpeg arg set on the same pipeline*, not a new pipeline.

## Architecture

### 1. When to transcode — copy-first + auto-fallback + manual
Default `-c:v copy` (fast for the H.264 majority). Switch to transcode when the browser can't decode the video, detected two ways in `PlayerView`:
- **hls.js error**: a fatal/`bufferAppendError`/`bufferAddCodecError`/manifest-incompatible-codecs event on the video track.
- **Watchdog**: audio is progressing (`currentTime` advancing) but `video.videoWidth === 0` after ~6s → the video track isn't decodable.
Either triggers `player.retryWithTranscode()`. A manual **"Transcode"** button in the player bar does the same (for cases the watchdog misses). Once a session is transcoding, it stays transcoding until Close (no copy re-attempt loop).

### 2. Encoder settings + self-test
`settings.json` gains `transcodeMode: 'auto' | 'gpu' | 'software' | 'off'` (default `auto`) and cached `encoderTest: { nvenc: boolean; x264: boolean; testedAt: number } | null`.
- Adapter `detectEncoders()` runs the tiny real ffmpeg checks (`-f lavfi -i testsrc … -c:v h264_nvenc -f null -` and same for `libx264`), returns which exit 0. (This is the source of truth — "ffmpeg lists it" ≠ "works", as the pre-driver-fix state proved.)
- Settings UI "Video transcoding": a mode `<select>` (Auto / GPU (NVENC) / Software (x264) / Off) + a **"Test encoders"** button that runs `detectEncoders()` and shows ✅/✗ per encoder.
- Resolution: `auto` → `nvenc` if `encoderTest.nvenc` else `x264`; `gpu` → nvenc (warn if untested/failed); `software` → x264; `off` → copy-only (transcode disabled; HEVC just won't play, with a clear message).

### 3. Transcode pipeline (arg builders)
Both `buildLiveRemuxArgs` and `buildVodRemuxArgs` gain a `videoCodec: 'copy' | 'nvenc' | 'x264'` option (default `'copy'`) replacing the fixed `-c:v copy`:
- `'copy'` → `-c:v copy` (today's behavior).
- `'nvenc'` → `-c:v h264_nvenc -preset p4 -tune ll -b:v 0 -cq 23` (software decode + GPU encode — robust; HW decode via `-hwaccel cuda` is a later optimization, not required). Audio `-c:a aac` unchanged.
- `'x264'` → `-c:v libx264 -preset veryfast -tune zerolatency -crf 23`.
`-c:a aac -b:a 128k` and all HLS flags stay. The engine picks `videoCodec` from `{ transcodeVideo, resolvedEncoder }` passed via `start` opts.

### 4. Wiring
- `PlaybackEngine.start(account, item, opts?)` opts gains `videoCodec?: 'copy' | 'nvenc' | 'x264'` (default `'copy'`). The engine stays pure — it just uses the codec it's handed. The **player store** owns resolution: a pure `resolveEncoder(mode, encoderTest): 'nvenc' | 'x264'` helper (`core/media/`) maps settings `transcodeMode`+`encoderTest`; the store passes `videoCodec: transcode ? resolveEncoder(...) : 'copy'`.
- `player` store: `play`/`seek` already restart cleanly; add `transcode: boolean` state (per current playback) and `retryWithTranscode()` = re-`start` the current item at the current `startOffset` with `transcode=true` (→ resolved `videoCodec`), through the same mutex+gen single-flight path (so it can't race play/seek/stop). `play`/`seek` keep passing the current `transcode` flag so a seek within a transcoded title stays transcoded. `stop()` resets `transcode=false`.
- `PlayerView`: the hls.js error handler + the videoWidth watchdog call `retryWithTranscode()` (once per session); the manual button too. Show a subtle "Transcoding (GPU/CPU)…" note while `transcode` is on.

## Data flow (HEVC channel)
`play (copy) → hls.js can't decode (error or 0×0 watchdog) → player.retryWithTranscode() → stop→settle→start(transcodeVideo:true) → engine resolves encoder (nvenc) → ffmpeg -c:v h264_nvenc → H.264 HLS → plays`. One connection throughout.

## Error handling
- `transcodeMode: 'off'` and HEVC → don't auto-transcode; show "This channel's video isn't supported (enable transcoding in Settings)".
- nvenc chosen but fails at runtime (driver regressed) → engine/player catches the ffmpeg failure; if encoder was nvenc, retry once with `x264`; if that fails, `player.fail(...)`.
- `encoderTest` null (never tested) → `auto` runs `detectEncoders()` lazily on first transcode; cache the result.
- Watchdog must not fire for audio-only/radio streams that legitimately have no video (only trigger when a video track is declared but 0×0) — guard on `hls` having a video level.

## Testing
- **Unit (pure/DI):** `buildVodRemuxArgs`/`buildLiveRemuxArgs` emit the right `-c:v` per `videoCodec` (copy/nvenc/x264) and keep audio/HLS flags; encoder resolution logic (`transcodeMode`+`encoderTest` → encoder) incl. auto/off and untested cases; player `retryWithTranscode` restarts once with `transcodeVideo:true` at the same offset and doesn't double-fire; settings store `transcodeMode`/`encoderTest` persistence.
- **Adapter (host, real ffmpeg):** `detectEncoders()` returns `{ nvenc:true, x264:true }` on this host (a small integration check, not in the vitest suite).
- **E2E (`dev/e2e-playback.mjs`, real Cockpit):** extend with a real HEVC source if the panel has one (else document manual verification): confirm it fails-then-transcodes and plays, and that only one ffmpeg runs. A host-side spike (task 1) transcodes a real panel HEVC stream with `h264_nvenc` to confirm the full arg set works end-to-end.
- Full `npm test && typecheck && build && test:smoke` gate per task.

## Rollout (subagent-driven-development)
1. **Spike + arg builders**: verify `-c:v h264_nvenc` transcode of a real panel HEVC stream (and libx264) end-to-end on the host; add `videoCodec` to both arg builders (+ tests).
2. **Encoder detection + settings**: `detectEncoders()` adapter, `transcodeMode`/`encoderTest` in settings store + a pure `resolveEncoder()` helper (+ tests), Settings "Video transcoding" UI with the Test button.
3. **Engine + player wiring**: `start` opts `videoCodec`; pure `resolveEncoder()`; store `transcode` state + `retryWithTranscode()` (single-flight); play/seek carry the flag.
4. **PlayerView triggers**: hls.js codec-error handler + videoWidth watchdog + manual "Transcode" button + the transcoding indicator; nvenc→x264 runtime fallback. E2E/host verification.
