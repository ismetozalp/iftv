import { defineStore } from 'pinia'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'
import type { XtreamTransport } from '@/core/xtream/transport'
import { getVodInfo, type MovieInfo } from '@/core/xtream/vodInfo'
import { useHost } from '@/composables/useHost'

interface DetailDeps { transport: XtreamTransport }

export const useDetailStore = defineStore('detail', {
  state: () => ({
    open: false,
    loading: false,
    error: '',
    movie: null as MovieInfo | null,
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
    close() {
      this.open = false
      this.movie = null
      this.item = null
      this.error = ''
    },
  },
})
