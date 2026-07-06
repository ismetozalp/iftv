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
    expect(await store.load('settings.json', { bufferSeconds: 0 })).toEqual({
      bufferSeconds: 60,
      transcodeMode: 'auto',
      encoderTest: null,
      cacheDir: '',
      cacheLimitGb: 5,
    })
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

  it('defaults transcodeMode to auto and encoderTest to null before loading', () => {
    const s = useSettingsStore()
    expect(s.transcodeMode).toBe('auto')
    expect(s.encoderTest).toBeNull()
  })

  it('load reads a persisted transcodeMode and encoderTest from the store', async () => {
    const store = createMemoryStore({
      'settings.json': { bufferSeconds: 45, transcodeMode: 'gpu', encoderTest: { nvenc: true, x264: true, testedAt: 123 } },
    })
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    expect(s.bufferSeconds).toBe(45)
    expect(s.transcodeMode).toBe('gpu')
    expect(s.encoderTest).toEqual({ nvenc: true, x264: true, testedAt: 123 })
  })

  it('load back-compat: an old settings.json with only bufferSeconds defaults the new fields', async () => {
    const store = createMemoryStore({ 'settings.json': { bufferSeconds: 45 } })
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    expect(s.bufferSeconds).toBe(45)
    expect(s.transcodeMode).toBe('auto')
    expect(s.encoderTest).toBeNull()
  })

  it('setTranscodeMode persists and does not wipe bufferSeconds (survives a reload)', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    await s.setBufferSeconds(90)
    await s.setTranscodeMode('gpu')
    expect(s.transcodeMode).toBe('gpu')

    const s2 = useSettingsStore()
    s2.$configure({ store })
    await s2.load()
    expect(s2.bufferSeconds).toBe(90)
    expect(s2.transcodeMode).toBe('gpu')
  })

  it('setTranscodeMode rejects an invalid mode', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    await expect(s.setTranscodeMode('bogus' as never)).rejects.toThrow()
    expect(s.transcodeMode).toBe('auto')
  })

  it('runEncoderTest uses the injected detect, sets encoderTest, and persists it (without wiping bufferSeconds)', async () => {
    const store = createMemoryStore()
    const detect = async () => ({ nvenc: true, x264: false })
    const s = useSettingsStore()
    s.$configure({ store, detect })
    await s.load()
    await s.setBufferSeconds(60)
    await s.runEncoderTest(999)
    expect(s.encoderTest).toEqual({ nvenc: true, x264: false, testedAt: 999 })

    const s2 = useSettingsStore()
    s2.$configure({ store })
    await s2.load()
    expect(s2.bufferSeconds).toBe(60)
    expect(s2.encoderTest).toEqual({ nvenc: true, x264: false, testedAt: 999 })
  })

  it('defaults cacheDir to empty and cacheLimitGb to 5 before loading', () => {
    const s = useSettingsStore()
    expect(s.cacheDir).toBe('')
    expect(s.cacheLimitGb).toBe(5)
  })

  it('load reads persisted cacheDir/cacheLimitGb from the store', async () => {
    const store = createMemoryStore({ 'settings.json': { bufferSeconds: 45, cacheDir: '/data/media', cacheLimitGb: 10 } })
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    expect(s.cacheDir).toBe('/data/media')
    expect(s.cacheLimitGb).toBe(10)
  })

  it('load back-compat: an old settings.json without cacheDir/cacheLimitGb defaults them', async () => {
    const store = createMemoryStore({ 'settings.json': { bufferSeconds: 45 } })
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    expect(s.cacheDir).toBe('')
    expect(s.cacheLimitGb).toBe(5)
  })

  it('persists cacheDir/cacheLimitGb across a reload of a new store instance', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store, probeWritable: async () => true })
    await s.load()
    await s.setCacheDir('/data/media')
    await s.setCacheLimitGb(20)

    const s2 = useSettingsStore()
    s2.$configure({ store })
    await s2.load()
    expect(s2.cacheDir).toBe('/data/media')
    expect(s2.cacheLimitGb).toBe(20)
  })

  it('setCacheLimitGb clamps negative values up to 1', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    await s.setCacheLimitGb(-1)
    expect(s.cacheLimitGb).toBe(1)
  })

  it('setCacheLimitGb treats 0 as unset and falls back to the default of 5', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    await s.setCacheLimitGb(0)
    expect(s.cacheLimitGb).toBe(5)
  })

  it('setCacheLimitGb floors fractional values', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    await s.setCacheLimitGb(3.9)
    expect(s.cacheLimitGb).toBe(3)
  })

  it('setCacheDir("") is always ok and persists the default', async () => {
    const store = createMemoryStore()
    const s = useSettingsStore()
    s.$configure({ store })
    await s.load()
    const r = await s.setCacheDir('')
    expect(r).toEqual({ ok: true })
    expect(s.cacheDir).toBe('')
    expect(await store.load('settings.json', {})).toMatchObject({ cacheDir: '' })
  })

  it('setCacheDir persists when probeWritable resolves true', async () => {
    const store = createMemoryStore()
    const probeWritable = async () => true
    const s = useSettingsStore()
    s.$configure({ store, probeWritable })
    await s.load()
    const r = await s.setCacheDir('/data/media')
    expect(r).toEqual({ ok: true })
    expect(s.cacheDir).toBe('/data/media')
    expect(await store.load('settings.json', {})).toMatchObject({ cacheDir: '/data/media' })
  })

  it('setCacheDir returns {ok:false} and leaves cacheDir unchanged when probeWritable resolves false', async () => {
    const store = createMemoryStore()
    const probeWritable = async () => false
    const s = useSettingsStore()
    s.$configure({ store, probeWritable })
    await s.load()
    const r = await s.setCacheDir('/data/media')
    expect(r).toEqual({ ok: false, error: 'Directory is not writable' })
    expect(s.cacheDir).toBe('')
  })

  it('setCacheDir rejects a relative path without probing (must be absolute)', async () => {
    const store = createMemoryStore()
    let probed = false
    const s = useSettingsStore()
    s.$configure({ store, probeWritable: async () => { probed = true; return true } })
    await s.load()
    const r = await s.setCacheDir('..')
    expect(r.ok).toBe(false)
    expect(probed).toBe(false) // rejected before touching the filesystem
    expect(s.cacheDir).toBe('')
  })
})
