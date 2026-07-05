import type { Category, Channel } from './types'
import type { XtreamTransport } from '@/core/xtream/transport'
import type { Account } from '@/core/accounts/accounts'
import { getLiveCategories, getLiveStreams } from '@/core/xtream/live'
import { parseM3u } from './m3u'

export interface ContentProvider {
  getCategories(): Promise<Category[]>
  getChannels(categoryId: string): Promise<Channel[]>
  getAllChannels(): Promise<Channel[]>
}

export function createXtreamLiveProvider(t: XtreamTransport, account: Account): ContentProvider {
  const { url, username, password } = account
  let allCache: Channel[] | null = null
  return {
    getCategories: () => getLiveCategories(t, url, username, password),
    getChannels: (categoryId) => getLiveStreams(t, url, username, password, categoryId),
    async getAllChannels() {
      if (!allCache) allCache = await getLiveStreams(t, url, username, password)
      return allCache
    },
  }
}

export function createM3uProvider(t: XtreamTransport, account: Account): ContentProvider {
  let parsed: { categories: Category[]; channels: Channel[] } | null = null
  async function ensure() {
    if (!parsed) parsed = parseM3u(await t.fetchText(account.url))
    return parsed
  }
  return {
    async getCategories() {
      return (await ensure()).categories
    },
    async getChannels(categoryId) {
      return (await ensure()).channels.filter((c) => c.categoryId === categoryId)
    },
    async getAllChannels() {
      return (await ensure()).channels
    },
  }
}

export function createProvider(t: XtreamTransport, account: Account): ContentProvider {
  return account.type === 'm3u' ? createM3uProvider(t, account) : createXtreamLiveProvider(t, account)
}
