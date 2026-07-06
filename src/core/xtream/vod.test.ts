import { describe, it, expect, vi } from 'vitest'
import { getVodCategories, getVodStreams } from './vod'
import type { XtreamTransport } from './transport'

function transport(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload), fetchText: vi.fn(async () => '') }
}

describe('getVodCategories', () => {
  it('maps categories and calls get_vod_categories', async () => {
    const t = transport([{ category_id: '10', category_name: 'Action' }])
    expect(await getVodCategories(t, 'http://h:8080', 'u', 'p')).toEqual([{ id: '10', name: 'Action' }])
    expect(t.getJson).toHaveBeenCalledWith({ scheme: 'http', host: 'h', port: 8080 }, '/player_api.php', { username: 'u', password: 'p', action: 'get_vod_categories' })
  })
})

describe('getVodStreams', () => {
  it('maps movie fields incl. container_extension, drops empty stream_id', async () => {
    const t = transport([
      { stream_id: 55, name: 'The Movie', stream_icon: 'http://p/m.jpg', category_id: '10', container_extension: 'mp4' },
      { name: 'no id', category_id: '10' },
    ])
    expect(await getVodStreams(t, 'http://h', 'u', 'p')).toEqual([
      { id: 'x:movie:55', kind: 'movie', name: 'The Movie', logo: 'http://p/m.jpg', categoryId: '10', streamId: '55', seriesId: null, containerExtension: 'mp4', url: null },
    ])
  })
  it('includes category_id param when given; omits otherwise', async () => {
    const t = transport([])
    await getVodStreams(t, 'http://h', 'u', 'p', '10')
    expect(t.getJson).toHaveBeenCalledWith(expect.anything(), '/player_api.php', { username: 'u', password: 'p', action: 'get_vod_streams', category_id: '10' })
    await getVodStreams(t, 'http://h', 'u', 'p')
    expect(t.getJson).toHaveBeenLastCalledWith(expect.anything(), '/player_api.php', { username: 'u', password: 'p', action: 'get_vod_streams' })
  })
  it('returns [] for a non-array body', async () => {
    expect(await getVodStreams(transport(null), 'http://h', 'u', 'p')).toEqual([])
  })
})
