import { describe, it, expect, vi } from 'vitest'
import { getSeriesInfo } from './seriesInfo'
import type { XtreamTransport } from './transport'

function transport(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload), fetchText: vi.fn(async () => '') }
}

describe('getSeriesInfo', () => {
  it('maps info and flattens season-keyed episodes into a sorted array + calls get_series_info with series_id', async () => {
    const t = transport({
      info: {
        name: 'The Series',
        cover: 'http://p/cover.jpg',
        plot: 'A great series',
        cast: 'Actor One, Actor Two',
        genre: 'Drama',
      },
      seasons: [{ season_number: 1 }, { season_number: 2 }],
      episodes: {
        '2': [
          { id: 21, episode_num: 1, title: 'S2E1', container_extension: 'mkv', season: 2 },
          { id: 22, episode_num: 2, title: 'S2E2', container_extension: 'mkv', season: 2 },
        ],
        '1': [
          { id: 12, episode_num: 2, title: 'S1E2', container_extension: 'mp4', season: 1 },
          { id: 11, episode_num: 1, title: 'S1E1', container_extension: 'mp4', season: 1 },
        ],
      },
    })

    expect(await getSeriesInfo(t, 'http://h:8080', 'u', 'p', '55')).toEqual({
      name: 'The Series',
      cover: 'http://p/cover.jpg',
      plot: 'A great series',
      cast: 'Actor One, Actor Two',
      genre: 'Drama',
      seasons: [1, 2],
      episodes: [
        { episodeId: '11', title: 'S1E1', season: 1, episodeNum: 1, containerExtension: 'mp4' },
        { episodeId: '12', title: 'S1E2', season: 1, episodeNum: 2, containerExtension: 'mp4' },
        { episodeId: '21', title: 'S2E1', season: 2, episodeNum: 1, containerExtension: 'mkv' },
        { episodeId: '22', title: 'S2E2', season: 2, episodeNum: 2, containerExtension: 'mkv' },
      ],
    })

    expect(t.getJson).toHaveBeenCalledWith(
      { scheme: 'http', host: 'h', port: 8080 },
      '/player_api.php',
      { username: 'u', password: 'p', action: 'get_series_info', series_id: '55' },
    )
  })

  it('guards missing/non-object info and episodes → empty fields', async () => {
    const t = transport({})
    expect(await getSeriesInfo(t, 'http://h', 'u', 'p', '1')).toEqual({
      name: '',
      cover: '',
      plot: '',
      cast: '',
      genre: '',
      seasons: [],
      episodes: [],
    })

    const t2 = transport({ info: null, episodes: 'nope' })
    expect(await getSeriesInfo(t2, 'http://h', 'u', 'p', '1')).toEqual({
      name: '',
      cover: '',
      plot: '',
      cast: '',
      genre: '',
      seasons: [],
      episodes: [],
    })
  })

  it('returns empty fields for a non-object body', async () => {
    const t = transport(null)
    expect(await getSeriesInfo(t, 'http://h', 'u', 'p', '1')).toEqual({
      name: '',
      cover: '',
      plot: '',
      cast: '',
      genre: '',
      seasons: [],
      episodes: [],
    })
  })
})
