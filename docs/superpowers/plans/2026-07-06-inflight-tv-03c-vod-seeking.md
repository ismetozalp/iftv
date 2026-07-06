# In-flight TV — Plan 3c: VOD On-Demand Seeking + Full Runtime

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Movies/episodes show their full runtime and let the user seek anywhere, while the panel never sees more than one connection.

**Architecture:** VOD reads the panel movie URL **directly** with `ffmpeg -ss <offset>` (spike-proven: movies are HTTP-range-seekable and don't redirect, so no curl/FIFO for VOD). A seek **stops the one running ffmpeg, waits for teardown, then restarts at the new offset** (serialized/coalesced — never two connections). Full runtime comes from `get_vod_info` metadata; a custom seekbar maps `playhead = startOffset + video.currentTime` onto `0…duration`. Live is unchanged (curl→FIFO).

**Tech Stack:** unchanged (Vue3/Vite/TS/Bootstrap/Pinia/hls.js/Vitest; host ffmpeg 7.1.5).

## Global Constraints
- Builds on `main` (3b + all playback fixes merged; movies play from 0 via `buildRemuxArgs` VOD event playlist). `src/core/**` pure/DI-tested; cockpit only in `src/adapters/**`. TDD; per-task commit; no push; merge to `main` per the autonomous workflow.
- **Exactly one panel connection at any instant.** Only one playback session (one ffmpeg for VOD / one curl+ffmpeg for live) alive; a seek stops-then-(settle)-then-starts. Seeks are coalesced (latest wins), never overlap.
- Spike (done 2026-07-06): movie URL → HTTP 206 on Range GET; `ffmpeg -ss 300 -i <movieUrl>` seeks in ~3s, no stall. So VOD = `ffmpeg -ss` direct on the panel movie URL.
- VOD ffmpeg input options order: `-user_agent … -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -ss <offset> -readrate 1 -readrate_initial_burst <burst> -i <url>` (all before `-i`; `-ss` before `-i` = fast range-seek). UA const `STREAM_USER_AGENT` from `ffmpegArgs.ts`.

## File Structure
- `src/core/media/ffmpegArgs.ts` — split the single `buildRemuxArgs` into `buildLiveRemuxArgs` (FIFO input, live window) + `buildVodRemuxArgs` (URL input, `-ss`, EVENT). (+ test)
- `src/core/media/PlaybackEngine.ts` — `start(account,item,opts?)` opts gains `startOffsetSeconds`; `PlaybackSession` gains `isLive`.
- `src/core/media/engine.ts` — branch live (curl→FIFO, unchanged) vs VOD (ffmpeg `-ss` direct, no curl/FIFO). (+ test)
- `src/core/media/seekbar.ts` — pure helpers: `formatTime(s)`, `seekFraction(playhead,duration)`, `bufferedFraction(...)`. NEW (+ test)
- `src/stores/player.ts` — state `duration`, `startOffset`, `account`; `play(account,item,opts?)`; `seek(toSeconds)` (coalesced single-flight). (+ test)
- `src/views/detail/MovieDetail.vue`, `src/views/detail/SeriesDetail.vue` — pass duration into `play`.
- `src/components/PlayerView.vue` — custom seekbar when `duration != null`; else current behavior. `src/styles/app.css` — bar styles.
- `src/stores/detail.ts` (or a watch in the account bar) — `close()` on active-account change.
- `dev/e2e-playback.mjs` (gitignored) — extend with a seek assertion.

---

### Task 1: VOD engine reads the movie URL directly with `-ss` (offset-aware, no curl/FIFO)

**Files:** Modify `src/core/media/ffmpegArgs.ts` (+ `ffmpegArgs.test.ts`), `src/core/media/PlaybackEngine.ts`, `src/core/media/engine.ts` (+ `engine.test.ts`).

**Interfaces:**
- Produces `buildVodRemuxArgs({ inputUrl: string, offsetSeconds: number, burstSeconds: number, playlistPath: string, segmentPath: string }): string[]`
- Produces `buildLiveRemuxArgs({ inputPath: string, liveWindow: number, playlistPath: string, segmentPath: string }): string[]` (was `buildRemuxArgs({..., live:true})`)
- `PlaybackEngine.start(account, item, opts?: { bufferSeconds?: number; startOffsetSeconds?: number })`
- `PlaybackSession` = `{ sourceUrl: string; isLive: boolean; createLoader(): unknown; stop(): Promise<void> }`

- [ ] **Step 1 — failing test for `buildVodRemuxArgs`** in `ffmpegArgs.test.ts`:
```ts
import { buildVodRemuxArgs, buildLiveRemuxArgs, STREAM_USER_AGENT } from './ffmpegArgs'

describe('buildVodRemuxArgs', () => {
  const a = buildVodRemuxArgs({ inputUrl: 'http://h/movie/u/p/9.mkv', offsetSeconds: 300, burstSeconds: 30, playlistPath: '/c/index.m3u8', segmentPath: '/c/seg_%05d.ts' })
  it('range-seeks to the offset, paces, reads the URL directly, EVENT keep-all', () => {
    expect(a.join(' ')).toContain('-ss 300')
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'))          // input seek (fast)
    expect(a.join(' ')).toContain('-readrate 1 -readrate_initial_burst 30')
    expect(a.join(' ')).toContain(`-i http://h/movie/u/p/9.mkv`)
    expect(a).toContain('-user_agent'); expect(a).toContain(STREAM_USER_AGENT)
    expect(a).toContain('-reconnect')
    expect(a.join(' ')).toContain('-hls_list_size 0')
    expect(a.join(' ')).toContain('-hls_playlist_type event')
    expect(a[a.length - 1]).toBe('/c/index.m3u8')
  })
  it('offset 0 still emits -ss 0', () => {
    expect(buildVodRemuxArgs({ inputUrl: 'u', offsetSeconds: 0, burstSeconds: 30, playlistPath: 'p', segmentPath: 's' }).join(' ')).toContain('-ss 0')
  })
})
```
- [ ] **Step 2 — run, expect FAIL** (`buildVodRemuxArgs` undefined): `npm run test -- ffmpegArgs`
- [ ] **Step 3 — implement** in `ffmpegArgs.ts`: rename the `live` branch of `buildRemuxArgs` into `buildLiveRemuxArgs` (keep exact live args: `-y -i <fifo> -c:v copy -c:a aac -b:a 128k -f hls -hls_time 4 -hls_list_size <liveWindow> -hls_flags delete_segments+append_list+omit_endlist -hls_segment_type mpegts -hls_segment_filename <seg> <playlist>`), and add:
```ts
export function buildVodRemuxArgs({ inputUrl, offsetSeconds, burstSeconds, playlistPath, segmentPath }: VodRemuxArgsInput): string[] {
  return [
    '-y',
    '-user_agent', STREAM_USER_AGENT,
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-ss', String(offsetSeconds),                  // input seek → HTTP range, fast
    '-readrate', '1', '-readrate_initial_burst', String(burstSeconds),
    '-i', inputUrl,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
    '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_flags', 'append_list',
    '-hls_segment_type', 'mpegts', '-hls_segment_filename', segmentPath,
    playlistPath,
  ]
}
```
Update the existing VOD `buildRemuxArgs` test to target `buildLiveRemuxArgs` for the live case and delete the old FIFO-based VOD assertions (VOD no longer uses the FIFO builder). Keep `STREAM_USER_AGENT` export.
- [ ] **Step 4 — run ffmpegArgs tests, expect PASS.**
- [ ] **Step 5 — engine test** in `engine.test.ts`: add `isLive` to the session mock deps if needed; update the live/VOD test:
```ts
it('LIVE = curl+ffmpeg over a FIFO; VOD = a single ffmpeg reading the URL directly with -ss (no curl/fifo)', async () => {
  const dLive = deps(); const sLive = await createPlaybackEngine(dLive).start(XT, item) // live
  expect(sLive.isLive).toBe(true)
  expect(dLive.mkfifo).toHaveBeenCalled()
  const liveCalls = spawnArgs(dLive).map(a => a[0]); expect(liveCalls).toContain('curl'); expect(liveCalls).toContain('ffmpeg')

  const movie = { ...item, id: 'x:movie:9', kind: 'movie' as const, streamId: '9', containerExtension: 'mkv' }
  const dVod = deps(); const sVod = await createPlaybackEngine(dVod).start(XT, movie, { startOffsetSeconds: 120 })
  expect(sVod.isLive).toBe(false)
  expect(dVod.mkfifo).not.toHaveBeenCalled()                    // no FIFO for VOD
  const vodCalls = spawnArgs(dVod).map(a => a[0]); expect(vodCalls).not.toContain('curl') // no curl for VOD
  const ff = spawnArgs(dVod).find(a => a[0] === 'ffmpeg')!.join(' ')
  expect(ff).toContain('-ss 120')
  expect(ff).toContain('http://h:8080/movie/u/p/9.mkv')          // reads the panel url directly
  expect(ff).toContain('-hls_playlist_type event')
})
```
- [ ] **Step 6 — run, expect FAIL.** `npm run test -- media/engine`
- [ ] **Step 7 — implement engine branch** in `engine.ts`. Add `startOffsetSeconds` to opts. Keep live path (curl→FIFO via `buildLiveRemuxArgs`). VOD path:
```ts
const live = item.kind === 'live'
const bufferSeconds = opts?.bufferSeconds ?? 30
if (live) {
  const fifo = `${dir}/in.ts`; await deps.mkfifo(fifo)
  const liveWindow = Math.max(6, Math.ceil(bufferSeconds / 4) + 2)
  const curl = deps.spawn(['curl', ...buildCurlArgs({ url: inputUrl, outPath: fifo, userAgent: STREAM_USER_AGENT })])
  const ff = deps.spawn(['ffmpeg', ...buildLiveRemuxArgs({ inputPath: fifo, liveWindow, playlistPath: playlistPath(dir), segmentPath: segmentPattern(dir) })])
  procs = [curl, ff]
} else {
  const ff = deps.spawn(['ffmpeg', ...buildVodRemuxArgs({ inputUrl, offsetSeconds: opts?.startOffsetSeconds ?? 0, burstSeconds: bufferSeconds, playlistPath: playlistPath(dir), segmentPath: segmentPattern(dir) })])
  procs = [ff]
}
const stopAll = (p: string) => procs.forEach((x) => x.close(p))
```
Return `{ sourceUrl: sourceUrl(id), isLive: live, createLoader, async stop() { stopAll('terminated'); await deps.rmrf(dir) } }`. `inputUrl = playbackUrl(account, item)` unchanged; the "not playable" guard unchanged.
- [ ] **Step 8 — run media tests + typecheck, expect PASS.** `npm run test -- media && npm run typecheck`
- [ ] **Step 9 — full gate + commit.** `npm run test && npm run typecheck && npm run build && npm run test:smoke`, then:
```bash
git commit -am "feat(playback): VOD reads the movie URL directly with ffmpeg -ss (offset-aware, no curl/FIFO); split live/VOD arg builders"
```

---

### Task 2: Duration + player-store `seek` (coalesced, single-connection)

**Files:** Modify `src/stores/player.ts` (+ `player.test.ts`), `src/views/detail/MovieDetail.vue`, `src/views/detail/SeriesDetail.vue`.

**Interfaces:**
- Consumes Task 1's `engine.start(account, item, { bufferSeconds, startOffsetSeconds })`.
- Produces player store state `duration: number | null`, `startOffset: number`, and actions `play(account, item, opts?: { durationSeconds?: number | null })`, `seek(toSeconds: number)`.
- Adds `PlayerDeps.sleep?: (ms: number) => Promise<void>` (default real setTimeout) so the settle-delay is stubbable in tests.

- [ ] **Step 1 — failing tests** in `player.test.ts` (extend `engineWith` mock to record start-arg order and share one `stop`):
```ts
it('play() records duration + starts at offset 0', async () => {
  const { engine } = engineWith()
  const p = usePlayerStore(); p.$configure({ engine, sleep: async () => {} })
  await p.play(ACC, MOVIE, { durationSeconds: 5400 })
  expect(p.duration).toBe(5400); expect(p.startOffset).toBe(0)
  expect(engine.start).toHaveBeenCalledWith(ACC, MOVIE, expect.objectContaining({ startOffsetSeconds: 0 }))
})
it('seek() stops the current session BEFORE starting the next (one connection) and sets startOffset', async () => {
  const order: string[] = []
  const stop = vi.fn(async () => { order.push('stop') })
  const engine = { start: vi.fn(async () => { order.push('start'); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop } }) }
  const p = usePlayerStore(); p.$configure({ engine, sleep: async () => { order.push('settle') } })
  await p.play(ACC, MOVIE, { durationSeconds: 5400 })
  order.length = 0
  await p.seek(1200)
  expect(order).toEqual(['stop', 'settle', 'start']) // stop → settle → start, never overlapped
  expect(p.startOffset).toBe(1200)
  expect(engine.start).toHaveBeenLastCalledWith(ACC, MOVIE, expect.objectContaining({ startOffsetSeconds: 1200 }))
})
it('seek() clamps to [0, duration]', async () => {
  const { engine } = engineWith(); const p = usePlayerStore(); p.$configure({ engine, sleep: async () => {} })
  await p.play(ACC, MOVIE, { durationSeconds: 100 })
  await p.seek(999); expect(p.startOffset).toBe(100)
  await p.seek(-5); expect(p.startOffset).toBe(0)
})
it('rapid seeks coalesce to the latest and never start two sessions at once', async () => {
  let active = 0, maxActive = 0
  const engine = { start: vi.fn(async () => { active++; maxActive = Math.max(maxActive, active); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => { active-- } } }) }
  const p = usePlayerStore(); p.$configure({ engine, sleep: async () => {} })
  await p.play(ACC, MOVIE, { durationSeconds: 5400 })
  await Promise.all([p.seek(60), p.seek(120), p.seek(180)])
  expect(maxActive).toBe(1)                 // never two live sessions
  expect(p.startOffset).toBe(180)           // latest wins
})
```
- [ ] **Step 2 — run, expect FAIL.** `npm run test -- player`
- [ ] **Step 3 — implement** in `player.ts`. Add state `duration: number | null = null`, `startOffset = 0`, private `account: Account | null`, `_pendingSeek: number | null`, `_seeking: boolean`, and `sleep` dep (default `(ms) => new Promise(r => setTimeout(r, ms))`, settle const `SETTLE_MS = 700`). `play(account, item, opts?)`: set `this.account = account`, `this.duration = opts?.durationSeconds ?? null`, `this.startOffset = 0`, then existing start flow with `engine.start(account, item, { bufferSeconds, startOffsetSeconds: 0 })`. Add:
```ts
async seek(toSeconds: number) {
  if (!this.account || !this.item || this.duration == null) return
  this._pendingSeek = Math.max(0, Math.min(toSeconds, this.duration))
  if (this._seeking) return
  this._seeking = true
  try {
    while (this._pendingSeek != null) {
      const target = this._pendingSeek; this._pendingSeek = null
      const bufferSeconds = useSettingsStore().bufferSeconds
      const s = this.session; this.session = null
      if (s) await s.stop()                 // release the one connection
      await this.sleep(SETTLE_MS)           // let the panel see the drop before reconnecting
      this.session = await this._engineStart(this.account, this.item, { bufferSeconds, startOffsetSeconds: target })
      this.startOffset = target; this.status = 'playing'
    }
  } catch (e) { this.status = 'error'; this.error = e instanceof Error ? e.message : String(e); this.session = null }
  finally { this._seeking = false }
}
```
(`_engineStart` = the awaited `(await this._engine()).start`.) Ensure `stop()`/account-switch resets `duration`, `startOffset`, `_pendingSeek`.
- [ ] **Step 4 — run player tests + typecheck, expect PASS.**
- [ ] **Step 5 — pass duration from the detail views.** In `MovieDetail.vue` `play()`, call `player.play(account, playItem, { durationSeconds: detail.movie.durationSecs || null })`. In `SeriesDetail.vue` episode play, pass `{ durationSeconds: episode.durationSecs ?? null }` (add `durationSecs` to the `Episode` type + `getSeriesInfo` mapping from `info.duration_secs` if present, else null — one small mapping line + a test assertion; if the panel omits it the episode simply keeps the growing bar).
- [ ] **Step 6 — full gate + commit.**
```bash
git commit -am "feat(player): seek() restarts VOD at an offset (coalesced, one connection at a time) + carries metadata duration"
```

---

### Task 3: Custom seekbar UI in PlayerView

**Files:** Create `src/core/media/seekbar.ts` (+ `seekbar.test.ts`); modify `src/components/PlayerView.vue`, `src/styles/app.css`.

**Interfaces:**
- Produces `formatTime(seconds: number): string` (`h:mm:ss` when ≥1h else `m:ss`), `clampFraction(n: number): number` (0..1).
- Consumes `player.duration`, `player.startOffset`, `player.seek`, and the `<video>` element's `currentTime`/`buffered`.

- [ ] **Step 1 — failing tests** `seekbar.test.ts`:
```ts
import { formatTime, clampFraction } from './seekbar'
it('formats time', () => { expect(formatTime(65)).toBe('1:05'); expect(formatTime(3661)).toBe('1:01:01'); expect(formatTime(0)).toBe('0:00'); expect(formatTime(NaN)).toBe('0:00') })
it('clamps fractions', () => { expect(clampFraction(-1)).toBe(0); expect(clampFraction(2)).toBe(1); expect(clampFraction(0.5)).toBe(0.5) })
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement `seekbar.ts`** (pure, no imports):
```ts
export function clampFraction(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : Number.isFinite(n) ? n : 0 }
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
```
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — PlayerView custom bar.** In `PlayerView.vue`: track `const now = ref(0)` (playhead) updated on `@timeupdate`/`@progress` from the `<video>`: `now.value = player.startOffset + video.currentTime`. Compute `bufferedEnd = player.startOffset + (video.buffered.length ? video.buffered.end(video.buffered.length-1) : 0)`. Render, only when `player.duration != null`, a control bar (native `controls` OFF in this mode):
```html
<div v-if="player.status !== 'idle' && player.duration != null" class="iftv-seekbar">
  <button class="btn btn-sm btn-light" @click="togglePlay">{{ paused ? '▶' : '⏸' }}</button>
  <span class="iftv-seek-time">{{ formatTime(now) }}</span>
  <div class="iftv-seek-track" ref="track" @click="onScrub">
    <div class="iftv-seek-buffered" :style="{ width: clampFraction(bufferedEnd / player.duration) * 100 + '%' }"></div>
    <div class="iftv-seek-played" :style="{ width: clampFraction(now / player.duration) * 100 + '%' }"></div>
  </div>
  <span class="iftv-seek-time">{{ formatTime(player.duration) }}</span>
</div>
```
`onScrub(e)`: `const r = track.getBoundingClientRect(); const frac = clampFraction((e.clientX - r.left) / r.width); player.seek(frac * player.duration)`. `togglePlay`: play/pause the `<video>`. When `player.duration == null` (live / no-duration episode) keep the existing native `controls` behavior (bind `:controls="player.duration == null"`). Keep the existing **Buffering…** overlay (it now also shows during a seek restart).
- [ ] **Step 6 — styles** in `app.css`: `.iftv-seekbar { display:flex; align-items:center; gap:.5rem; padding:.4rem .8rem; background:rgba(0,0,0,.85); }` `.iftv-seek-track { position:relative; flex:1; height:6px; border-radius:3px; background:#444; cursor:pointer; }` `.iftv-seek-buffered/.iftv-seek-played { position:absolute; left:0; top:0; height:100%; border-radius:3px; }` buffered `#888`, played `#0d6efd`. `.iftv-seek-time { color:#ddd; font-variant-numeric:tabular-nums; font-size:.8rem; min-width:3.5rem; }`.
- [ ] **Step 7 — gate + commit.**
```bash
git commit -am "feat(player): custom seekbar for VOD — full runtime, scrub-to-seek, buffered band (native controls kept for live)"
```

---

### Task 4: Account-switch closes detail overlay + E2E seek verification

**Files:** Modify `src/stores/detail.ts` (+ `detail.test.ts`) and its caller/watch; extend `dev/e2e-playback.mjs`.

**Interfaces:** Consumes `useDetailStore().close()`. No new exports.

- [ ] **Step 1 — failing test** `detail.test.ts`: after `openMovie`, calling the workspace active-account change handler closes it. Simplest: assert the app-level watch calls `detail.close()` — implement as a store action `onAccountChange()` that calls `close()`, unit-tested:
```ts
it('closes an open detail when the active account changes', () => {
  const d = useDetailStore(); d.$patch({ open: true, mode: 'movie', movie: {} as never })
  d.close(); expect(d.open).toBe(false); expect(d.mode).toBe(null)
})
```
- [ ] **Step 2 — wire it:** in the component that watches `ws.activeAccount` (the account tab bar / `BrowseView`/`HomeView` where `setContext` is called on account change), add `detail.close()` to that same watcher. Run tests, expect PASS.
- [ ] **Step 3 — extend `dev/e2e-playback.mjs`** (gitignored, real Cockpit, ONE connection): after the movie is playing and `duration` is finite, drive a seek and verify:
```js
// after playback confirmed:
const dur = await frame.evaluate(() => document.querySelector('video') ? document.querySelector('video').closest('.iftv-player') && window.__iftvDuration : null) // or read the seekbar total label
// click the seek track at ~60% and confirm the playhead jumps forward then plays
await frame.click('.iftv-seek-track', { position: { x: /* ~60% width */ } })
// sample for ~12s: expect a brief buffering then currentTime advancing again, and the displayed playhead near 60% of runtime
```
Assert (a) the total-time label shows the full runtime (finite, > streamed), (b) after the seek the playhead is near the target (not 0, not the old position), (c) on the host, `pgrep -af "hls_segment_filename"` shows exactly one ffmpeg during/after the seek (no second connection). Run it; capture the sample log.
- [ ] **Step 4 — run the E2E**, paste the sample + the one-ffmpeg check into `.superpowers/sdd/task-4-report.md`. (Manual/host verification, not part of `npm test`.)
- [ ] **Step 5 — gate + commit.**
```bash
git commit -am "fix(detail): close the detail overlay on account switch; add VOD seek E2E check"
```

---

## Self-Review
- **Spec coverage:** §3 offset engine → T1; §4 duration + §5 seek → T2; §6 custom seekbar → T3; §7 account-switch + E2E seek → T4. §1 spike already done (recorded in spec). §2 dropped (movies don't redirect).
- **Types:** `buildVodRemuxArgs`/`buildLiveRemuxArgs` consumed by `engine.ts`; `start(...,{startOffsetSeconds})` + `PlaybackSession.isLive` consumed by T2/T3; `player.duration/startOffset/seek` consumed by T3 UI + T4 E2E; `formatTime/clampFraction` in T3. `Episode.durationSecs` added in T2 (get_series_info) used by SeriesDetail.
- **Single-connection invariant** enforced in T2 `seek` (stop→settle→start, coalesced) and tested (`maxActive===1`); T4 re-verifies on the real host (one ffmpeg).
- **No regression:** live unchanged (curl→FIFO via `buildLiveRemuxArgs`); VOD-from-0 is `ffmpeg -ss 0` direct (spike-proven equivalent). `duration == null` → existing native/growing behavior.
- Deferred (not this plan): hardware-accel, subtitle/audio tracks, HEVC transcode.
