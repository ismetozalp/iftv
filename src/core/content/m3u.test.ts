import { describe, it, expect } from 'vitest'
import { parseM3u } from './m3u'

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="cnn" tvg-name="CNN" tvg-logo="http://l/cnn.png" group-title="News",CNN HD
http://s/cnn.m3u8
#EXTINF:-1 tvg-logo="http://l/bbc.png" group-title="News",BBC
http://s/bbc.ts
#EXTINF:-1 tvg-name="ESPN",ESPN
http://s/espn.m3u8
`

describe('parseM3u', () => {
  it('parses channels with name/logo/group and the stream url', () => {
    const { channels } = parseM3u(SAMPLE)
    expect(channels).toHaveLength(3)
    expect(channels[0]).toEqual({ id: 'm:0', name: 'CNN HD', logo: 'http://l/cnn.png', categoryId: 'News', streamId: null, url: 'http://s/cnn.m3u8' })
    expect(channels[1].categoryId).toBe('News')
    expect(channels[1].url).toBe('http://s/bbc.ts')
  })
  it('defaults missing group-title to Uncategorized', () => {
    const { channels } = parseM3u(SAMPLE)
    expect(channels[2].categoryId).toBe('Uncategorized')
    expect(channels[2].name).toBe('ESPN')
  })
  it('derives distinct categories in first-seen order', () => {
    const { categories } = parseM3u(SAMPLE)
    expect(categories).toEqual([{ id: 'News', name: 'News' }, { id: 'Uncategorized', name: 'Uncategorized' }])
  })
  it('tolerates blank lines, CRLF, and comments; ignores an #EXTINF with no url', () => {
    const { channels } = parseM3u('#EXTM3U\r\n\r\n#EXTINF:-1,Orphan\r\n#EXTINF:-1,Real\r\nhttp://s/x\r\n')
    expect(channels).toHaveLength(1)
    expect(channels[0].name).toBe('Real')
  })
  it('returns empty for a body with no entries', () => {
    expect(parseM3u('#EXTM3U\n')).toEqual({ categories: [], channels: [] })
  })
})
