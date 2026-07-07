import { normalizeChannelName } from './normalize'
import type { EpgIndex, ParsedEpg, Programme } from './types'

export function buildIndex(parsed: ParsedEpg): EpgIndex {
  const byChannelId = new Map<string, Programme[]>()
  for (const p of parsed.programmes) {
    const list = byChannelId.get(p.channelId)
    if (list) list.push(p)
    else byChannelId.set(p.channelId, [p])
  }
  for (const list of byChannelId.values()) list.sort((a, b) => a.startMs - b.startMs)

  const index: EpgIndex = { byId: {}, byName: {} }
  for (const channel of parsed.channels) {
    const programmes = byChannelId.get(channel.id) ?? []
    if (channel.id) index.byId[channel.id] = programmes
    for (const name of channel.names) {
      const key = normalizeChannelName(name)
      if (!key) continue
      index.byName[key] = programmes
    }
  }
  return index
}

// Look up a channel's programmes by its EPG id (exact, wins) then its normalized name (fallback).
export function lookup(index: EpgIndex, name: string, epgId: string): Programme[] {
  if (epgId && index.byId[epgId]) return index.byId[epgId]
  return index.byName[normalizeChannelName(name)] ?? []
}

export const EMPTY_INDEX: EpgIndex = { byId: {}, byName: {} }

export function nowNext(progs: Programme[], nowMs: number): { now: Programme | null; next: Programme | null } {
  let now: Programme | null = null
  let next: Programme | null = null
  for (let i = 0; i < progs.length; i++) {
    const p = progs[i]
    if (nowMs >= p.startMs && nowMs < p.stopMs) {
      now = p
      next = progs[i + 1] ?? null
      break
    }
    if (nowMs < p.startMs) {
      next = p
      break
    }
  }
  return { now, next }
}

export function programmesInWindow(progs: Programme[], fromMs: number, toMs: number): Programme[] {
  return progs.filter((p) => p.stopMs >= fromMs && p.startMs <= toMs)
}

export function daySchedule(progs: Programme[], nowMs: number): Programme[] {
  return progs.filter((p) => p.stopMs > nowMs)
}
