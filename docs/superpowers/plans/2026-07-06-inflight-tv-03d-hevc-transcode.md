# In-flight TV — Plan 3d: HEVC Transcode + Hardware-Accel

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Video the browser can't decode (chiefly HEVC) plays by transcoding to H.264 on the host — GPU via NVENC (verified) with a software libx264 fallback — chosen by a test-based Settings picker, triggered copy-first-then-auto-fallback.

**Architecture:** Transcode is a different `-c:v` on the *same* pipeline (live curl→FIFO→ffmpeg, VOD ffmpeg -ss). A shared `videoCodecArgs()` maps `'copy'|'nvenc'|'x264'`→ffmpeg flags used by both arg builders. The player store resolves the encoder from settings and hands the engine a concrete `videoCodec`; a transcode switch restarts through the existing mutex+gen single-flight path (one connection). PlayerView detects "can't decode" (hls.js codec error or a videoWidth-0 watchdog) and calls `retryWithTranscode()`; a manual button does the same.

**Tech Stack:** unchanged (Vue3/Vite/TS/Bootstrap/Pinia/hls.js/Vitest; host ffmpeg 7.1.5, NVIDIA 580.159.04 NVENC).

## Global Constraints
- Builds on `main` (Plan 3c merged). `src/core/**` pure/DI-tested; cockpit/ffmpeg in `src/adapters/**`. TDD; per-task commit; merge to `main`.
- **One panel connection at any instant** — a transcode switch reuses `retryWithTranscode` → the store's single-flight restart; never overlaps.
- Spike-verified args (2026-07-06, real ffmpeg): nvenc `-c:v h264_nvenc -preset p4 -tune ll -b:v 0 -cq 23` and software `-c:v libx264 -preset veryfast -tune zerolatency -crf 23` both HEVC(4:2:0)→H.264→HLS OK; `detectEncoders` returns nvenc=true,x264=true on this host.
- Audio stays `-c:a aac -b:a 128k`; all HLS flags unchanged.

## File Structure
- `src/core/media/ffmpegArgs.ts` — add `videoCodecArgs(codec)`; both builders take `videoCodec?` (+ test).
- `src/core/media/encoder.ts` — pure `resolveEncoder(mode, encoderTest)` (+ test). NEW.
- `src/adapters/cockpitEncoders.ts` — `detectEncoders()` via cockpit.spawn ffmpeg tests. NEW.
- `src/stores/settings.ts` — `transcodeMode`, `encoderTest`, actions (+ test).
- `src/views/settings/SettingsView.vue` — "Video transcoding" section.
- `src/core/media/PlaybackEngine.ts` — `start` opts `videoCodec?`.
- `src/core/media/engine.ts` — pass `videoCodec` to the builders.
- `src/stores/player.ts` — `transcode` state, `retryWithTranscode()`, play/seek carry the flag, nvenc→x264 runtime fallback (+ test).
- `src/components/PlayerView.vue` — codec-error handler + watchdog + manual button + indicator.

---

### Task 1: `videoCodec` in both arg builders

**Files:** Modify `src/core/media/ffmpegArgs.ts` (+ `ffmpegArgs.test.ts`).
**Interfaces (Produces):** `videoCodecArgs(codec: 'copy'|'nvenc'|'x264'): string[]`; `buildLiveRemuxArgs({inputPath,liveWindow,playlistPath,segmentPath,videoCodec?})`; `buildVodRemuxArgs({inputUrl,offsetSeconds,burstSeconds,playlistPath,segmentPath,videoCodec?})`. Default `videoCodec='copy'`.

- [ ] **Step 1 — failing test** in `ffmpegArgs.test.ts`:
```ts
import { videoCodecArgs, buildLiveRemuxArgs, buildVodRemuxArgs } from './ffmpegArgs'
describe('videoCodecArgs', () => {
  it('maps codecs', () => {
    expect(videoCodecArgs('copy')).toEqual(['-c:v', 'copy'])
    expect(videoCodecArgs('nvenc').join(' ')).toBe('-c:v h264_nvenc -preset p4 -tune ll -b:v 0 -cq 23')
    expect(videoCodecArgs('x264').join(' ')).toBe('-c:v libx264 -preset veryfast -tune zerolatency -crf 23')
  })
})
describe('builders honor videoCodec', () => {
  const live = { inputPath: '/c/in.ts', liveWindow: 6, playlistPath: '/c/i.m3u8', segmentPath: '/c/s_%05d.ts' }
  it('live default is copy; nvenc swaps it', () => {
    expect(buildLiveRemuxArgs(live).join(' ')).toContain('-c:v copy')
    expect(buildLiveRemuxArgs({ ...live, videoCodec: 'nvenc' }).join(' ')).toContain('-c:v h264_nvenc')
    expect(buildLiveRemuxArgs({ ...live, videoCodec: 'nvenc' }).join(' ')).not.toContain('-c:v copy')
  })
  it('vod honors x264 and keeps -ss + event', () => {
    const a = buildVodRemuxArgs({ inputUrl: 'http://h/m.mkv', offsetSeconds: 60, burstSeconds: 30, playlistPath: '/c/i.m3u8', segmentPath: '/c/s.ts', videoCodec: 'x264' }).join(' ')
    expect(a).toContain('-c:v libx264'); expect(a).toContain('-ss 60'); expect(a).toContain('-hls_playlist_type event')
  })
})
```
- [ ] **Step 2 — run, expect FAIL.** `npm run test -- ffmpegArgs`
- [ ] **Step 3 — implement.** Add:
```ts
export function videoCodecArgs(codec: 'copy' | 'nvenc' | 'x264'): string[] {
  if (codec === 'nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-b:v', '0', '-cq', '23']
  if (codec === 'x264') return ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '23']
  return ['-c:v', 'copy']
}
```
Add `videoCodec?: 'copy' | 'nvenc' | 'x264'` to both input interfaces (default `'copy'`); in each builder replace the literal `'-c:v', 'copy'` with `...videoCodecArgs(videoCodec)`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit.** `git commit -am "feat(transcode): videoCodec (copy/nvenc/x264) in live+VOD ffmpeg arg builders"`

---

### Task 2: encoder detection + resolveEncoder + settings

**Files:** Create `src/core/media/encoder.ts` (+test), `src/adapters/cockpitEncoders.ts`; modify `src/stores/settings.ts` (+test), `src/views/settings/SettingsView.vue`.
**Interfaces:** Produces `resolveEncoder(mode: TranscodeMode, encoderTest: EncoderTest | null): 'nvenc' | 'x264'` where `type TranscodeMode = 'auto'|'gpu'|'software'|'off'`, `interface EncoderTest { nvenc: boolean; x264: boolean; testedAt: number }`. `detectEncoders(): Promise<{ nvenc: boolean; x264: boolean }>`. Settings store gains `transcodeMode`, `encoderTest`, `setTranscodeMode`, `runEncoderTest`.

- [ ] **Step 1 — failing test** `encoder.test.ts`:
```ts
import { resolveEncoder } from './encoder'
it('auto prefers nvenc when it tested OK, else x264', () => {
  expect(resolveEncoder('auto', { nvenc: true, x264: true, testedAt: 1 })).toBe('nvenc')
  expect(resolveEncoder('auto', { nvenc: false, x264: true, testedAt: 1 })).toBe('x264')
  expect(resolveEncoder('auto', null)).toBe('x264') // untested → safe software
})
it('explicit modes', () => {
  expect(resolveEncoder('gpu', null)).toBe('nvenc')
  expect(resolveEncoder('software', { nvenc: true, x264: true, testedAt: 1 })).toBe('x264')
  expect(resolveEncoder('off', null)).toBe('x264') // 'off' is handled by the store (won't transcode); resolveEncoder still returns a safe default
})
```
- [ ] **Step 2 — run FAIL. Step 3 — implement `encoder.ts`:**
```ts
export type TranscodeMode = 'auto' | 'gpu' | 'software' | 'off'
export interface EncoderTest { nvenc: boolean; x264: boolean; testedAt: number }
export function resolveEncoder(mode: TranscodeMode, test: EncoderTest | null): 'nvenc' | 'x264' {
  if (mode === 'gpu') return 'nvenc'
  if (mode === 'software' || mode === 'off') return 'x264'
  return test?.nvenc ? 'nvenc' : 'x264' // auto
}
```
- [ ] **Step 4 — run PASS.**
- [ ] **Step 5 — adapter `cockpitEncoders.ts`** (untestable cockpit seam, thin):
```ts
import cockpit from 'cockpit'
async function encoderWorks(codec: string): Promise<boolean> {
  try {
    await cockpit.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=1', '-c:v', codec, '-f', 'null', '-'], { err: 'message' })
    return true
  } catch { return false }
}
export async function detectEncoders(): Promise<{ nvenc: boolean; x264: boolean }> {
  const [nvenc, x264] = await Promise.all([encoderWorks('h264_nvenc'), encoderWorks('libx264')])
  return { nvenc, x264 }
}
```
- [ ] **Step 6 — settings store** (+ test with a memory store + injected `detect`): add state `transcodeMode: 'auto'`, `encoderTest: null as EncoderTest | null`. Persist both in `settings.json` (extend the existing load/save shape; keep `bufferSeconds`). `setTranscodeMode(m)` (validate ∈ modes, save). `runEncoderTest()` → calls injected `detect` (default `detectEncoders`), sets `encoderTest = { ...result, testedAt: <passed-in or 0> }`, save. Add `detect?` to the store deps (`$configure`). Test: default `auto`/null; `setTranscodeMode('gpu')` persists; `runEncoderTest` with a fake detect sets `encoderTest`.
- [ ] **Step 7 — Settings UI:** in `SettingsView.vue` add a "Video transcoding" block: a `<select>` bound to `transcodeMode` (Auto / GPU (NVENC) / Software (x264) / Off) via `setTranscodeMode`; a **"Test encoders"** button → `runEncoderTest()`; show `encoderTest` as `NVENC ✅/✗ · x264 ✅/✗ (tested <when>)` or "not tested".
- [ ] **Step 8 — gate + commit.** `git commit -am "feat(settings): transcode-encoder mode + real ffmpeg self-test (resolveEncoder, detectEncoders)"`

---

### Task 3: engine + player wiring (single-flight, nvenc→x264 fallback)

**Files:** Modify `src/core/media/PlaybackEngine.ts`, `src/core/media/engine.ts`, `src/stores/player.ts` (+ `player.test.ts`).
**Interfaces:** `PlaybackEngine.start(account,item,opts?: { bufferSeconds?; startOffsetSeconds?; videoCodec?: 'copy'|'nvenc'|'x264' })`. Player store: state `transcode: boolean`; action `retryWithTranscode()`.

- [ ] **Step 1 — engine:** add `videoCodec` to `start` opts (default `'copy'`); pass it into `buildLiveRemuxArgs`/`buildVodRemuxArgs`. (Live and VOD both forward it.) No test change beyond compile; add one assertion to `engine.test.ts` that a movie started with `{ videoCodec: 'nvenc' }` yields `ffmpeg … -c:v h264_nvenc`.
- [ ] **Step 2 — failing player tests** (`player.test.ts`), mirroring the Plan-3c single-flight style:
```ts
it('retryWithTranscode restarts the SAME item at the same offset with a resolved encoder, once', async () => {
  const starts: any[] = []
  const engine = { start: vi.fn(async (_a, _i, o) => { starts.push(o); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => {} } }) }
  const p = usePlayerStore(); p.$configure({ engine, sleep: async () => {} })
  useSettingsStore().$patch({ transcodeMode: 'gpu', encoderTest: { nvenc: true, x264: true, testedAt: 1 } })
  await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
  await p.seek(1200)
  starts.length = 0
  await p.retryWithTranscode()
  expect(p.transcode).toBe(true)
  expect(starts).toHaveLength(1)
  expect(starts[0]).toMatchObject({ startOffsetSeconds: 1200, videoCodec: 'nvenc' }) // same offset, GPU
})
it('a seek after transcoding stays transcoded', async () => {
  /* set transcode via retryWithTranscode, then seek, assert engine.start last call videoCodec==='nvenc' */
})
it('play() resets transcode to copy', async () => {
  /* after retryWithTranscode, play() a new item → transcode false, videoCodec copy */
})
```
- [ ] **Step 3 — implement** in `player.ts`: add state `transcode: false`. Centralise the actual start in a private `_startSession(offset: number)` used by play/seek/retry that computes `videoCodec = this.transcode ? resolveEncoder(useSettingsStore().transcodeMode, useSettingsStore().encoderTest) : 'copy'` and calls `engine.start(this.account!, this.item!, { bufferSeconds, startOffsetSeconds: offset, videoCodec })`. `play()` sets `this.transcode = false` before starting. `seek()` keeps `this.transcode` as-is. `retryWithTranscode()`: if `useSettingsStore().transcodeMode === 'off'` → set a friendly `error`/status and return; else set `this.transcode = true` and run the same single-flight restart (mutex+gen) at `this.startOffset`. `stop()`/`fail()` reset `transcode=false`. **Runtime fallback:** wrap the `engine.start` in `_startSession`; on catch, if the attempted `videoCodec === 'nvenc'`, retry once with `videoCodec: 'x264'` before surfacing the error.
- [ ] **Step 4 — run player + engine tests + typecheck, expect PASS.**
- [ ] **Step 5 — gate + commit.** `git commit -am "feat(player): retryWithTranscode() (single-flight) + engine videoCodec + nvenc→x264 runtime fallback"`

---

### Task 4: PlayerView auto-trigger + manual button + indicator

**Files:** Modify `src/components/PlayerView.vue`; extend `dev/e2e-playback.mjs` (gitignored).
**Interfaces:** Consumes `player.transcode`, `player.retryWithTranscode`, hls.js error events.

- [ ] **Step 1 — implement in `PlayerView.vue`:**
  - **hls.js codec error:** in the existing `Hls.Events.ERROR` handler, when `!player.transcode` and the error is a decode/codec class (`data.details` ∈ {`bufferAppendError`,`bufferAddCodecError`,`fragParsingError`} or `data.type === Hls.ErrorTypes.MEDIA_ERROR` that recovery already failed twice), call `void player.retryWithTranscode()` (once) instead of `player.fail`.
  - **Watchdog:** a timer armed when a session starts; if after ~6s the video is progressing on audio (`video.currentTime > 0`) but `video.videoWidth === 0` and `!player.transcode`, call `retryWithTranscode()`. Guard: only if the manifest declares a video track (skip audio-only). Clear the timer on `loadeddata`/teardown/when videoWidth>0.
  - **Manual button** in the player bar: `⤵ Transcode` shown when `!player.transcode` (and `settings.transcodeMode !== 'off'`), calls `retryWithTranscode()`.
  - **Indicator:** when `player.transcode`, show a small badge "Transcoding · {GPU|CPU}" (GPU if resolved encoder is nvenc).
- [ ] **Step 2 — gate** (`npm run test && typecheck && build && test:smoke`). Commit `git commit -am "feat(player): auto-transcode on undecodable video (hls error + videoWidth watchdog) + manual button + indicator"`.
- [ ] **Step 3 — host/E2E verification** (orchestrator, one connection): find a real HEVC channel/movie on the panel (`ffprobe` a few stream URLs via range to spot `hevc`), then via `dev/e2e-playback.mjs` confirm it starts on copy, auto-switches to transcode, and plays H.264 (video decodes, `videoWidth>0`), with exactly one ffmpeg (`pgrep`). If no HEVC content exists on the panel, document that + verify the path by forcing `retryWithTranscode()` on an H.264 title (it should re-encode and still play). Record in `.superpowers/sdd/task-4-report.md`.

---

## Self-Review
- **Spec coverage:** §1 trigger → T4; §2 encoder settings+detection → T2; §3 pipeline args → T1; §4 wiring → T3. Spike (§Testing) done, args verified.
- **Types:** `videoCodecArgs`/builders `videoCodec` (T1) → engine `start.videoCodec` (T3); `resolveEncoder`/`TranscodeMode`/`EncoderTest` (T2) → settings store + player store (T3); `retryWithTranscode`/`player.transcode` (T3) → PlayerView (T4).
- **One-connection invariant:** transcode uses the store's existing mutex+gen single-flight restart (Plan 3c) — no new concurrency; T3 tests assert `retryWithTranscode` starts once.
- **No regression:** default `videoCodec='copy'` everywhere → H.264 live+VOD + seeking unchanged; `off` mode never transcodes.
- Deferred: audio/subtitle tracks (Plan 3e), HW HEVC *decode* (`-hwaccel cuda`) optimization, AV1.
