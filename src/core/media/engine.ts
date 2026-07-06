import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { EngineDeps, PlaybackEngine, PlaybackSession } from './PlaybackEngine'
import { playbackUrl } from './streamUrl'
import { buildCurlArgs, buildRemuxArgs, STREAM_USER_AGENT } from './ffmpegArgs'
import { cacheRoot, sessionDir, playlistPath, segmentPattern, sourceUrl, resolveInDir } from './session'
import { createCockpitLoaderClass } from './hlsLoader'

const PLAYLIST_TRIES = 40
const PLAYLIST_INTERVAL_MS = 500

export function createPlaybackEngine(deps: EngineDeps): PlaybackEngine {
  return {
    async start(account: Account, item: ContentItem, opts?: { bufferSeconds?: number }): Promise<PlaybackSession> {
      const inputUrl = playbackUrl(account, item)
      if (!inputUrl) throw new Error('This item is not playable')

      const id = deps.newId()
      const dir = sessionDir(cacheRoot(await deps.home()), id)
      await deps.mkdir(dir)
      const fifo = `${dir}/in.ts`
      await deps.mkfifo(fifo)

      // Live = rolling window sized to hold the buffer (>= bufferSeconds of 4s segments).
      // Movie/episode = finite VOD: keep every segment so hls.js gets a duration + seeking.
      const live = item.kind === 'live'
      const bufferSeconds = opts?.bufferSeconds ?? 30
      const liveWindow = Math.max(6, Math.ceil(bufferSeconds / 4) + 2)

      // curl fetches the upstream (following the panel's cross-host 302 redirect, which ffmpeg
      // stalls on for many Xtream panels) and writes it into the FIFO; ffmpeg reads the FIFO — a
      // local input, so no redirect/HTTP quirks — and remuxes to HLS.
      const curl = deps.spawn(['curl', ...buildCurlArgs({ url: inputUrl, outPath: fifo, userAgent: STREAM_USER_AGENT })])
      const ff = deps.spawn(['ffmpeg', ...buildRemuxArgs({ inputPath: fifo, playlistPath: playlistPath(dir), segmentPath: segmentPattern(dir), live, liveWindow })])
      const stopAll = (problem: string) => {
        curl.close(problem)
        ff.close(problem)
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
        createLoader: () => Loader,
        async stop() {
          stopAll('terminated')
          await deps.rmrf(dir)
        },
      }
    },
  }
}
