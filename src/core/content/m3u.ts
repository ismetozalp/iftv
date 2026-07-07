import type { Category, ContentItem } from './types'

function attr(line: string, name: string): string {
  return new RegExp(`${name}="([^"]*)"`, 'i').exec(line)?.[1] ?? ''
}

// The display name is the text after the first comma that is NOT inside a quoted
// attribute value, so commas inside tvg-name/group-title don't split early and
// commas within the title itself are preserved.
function displayName(line: string): string {
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ',' && !inQuotes) return line.slice(i + 1).trim()
  }
  return ''
}

export function parseM3u(text: string): { categories: Category[]; items: ContentItem[]; tvgUrl: string } {
  const items: ContentItem[] = []
  const order: string[] = []
  const seen = new Set<string>()
  let tvgUrl = ''
  let pending: { name: string; logo: string; group: string; epgId: string } | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#EXTM3U')) {
      // The playlist may declare its own guide in the header.
      tvgUrl = attr(line, 'url-tvg') || attr(line, 'x-tvg-url') || tvgUrl
    } else if (line.startsWith('#EXTINF')) {
      const name = displayName(line) || attr(line, 'tvg-name') || 'Unnamed'
      pending = { name, logo: attr(line, 'tvg-logo'), group: attr(line, 'group-title') || 'Uncategorized', epgId: attr(line, 'tvg-id') }
    } else if (line !== '' && !line.startsWith('#') && pending) {
      if (!seen.has(pending.group)) { seen.add(pending.group); order.push(pending.group) }
      items.push({
        id: `m:${items.length}`,
        kind: 'live',
        name: pending.name,
        logo: pending.logo,
        epgId: pending.epgId,
        categoryId: pending.group,
        streamId: null,
        seriesId: null,
        containerExtension: null,
        url: line,
      })
      pending = null
    }
  }

  return { categories: order.map((g) => ({ id: g, name: g })), items, tvgUrl }
}
