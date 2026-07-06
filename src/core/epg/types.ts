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

export type EpgIndex = Record<string, Programme[]>
