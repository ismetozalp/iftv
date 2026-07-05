import type { XtreamTransport } from './transport'
import { buildPlayerApiParams } from './transport'
import { parseXtreamUrl, toStr } from './normalize'
import type { Category, Channel } from '@/core/content/types'

export async function getLiveCategories(
  t: XtreamTransport, url: string, username: string, password: string,
): Promise<Category[]> {
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, { action: 'get_live_categories' }))
  const arr = Array.isArray(body) ? body : []
  return arr
    .map((c) => ({ id: toStr((c as Record<string, unknown>).category_id), name: toStr((c as Record<string, unknown>).category_name) }))
    .filter((c) => c.id !== '')
}

export async function getLiveStreams(
  t: XtreamTransport, url: string, username: string, password: string, categoryId?: string,
): Promise<Channel[]> {
  const extra: Record<string, string> = { action: 'get_live_streams' }
  if (categoryId) extra.category_id = categoryId
  const body = await t.getJson(parseXtreamUrl(url), '/player_api.php',
    buildPlayerApiParams(username, password, extra))
  const arr = Array.isArray(body) ? body : []
  return arr
    .map((s) => {
      const r = s as Record<string, unknown>
      const streamId = toStr(r.stream_id)
      return {
        id: `x:${streamId}`,
        name: toStr(r.name),
        logo: toStr(r.stream_icon),
        categoryId: toStr(r.category_id),
        streamId: streamId || null,
        url: null as string | null,
      }
    })
    .filter((c) => c.streamId !== null)
}
