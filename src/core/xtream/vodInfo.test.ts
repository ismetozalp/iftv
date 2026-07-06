import { describe, it, expect, vi } from 'vitest'
import { getVodInfo } from './vodInfo'
import type { XtreamTransport } from './transport'

function transport(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload), fetchText: vi.fn(async () => '') }
}

describe('getVodInfo', () => {
  it('maps info+movie_data and calls get_vod_info with vod_id', async () => {
    const t = transport({
      info: {
        movie_image: 'http://p/poster.jpg',
        plot: 'A great movie',
        cast: 'Actor One, Actor Two',
        genre: 'Action',
        director: 'Some Director',
        releasedate: '2020-01-01',
        duration_secs: 7200,
      },
      movie_data: { stream_id: 99, name: 'The Movie', container_extension: 'mkv' },
    })
    expect(await getVodInfo(t, 'http://h:8080', 'u', 'p', '99')).toEqual({
      streamId: '99',
      name: 'The Movie',
      poster: 'http://p/poster.jpg',
      plot: 'A great movie',
      cast: 'Actor One, Actor Two',
      genre: 'Action',
      director: 'Some Director',
      releaseDate: '2020-01-01',
      durationSecs: 7200,
      containerExtension: 'mkv',
    })
    expect(t.getJson).toHaveBeenCalledWith(
      { scheme: 'http', host: 'h', port: 8080 },
      '/player_api.php',
      { username: 'u', password: 'p', action: 'get_vod_info', vod_id: '99' },
    )
  })

  it('falls back to info.cover_big and info.name; handles missing duration_secs', async () => {
    const t = transport({
      info: { cover_big: 'http://p/cover.jpg', name: 'Fallback Name' },
      movie_data: { stream_id: 5 },
    })
    expect(await getVodInfo(t, 'http://h', 'u', 'p', '5')).toEqual({
      streamId: '5',
      name: 'Fallback Name',
      poster: 'http://p/cover.jpg',
      plot: '',
      cast: '',
      genre: '',
      director: '',
      releaseDate: '',
      durationSecs: null,
      containerExtension: '',
    })
  })

  it('guards missing/non-object info and movie_data → empty fields', async () => {
    const t = transport({})
    expect(await getVodInfo(t, 'http://h', 'u', 'p', '1')).toEqual({
      streamId: '',
      name: '',
      poster: '',
      plot: '',
      cast: '',
      genre: '',
      director: '',
      releaseDate: '',
      durationSecs: null,
      containerExtension: '',
    })

    const t2 = transport({ info: null, movie_data: 'nope' })
    expect(await getVodInfo(t2, 'http://h', 'u', 'p', '1')).toEqual({
      streamId: '',
      name: '',
      poster: '',
      plot: '',
      cast: '',
      genre: '',
      director: '',
      releaseDate: '',
      durationSecs: null,
      containerExtension: '',
    })
  })

  it('returns empty fields for a non-object body', async () => {
    const t = transport(null)
    expect(await getVodInfo(t, 'http://h', 'u', 'p', '1')).toEqual({
      streamId: '',
      name: '',
      poster: '',
      plot: '',
      cast: '',
      genre: '',
      director: '',
      releaseDate: '',
      durationSecs: null,
      containerExtension: '',
    })
  })
})
