# In-flight TV — Plan 3: Live Playback (Media Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a **live channel** in the browser. Click a live item → a host-side **ffmpeg** (via `cockpit.spawn`) remuxes the upstream stream to a rolling **HLS** window on disk → the browser feeds those files to **hls.js** through a custom loader that reads bytes via `cockpit.file` (no network, no CORS, no mixed-content) → the `<video>` plays. Works for Xtream live (`/live/{u}/{p}/{id}.ts`) and M3U direct URLs. VOD/Series playback, seeking, detail views, and hardware-accel settings are Plan 3b.

**Architecture (de-risked by research):** Pure core builds the upstream URL + the ffmpeg argv + session paths + the hls.js loader class (over an injected byte-reader). A Cockpit-backed **playback engine** spawns ffmpeg, waits for the playlist to appear, and returns a session (`sourceUrl` + a loader class + `stop()`). A thin Pinia `player` store tracks the current session; a `PlayerView` overlay attaches hls.js (`pLoader`/`fLoader` = the session loader, `enableWorker:false`) to a `<video>`. Stop kills ffmpeg with `.close('terminated')` (SIGTERM) and removes the temp dir.

**Tech Stack:** Vue 3, Vite, TS, Bootstrap 5, Pinia, **hls.js** (new dep), Vitest, Playwright; ffmpeg on the host.

## Global Constraints

- Builds on `main` (Plans 1, Accounts v2, 2, 2b merged). `src/core/**` pure (host access injected). Adapters may import `cockpit`.
- Live playback only. Upstream URL: M3U item → `item.url`; Xtream live item → `{scheme}://{host}:{port}/live/{username}/{password}/{streamId}.ts`. Non-live / non-playable items do nothing when clicked.
- ffmpeg live args (exact): `-y -reconnect 1 -reconnect_streamed 1 -reconnect_at_eof 1 -reconnect_delay_max 5 -i <url> -c:v copy -c:a aac -b:a 128k -f hls -hls_time 4 -hls_list_size 6 -hls_flags delete_segments+append_list+omit_endlist -hls_segment_type mpegts -hls_segment_filename <dir>/seg_%05d.ts <dir>/index.m3u8`. (HEVC video won't play until Plan 3b's video transcode; audio is always made AAC-safe.)
- Session temp dir: `<home>/.cache/inflighttv/<sessionId>/`. Stop = `proc.close('terminated')` (NOT bare `.close()`), then `rm -rf` the dir. Clean up stale session dirs on engine init.
- hls.js: `new Hls({ pLoader, fLoader, enableWorker: false })`; source URL is a fake `iftv://<sessionId>/index.m3u8`; the loader maps any `iftv://…/<name>` → `<dir>/<name>` and reads via `cockpit.file(path,{binary:true}).read()`. Playlist load → text; fragment load (`responseType==='arraybuffer'`) → ArrayBuffer. Always populate the full `stats` object.
- No monolithic files; TDD for pure/store logic; adapters (cockpit.spawn/file) + real playback verified manually. Commit per task; do not push.

---

### Task 1: Pure media helpers — stream URL, ffmpeg args, session paths

**Files:**
- Create: `src/core/media/streamUrl.ts`, `src/core/media/streamUrl.test.ts`, `src/core/media/ffmpegArgs.ts`, `src/core/media/ffmpegArgs.test.ts`, `src/core/media/session.ts`, `src/core/media/session.test.ts`

**Interfaces:**
- `liveStreamUrl(account: Account, item: ContentItem): string | null`.
- `buildLiveArgs({ inputUrl, playlistPath, segmentPath }): string[]` (ffmpeg argv WITHOUT the leading `ffmpeg`).
- `session.ts`: `cacheRoot(home)`, `sessionDir(root, id)`, `playlistPath(dir)`, `segmentPattern(dir)`, `sourceUrl(id)`, `fileNameFromUrl(url)`, `resolveInDir(dir, url)`.

- [ ] **Step 1: Write `src/core/media/streamUrl.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { liveStreamUrl } from './streamUrl'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const XT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://host:8080', username: 'u', password: 'p', createdAt: 1 }
const M3: Account = { id: 'b', type: 'm3u', name: 'M', url: 'http://h/list.m3u', username: '', password: '', createdAt: 2 }
function live(over: Partial<ContentItem> = {}): ContentItem {
  return { id: 'x:live:1', kind: 'live', name: 'C', logo: '', categoryId: '1', streamId: '1', seriesId: null, containerExtension: null, url: null, ...over }
}

describe('liveStreamUrl', () => {
  it('builds an Xtream live URL from account + streamId', () => {
    expect(liveStreamUrl(XT, live({ streamId: '42' }))).toBe('http://host:8080/live/u/p/42.ts')
  })
  it('uses the M3U direct url when present', () => {
    expect(liveStreamUrl(M3, live({ streamId: null, url: 'http://h/s.m3u8' }))).toBe('http://h/s.m3u8')
  })
  it('prefers a direct url even on an xtream account', () => {
    expect(liveStreamUrl(XT, live({ url: 'http://direct/x.ts' }))).toBe('http://direct/x.ts')
  })
  it('returns null when nothing is playable (no url, no streamId)', () => {
    expect(liveStreamUrl(XT, live({ streamId: null, url: null }))).toBeNull()
  })
  it('returns null for a non-live item with no direct url', () => {
    expect(liveStreamUrl(XT, live({ kind: 'movie', streamId: '9', url: null }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run → RED** — `npm run test -- streamUrl`.

- [ ] **Step 3: Implement `src/core/media/streamUrl.ts`**

```ts
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import { parseXtreamUrl } from '@/core/xtream/normalize'

// The upstream URL ffmpeg reads for a LIVE item. M3U items are direct URLs;
// Xtream live items build /live/{user}/{pass}/{streamId}.ts.
export function liveStreamUrl(account: Account, item: ContentItem): string | null {
  if (item.url) return item.url
  if (item.kind === 'live' && item.streamId && account.type === 'xtream') {
    const b = parseXtreamUrl(account.url)
    return `${b.scheme}://${b.host}:${b.port}/live/${account.username}/${account.password}/${item.streamId}.ts`
  }
  return null
}
```

- [ ] **Step 4: Write `src/core/media/ffmpegArgs.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildLiveArgs } from './ffmpegArgs'

describe('buildLiveArgs', () => {
  const args = buildLiveArgs({ inputUrl: 'http://h/live/u/p/1.ts', playlistPath: '/c/s/index.m3u8', segmentPath: '/c/s/seg_%05d.ts' })
  it('reconnects, remuxes video, transcodes audio to aac', () => {
    expect(args).toContain('-reconnect'); expect(args).toContain('-reconnect_streamed')
    expect(args.join(' ')).toContain('-c:v copy')
    expect(args.join(' ')).toContain('-c:a aac')
  })
  it('emits a rolling live HLS window to the given paths', () => {
    expect(args).toContain('-f'); expect(args).toContain('hls')
    expect(args).toContain('-hls_time'); expect(args).toContain('4')
    expect(args).toContain('-hls_list_size'); expect(args).toContain('6')
    expect(args).toContain('delete_segments+append_list+omit_endlist')
    expect(args).toContain('-hls_segment_filename'); expect(args).toContain('/c/s/seg_%05d.ts')
    expect(args[args.length - 1]).toBe('/c/s/index.m3u8') // playlist is the output (last arg)
    expect(args).toContain('http://h/live/u/p/1.ts')
  })
})
```

- [ ] **Step 5: Run → RED** — `npm run test -- ffmpegArgs`.

- [ ] **Step 6: Implement `src/core/media/ffmpegArgs.ts`**

```ts
export interface LiveArgsInput {
  inputUrl: string
  playlistPath: string
  segmentPath: string
}

// Remux video (cheap), transcode audio to AAC (browser-safe), rolling live HLS window.
// (HEVC video needs a video transcode — deferred to Plan 3b.)
export function buildLiveArgs({ inputUrl, playlistPath, segmentPath }: LiveArgsInput): string[] {
  return [
    '-y',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_delay_max', '5',
    '-i', inputUrl,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list+omit_endlist',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', segmentPath,
    playlistPath,
  ]
}
```

- [ ] **Step 7: Write `src/core/media/session.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { cacheRoot, sessionDir, playlistPath, segmentPattern, sourceUrl, fileNameFromUrl, resolveInDir } from './session'

describe('session paths', () => {
  it('builds cache root, session dir, playlist + segment paths under home', () => {
    const root = cacheRoot('/home/ismet')
    expect(root).toBe('/home/ismet/.cache/inflighttv')
    const dir = sessionDir(root, 'sid')
    expect(dir).toBe('/home/ismet/.cache/inflighttv/sid')
    expect(playlistPath(dir)).toBe('/home/ismet/.cache/inflighttv/sid/index.m3u8')
    expect(segmentPattern(dir)).toBe('/home/ismet/.cache/inflighttv/sid/seg_%05d.ts')
  })
  it('sourceUrl is a fake iftv:// playlist url per session', () => {
    expect(sourceUrl('sid')).toBe('iftv://sid/index.m3u8')
  })
  it('maps an hls.js-requested url back to a file in the session dir', () => {
    const dir = '/c/sid'
    expect(fileNameFromUrl('iftv://sid/index.m3u8')).toBe('index.m3u8')
    expect(fileNameFromUrl('iftv://sid/seg_00007.ts?x=1')).toBe('seg_00007.ts')
    expect(resolveInDir(dir, 'iftv://sid/seg_00007.ts')).toBe('/c/sid/seg_00007.ts')
  })
})
```

- [ ] **Step 8: Run → RED** — `npm run test -- media/session`.

- [ ] **Step 9: Implement `src/core/media/session.ts`**

```ts
export function cacheRoot(home: string): string {
  return `${home}/.cache/inflighttv`
}
export function sessionDir(root: string, id: string): string {
  return `${root}/${id}`
}
export function playlistPath(dir: string): string {
  return `${dir}/index.m3u8`
}
export function segmentPattern(dir: string): string {
  return `${dir}/seg_%05d.ts`
}
// hls.js loads this fake URL; segment URIs in the playlist resolve against it.
export function sourceUrl(id: string): string {
  return `iftv://${id}/index.m3u8`
}
export function fileNameFromUrl(url: string): string {
  return (url.split('/').pop() ?? '').split('?')[0]
}
export function resolveInDir(dir: string, url: string): string {
  return `${dir}/${fileNameFromUrl(url)}`
}
```

- [ ] **Step 10: GREEN + typecheck** — `npm run test -- streamUrl ffmpegArgs media/session` (all pass), `npm run typecheck`.

- [ ] **Step 11: Commit**

```bash
git add src/core/media/streamUrl.ts src/core/media/streamUrl.test.ts src/core/media/ffmpegArgs.ts \
  src/core/media/ffmpegArgs.test.ts src/core/media/session.ts src/core/media/session.test.ts
git commit -m "feat: pure media helpers — live stream URL, ffmpeg HLS args, session paths"
```

---

### Task 2: hls.js custom loader (over an injected byte-reader)

**Files:**
- Create: `src/core/media/hlsLoader.ts`, `src/core/media/hlsLoader.test.ts`

**Interfaces:**
- `type ByteReader = (path: string) => Promise<Uint8Array | null>`
- `type PathResolver = (url: string) => string`
- `createCockpitLoaderClass(readFile: ByteReader, resolvePath: PathResolver): LoaderClass` — returns an hls.js-compatible loader class (`load/abort/destroy`, `context`, `stats`). `load` reads `readFile(resolvePath(context.url))`; on `null` → `onError({code:404})`; else builds a full `stats` and calls `onSuccess({url, data})` with a UTF-8 string for playlists or an `ArrayBuffer` for `responseType==='arraybuffer'`.

- [ ] **Step 1: Write the failing test**

`src/core/media/hlsLoader.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createCockpitLoaderClass } from './hlsLoader'

const enc = (s: string) => new TextEncoder().encode(s)

function callbacks() {
  return { onSuccess: vi.fn(), onError: vi.fn(), onTimeout: vi.fn(), onProgress: vi.fn() }
}
const cfg = {} as never

describe('createCockpitLoaderClass', () => {
  it('returns playlist text via onSuccess (text responseType)', async () => {
    const read = vi.fn(async () => enc('#EXTM3U\n#EXTINF:4,\nseg_00000.ts'))
    const Loader = createCockpitLoaderClass(read, (u) => `/dir/${u.split('/').pop()}`)
    const l = new Loader()
    const cb = callbacks()
    l.load({ url: 'iftv://s/index.m3u8', responseType: '' }, cfg, cb)
    await Promise.resolve(); await Promise.resolve()
    expect(read).toHaveBeenCalledWith('/dir/index.m3u8')
    expect(cb.onError).not.toHaveBeenCalled()
    const [resp, stats] = cb.onSuccess.mock.calls[0]
    expect(typeof resp.data).toBe('string')
    expect(resp.data).toContain('#EXTM3U')
    expect(stats.loaded).toBeGreaterThan(0)
    expect(stats.loading.end).toBeGreaterThanOrEqual(0)
  })

  it('returns fragment bytes as an ArrayBuffer (arraybuffer responseType)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const Loader = createCockpitLoaderClass(async () => bytes, (u) => `/dir/${u.split('/').pop()}`)
    const l = new Loader()
    const cb = callbacks()
    l.load({ url: 'iftv://s/seg_00000.ts', responseType: 'arraybuffer' }, cfg, cb)
    await Promise.resolve(); await Promise.resolve()
    const [resp] = cb.onSuccess.mock.calls[0]
    expect(resp.data).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(resp.data)).toEqual(bytes)
  })

  it('calls onError with 404 when the file is missing (null)', async () => {
    const Loader = createCockpitLoaderClass(async () => null, (u) => u)
    const l = new Loader()
    const cb = callbacks()
    l.load({ url: 'iftv://s/index.m3u8', responseType: '' }, cfg, cb)
    await Promise.resolve(); await Promise.resolve()
    expect(cb.onSuccess).not.toHaveBeenCalled()
    expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 404 }), expect.anything(), null, expect.anything())
  })

  it('calls onError when the reader throws', async () => {
    const Loader = createCockpitLoaderClass(async () => { throw new Error('boom') }, (u) => u)
    const l = new Loader()
    const cb = callbacks()
    l.load({ url: 'iftv://s/x', responseType: '' }, cfg, cb)
    await Promise.resolve(); await Promise.resolve()
    expect(cb.onError).toHaveBeenCalled()
  })

  it('after abort(), a resolving read does not call onSuccess', async () => {
    let resolve!: (v: Uint8Array) => void
    const Loader = createCockpitLoaderClass(() => new Promise((r) => { resolve = r }), (u) => u)
    const l = new Loader()
    const cb = callbacks()
    l.load({ url: 'iftv://s/index.m3u8', responseType: '' }, cfg, cb)
    l.abort()
    resolve(enc('#EXTM3U'))
    await Promise.resolve(); await Promise.resolve()
    expect(cb.onSuccess).not.toHaveBeenCalled()
    expect(l.stats.aborted).toBe(true)
  })
})
```

- [ ] **Step 2: Run → RED** — `npm run test -- hlsLoader`.

- [ ] **Step 3: Implement `src/core/media/hlsLoader.ts`**

```ts
export type ByteReader = (path: string) => Promise<Uint8Array | null>
export type PathResolver = (url: string) => string

interface Cb {
  onSuccess(resp: { url: string; data: string | ArrayBuffer }, stats: unknown, context: unknown, nd: unknown): void
  onError(err: { code: number; text: string }, context: unknown, nd: unknown, stats: unknown): void
  onTimeout?(stats: unknown, context: unknown, nd: unknown): void
  onProgress?(stats: unknown, context: unknown, data: unknown, nd: unknown): void
}
interface Ctx {
  url: string
  responseType: string
  rangeStart?: number
  rangeEnd?: number
}

function newStats() {
  return {
    aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  }
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// Build an hls.js-compatible loader class that reads bytes via `readFile` instead
// of the network. Used as `pLoader`/`fLoader` in the Hls config.
export function createCockpitLoaderClass(readFile: ByteReader, resolvePath: PathResolver) {
  return class CockpitLoader {
    context: Ctx | null = null
    stats = newStats()
    private aborted = false

    load(context: Ctx, _config: unknown, callbacks: Cb): void {
      this.context = context
      this.aborted = false
      this.stats = newStats()
      this.stats.loading.start = now()
      const path = resolvePath(context.url)
      readFile(path)
        .then((data) => {
          if (this.aborted) return
          if (data == null) {
            callbacks.onError({ code: 404, text: 'not found' }, context, null, this.stats)
            return
          }
          let bytes = data
          if (context.rangeEnd) bytes = data.subarray(context.rangeStart ?? 0, context.rangeEnd)
          const s = this.stats
          s.loading.first = now()
          s.loading.end = now()
          s.loaded = s.total = bytes.byteLength
          const out: string | ArrayBuffer =
            context.responseType === 'arraybuffer'
              ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
              : new TextDecoder().decode(bytes)
          callbacks.onSuccess({ url: context.url, data: out }, s, context, null)
        })
        .catch((e) => {
          if (this.aborted) return
          callbacks.onError({ code: 0, text: String(e) }, context, null, this.stats)
        })
    }

    abort(): void {
      this.aborted = true
      this.stats.aborted = true
    }

    destroy(): void {
      this.abort()
      this.context = null
    }
  }
}
```

- [ ] **Step 4: GREEN + typecheck** — `npm run test -- hlsLoader` (pass), `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/core/media/hlsLoader.ts src/core/media/hlsLoader.test.ts
git commit -m "feat: hls.js custom loader that reads segments via an injected byte-reader"
```

---

### Task 3: Playback engine (orchestration) + Cockpit adapters + hls.js dep

**Files:**
- Create: `src/core/media/PlaybackEngine.ts`, `src/core/media/engine.ts`, `src/core/media/engine.test.ts`, `src/adapters/cockpitPlayback.ts`
- Modify: `package.json` (add `hls.js`)

**Interfaces:**
- `PlaybackEngine.ts`: `interface PlaybackSession { sourceUrl: string; createLoader(): unknown; stop(): Promise<void> }`, `interface PlaybackEngine { start(account: Account, item: ContentItem): Promise<PlaybackSession> }`, and `interface EngineDeps { home(): Promise<string>; newId(): string; mkdir(dir): Promise<void>; rmrf(dir): Promise<void>; spawn(argv: string[]): { close(problem: string): void }; readFile(path): Promise<Uint8Array | null>; wait(ms): Promise<void> }`.
- `engine.ts`: `createPlaybackEngine(deps: EngineDeps): PlaybackEngine` — pure orchestration (all IO injected), TDD.
- `cockpitPlayback.ts`: `createCockpitPlaybackEngine(): Promise<PlaybackEngine>` — wires `EngineDeps` to real `cockpit` (`cockpit.user().home`, `crypto.randomUUID`, `cockpit.spawn(['mkdir'...])`, `cockpit.spawn(argv,{err:'message'})`, `cockpit.file(path,{binary:true}).read()`), and cleans up stale session dirs on creation. Not unit-tested (needs Cockpit).

- [ ] **Step 1: Add hls.js dependency**

In `package.json` `dependencies`, add `"hls.js": "^1.5.0"`. Run `npm install`.

- [ ] **Step 2: Create `src/core/media/PlaybackEngine.ts`**

```ts
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

export interface PlaybackSession {
  sourceUrl: string // pass to hls.loadSource
  createLoader(): unknown // loader class for Hls { pLoader, fLoader }
  stop(): Promise<void>
}

export interface PlaybackEngine {
  start(account: Account, item: ContentItem): Promise<PlaybackSession>
}

export interface FfmpegProc {
  close(problem: string): void
}

export interface EngineDeps {
  home(): Promise<string>
  newId(): string
  mkdir(dir: string): Promise<void>
  rmrf(dir: string): Promise<void>
  spawn(argv: string[]): FfmpegProc
  readFile(path: string): Promise<Uint8Array | null>
  wait(ms: number): Promise<void>
}
```

- [ ] **Step 3: Write `src/core/media/engine.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createPlaybackEngine } from './engine'
import type { EngineDeps } from './PlaybackEngine'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const XT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h:8080', username: 'u', password: 'p', createdAt: 1 }
const item: ContentItem = { id: 'x:live:7', kind: 'live', name: 'C', logo: '', categoryId: '1', streamId: '7', seriesId: null, containerExtension: null, url: null }

function deps(over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    home: async () => '/home/u',
    newId: () => 'sid',
    mkdir: vi.fn(async () => {}),
    rmrf: vi.fn(async () => {}),
    spawn: vi.fn(() => ({ close: vi.fn() })),
    readFile: vi.fn(async () => new TextEncoder().encode('#EXTM3U')), // playlist ready immediately
    wait: vi.fn(async () => {}),
    ...over,
  }
}

describe('createPlaybackEngine.start', () => {
  it('mkdirs the session dir, spawns ffmpeg with the input URL, returns the source url', async () => {
    const d = deps()
    const eng = createPlaybackEngine(d)
    const s = await eng.start(XT, item)
    expect(d.mkdir).toHaveBeenCalledWith('/home/u/.cache/inflighttv/sid')
    const argv = (d.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(argv[0]).toBe('ffmpeg')
    expect(argv).toContain('http://h:8080/live/u/p/7.ts')
    expect(argv[argv.length - 1]).toBe('/home/u/.cache/inflighttv/sid/index.m3u8')
    expect(s.sourceUrl).toBe('iftv://sid/index.m3u8')
    expect(typeof s.createLoader()).toBe('function') // a loader class
  })

  it('waits (polls) for the playlist to appear before returning', async () => {
    let n = 0
    const d = deps({ readFile: vi.fn(async () => (++n < 3 ? null : new TextEncoder().encode('#EXTM3U'))) })
    const eng = createPlaybackEngine(d)
    await eng.start(XT, item)
    expect((d.readFile as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(d.wait).toHaveBeenCalled()
  })

  it('kills ffmpeg and cleans up if the playlist never appears', async () => {
    const close = vi.fn()
    const d = deps({ readFile: async () => null, spawn: () => ({ close }) })
    const eng = createPlaybackEngine(d)
    await expect(eng.start(XT, item)).rejects.toThrow(/did not start/i)
    expect(close).toHaveBeenCalledWith(expect.any(String))
    expect(d.rmrf).toHaveBeenCalledWith('/home/u/.cache/inflighttv/sid')
  })

  it('throws for a non-playable item without spawning', async () => {
    const d = deps()
    const eng = createPlaybackEngine(d)
    await expect(eng.start(XT, { ...item, streamId: null, url: null })).rejects.toThrow(/not playable/i)
    expect(d.spawn).not.toHaveBeenCalled()
  })

  it('stop() kills ffmpeg with a problem code and removes the dir', async () => {
    const close = vi.fn()
    const d = deps({ spawn: () => ({ close }) })
    const eng = createPlaybackEngine(d)
    const s = await eng.start(XT, item)
    await s.stop()
    expect(close).toHaveBeenCalledWith('terminated')
    expect(d.rmrf).toHaveBeenCalledWith('/home/u/.cache/inflighttv/sid')
  })
})
```

- [ ] **Step 4: Run → RED** — `npm run test -- media/engine`.

- [ ] **Step 5: Implement `src/core/media/engine.ts`**

```ts
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { EngineDeps, PlaybackEngine, PlaybackSession } from './PlaybackEngine'
import { liveStreamUrl } from './streamUrl'
import { buildLiveArgs } from './ffmpegArgs'
import { cacheRoot, sessionDir, playlistPath, segmentPattern, sourceUrl, resolveInDir } from './session'
import { createCockpitLoaderClass } from './hlsLoader'

const PLAYLIST_TRIES = 40
const PLAYLIST_INTERVAL_MS = 500

export function createPlaybackEngine(deps: EngineDeps): PlaybackEngine {
  return {
    async start(account: Account, item: ContentItem): Promise<PlaybackSession> {
      const inputUrl = liveStreamUrl(account, item)
      if (!inputUrl) throw new Error('This item is not playable')

      const id = deps.newId()
      const dir = sessionDir(cacheRoot(await deps.home()), id)
      await deps.mkdir(dir)

      const argv = ['ffmpeg', ...buildLiveArgs({ inputUrl, playlistPath: playlistPath(dir), segmentPath: segmentPattern(dir) })]
      const proc = deps.spawn(argv)

      const pl = playlistPath(dir)
      let ready = false
      for (let i = 0; i < PLAYLIST_TRIES; i++) {
        const data = await deps.readFile(pl)
        if (data && data.byteLength > 0) { ready = true; break }
        await deps.wait(PLAYLIST_INTERVAL_MS)
      }
      if (!ready) {
        proc.close('timeout')
        await deps.rmrf(dir)
        throw new Error('Stream did not start (no playlist produced)')
      }

      const Loader = createCockpitLoaderClass((p) => deps.readFile(p), (url) => resolveInDir(dir, url))
      return {
        sourceUrl: sourceUrl(id),
        createLoader: () => Loader,
        async stop() {
          proc.close('terminated')
          await deps.rmrf(dir)
        },
      }
    },
  }
}
```

- [ ] **Step 6: GREEN + typecheck** — `npm run test -- media/engine` (all pass), `npm run typecheck`.

- [ ] **Step 7: Create the Cockpit adapter `src/adapters/cockpitPlayback.ts`** (not unit-tested)

```ts
import cockpit from 'cockpit'
import type { EngineDeps, PlaybackEngine } from '@/core/media/PlaybackEngine'
import { createPlaybackEngine } from '@/core/media/engine'
import { cacheRoot } from '@/core/media/session'

export async function createCockpitPlaybackEngine(): Promise<PlaybackEngine> {
  const user = await cockpit.user()
  const root = cacheRoot(user.home)
  // Best-effort cleanup of stale session dirs from prior/crashed runs.
  cockpit.spawn(['sh', '-c', `rm -rf ${root}/* 2>/dev/null || true`], { superuser: 'try' }).catch(() => {})

  const deps: EngineDeps = {
    home: async () => user.home,
    newId: () => crypto.randomUUID(),
    mkdir: async (dir) => { await cockpit.spawn(['mkdir', '-p', dir]) },
    rmrf: async (dir) => { await cockpit.spawn(['rm', '-rf', dir]).catch(() => {}) },
    spawn: (argv) => cockpit.spawn(argv, { err: 'message' }) as unknown as { close(p: string): void },
    readFile: async (path) => {
      const handle = cockpit.file<Uint8Array>(path, { binary: true })
      try {
        return await handle.read()
      } catch {
        return null
      } finally {
        handle.close()
      }
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  }
  return createPlaybackEngine(deps)
}
```

- [ ] **Step 8: Typecheck + build** — `npm run typecheck && npm run build` (clean; hls.js bundles).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/core/media/PlaybackEngine.ts src/core/media/engine.ts \
  src/core/media/engine.test.ts src/adapters/cockpitPlayback.ts
git commit -m "feat: playback engine (ffmpeg session orchestration) + Cockpit adapter + hls.js dep"
```

---

### Task 4: Player store + PlayerView + click-to-play wiring

**Files:**
- Create: `src/stores/player.ts`, `src/stores/player.test.ts`, `src/components/PlayerView.vue`
- Modify: `src/components/ContentCard.vue`, `src/views/browse/BrowseView.vue`, `src/views/home/HomeView.vue`, `src/styles/app.css`

**Interfaces:**
- `usePlayerStore`: state `{ status: 'idle'|'starting'|'playing'|'error', error, item, session }`; actions `$configure(deps)`, `play(account, item)`, `stop()`. Injected `{ engine: PlaybackEngine }` for tests; app default builds it via `createCockpitPlaybackEngine()` (cached).
- `PlayerView.vue` — an overlay shown when the player is active; owns the hls.js lifecycle against a `<video>`.

- [ ] **Step 1: Write `src/stores/player.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from './player'
import type { PlaybackEngine, PlaybackSession } from '@/core/media/PlaybackEngine'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const ACCT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h', username: 'u', password: 'p', createdAt: 1 }
const item: ContentItem = { id: 'x:live:1', kind: 'live', name: 'CNN', logo: '', categoryId: '1', streamId: '1', seriesId: null, containerExtension: null, url: null }

function engineWith(session: Partial<PlaybackSession> = {}): { engine: PlaybackEngine; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn(async () => {})
  const engine: PlaybackEngine = {
    start: vi.fn(async () => ({ sourceUrl: 'iftv://s/index.m3u8', createLoader: () => class {}, stop, ...session })),
  }
  return { engine, stop }
}

describe('usePlayerStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('play() starts the engine and becomes playing with the session', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item)
    expect(engine.start).toHaveBeenCalledWith(ACCT, item)
    expect(p.status).toBe('playing')
    expect(p.item?.id).toBe('x:live:1')
    expect(p.session?.sourceUrl).toBe('iftv://s/index.m3u8')
  })

  it('play() while already playing stops the previous session first', async () => {
    const { engine, stop } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item)
    await p.play(ACCT, { ...item, id: 'x:live:2', streamId: '2' })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(p.item?.id).toBe('x:live:2')
  })

  it('records an error when the engine throws', async () => {
    const engine: PlaybackEngine = { start: vi.fn(async () => { throw new Error('no playlist') }) }
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item)
    expect(p.status).toBe('error')
    expect(p.error).toMatch(/no playlist/)
    expect(p.session).toBeNull()
  })

  it('stop() stops the session and returns to idle', async () => {
    const { engine, stop } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item)
    await p.stop()
    expect(stop).toHaveBeenCalled()
    expect(p.status).toBe('idle')
    expect(p.session).toBeNull()
  })
})
```

- [ ] **Step 2: Run → RED** — `npm run test -- stores/player`.

- [ ] **Step 3: Implement `src/stores/player.ts`**

```ts
import { defineStore } from 'pinia'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { PlaybackEngine, PlaybackSession } from '@/core/media/PlaybackEngine'
import { createCockpitPlaybackEngine } from '@/adapters/cockpitPlayback'

interface PlayerDeps { engine: PlaybackEngine }

export const usePlayerStore = defineStore('player', {
  state: () => ({
    status: 'idle' as 'idle' | 'starting' | 'playing' | 'error',
    error: '',
    item: null as ContentItem | null,
    session: null as PlaybackSession | null,
    _deps: null as PlayerDeps | null,
  }),
  actions: {
    $configure(deps: PlayerDeps) {
      this._deps = deps
    },
    async _engine(): Promise<PlaybackEngine> {
      if (!this._deps) this._deps = { engine: await createCockpitPlaybackEngine() }
      return this._deps.engine
    },
    async play(account: Account, item: ContentItem) {
      if (this.session) await this.stop()
      this.status = 'starting'
      this.error = ''
      this.item = item
      try {
        const engine = await this._engine()
        this.session = await engine.start(account, item)
        this.status = 'playing'
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        this.session = null
      }
    },
    async stop() {
      const s = this.session
      this.session = null
      this.item = null
      this.status = 'idle'
      this.error = ''
      if (s) await s.stop()
    },
  },
})
```

- [ ] **Step 4: GREEN** — `npm run test -- stores/player` (all pass).

- [ ] **Step 5: Create `src/components/PlayerView.vue`**

```vue
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import Hls from 'hls.js'
import { usePlayerStore } from '@/stores/player'

const player = usePlayerStore()
const video = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null

function teardown() {
  if (hls) { hls.destroy(); hls = null }
}

watch(
  () => player.session,
  (session) => {
    teardown()
    if (!session || !video.value) return
    if (Hls.isSupported()) {
      const Loader = session.createLoader() as never
      hls = new Hls({ pLoader: Loader, fLoader: Loader, enableWorker: false })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) player.error = `Playback error: ${data.details}`
      })
      hls.loadSource(session.sourceUrl)
      hls.attachMedia(video.value)
      hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.value?.play().catch(() => {}) })
    } else if (video.value.canPlayType('application/vnd.apple.mpegurl')) {
      video.value.src = session.sourceUrl // native HLS (Safari) — fallback, unlikely for iftv://
    }
  },
)

onBeforeUnmount(teardown)

function close() {
  teardown()
  void player.stop()
}
</script>

<template>
  <div v-if="player.status !== 'idle'" class="iftv-player">
    <div class="iftv-player-bar">
      <span class="iftv-player-title text-truncate">{{ player.item?.name }}</span>
      <button class="btn btn-sm btn-light" @click="close">✕ Close</button>
    </div>
    <div class="iftv-player-body">
      <p v-if="player.status === 'starting'" class="text-light p-3">Starting stream…</p>
      <p v-else-if="player.status === 'error'" class="text-danger p-3">{{ player.error }}</p>
      <video ref="video" class="iftv-player-video" controls autoplay playsinline></video>
    </div>
  </div>
</template>
```

- [ ] **Step 6: Wire click-to-play — `ContentCard.vue` + `BrowseView.vue`**

`ContentCard.vue` is already a clickable card; add nothing there (native click bubbles). In `BrowseView.vue`, import the player + workspace stores and add a handler, and bind it on the card. Change the grid slot:
```vue
        <template #default="{ item }">
          <ContentCard :item="(item as ContentItem)" @click="onPlay(item as ContentItem)" />
        </template>
```
Add to `<script setup>` (after the existing store setup):
```ts
import { usePlayerStore } from '@/stores/player'
const player = usePlayerStore()
function onPlay(item: ContentItem) {
  if (item.kind === 'live' && ws.activeAccount) player.play(ws.activeAccount, item)
}
```
(Only live items play in this milestone; movie/series clicks are inert — Plan 3b.)

- [ ] **Step 7: Render the overlay — `HomeView.vue`**

Add `import PlayerView from '@/components/PlayerView.vue'` to HomeView's script and render it once at the end of the template's root `<div>` (so it overlays whatever section is showing):
```vue
    <PlayerView />
```
(Place it as the last child inside the root `<div class="h-100 d-flex flex-column">`.)

- [ ] **Step 8: Append player styles to `src/styles/app.css`**

```css
.iftv-player { position: fixed; inset: 0; z-index: 1050; background: #000; display: flex; flex-direction: column; }
.iftv-player-bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.75rem; background: #111; color: #fff; }
.iftv-player-title { flex: 1; font-weight: 600; }
.iftv-player-body { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.iftv-player-video { max-width: 100%; max-height: 100%; background: #000; }
```

- [ ] **Step 9: Typecheck, build, full suite, smoke**

Run: `npm run typecheck && npm run build && npm run test && npm run test:smoke`
Expected: all green; `smoke OK`. (The smoke test is unchanged from Plan 2b — it verifies browsing; it does NOT click-to-play, since real playback needs ffmpeg + a real stream. hls.js bundles cleanly.)

- [ ] **Step 10: Manual verification (needs ffmpeg on host + a real live stream)**

Ensure `ffmpeg` is installed (`ffmpeg -version`). With the dev mock (`node dev/mock-xtream.mjs`) the "Mock Channel One" upstream won't be a real stream, so use a **real Xtream account** or point an M3U account at the verified free HLS test stream. Then:
- Open a live channel → overlay appears, "Starting stream…", then video plays within a few seconds (ffmpeg → HLS → hls.js). Check `~/.cache/inflighttv/<id>/index.m3u8` + segments exist during playback.
- Close → overlay hides; confirm the ffmpeg process is gone (`pgrep -a ffmpeg`) and the session dir is removed.
- Switch to another channel while playing → previous ffmpeg is killed, new one starts.
- A dead/invalid URL → "Stream did not start" error in the overlay, process cleaned up.

- [ ] **Step 11: Commit**

```bash
git add src/stores/player.ts src/stores/player.test.ts src/components/PlayerView.vue \
  src/components/ContentCard.vue src/views/browse/BrowseView.vue src/views/home/HomeView.vue src/styles/app.css
git commit -m "feat: live playback — player store, PlayerView (hls.js), click-to-play"
```

---

## Self-Review

**Spec coverage (Plan 3 / live playback):**
- ffmpeg live remux → rolling HLS via `cockpit.spawn` → Tasks 1 (args), 3 (engine/adapter). ✓
- hls.js fed from `cockpit.file` via a custom loader (no network/CORS) → Tasks 2, 4. ✓
- Session lifecycle (spawn, wait-for-playlist, stop via `.close('terminated')`, temp dir, stale cleanup) → Task 3. ✓
- Player store + overlay + click-a-live-channel-to-play → Task 4. ✓
- Xtream live + M3U live both playable → Task 1 `liveStreamUrl`. ✓
- Swap-able `PlaybackEngine` interface (Plan 1 design) → Task 3. ✓
- Deferred to Plan 3b: VOD/Series playback (needs movie/episode URL + detail views), seeking (`-ss`), hardware-accel settings + codec probing/HEVC video transcode, subtitle/audio-track selection.

**Placeholder scan:** No TBD/TODO; full code in every step. The Cockpit adapters (`cockpitPlayback.ts`, `PlayerView`'s hls.js/DOM) and real playback are verified manually (Task 4 Step 10) — the pure engine orchestration, loader, args, URL, and player store are all unit-tested with injected fakes.

**Type consistency:** `PlaybackEngine`/`PlaybackSession`/`EngineDeps` (Task 3) are used identically by `engine.ts`, the Cockpit adapter, and the player store + its test. `createCockpitLoaderClass(readFile, resolvePath)` (Task 2) is called by `engine.ts` with `deps.readFile` + `resolveInDir(dir, …)`. `liveStreamUrl`/`buildLiveArgs`/session helpers (Task 1) are consumed by `engine.ts`. The player store's `play(account, item)`/`stop()`/`session` are consumed by `PlayerView` and `BrowseView`.

**Notes:** hls.js uses `enableWorker:false` to avoid CSP worker-blob issues (main-thread demux is fine for one stream); the custom loader does zero network I/O so `connect-src 'self'` is untouched and `media-src 'self' blob:` covers MSE. Only one playback session runs at a time (starting a new one stops the old). `readFile` returns `null` on missing/not-yet-written files, which hls.js's retry policy tolerates during startup. Stale-session cleanup is best-effort on engine creation.
