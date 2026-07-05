export interface Category {
  id: string
  name: string
}

export interface Channel {
  id: string
  name: string
  logo: string
  categoryId: string
  streamId: string | null // Xtream live stream id (used to build the play URL in Plan 3)
  url: string | null // direct stream URL (M3U channels)
}
