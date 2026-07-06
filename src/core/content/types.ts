export interface Category {
  id: string
  name: string
}

export type ContentKind = 'live' | 'movie' | 'series' | 'episode'

export interface ContentItem {
  id: string
  kind: ContentKind
  name: string
  logo: string // live logo or movie/series poster; '' if none
  categoryId: string
  streamId: string | null // live/movie stream id (play URL, Plan 3)
  seriesId: string | null // series id (series detail, Plan 3)
  containerExtension: string | null // movie container ext (play URL, Plan 3)
  url: string | null // M3U direct URL
}
