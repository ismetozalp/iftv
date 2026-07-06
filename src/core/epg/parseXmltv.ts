import type { ParsedEpg, Programme, XmltvChannel } from './types'

// Lightweight string/regex XMLTV parser — no DOM, node-testable. XMLTV is a
// regular, well-known shape so a full XML parser is unnecessary overhead here.

const CHANNEL_RE = /<channel\s[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g
const DISPLAY_NAME_RE = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g
const PROGRAMME_RE =
  /<programme\s[^>]*start="([^"]*)"[^>]*stop="([^"]*)"[^>]*channel="([^"]*)"[^>]*>([\s\S]*?)<\/programme>/g
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/
const DESC_RE = /<desc[^>]*>([\s\S]*?)<\/desc>/

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, code: string) => {
    if (code in ENTITY_MAP) return ENTITY_MAP[code]
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const cp = parseInt(code.slice(2), 16)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : full
    }
    if (code.startsWith('#')) {
      const cp = parseInt(code.slice(1), 10)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : full
    }
    return full
  })
}

const XMLTV_TIME_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/

export function parseXmltvTime(raw: string): number | null {
  const m = XMLTV_TIME_RE.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s, sign, offH, offM] = m
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  if (!sign) return utcMs
  const offsetMs = (Number(offH) * 60 + Number(offM)) * 60000
  return sign === '+' ? utcMs - offsetMs : utcMs + offsetMs
}

export function parseXmltv(xml: string): ParsedEpg {
  const channels: XmltvChannel[] = []
  let cm: RegExpExecArray | null
  CHANNEL_RE.lastIndex = 0
  while ((cm = CHANNEL_RE.exec(xml))) {
    const id = decodeEntities(cm[1])
    const body = cm[2]
    const names: string[] = []
    let nm: RegExpExecArray | null
    DISPLAY_NAME_RE.lastIndex = 0
    while ((nm = DISPLAY_NAME_RE.exec(body))) {
      names.push(decodeEntities(nm[1]).trim())
    }
    channels.push({ id, names })
  }

  const programmes: Programme[] = []
  let pm: RegExpExecArray | null
  PROGRAMME_RE.lastIndex = 0
  while ((pm = PROGRAMME_RE.exec(xml))) {
    const [, startRaw, stopRaw, channelId, body] = pm
    const startMs = parseXmltvTime(startRaw)
    const stopMs = parseXmltvTime(stopRaw)
    if (startMs == null || stopMs == null) continue // skip malformed programme, don't throw
    const titleMatch = TITLE_RE.exec(body)
    const descMatch = DESC_RE.exec(body)
    programmes.push({
      channelId: decodeEntities(channelId),
      startMs,
      stopMs,
      title: titleMatch ? decodeEntities(titleMatch[1]).trim() : '',
      desc: descMatch ? decodeEntities(descMatch[1]).trim() : '',
    })
  }

  return { channels, programmes }
}
