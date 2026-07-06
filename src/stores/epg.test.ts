import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEpgStore } from './epg'
import { useSettingsStore, EPG_TTL_MS } from './settings'
import { createMemoryStore } from '@/core/storage/appState'

const SAMPLE_XML = `<?xml version="1.0"?><tv>
<channel id="TRT.1.HD.tr"><display-name>TR: TRT 1 HD</display-name><display-name>TRT1</display-name></channel>
<programme start="20260706120000 +0300" stop="20260706130000 +0300" channel="TRT.1.HD.tr"><title>Haber</title><desc>Gunun haberleri</desc></programme>
<programme start="20260706130000 +0300" stop="20260706140000 +0300" channel="TRT.1.HD.tr"><title>Dizi</title></programme>
</tv>`

// 12:30 +03:00 == 09:30 UTC, inside the first programme's window.
const PINNED_MS = Date.UTC(2026, 6, 6, 9, 30, 0)

describe('useEpgStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('defaults to an empty index before loading', () => {
    const e = useEpgStore()
    expect(e.index).toEqual({})
    expect(e.loadedAt).toBe(0)
    expect(e.loading).toBe(false)
    expect(e.error).toBe('')
  })

  it('refresh() fetches, populates the index, and persists {loadedAt, channels, programmes}', async () => {
    const store = createMemoryStore()
    const fetchXml = async () => SAMPLE_XML
    const e = useEpgStore()
    e.$configure({ store, fetchXml })
    await e.refresh()

    expect(e.error).toBe('')
    expect(e.loadedAt).toBeGreaterThan(0)
    const nn = e.nowNextFor('TR: TRT 1 HD', PINNED_MS)
    expect(nn.now?.title).toBe('Haber')
    expect(nn.next?.title).toBe('Dizi')

    const persisted = await store.load('epg.json', { loadedAt: 0, channels: [], programmes: [] })
    expect(persisted.loadedAt).toBe(e.loadedAt)
    expect(persisted.programmes).toHaveLength(2)
    expect(persisted.channels).toHaveLength(1)
  })

  it('load() rebuilds the index from cache without fetching', async () => {
    const store = createMemoryStore()
    const e1 = useEpgStore()
    e1.$configure({ store, fetchXml: async () => SAMPLE_XML })
    await e1.refresh()

    const e2 = useEpgStore()
    let fetchCalls = 0
    e2.$configure({
      store,
      fetchXml: async () => {
        fetchCalls++
        return SAMPLE_XML
      },
    })
    await e2.load()

    expect(fetchCalls).toBe(0)
    expect(e2.loadedAt).toBe(e1.loadedAt)
    const nn = e2.nowNextFor('TR: TRT 1 HD', PINNED_MS)
    expect(nn.now?.title).toBe('Haber')
  })

  it('a throwing fetchXml sets error and keeps the previous index', async () => {
    const store = createMemoryStore()
    const e = useEpgStore()
    e.$configure({ store, fetchXml: async () => SAMPLE_XML })
    await e.refresh()
    const loadedAtBefore = e.loadedAt

    e.$configure({
      store,
      fetchXml: async () => {
        throw new Error('network down')
      },
    })
    await e.refresh()

    expect(e.error).toBe('network down')
    expect(e.loadedAt).toBe(loadedAtBefore) // unchanged — kept the prior cache
    const nn = e.nowNextFor('TR: TRT 1 HD', PINNED_MS)
    expect(nn.now?.title).toBe('Haber')
  })

  it('ensureFresh() refreshes only once the cache is older than EPG_TTL_MS', async () => {
    const store = createMemoryStore()
    let calls = 0
    const e = useEpgStore()
    e.$configure({
      store,
      fetchXml: async () => {
        calls++
        return SAMPLE_XML
      },
    })
    await e.refresh()
    expect(calls).toBe(1)

    await e.ensureFresh(e.loadedAt + 1000) // fresh — no refresh
    expect(calls).toBe(1)

    await e.ensureFresh(e.loadedAt + EPG_TTL_MS + 1) // stale — refreshes
    expect(calls).toBe(2)
  })

  it('ensureFresh() does nothing when settings.epgUrl is empty (EPG disabled)', async () => {
    const store = createMemoryStore()
    let calls = 0
    const settings = useSettingsStore()
    settings.$configure({ store })
    await settings.load()
    await settings.setEpgUrl('')

    const e = useEpgStore()
    e.$configure({
      store,
      fetchXml: async () => {
        calls++
        return SAMPLE_XML
      },
    })
    await e.ensureFresh(EPG_TTL_MS + 1)
    expect(calls).toBe(0)
  })

  it('hasEpgFor / scheduleFor / guideChannels work via normalized names', async () => {
    const store = createMemoryStore()
    const e = useEpgStore()
    e.$configure({ store, fetchXml: async () => SAMPLE_XML })
    await e.refresh()

    expect(e.hasEpgFor('TRT1')).toBe(true)
    expect(e.hasEpgFor('Unknown Channel')).toBe(false)

    const schedule = e.scheduleFor('TR: TRT 1 HD', PINNED_MS)
    expect(schedule.map((p: { title: string }) => p.title)).toEqual(['Haber', 'Dizi'])

    const items = [
      { id: '1', kind: 'live', name: 'TR: TRT 1 HD', logo: '', categoryId: '', streamId: null, seriesId: null, containerExtension: null, url: null },
      { id: '2', kind: 'live', name: 'Some Other Channel', logo: '', categoryId: '', streamId: null, seriesId: null, containerExtension: null, url: null },
    ]
    const from = Date.UTC(2026, 6, 6, 9, 0, 0)
    const to = Date.UTC(2026, 6, 6, 11, 0, 0)
    const guide = e.guideChannels(items as never, from, to)
    expect(guide).toHaveLength(1)
    expect(guide[0].item.name).toBe('TR: TRT 1 HD')
    expect(guide[0].programmes.map((p: { title: string }) => p.title)).toEqual(['Haber', 'Dizi'])
  })
})
