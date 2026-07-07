import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEpgStore } from './epg'
import { createMemoryStore } from '@/core/storage/appState'
import type { Account } from '@/core/accounts/accounts'

// A channel with two display-names AND an id, so we can test id- and name-matching.
const SAMPLE_XML = `<?xml version="1.0"?><tv>
<channel id="TRT.1.HD.tr"><display-name>TR: TRT 1 HD</display-name><display-name>TRT1</display-name></channel>
<programme start="20260706120000 +0300" stop="20260706130000 +0300" channel="TRT.1.HD.tr"><title>Haber</title><desc>Gunun haberleri</desc></programme>
<programme start="20260706130000 +0300" stop="20260706140000 +0300" channel="TRT.1.HD.tr"><title>Dizi</title></programme>
</tv>`
const OTHER_XML = `<?xml version="1.0"?><tv>
<channel id="cnn.us"><display-name>CNN</display-name></channel>
<programme start="20260706120000 +0300" stop="20260706130000 +0300" channel="cnn.us"><title>World News</title></programme>
</tv>`

// 12:30 +03:00 == 09:30 UTC, inside the first programme's window.
const PINNED_MS = Date.UTC(2026, 6, 6, 9, 30, 0)

// Manual per-account URL ⇒ resolveEpgUrl returns it directly (no workspace/global needed).
const ACCT: Account = { id: 'a', type: 'm3u', name: 'A', url: 'http://h/a.m3u', username: '', password: '', epgUrl: 'http://epg/a', createdAt: 1 }
const ACCT2: Account = { id: 'b', type: 'm3u', name: 'B', url: 'http://h/b.m3u', username: '', password: '', epgUrl: 'http://epg/b', createdAt: 2 }

describe('useEpgStore (per-account)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('defaults to an empty per-account state', () => {
    const e = useEpgStore()
    expect(e.byAccount).toEqual({})
    expect(e.loadedAtFor('a')).toBe(0)
    expect(e.isLoading('a')).toBe(false)
    expect(e.errorFor('a')).toBe('')
  })

  it('refresh(account) fetches, indexes, and persists keyed by account id', async () => {
    const store = createMemoryStore()
    const e = useEpgStore()
    e.$configure({ store, fetchXml: async () => SAMPLE_XML })
    await e.refresh(ACCT)

    expect(e.errorFor('a')).toBe('')
    expect(e.loadedAtFor('a')).toBeGreaterThan(0)
    // matched by name…
    expect(e.nowNextFor('TR: TRT 1 HD', '', 'a', PINNED_MS).now?.title).toBe('Haber')
    // …and by EPG id (even with a mismatched name)
    expect(e.nowNextFor('whatever', 'TRT.1.HD.tr', 'a', PINNED_MS).now?.title).toBe('Haber')

    const persisted = await store.load('epg.json', {} as Record<string, { channels: unknown[]; programmes: unknown[] }>)
    expect(persisted.a.channels).toHaveLength(1)
    expect(persisted.a.programmes).toHaveLength(2)
    expect(persisted.b).toBeUndefined()
  })

  it('keeps accounts isolated — each has its own guide', async () => {
    const store = createMemoryStore()
    const e = useEpgStore()
    e.$configure({ store, fetchXml: async (url) => (url === 'http://epg/a' ? SAMPLE_XML : OTHER_XML) })
    await e.refresh(ACCT)
    await e.refresh(ACCT2)

    expect(e.nowNextFor('TR: TRT 1 HD', '', 'a', PINNED_MS).now?.title).toBe('Haber')
    expect(e.hasEpgFor('TR: TRT 1 HD', '', 'a')).toBe(true)
    expect(e.hasEpgFor('TR: TRT 1 HD', '', 'b')).toBe(false) // account b doesn't have TRT
    expect(e.nowNextFor('CNN', '', 'b', PINNED_MS).now?.title).toBe('World News')
    expect(e.hasEpgFor('CNN', '', 'a')).toBe(false) // account a doesn't have CNN
  })

  it('load() rebuilds every account index from the keyed cache without fetching', async () => {
    const store = createMemoryStore()
    const e1 = useEpgStore()
    e1.$configure({ store, fetchXml: async () => SAMPLE_XML })
    await e1.refresh(ACCT)

    const e2 = useEpgStore()
    let fetchCalls = 0
    e2.$configure({ store, fetchXml: async () => { fetchCalls++; return SAMPLE_XML } })
    await e2.load()

    expect(fetchCalls).toBe(0)
    expect(e2.loadedAtFor('a')).toBe(e1.loadedAtFor('a'))
    expect(e2.nowNextFor('TRT1', '', 'a', PINNED_MS).now?.title).toBe('Haber')
  })

  it('a throwing fetch sets that account error and keeps its previous index', async () => {
    const store = createMemoryStore()
    const e = useEpgStore()
    e.$configure({ store, fetchXml: async () => SAMPLE_XML })
    await e.refresh(ACCT)
    const before = e.loadedAtFor('a')

    e.$configure({ store, fetchXml: async () => { throw new Error('network down') } })
    await e.refresh(ACCT)

    expect(e.errorFor('a')).toBe('network down')
    expect(e.loadedAtFor('a')).toBe(before) // kept the prior cache
    expect(e.nowNextFor('TRT1', '', 'a', PINNED_MS).now?.title).toBe('Haber')
  })

  it('ensureFresh(account) refreshes only once the cache is older than the TTL', async () => {
    const store = createMemoryStore()
    let calls = 0
    const e = useEpgStore()
    e.$configure({ store, fetchXml: async () => { calls++; return SAMPLE_XML } })
    await e.refresh(ACCT)
    expect(calls).toBe(1)

    await e.ensureFresh(ACCT, e.loadedAtFor('a') + 1000) // fresh — no refresh
    expect(calls).toBe(1)
    await e.ensureFresh(ACCT, e.loadedAtFor('a') + 13 * 3600 * 1000) // stale — refreshes
    expect(calls).toBe(2)
  })

  it('ensureFresh does nothing when the account resolves to no EPG URL', async () => {
    const store = createMemoryStore()
    let calls = 0
    const e = useEpgStore()
    e.$configure({ store, fetchXml: async () => { calls++; return SAMPLE_XML } })
    // m3u account, no manual epgUrl, no tvgUrl, and the global settings default is empty
    const noEpg: Account = { id: 'c', type: 'm3u', name: 'C', url: 'http://h/c.m3u', username: '', password: '', createdAt: 3 }
    e.noteTvgUrl('c', '')
    // settings.epgUrl defaults to a value; force the resolver to '' by relying on m3u+no-tvg+empty-global:
    const { useSettingsStore } = await import('./settings')
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    await s.setEpgUrl('')
    await e.ensureFresh(noEpg, 13 * 3600 * 1000)
    expect(calls).toBe(0)
  })

  it('guideChannels lists only channels with EPG (by id or name) for the given account', async () => {
    const store = createMemoryStore()
    const e = useEpgStore()
    e.$configure({ store, fetchXml: async () => SAMPLE_XML })
    await e.refresh(ACCT)
    const items = [
      { id: '1', kind: 'live', name: 'nope', epgId: 'TRT.1.HD.tr', logo: '', categoryId: '', streamId: null, seriesId: null, containerExtension: null, url: null },
      { id: '2', kind: 'live', name: 'Some Other', epgId: '', logo: '', categoryId: '', streamId: null, seriesId: null, containerExtension: null, url: null },
    ]
    const guide = e.guideChannels(items as never, Date.UTC(2026, 6, 6, 9, 0, 0), Date.UTC(2026, 6, 6, 11, 0, 0), 'a')
    expect(guide).toHaveLength(1) // only the id-matched channel
    expect(guide[0].programmes.map((p: { title: string }) => p.title)).toEqual(['Haber', 'Dizi'])
  })
})
