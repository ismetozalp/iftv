import type { XtreamTransport } from './transport'
import { buildPlayerApiParams } from './transport'
import { parseXtreamUrl, toStr } from './normalize'
import type { Category, ContentItem } from '@/core/content/types'

export async function getVodCategories(
  t: XtreamTransport, url: string, username: string, password: string,
): Promise<Category[]> {
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, { action: 'get_vod_categories' }))
  const arr = Array.isArray(body) ? body : []
  return arr
    .map((c) => ({ id: toStr((c as Record<string, unknown>).category_id), name: toStr((c as Record<string, unknown>).category_name) }))
    .filter((c) => c.id !== '')
}

export async function getVodStreams(
  t: XtreamTransport, url: string, username: string, password: string, categoryId?: string,
): Promise<ContentItem[]> {
  const extra: Record<string, string> = { action: 'get_vod_streams' }
  if (categoryId) extra.category_id = categoryId
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, extra))
  const arr = Array.isArray(body) ? body : []
  return arr
    .map((s) => {
      const r = s as Record<string, unknown>
      const streamId = toStr(r.stream_id)
      const ext = toStr(r.container_extension)
      return {
        id: `x:movie:${streamId}`,
        kind: 'movie' as const,
        name: toStr(r.name),
        logo: toStr(r.stream_icon),
        categoryId: toStr(r.category_id),
        streamId: streamId || null,
        seriesId: null,
        containerExtension: ext || null,
        url: null as string | null,
      }
    })
    .filter((c) => c.streamId !== null)
}
