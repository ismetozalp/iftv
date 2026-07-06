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
