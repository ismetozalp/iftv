import { describe, it, expect } from 'vitest'
import { playbackUrl } from './streamUrl'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const XT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://host:8080', username: 'u', password: 'p', createdAt: 1 }
const M3: Account = { id: 'b', type: 'm3u', name: 'M', url: 'http://h/list.m3u', username: '', password: '', createdAt: 2 }
function live(over: Partial<ContentItem> = {}): ContentItem {
  return { id: 'x:live:1', kind: 'live', name: 'C', logo: '', categoryId: '1', streamId: '1', seriesId: null, containerExtension: null, url: null, ...over }
}

describe('playbackUrl', () => {
  it('builds an Xtream live URL from account + streamId', () => {
    expect(playbackUrl(XT, live({ streamId: '42' }))).toBe('http://host:8080/live/u/p/42.ts')
  })
  it('uses the M3U direct url when present', () => {
    expect(playbackUrl(M3, live({ streamId: null, url: 'http://h/s.m3u8' }))).toBe('http://h/s.m3u8')
  })
  it('prefers a direct url even on an xtream account', () => {
    expect(playbackUrl(XT, live({ url: 'http://direct/x.ts' }))).toBe('http://direct/x.ts')
  })
  it('returns null when nothing is playable (no url, no streamId)', () => {
    expect(playbackUrl(XT, live({ streamId: null, url: null }))).toBeNull()
  })
  it('returns null for a non-xtream, non-live-kind item with no direct url', () => {
    expect(playbackUrl(XT, live({ kind: 'series', streamId: '9', url: null }))).toBeNull()
  })
  it('builds an Xtream movie URL with containerExtension', () => {
    expect(playbackUrl(XT, live({ kind: 'movie', streamId: '55', containerExtension: 'mkv' }))).toBe('http://host:8080/movie/u/p/55.mkv')
  })
  it('defaults movie extension to mp4 when containerExtension is missing', () => {
    expect(playbackUrl(XT, live({ kind: 'movie', streamId: '55', containerExtension: null }))).toBe('http://host:8080/movie/u/p/55.mp4')
  })
  it('builds an Xtream episode URL (streamId carries the episode id)', () => {
    expect(playbackUrl(XT, live({ kind: 'episode', streamId: '88', containerExtension: 'mp4' }))).toBe('http://host:8080/series/u/p/88.mp4')
  })
  it('defaults episode extension to mp4 when containerExtension is missing', () => {
    expect(playbackUrl(XT, live({ kind: 'episode', streamId: '88', containerExtension: null }))).toBe('http://host:8080/series/u/p/88.mp4')
  })
})
