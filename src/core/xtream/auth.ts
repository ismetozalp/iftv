import type { XtreamTransport } from './transport'
import { buildPlayerApiParams } from './transport'
import { parseXtreamUrl, toNum, toStr } from './normalize'

export interface XtreamAuth {
  auth: boolean
  status: string
  active: boolean
  expDate: number | null
  maxConnections: number | null
  allowedOutputFormats: string[]
}

export async function xtreamLogin(
  transport: XtreamTransport,
  url: string,
  username: string,
  password: string,
): Promise<XtreamAuth> {
  const base = parseXtreamUrl(url)
  const body = (await transport.getJson(base, '/player_api.php', buildPlayerApiParams(username, password))) as
    | { user_info?: Record<string, unknown> }
    | null
  const info = (body && body.user_info) || {}
  const auth = info.auth === 1 || info.auth === '1'
  const status = toStr(info.status)
  const formats = Array.isArray(info.allowed_output_formats)
    ? (info.allowed_output_formats as unknown[]).map(toStr)
    : []
  return {
    auth,
    status,
    active: auth && status === 'Active',
    expDate: toNum(info.exp_date),
    maxConnections: toNum(info.max_connections),
    allowedOutputFormats: formats,
  }
}
