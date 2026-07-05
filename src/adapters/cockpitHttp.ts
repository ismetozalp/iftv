import cockpit from 'cockpit'
import type { XtreamBase, XtreamTransport } from '@/core/xtream/transport'

export function createCockpitTransport(): XtreamTransport {
  return {
    async getJson(base: XtreamBase, path: string, params: Record<string, string>): Promise<unknown> {
      const options =
        base.scheme === 'https'
          ? { address: base.host, port: base.port, tls: {} }
          : { address: base.host, port: base.port }
      const text = await cockpit.http(options).get(path, params)
      try {
        return JSON.parse(text)
      } catch {
        return null
      }
    },
    async fetchText(fullUrl: string): Promise<string> {
      const u = new URL(fullUrl)
      const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
      const options =
        u.protocol === 'https:'
          ? { address: u.hostname, port, tls: {} }
          : { address: u.hostname, port }
      return cockpit.http(options).get(u.pathname + u.search)
    },
  }
}
