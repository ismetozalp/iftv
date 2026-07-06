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
