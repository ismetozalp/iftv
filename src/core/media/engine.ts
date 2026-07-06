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
