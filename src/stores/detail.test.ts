import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDetailStore } from './detail'
import type { XtreamTransport } from '@/core/xtream/transport'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const ACCT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h:8080', username: 'u', password: 'p', createdAt: 1 }
const MOVIE: ContentItem = { id: 'x:movie:99', kind: 'movie', name: 'The Movie', logo: '', epgId: '', categoryId: '1', streamId: '99', seriesId: null, containerExtension: null, url: null }
const SERIES: ContentItem = { id: 'x:series:55', kind: 'series', name: 'The Series', logo: '', epgId: '', categoryId: '1', streamId: null, seriesId: '55', containerExtension: null, url: null }

function fakeTransport(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload), fetchText: vi.fn(async () => '') }
}

describe('useDetailStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('openMovie fetches get_vod_info via transport and populates movie+item, opening the overlay', async () => {
    const t = fakeTransport({
      info: { movie_image: 'http://p/poster.jpg', plot: 'Plot here', cast: 'A, B', genre: 'Action', duration_secs: 100 },
      movie_data: { stream_id: 99, name: 'The Movie', container_extension: 'mkv' },
    })
    const s = useDetailStore()
    s.$configure({ transport: t })
    await s.openMovie(ACCT, MOVIE)

    expect(t.getJson).toHaveBeenCalledWith(
      { scheme: 'http', host: 'h', port: 8080 },
      '/player_api.php',
      { username: 'u', password: 'p', action: 'get_vod_info', vod_id: '99' },
    )
    expect(s.open).toBe(true)
    expect(s.mode).toBe('movie')
    expect(s.loading).toBe(false)
    expect(s.error).toBe('')
    expect(s.item).toEqual(MOVIE)
    expect(s.movie).toEqual({
      streamId: '99',
      name: 'The Movie',
      poster: 'http://p/poster.jpg',
      plot: 'Plot here',
      cast: 'A, B',
      genre: 'Action',
      director: '',
      releaseDate: '',
      durationSecs: 100,
      containerExtension: 'mkv',
    })
  })

  it('openSeries fetches get_series_info via transport and populates series+item, opening the overlay', async () => {
    const t = fakeTransport({
      info: { name: 'The Series', cover: 'http://p/cover.jpg', plot: 'Plot here', cast: 'A, B', genre: 'Drama' },
      episodes: {
        '1': [{ id: 11, episode_num: 1, title: 'S1E1', container_extension: 'mp4', season: 1 }],
      },
    })
    const s = useDetailStore()
    s.$configure({ transport: t })
    await s.openSeries(ACCT, SERIES)

    expect(t.getJson).toHaveBeenCalledWith(
      { scheme: 'http', host: 'h', port: 8080 },
      '/player_api.php',
      { username: 'u', password: 'p', action: 'get_series_info', series_id: '55' },
    )
    expect(s.open).toBe(true)
    expect(s.mode).toBe('series')
    expect(s.loading).toBe(false)
    expect(s.error).toBe('')
    expect(s.item).toEqual(SERIES)
    expect(s.series).toEqual({
      name: 'The Series',
      cover: 'http://p/cover.jpg',
      plot: 'Plot here',
      cast: 'A, B',
      genre: 'Drama',
      seasons: [1],
      episodes: [{ episodeId: '11', title: 'S1E1', season: 1, episodeNum: 1, containerExtension: 'mp4', durationSecs: null }],
    })
  })

  it('openSeries sets error and stays closed when the fetch fails', async () => {
    const t: XtreamTransport = {
      getJson: vi.fn(async () => { throw new Error('boom') }),
      fetchText: vi.fn(async () => ''),
    }
    const s = useDetailStore()
    s.$configure({ transport: t })
    await s.openSeries(ACCT, SERIES)

    expect(s.open).toBe(false)
    expect(s.mode).toBe('series')
    expect(s.loading).toBe(false)
    expect(s.error).toBe('boom')
    expect(s.series).toBeNull()
  })

  it('sets error and stays closed when the fetch fails', async () => {
    const t: XtreamTransport = {
      getJson: vi.fn(async () => { throw new Error('boom') }),
      fetchText: vi.fn(async () => ''),
    }
    const s = useDetailStore()
    s.$configure({ transport: t })
    await s.openMovie(ACCT, MOVIE)

    expect(s.open).toBe(false)
    expect(s.loading).toBe(false)
    expect(s.error).toBe('boom')
    expect(s.movie).toBeNull()
  })

  it('close resets open/movie/series/item/mode/error', async () => {
    const t = fakeTransport({ info: {}, movie_data: { stream_id: '99' } })
    const s = useDetailStore()
    s.$configure({ transport: t })
    await s.openMovie(ACCT, MOVIE)
    s.close()
    expect(s.open).toBe(false)
    expect(s.movie).toBeNull()
    expect(s.series).toBeNull()
    expect(s.item).toBeNull()
    expect(s.mode).toBeNull()
    expect(s.error).toBe('')
  })

  it('closes an open series detail fully, resetting series and mode (e.g. on account switch)', async () => {
    const t = fakeTransport({
      info: { name: 'The Series', cover: '', plot: '', cast: '', genre: '' },
      episodes: {},
    })
    const s = useDetailStore()
    s.$configure({ transport: t })
    await s.openSeries(ACCT, SERIES)
    expect(s.open).toBe(true)

    s.close()

    expect(s.open).toBe(false)
    expect(s.mode).toBeNull()
    expect(s.movie).toBeNull()
    expect(s.series).toBeNull()
    expect(s.item).toBeNull()
  })
})
