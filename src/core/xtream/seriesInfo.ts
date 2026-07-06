import type { XtreamTransport } from './transport'
import { buildPlayerApiParams } from './transport'
import { parseXtreamUrl, toStr, toNum } from './normalize'

export interface Episode {
  episodeId: string
  title: string
  season: number
  episodeNum: number
  containerExtension: string
}

export interface SeriesDetailData {
  name: string
  cover: string
  plot: string
  cast: string
  genre: string
  seasons: number[]
  episodes: Episode[]
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export async function getSeriesInfo(
  t: XtreamTransport, url: string, username: string, password: string, seriesId: string,
): Promise<SeriesDetailData> {
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, { action: 'get_series_info', series_id: seriesId }))
  const b = asRecord(body)
  const info = asRecord(b.info)
  const episodesBySeason = asRecord(b.episodes)

  const episodes: Episode[] = []
  // episodes is keyed by season number; fall back to that key when an episode omits `season`.
  for (const [seasonKey, seasonList] of Object.entries(episodesBySeason)) {
    if (!Array.isArray(seasonList)) continue
    for (const raw of seasonList) {
      const e = asRecord(raw)
      episodes.push({
        episodeId: toStr(e.id),
        title: toStr(e.title),
        season: toNum(e.season) ?? toNum(seasonKey) ?? 0,
        episodeNum: toNum(e.episode_num) ?? 0,
        containerExtension: toStr(e.container_extension),
      })
    }
  }
  episodes.sort((a, b2) => a.season - b2.season || a.episodeNum - b2.episodeNum)

  const seasons = [...new Set(episodes.map((e) => e.season))].sort((a, b2) => a - b2)

  return {
    name: toStr(info.name),
    cover: toStr(info.cover),
    plot: toStr(info.plot),
    cast: toStr(info.cast),
    genre: toStr(info.genre),
    seasons,
    episodes,
  }
}
