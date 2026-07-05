export interface XtreamBase {
  scheme: 'http' | 'https'
  host: string
  port: number
}

export interface XtreamTransport {
  getJson(base: XtreamBase, path: string, params: Record<string, string>): Promise<unknown>
}

export function buildPlayerApiParams(
  username: string,
  password: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { username, password, ...extra }
}
