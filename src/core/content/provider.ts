import type { Category, ContentItem } from './types'
import type { XtreamTransport } from '@/core/xtream/transport'
import type { Account } from '@/core/accounts/accounts'
import { getLiveCategories, getLiveStreams } from '@/core/xtream/live'
import { getVodCategories, getVodStreams } from '@/core/xtream/vod'
import { getSeriesCategories, getSeries } from '@/core/xtream/series'
import { parseM3u } from './m3u'

export type Section = 'live' | 'vod' | 'series'

export interface ContentProvider {
  getCategories(): Promise<Category[]>
  getItems(categoryId: string): Promise<ContentItem[]>
  getAllItems(): Promise<ContentItem[]>
}

type Cats = (t: XtreamTransport, url: string, u: string, p: string) => Promise<Category[]>
type Items = (t: XtreamTransport, url: string, u: string, p: string, categoryId?: string) => Promise<ContentItem[]>

function xtreamSection(section: Section): { cats: Cats; items: Items } {
  if (section === 'vod') return { cats: getVodCategories, items: getVodStreams }
  if (section === 'series') return { cats: getSeriesCategories, items: getSeries }
  return { cats: getLiveCategories, items: getLiveStreams }
}

export function createXtreamProvider(t: XtreamTransport, account: Account, section: Section): ContentProvider {
  const { url, username, password } = account
  const { cats, items } = xtreamSection(section)
  let allCache: ContentItem[] | null = null
  return {
    getCategories: () => cats(t, url, username, password),
    getItems: (categoryId) => items(t, url, username, password, categoryId),
    async getAllItems() {
      if (!allCache) allCache = await items(t, url, username, password)
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

const EMPTY_PROVIDER: ContentProvider = {
  getCategories: async () => [],
  getItems: async () => [],
  getAllItems: async () => [],
}

export function createProvider(t: XtreamTransport, account: Account, section: Section): ContentProvider {
  if (account.type === 'm3u') return section === 'live' ? createM3uProvider(t, account) : EMPTY_PROVIDER
  return createXtreamProvider(t, account, section)
}
