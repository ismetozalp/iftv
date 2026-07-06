# In-flight TV — Plan 3e: Audio-Track + Subtitle Selection

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Pick the audio track (language) and turn on/pick a text subtitle in the player — restart-based, one connection, text subs only.

**Architecture:** `ffprobe` enumerates tracks. Each of the 3 ffmpeg builders gains `-map 0:v:0 -map 0:a:<A>` and, when a subtitle is chosen, a **second WebVTT output** of the *same* process (`-map 0:s:<S> -c:s webvtt -f webvtt <dir>/sub.vtt`). A track change restarts the single session through the existing mutex+gen single-flight (like transcode/seek). PlayerView renders the subtitle as a `<track>` from a `blob:` of the growing `.vtt`, refreshed on a timer.

**Tech Stack:** unchanged (Vue3/Vite/TS/Bootstrap/Pinia/hls.js/Vitest; host ffmpeg/ffprobe).

## Global Constraints
- Builds on `main` (Plan 3d + M3U-HLS fix merged). `src/core/**` pure/DI; ffprobe in `src/adapters/**`. TDD; per-task commit; merge to `main`.
- **One connection** — a track change reuses the store's single-flight restart (never overlaps).
- Spike-verified: one ffmpeg → HLS (`-map 0:v:0 -map 0:a:N`) + `-map 0:s:M -c:s webvtt -f webvtt sub.vtt`; `subrip`→WebVTT works; `-ss` rebases sub timestamps. Map `0:v:0` (not `0:v`) to skip embedded PNG posters.
- Text subs only: `text` codecs = `subrip|mov_text|webvtt|ass|ssa|text`; bitmap (`dvb_subtitle|hdmv_pgs_subtitle`) → non-selectable.

## File Structure
- `src/core/media/tracks.ts` — types `AudioTrack`/`SubtitleTrack` + pure `parseTracks(streams)`. NEW (+test)
- `src/adapters/cockpitProbe.ts` — `probeStreams(url)` via `cockpit.spawn(ffprobe json)`. NEW
- `src/core/media/ffmpegArgs.ts` — `mapArgs(audioIndex)` + `subtitleOutputArgs(subIdx, subPath)`; the 3 builders take `audioIndex`/`subtitleIndex`/`subtitlePath`. (+test)
- `src/core/media/PlaybackEngine.ts` — `start` opts `audioIndex`/`subtitleIndex`; `PlaybackSession.readSubtitle()`.
- `src/core/media/engine.ts` — build `${dir}/sub.vtt`, pass through, expose `readSubtitle`. (+test)
- `src/stores/player.ts` — track state, discovery-on-play, `setAudioTrack`/`setSubtitle` single-flight, carry selections in every restart. (+test)
- `src/components/PlayerView.vue` — Audio + CC menus + `<track>` blob rendering with refresh timer.

---

### Task 1: Track discovery — `parseTracks` (pure) + `probeStreams` (adapter)

**Files:** Create `src/core/media/tracks.ts` (+ `tracks.test.ts`), `src/adapters/cockpitProbe.ts`.
**Produces:** `interface AudioTrack { index: number; language: string; codec: string }`, `interface SubtitleTrack { index: number; language: string; codec: string; text: boolean }`, `parseTracks(streams: unknown[]): { audio: AudioTrack[]; subtitles: SubtitleTrack[] }`, `probeStreams(url: string): Promise<unknown[]>`.

- [ ] **Step 1 — failing test** `tracks.test.ts`:
```ts
import { parseTracks } from './tracks'
const streams = [
  { codec_type: 'video', codec_name: 'h264' },
  { codec_type: 'audio', codec_name: 'aac', tags: { language: 'tur' } },
  { codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } },
  { codec_type: 'subtitle', codec_name: 'dvb_subtitle', tags: { language: 'tur' } },
  { codec_type: 'video', codec_name: 'png' }, // embedded poster — ignored
]
it('extracts type-relative audio + subtitle tracks, flags text vs bitmap', () => {
  const t = parseTracks(streams)
  expect(t.audio).toEqual([{ index: 0, language: 'tur', codec: 'aac' }])
  expect(t.subtitles).toEqual([
    { index: 0, language: 'eng', codec: 'subrip', text: true },
    { index: 1, language: 'tur', codec: 'dvb_subtitle', text: false },
  ])
})
it('handles missing tags/empty', () => {
  expect(parseTracks([{ codec_type: 'audio', codec_name: 'aac' }]).audio[0].language).toBe('')
  expect(parseTracks([])).toEqual({ audio: [], subtitles: [] })
})
```
- [ ] **Step 2 — run FAIL.** `npm run test -- tracks`
- [ ] **Step 3 — implement `tracks.ts`:**
```ts
export interface AudioTrack { index: number; language: string; codec: string }
export interface SubtitleTrack { index: number; language: string; codec: string; text: boolean }
const TEXT_SUBS = new Set(['subrip', 'mov_text', 'webvtt', 'ass', 'ssa', 'text'])
function lang(s: Record<string, unknown>): string {
  const tags = (s.tags && typeof s.tags === 'object' ? s.tags : {}) as Record<string, unknown>
  return String(tags.language || tags.LANGUAGE || '')
}
export function parseTracks(streams: unknown[]): { audio: AudioTrack[]; subtitles: SubtitleTrack[] } {
  const audio: AudioTrack[] = []; const subtitles: SubtitleTrack[] = []
  for (const raw of Array.isArray(streams) ? streams : []) {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const codec = String(s.codec_name || '')
    if (s.codec_type === 'audio') audio.push({ index: audio.length, language: lang(s), codec })
    else if (s.codec_type === 'subtitle') subtitles.push({ index: subtitles.length, language: lang(s), codec, text: TEXT_SUBS.has(codec) })
  }
  return { audio, subtitles }
}
```
- [ ] **Step 4 — run PASS.**
- [ ] **Step 5 — adapter `cockpitProbe.ts`** (thin, untestable seam):
```ts
import cockpit from 'cockpit'
// Enumerate a stream's tracks. Works for VOD (direct URL) and HLS (.m3u8) live; direct-.ts live may
// fail (redirect) → caller treats a throw as "no track info".
export async function probeStreams(url: string): Promise<unknown[]> {
  const out = await cockpit.spawn(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', url], { err: 'message' })
  try { return (JSON.parse(out as string).streams as unknown[]) ?? [] } catch { return [] }
}
```
- [ ] **Step 6 — gate + commit.** `git commit -am "feat(tracks): ffprobe track discovery — parseTracks (pure) + probeStreams adapter"`

---

### Task 2: Track-aware ffmpeg args + engine

**Files:** Modify `src/core/media/ffmpegArgs.ts` (+test), `src/core/media/PlaybackEngine.ts`, `src/core/media/engine.ts` (+test).
**Interfaces:** `mapArgs(audioIndex: number): string[]`; `subtitleOutputArgs(subtitleIndex: number | null, subtitlePath: string | null): string[]`. Each `*RemuxArgsInput` gains `audioIndex?: number` (default 0), `subtitleIndex?: number | null` (default null), `subtitlePath?: string | null`. `start` opts gain `audioIndex?: number; subtitleIndex?: number | null`. `PlaybackSession.readSubtitle(): Promise<Uint8Array | null>`.

- [ ] **Step 1 — failing test** in `ffmpegArgs.test.ts`:
```ts
import { mapArgs, subtitleOutputArgs, buildVodRemuxArgs } from './ffmpegArgs'
it('mapArgs maps first video + the chosen audio', () => {
  expect(mapArgs(1)).toEqual(['-map', '0:v:0', '-map', '0:a:1'])
})
it('subtitleOutputArgs emits a webvtt output only when a subtitle is chosen', () => {
  expect(subtitleOutputArgs(null, null)).toEqual([])
  expect(subtitleOutputArgs(0, '/c/sub.vtt').join(' ')).toBe('-map 0:s:0 -c:s webvtt -f webvtt /c/sub.vtt')
})
it('builders insert the audio map and append the subtitle output', () => {
  const a = buildVodRemuxArgs({ inputUrl: 'http://h/m.mkv', offsetSeconds: 0, burstSeconds: 30, playlistPath: '/c/i.m3u8', segmentPath: '/c/s.ts', audioIndex: 1, subtitleIndex: 0, subtitlePath: '/c/sub.vtt' }).join(' ')
  expect(a).toContain('-map 0:v:0 -map 0:a:1')
  expect(a.indexOf('-map 0:a:1')).toBeLessThan(a.indexOf('-c:v')) // maps before codec
  expect(a).toContain('-map 0:s:0 -c:s webvtt -f webvtt /c/sub.vtt')
  expect(a.indexOf('/c/i.m3u8')).toBeLessThan(a.indexOf('-map 0:s:0')) // sub output AFTER the playlist
})
it('no maps change / no sub output by default', () => {
  const a = buildVodRemuxArgs({ inputUrl: 'u', offsetSeconds: 0, burstSeconds: 30, playlistPath: 'p', segmentPath: 's' }).join(' ')
  expect(a).toContain('-map 0:v:0 -map 0:a:0'); expect(a).not.toContain('-c:s webvtt')
})
```
- [ ] **Step 2 — run FAIL.**
- [ ] **Step 3 — implement** in `ffmpegArgs.ts`:
```ts
export function mapArgs(audioIndex: number): string[] { return ['-map', '0:v:0', '-map', `0:a:${audioIndex}`] }
export function subtitleOutputArgs(subtitleIndex: number | null, subtitlePath: string | null): string[] {
  return subtitleIndex != null && subtitlePath ? ['-map', `0:s:${subtitleIndex}`, '-c:s', 'webvtt', '-f', 'webvtt', subtitlePath] : []
}
```
Add `audioIndex = 0`, `subtitleIndex = null`, `subtitlePath = null` to all 3 `*RemuxArgsInput` + their destructured params. In each builder: insert `...mapArgs(audioIndex),` immediately before `...videoCodecArgs(videoCodec),`, and append `...subtitleOutputArgs(subtitleIndex, subtitlePath),` as the LAST elements (after `playlistPath`). Keep everything else identical.
- [ ] **Step 4 — run PASS.**
- [ ] **Step 5 — engine.** `PlaybackEngine.start` opts gain `audioIndex?: number; subtitleIndex?: number | null`. `PlaybackSession` gains `readSubtitle(): Promise<Uint8Array | null>`. In `engine.ts`:
```ts
const audioIndex = opts?.audioIndex ?? 0
const subtitleIndex = opts?.subtitleIndex ?? null
const subtitlePath = subtitleIndex != null ? `${dir}/sub.vtt` : null
```
Pass `audioIndex, subtitleIndex, subtitlePath` into all three builder calls. In the returned session add:
```ts
readSubtitle: async () => (subtitlePath ? deps.readFile(subtitlePath) : null),
```
Add to `engine.test.ts`: a movie started with `{ audioIndex: 1, subtitleIndex: 0 }` → ffmpeg args contain `-map 0:a:1` and `-map 0:s:0 -c:s webvtt -f webvtt /home/u/.cache/inflighttv/sid/sub.vtt`, and `s.readSubtitle` is a function (reads that path); default start (no opts) → no `-c:s webvtt`, `readSubtitle()` resolves null.
- [ ] **Step 6 — gate + commit.** `git commit -am "feat(tracks): ffmpeg audio -map + webvtt subtitle output in all builders; engine subtitle path + session.readSubtitle"`

---

### Task 3: Player store — selection state + single-flight restart

**Files:** Modify `src/stores/player.ts` (+ `player.test.ts`).
**Interfaces (Consumes):** Task-1 `parseTracks`/`AudioTrack`/`SubtitleTrack`, Task-2 `start({audioIndex, subtitleIndex})`. **Produces:** state `audioTracks`, `subtitleTracks`, `selectedAudio: number`, `selectedSubtitle: number | null`; actions `setAudioTrack(i)`, `setSubtitle(i | null)`; `PlayerDeps.probe?: (account, item) => Promise<{audio; subtitles}>`.

- [ ] **Step 1 — failing tests** `player.test.ts` (mirror the transcode single-flight style):
```ts
it('play() discovers tracks (via injected probe) and defaults to audio 0 / no subtitle', async () => {
  const { engine } = engineWith()
  const probe = vi.fn(async () => ({ audio: [{ index: 0, language: 'tur', codec: 'aac' }], subtitles: [{ index: 0, language: 'eng', codec: 'subrip', text: true }] }))
  const p = usePlayerStore(); p.$configure({ engine, sleep: async () => {}, probe })
  await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
  await Promise.resolve() // let discovery settle
  expect(p.selectedAudio).toBe(0); expect(p.selectedSubtitle).toBe(null)
  expect(p.subtitleTracks.length).toBe(1)
})
it('setSubtitle restarts ONCE at the same offset with subtitleIndex, single-flight', async () => {
  const starts: any[] = []
  const engine = { start: vi.fn(async (_a, _i, o) => { starts.push(o); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, readSubtitle: async () => null, stop: async () => {} } }) }
  const p = usePlayerStore(); p.$configure({ engine, sleep: async () => {}, probe: async () => ({ audio: [], subtitles: [{ index: 0, language: 'eng', codec: 'subrip', text: true }] }) })
  await p.play(ACCT, MOVIE, { durationSeconds: 5400 }); await p.seek(600)
  starts.length = 0
  await p.setSubtitle(0)
  expect(starts).toHaveLength(1)
  expect(starts[0]).toMatchObject({ startOffsetSeconds: 600, subtitleIndex: 0 })
  expect(p.selectedSubtitle).toBe(0)
})
it('a seek after picking audio/subtitle keeps the selection', async () => {
  /* setAudioTrack(1)+setSubtitle(0), then seek → engine.start last call has audioIndex:1, subtitleIndex:0 */
})
it('rapid track changes never start two sessions (maxActive===1)', async () => { /* like the transcode maxActive test */ })
```
- [ ] **Step 2 — run FAIL. Step 3 — implement:** add state `audioTracks: [] as AudioTrack[]`, `subtitleTracks: [] as SubtitleTrack[]`, `selectedAudio: 0`, `selectedSubtitle: null as number | null`. Add `probe` to `PlayerDeps` (default `async (account, item) => parseTracks(await probeStreams(playbackUrl(account, item) ?? ''))` — import `playbackUrl`, `probeStreams`, `parseTracks`). In `play()`, after a successful start, reset selections (`selectedAudio=0`, `selectedSubtitle=null`) and fire discovery guarded by `gen`: `this._deps.probe(account,item).then(t => { if (gen === this._mx.gen) { this.audioTracks = t.audio; this.subtitleTracks = t.subtitles } }).catch(() => {})`. Add a private `_videoCodec`-style resolver already exists; thread `audioIndex: this.selectedAudio, subtitleIndex: this.selectedSubtitle` into EVERY `engine.start(...)` call (play, seek, retryWithTranscode, fallbackToSoftware). Add:
```ts
async setAudioTrack(i: number) { this.selectedAudio = i; await this._restartCurrent() },
async setSubtitle(i: number | null) { this.selectedSubtitle = i; await this._restartCurrent() },
```
where `_restartCurrent()` mirrors `fallbackToSoftware`'s single-flight body (mutex+gen, stop→settle→start at `this.startOffset`, carrying videoCodec + audioIndex + subtitleIndex). Reset tracks/selections in `stop`/`fail`.
- [ ] **Step 4 — run tests + typecheck PASS. Step 5 — gate + commit.** `git commit -am "feat(player): audio/subtitle track state + discovery-on-play + setAudioTrack/setSubtitle single-flight restart"`

---

### Task 4: PlayerView — Audio + CC menus + WebVTT `<track>` rendering

**Files:** Modify `src/components/PlayerView.vue`, `src/styles/app.css`; E2E verify.

- [ ] **Step 1 — menus.** In the player bar add, before the badge:
  - **Audio** `<select>` shown when `player.audioTracks.length > 1`: options = each track (`{{ language || 'Audio '+index }}`), `:value="player.selectedAudio"`, `@change` → `player.setAudioTrack(Number($event.target.value))`.
  - **CC** `<select>`: an `Off` option (value `''`) + each subtitle; **text subs selectable, bitmap `:disabled` with `(bitmap)` suffix**; `:value="player.selectedSubtitle ?? ''"`, `@change` → `player.setSubtitle($event.target.value === '' ? null : Number($event.target.value))`.
- [ ] **Step 2 — subtitle `<track>` rendering.** Add a `<track ref="subTrack" kind="subtitles" label="Subtitles" default>` inside `<video>`. Logic: `watch([() => player.selectedSubtitle, () => player.session], refreshSub)`. `refreshSub()`: if `selectedSubtitle == null || !session` → remove/clear the track src, stop the timer; else start a ~3s interval that does `const bytes = await player.session.readSubtitle(); if (bytes) { const url = URL.createObjectURL(new Blob([bytes], { type: 'text/vtt' })); if (lastUrl) URL.revokeObjectURL(lastUrl); subTrack.src = url; lastUrl = url; subTrack.track.mode = 'showing' }`. Clear the interval + revoke the blob in `teardown()`. (Growing .vtt → refreshing the blob src reloads cues.)
- [ ] **Step 3 — styles** for the two `<select>` (small, dark bar) in app.css (`.iftv-track-select { max-width: 9rem; }` on `form-select-sm`).
- [ ] **Step 4 — gate** (`npm run test && typecheck && build && test:smoke`). Commit `git commit -am "feat(player): audio-track + subtitle (CC) menus and WebVTT track rendering"`.
- [ ] **Step 5 — E2E** (`dev/e2e-*.mjs`, real Cockpit, JetIPTV account): play the `subrip` movie (id 222601) → the **CC** menu lists English/Turkish → pick English → assert the `<track>` gets a `blob:` src and `video.textTracks[0].cues.length > 0` after a few seconds, video still playing, one ffmpeg. Record in `.superpowers/sdd/task-4-report.md`.

---

## Self-Review
- **Spec coverage:** §1 discovery → T1; §2 engine args → T2; §3 store → T3; §4 UI+render → T4. Spike done.
- **Types:** `parseTracks`/`AudioTrack`/`SubtitleTrack` (T1) → store + PlayerView; `mapArgs`/`subtitleOutputArgs` + builder params (T2) → engine; `start({audioIndex,subtitleIndex})` + `session.readSubtitle` (T2) → store (T3) + PlayerView (T4); `selectedAudio`/`selectedSubtitle`/`setAudioTrack`/`setSubtitle` (T3) → PlayerView (T4).
- **One-connection:** `setAudioTrack`/`setSubtitle` use the store's single-flight `_restartCurrent` (mutex+gen); T3 asserts maxActive===1; every restart path carries audioIndex+subtitleIndex so selections persist and never spawn a 2nd session.
- **No regression:** default `audioIndex:0` (was ffmpeg's auto-first-audio → equivalent), `subtitleIndex:null` → no sub output; copy/live/VOD/seek/transcode unchanged. `-map 0:v:0` fixes the embedded-poster case (a latent improvement).
- Bitmap subs non-selectable; live discovery best-effort (throw → empty menus).
