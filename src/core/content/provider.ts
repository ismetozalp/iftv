import type { Category, ContentItem } from './types'
import type { XtreamTransport } from '@/core/xtream/transport'
import type { Account } from '@/core/accounts/accounts'
import { getLiveCategories, getLiveStreams } from '@/core/xtream/live'
import { parseM3u } from './m3u'

export interface ContentProvider {
  getCategories(): Promise<Category[]>
  getItems(categoryId: string): Promise<ContentItem[]>
  getAllItems(): Promise<ContentItem[]>
}

export function createXtreamLiveProvider(t: XtreamTransport, account: Account): ContentProvider {
  const { url, username, password } = account
  let allCache: ContentItem[] | null = null
  return {
    getCategories: () => getLiveCategories(t, url, username, password),
    getItems: (categoryId) => getLiveStreams(t, url, username, password, categoryId),
    async getAllItems() {
      if (!allCache) allCache = await getLiveStreams(t, url, username, password)
      return allCache
    },
  }
}

export function createM3uProvider(t: XtreamTransport, account: Account): ContentProvider {
  let parsed: { categories: Category[]; items: ContentItem[] } | null = null
  async function ensure() {
    if (!parsed) parsed = parseM3u(await t.fetchText(account.url))
    return parsed
  }
  return {
    async getCategories() {
      return (await ensure()).categories
    },
    async getItems(categoryId) {
      return (await ensure()).items.filter((c) => c.categoryId === categoryId)
    },
    async getAllItems() {
      return (await ensure()).items
    },
  }
}

export function createProvider(t: XtreamTransport, account: Account): ContentProvider {
  return account.type === 'm3u' ? createM3uProvider(t, account) : createXtreamLiveProvider(t, account)
}
