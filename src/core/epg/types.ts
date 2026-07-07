export interface Programme {
  channelId: string
  startMs: number
  stopMs: number
  title: string
  desc: string
}

export interface XmltvChannel {
  id: string
  names: string[]
}

export interface ParsedEpg {
  channels: XmltvChannel[]
  programmes: Programme[]
}

// Programmes looked up by channel EPG id (exact) or by normalized channel name (fallback).
export interface EpgIndex {
  byId: Record<string, Programme[]>
  byName: Record<string, Programme[]>
}
