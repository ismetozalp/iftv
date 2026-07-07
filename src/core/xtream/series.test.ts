import { describe, it, expect, vi } from 'vitest'
import { getSeriesCategories, getSeries } from './series'
import type { XtreamTransport } from './transport'

function transport(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload), fetchText: vi.fn(async () => '') }
}

describe('getSeriesCategories', () => {
  it('maps categories and calls get_series_categories', async () => {
    const t = transport([{ category_id: '20', category_name: 'Drama' }])
    expect(await getSeriesCategories(t, 'http://h:8080', 'u', 'p')).toEqual([{ id: '20', name: 'Drama' }])
    expect(t.getJson).toHaveBeenCalledWith({ scheme: 'http', host: 'h', port: 8080 }, '/player_api.php', { username: 'u', password: 'p', action: 'get_series_categories' })
  })
})

describe('getSeries', () => {
  it('maps series fields (cover→logo, series_id→seriesId), drops empty series_id', async () => {
    const t = transport([
      { series_id: 77, name: 'The Show', cover: 'http://p/s.jpg', category_id: '20' },
      { name: 'no id', category_id: '20' },
    ])
    expect(await getSeries(t, 'http://h', 'u', 'p')).toEqual([
      { id: 'x:series:77', kind: 'series', name: 'The Show', logo: 'http://p/s.jpg', epgId: '', categoryId: '20', streamId: null, seriesId: '77', containerExtension: null, url: null },
    ])
  })
  it('includes category_id param when given; omits otherwise', async () => {
    const t = transport([])
    await getSeries(t, 'http://h', 'u', 'p', '20')
    expect(t.getJson).toHaveBeenCalledWith(expect.anything(), '/player_api.php', { username: 'u', password: 'p', action: 'get_series', category_id: '20' })
    await getSeries(t, 'http://h', 'u', 'p')
    expect(t.getJson).toHaveBeenLastCalledWith(expect.anything(), '/player_api.php', { username: 'u', password: 'p', action: 'get_series' })
  })
  it('returns [] for a non-array body', async () => {
    expect(await getSeries(transport(null), 'http://h', 'u', 'p')).toEqual([])
  })
})
