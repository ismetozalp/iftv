import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import { parseXtreamUrl } from '@/core/xtream/normalize'

// The upstream URL ffmpeg reads for a playable item. M3U items are direct URLs;
// Xtream items build the per-kind panel URL from account + streamId:
//   live    -> /live/{user}/{pass}/{streamId}.ts
//   movie   -> /movie/{user}/{pass}/{streamId}.{containerExtension||mp4}
//   episode -> /series/{user}/{pass}/{streamId}.{containerExtension||mp4}  (streamId carries the episode id)
export function playbackUrl(account: Account, item: ContentItem): string | null {
  if (item.url) return item.url
  if (item.streamId && account.type === 'xtream') {
    const b = parseXtreamUrl(account.url)
    const base = `${b.scheme}://${b.host}:${b.port}`
    const u = account.username
    const p = account.password
    if (item.kind === 'live') return `${base}/live/${u}/${p}/${item.streamId}.ts`
    if (item.kind === 'movie') return `${base}/movie/${u}/${p}/${item.streamId}.${item.containerExtension || 'mp4'}`
    if (item.kind === 'episode') return `${base}/series/${u}/${p}/${item.streamId}.${item.containerExtension || 'mp4'}`
  }
  return null
}
