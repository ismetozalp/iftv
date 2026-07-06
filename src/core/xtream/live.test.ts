import { describe, it, expect, vi } from 'vitest'
import { getLiveCategories, getLiveStreams } from './live'
import type { XtreamTransport } from './transport'

function transport(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload), fetchText: vi.fn(async () => '') }
}

describe('getLiveCategories', () => {
  it('maps category_id/category_name and drops empty ids', async () => {
    const t = transport([
      { category_id: '1', category_name: 'News', parent_id: 0 },
      { category_id: '', category_name: 'Bad' },
    ])
    expect(await getLiveCategories(t, 'http://h:8080', 'u', 'p')).toEqual([{ id: '1', name: 'News' }])
  })
  it('returns [] for a non-array body', async () => {
    expect(await getLiveCategories(transport(null), 'http://h', 'u', 'p')).toEqual([])
  })
  it('calls get_live_categories with credentials', async () => {
    const t = transport([])
    await getLiveCategories(t, 'http://h:8080', 'u', 'p')
    expect(t.getJson).toHaveBeenCalledWith(
      { scheme: 'http', host: 'h', port: 8080 }, '/player_api.php',
      { username: 'u', password: 'p', action: 'get_live_categories' },
    )
  })
})

describe('getLiveStreams', () => {
  it('maps stream fields and drops entries without a stream_id', async () => {
    const t = transport([
      { stream_id: 101, name: 'CNN', stream_icon: 'http://l/cnn.png', category_id: '1' },
      { name: 'No id', category_id: '1' },
    ])
    expect(await getLiveStreams(t, 'http://h', 'u', 'p')).toEqual([
      { id: 'x:live:101', kind: 'live', name: 'CNN', logo: 'http://l/cnn.png', categoryId: '1', streamId: '101', seriesId: null, containerExtension: null, url: null },
    ])
  })
  it('includes category_id param when given', async () => {
    const t = transport([])
    await getLiveStreams(t, 'http://h', 'u', 'p', '5')
    expect(t.getJson).toHaveBeenCalledWith(expect.anything(), '/player_api.php', {
      username: 'u', password: 'p', action: 'get_live_streams', category_id: '5',
    })
  })
  it('omits category_id when not given', async () => {
    const t = transport([])
    await getLiveStreams(t, 'http://h', 'u', 'p')
    expect(t.getJson).toHaveBeenCalledWith(expect.anything(), '/player_api.php', {
      username: 'u', password: 'p', action: 'get_live_streams',
    })
  })
})
