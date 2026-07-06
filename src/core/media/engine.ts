import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { EngineDeps, FfmpegProc, PlaybackEngine, PlaybackSession } from './PlaybackEngine'
import { playbackUrl } from './streamUrl'
import { buildCurlArgs, buildLiveRemuxArgs, buildVodRemuxArgs, STREAM_USER_AGENT } from './ffmpegArgs'
import { cacheRoot, sessionDir, playlistPath, segmentPattern, sourceUrl, resolveInDir } from './session'
import { createCockpitLoaderClass } from './hlsLoader'

const PLAYLIST_TRIES = 40
const PLAYLIST_INTERVAL_MS = 500

export function createPlaybackEngine(deps: EngineDeps): PlaybackEngine {
  return {
    async start(account: Account, item: ContentItem, opts?: { bufferSeconds?: number; startOffsetSeconds?: number; videoCodec?: 'copy' | 'nvenc' | 'x264' }): Promise<PlaybackSession> {
      const inputUrl = playbackUrl(account, item)
      if (!inputUrl) throw new Error('This item is not playable')

      const id = deps.newId()
      const dir = sessionDir(cacheRoot(await deps.home()), id)
      await deps.mkdir(dir)

      // Live = rolling window (curl→FIFO, unchanged), sized to hold the buffer (>= bufferSeconds
      // of 4s segments). Movie/episode = finite VOD: ffmpeg reads the panel url directly with
      // `-ss <offset>` (spike-proven HTTP range-seekable, no redirect) — no curl, no FIFO, so the
      // panel never sees more than the one ffmpeg connection.
      const live = item.kind === 'live'
      const bufferSeconds = opts?.bufferSeconds ?? 30
      const videoCodec = opts?.videoCodec ?? 'copy'

      let procs: FfmpegProc[]
      if (live) {
        const fifo = `${dir}/in.ts`
        await deps.mkfifo(fifo)
        const liveWindow = Math.max(6, Math.ceil(bufferSeconds / 4) + 2)
        // curl fetches the upstream (following the panel's cross-host 302 redirect, which ffmpeg
        // stalls on for many Xtream panels) and writes it into the FIFO; ffmpeg reads the FIFO —
        // a local input, so no redirect/HTTP quirks — and remuxes to HLS.
        const curl = deps.spawn(['curl', ...buildCurlArgs({ url: inputUrl, outPath: fifo, userAgent: STREAM_USER_AGENT })])
        const ff = deps.spawn(['ffmpeg', ...buildLiveRemuxArgs({ inputPath: fifo, liveWindow, playlistPath: playlistPath(dir), segmentPath: segmentPattern(dir), videoCodec })])
        procs = [curl, ff]
      } else {
        const ff = deps.spawn(['ffmpeg', ...buildVodRemuxArgs({ inputUrl, offsetSeconds: opts?.startOffsetSeconds ?? 0, burstSeconds: bufferSeconds, playlistPath: playlistPath(dir), segmentPath: segmentPattern(dir), videoCodec })])
        procs = [ff]
      }
      const stopAll = (problem: string) => {
        procs.forEach((p) => p.close(problem))
      }

      const pl = playlistPath(dir)
      let ready = false
      for (let i = 0; i < PLAYLIST_TRIES; i++) {
        const data = await deps.readFile(pl)
        if (data && data.byteLength > 0) { ready = true; break }
        await deps.wait(PLAYLIST_INTERVAL_MS)
      }
      if (!ready) {
        stopAll('timeout')
        await deps.rmrf(dir)
        throw new Error('Stream did not start (no playlist produced)')
      }

      const Loader = createCockpitLoaderClass((p) => deps.readFile(p), (url) => resolveInDir(dir, url))
      return {
        sourceUrl: sourceUrl(id),
        isLive: live,
        createLoader: () => Loader,
        async stop() {
          stopAll('terminated')
          await deps.rmrf(dir)
        },
      }
    },
  }
}
