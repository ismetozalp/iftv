import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from './settings'
import { createMemoryStore } from '@/core/storage/appState'

describe('useSettingsStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('defaults bufferSeconds to 30 before loading', () => {
    const s = useSettingsStore()
    expect(s.bufferSeconds).toBe(30)
  })

  it('load reads a persisted bufferSeconds from the store', async () => {
    const store = createMemoryStore({ 'settings.json': { bufferSeconds: 45 } })
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    expect(s.bufferSeconds).toBe(45)
  })

  it('load falls back to 30 when nothing is persisted yet', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    expect(s.bufferSeconds).toBe(30)
  })

  it('setBufferSeconds updates state and persists it', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    await s.setBufferSeconds(60)
    expect(s.bufferSeconds).toBe(60)
    expect(await store.load('settings.json', { bufferSeconds: 0 })).toEqual({ bufferSeconds: 60 })
  })

  it('setBufferSeconds clamps values below 5 up to 5', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    await s.setBufferSeconds(1)
    expect(s.bufferSeconds).toBe(5)
  })

  it('setBufferSeconds clamps values above 120 down to 120', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    await s.setBufferSeconds(999)
    expect(s.bufferSeconds).toBe(120)
  })

  it('persists across a reload of a new store instance', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    await s.setBufferSeconds(90)

    const s2 = useSettingsStore()
    s2.$configure({ store })
    await s2.load()
    expect(s2.bufferSeconds).toBe(90)
  })
})
