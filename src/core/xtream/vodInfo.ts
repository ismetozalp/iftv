import type { XtreamTransport } from './transport'
import { buildPlayerApiParams } from './transport'
import { parseXtreamUrl, toStr, toNum } from './normalize'

export interface MovieInfo {
  streamId: string
  name: string
  poster: string
  plot: string
  cast: string
  genre: string
  director: string
  releaseDate: string
  durationSecs: number | null
  containerExtension: string
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export async function getVodInfo(
  t: XtreamTransport, url: string, username: string, password: string, vodId: string,
): Promise<MovieInfo> {
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, { action: 'get_vod_info', vod_id: vodId }))
  const b = asRecord(body)
  const info = asRecord(b.info)
  const movieData = asRecord(b.movie_data)
  return {
    streamId: toStr(movieData.stream_id),
    name: toStr(movieData.name) || toStr(info.name),
    poster: toStr(info.movie_image) || toStr(info.cover_big),
    plot: toStr(info.plot),
    cast: toStr(info.cast),
    genre: toStr(info.genre),
    director: toStr(info.director),
    releaseDate: toStr(info.releasedate),
    durationSecs: toNum(info.duration_secs),
    containerExtension: toStr(movieData.container_extension),
  }
}
