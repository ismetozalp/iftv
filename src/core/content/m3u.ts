import type { Category, Channel } from './types'

function attr(line: string, name: string): string {
  return new RegExp(`${name}="([^"]*)"`, 'i').exec(line)?.[1] ?? ''
}

export function parseM3u(text: string): { categories: Category[]; channels: Channel[] } {
  const channels: Channel[] = []
  const order: string[] = []
  const seen = new Set<string>()
  let pending: { name: string; logo: string; group: string } | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#EXTINF')) {
      const comma = line.indexOf(',')
      const display = comma >= 0 ? line.slice(comma + 1).trim() : ''
      const name = display || attr(line, 'tvg-name') || 'Unnamed'
      pending = { name, logo: attr(line, 'tvg-logo'), group: attr(line, 'group-title') || 'Uncategorized' }
    } else if (line !== '' && !line.startsWith('#') && pending) {
      if (!seen.has(pending.group)) { seen.add(pending.group); order.push(pending.group) }
      channels.push({
        id: `m:${channels.length}`,
        name: pending.name,
        logo: pending.logo,
        categoryId: pending.group,
        streamId: null,
        url: line,
      })
      pending = null
    }
  }

  return { categories: order.map((g) => ({ id: g, name: g })), channels }
}
