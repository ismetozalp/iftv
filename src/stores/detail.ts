import { defineStore } from 'pinia'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { XtreamTransport } from '@/core/xtream/transport'
import { getVodInfo, type MovieInfo } from '@/core/xtream/vodInfo'
import { getSeriesInfo, type SeriesDetailData } from '@/core/xtream/seriesInfo'
import { useHost } from '@/composables/useHost'

interface DetailDeps { transport: XtreamTransport }

export const useDetailStore = defineStore('detail', {
  state: () => ({
    open: false,
    loading: false,
    error: '',
    mode: null as 'movie' | 'series' | null,
    movie: null as MovieInfo | null,
    series: null as SeriesDetailData | null,
    item: null as ContentItem | null,
    _deps: null as DetailDeps | null,
  }),
  actions: {
    $configure(deps: DetailDeps) {
      this._deps = deps
    },
    async _transport(): Promise<XtreamTransport> {
      if (!this._deps) {
        const { transport } = await useHost()
        this._deps = { transport }
      }
      return this._deps.transport
    },
    async openMovie(account: Account, item: ContentItem) {
      this.loading = true
      this.error = ''
      this.mode = 'movie'
      try {
        const transport = await this._transport()
        const vodId = item.streamId ?? ''
        const movie = await getVodInfo(transport, account.url, account.username, account.password, vodId)
        this.movie = movie
        this.item = item
        this.open = true
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
        this.movie = null
        this.item = null
        this.open = false
      } finally {
        this.loading = false
      }
    },
    async openSeries(account: Account, item: ContentItem) {
      this.loading = true
      this.error = ''
      this.mode = 'series'
      try {
        const transport = await this._transport()
        const seriesId = item.seriesId ?? item.streamId ?? ''
        const series = await getSeriesInfo(transport, account.url, account.username, account.password, seriesId)
        this.series = series
        this.item = item
        this.open = true
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
        this.series = null
        this.item = null
        this.open = false
      } finally {
        this.loading = false
      }
    },
    close() {
      this.open = false
      this.movie = null
      this.series = null
      this.item = null
      this.mode = null
      this.error = ''
    },
  },
})
