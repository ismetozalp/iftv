import { describe, it, expect, vi } from 'vitest'
import { createProvider } from './provider'
import type { XtreamTransport } from '@/core/xtream/transport'
import type { Account } from '@/core/accounts/accounts'

const XT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h:8080', username: 'u', password: 'p', createdAt: 1 }
const M3: Account = { id: 'b', type: 'm3u', name: 'M', url: 'http://host/list.m3u', username: '', password: '', createdAt: 2 }

const M3U_BODY = `#EXTM3U
#EXTINF:-1 group-title="News",CNN
http://s/cnn
#EXTINF:-1 group-title="Sports",ESPN
http://s/espn
`

function xtreamTransport(): XtreamTransport {
  return {
    getJson: vi.fn(async (_b, _p, params: Record<string, string>) => {
      if (params.action === 'get_live_categories') return [{ category_id: '1', category_name: 'News' }]
      if (params.action === 'get_live_streams') return [{ stream_id: 1, name: 'CNN', stream_icon: '', category_id: params.category_id ?? '1' }]
      if (params.action === 'get_vod_categories') return [{ category_id: '10', category_name: 'Action' }]
      if (params.action === 'get_vod_streams') return [{ stream_id: 5, name: 'Film', stream_icon: '', category_id: '10', container_extension: 'mkv' }]
      if (params.action === 'get_series_categories') return [{ category_id: '20', category_name: 'Drama' }]
      if (params.action === 'get_series') return [{ series_id: 9, name: 'Show', cover: '', category_id: '20' }]
      return []
    }),
    fetchText: vi.fn(async () => ''),
  }
}
function m3uTransport(): XtreamTransport {
  return { getJson: vi.fn(async () => []), fetchText: vi.fn(async () => M3U_BODY) }
}

describe('createProvider — xtream', () => {
  it('fetches categories and streams via the API', async () => {
    const p = createProvider(xtreamTransport(), XT, 'live')
    expect(await p.getCategories()).toEqual([{ id: '1', name: 'News' }])
    const chans = await p.getItems('1')
    expect(chans[0]).toMatchObject({ id: 'x:live:1', name: 'CNN', categoryId: '1', streamId: '1' })
  })
  it('caches getAllChannels (one API call)', async () => {
    const t = xtreamTransport()
    const p = createProvider(t, XT, 'live')
    await p.getAllItems(); await p.getAllItems()
    const allCalls = (t.getJson as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[2] as Record<string, string>).action === 'get_live_streams' && !(c[2] as Record<string, string>).category_id)
    expect(allCalls).toHaveLength(1)
  })
})

describe('createProvider — m3u', () => {
  it('parses the playlist and serves categories/channels from memory', async () => {
    const t = m3uTransport()
    const p = createProvider(t, M3, 'live')
    expect(await p.getCategories()).toEqual([{ id: 'News', name: 'News' }, { id: 'Sports', name: 'Sports' }])
    expect((await p.getItems('Sports')).map((c) => c.name)).toEqual(['ESPN'])
    expect(await p.getAllItems()).toHaveLength(2)
  })
  it('fetches + parses the playlist only once', async () => {
    const t = m3uTransport()
    const p = createProvider(t, M3, 'live')
    await p.getCategories(); await p.getAllItems(); await p.getItems('News')
    expect(t.fetchText).toHaveBeenCalledTimes(1)
  })
})

describe('createProvider — xtream sections', () => {
  it('vod section fetches movies with container_extension', async () => {
    const p = createProvider(xtreamTransport(), XT, 'vod')
    expect(await p.getCategories()).toEqual([{ id: '10', name: 'Action' }])
    expect((await p.getItems('10'))[0]).toMatchObject({ id: 'x:movie:5', kind: 'movie', containerExtension: 'mkv', seriesId: null })
  })
  it('series section fetches series with seriesId', async () => {
    const p = createProvider(xtreamTransport(), XT, 'series')
    expect(await p.getCategories()).toEqual([{ id: '20', name: 'Drama' }])
    expect((await p.getItems('20'))[0]).toMatchObject({ id: 'x:series:9', kind: 'series', seriesId: '9', streamId: null })
  })
})

describe('createProvider — m3u non-live', () => {
  it('returns an empty provider for vod/series on an m3u account', async () => {
    const t = m3uTransport()
    const vod = createProvider(t, M3, 'vod')
    expect(await vod.getCategories()).toEqual([])
    expect(await vod.getAllItems()).toEqual([])
    expect(t.fetchText).not.toHaveBeenCalled()
  })
})
