import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { useProxiedImage } from './useProxiedImage'

// Flush the watcher + the whole async fetch chain (disk read → network → decode), which spans several
// microtask hops. A fixed number of nextTicks is brittle; drain the microtask queue instead.
const flush = async () => {
  await nextTick()
  for (let i = 0; i < 15; i++) await Promise.resolve()
  await nextTick()
}

describe('useProxiedImage', () => {
  it('returns empty url for empty src', async () => {
    const fetchBytes = vi.fn()
    const makeUrl = vi.fn()
    const { url, failed } = useProxiedImage(() => '', { fetchBytes, makeUrl })
    await flush()
    expect(url.value).toBe('')
    expect(failed.value).toBe(false)
    expect(fetchBytes).not.toHaveBeenCalled()
  })

  it('returns empty url for null/undefined src', async () => {
    const fetchBytes = vi.fn()
    const { url } = useProxiedImage(() => null, { fetchBytes })
    await flush()
    expect(url.value).toBe('')
    expect(fetchBytes).not.toHaveBeenCalled()
  })

  it('fetches bytes and sets a blob url for a src', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const fetchBytes = vi.fn(async (u: string) => {
      expect(u).toBe('http://p/a.jpg')
      return bytes
    })
    const makeUrl = vi.fn((b: Uint8Array) => `blob:fake/${b.length}`)
    const { url, failed } = useProxiedImage(() => 'http://p/a.jpg', { fetchBytes, makeUrl })
    await flush()
    expect(fetchBytes).toHaveBeenCalledWith('http://p/a.jpg')
    expect(url.value).toBe('blob:fake/3')
    expect(failed.value).toBe(false)
  })

  it('sets failed on fetch rejection', async () => {
    const fetchBytes = vi.fn(async () => {
      throw new Error('curl failed')
    })
    const { url, failed } = useProxiedImage(() => 'http://p/broken.jpg', { fetchBytes })
    await flush()
    expect(failed.value).toBe(true)
    expect(url.value).toBe('')
  })

  it('reuses cache for the same src (fetchBytes called once)', async () => {
    const bytes = new Uint8Array([9])
    const fetchBytes = vi.fn(async () => bytes)
    const makeUrl = vi.fn((b: Uint8Array) => `blob:fake2/${b.length}`)
    const src = 'http://p/cached.jpg'

    const first = useProxiedImage(() => src, { fetchBytes, makeUrl })
    await flush()
    expect(first.url.value).toBe('blob:fake2/1')
    expect(fetchBytes).toHaveBeenCalledTimes(1)

    const second = useProxiedImage(() => src, { fetchBytes, makeUrl })
    await flush()
    expect(second.url.value).toBe('blob:fake2/1')
    expect(fetchBytes).toHaveBeenCalledTimes(1)
  })

  it('serves a disk-cache hit without a network fetch', async () => {
    const diskBytes = new Uint8Array([7, 7])
    const readDisk = vi.fn(async () => diskBytes)
    const fetchBytes = vi.fn()
    const writeDisk = vi.fn()
    const makeUrl = vi.fn((b: Uint8Array) => `blob:disk/${b.length}`)
    const { url } = useProxiedImage(() => 'http://p/disk-hit.jpg', { readDisk, fetchBytes, writeDisk, makeUrl })
    await flush()
    expect(readDisk).toHaveBeenCalledWith('http://p/disk-hit.jpg')
    expect(fetchBytes).not.toHaveBeenCalled()
    expect(writeDisk).not.toHaveBeenCalled()
    expect(url.value).toBe('blob:disk/2')
  })

  it('on a disk miss, fetches from network and populates the disk cache', async () => {
    const netBytes = new Uint8Array([5])
    const readDisk = vi.fn(async () => null)
    const fetchBytes = vi.fn(async () => netBytes)
    const writeDisk = vi.fn(async () => {})
    const makeUrl = vi.fn((b: Uint8Array) => `blob:net/${b.length}`)
    const { url } = useProxiedImage(() => 'http://p/disk-miss.jpg', { readDisk, fetchBytes, writeDisk, makeUrl })
    await flush()
    expect(fetchBytes).toHaveBeenCalledWith('http://p/disk-miss.jpg')
    expect(writeDisk).toHaveBeenCalledWith('http://p/disk-miss.jpg', netBytes)
    expect(url.value).toBe('blob:net/1')
  })

  it('exposes a loading flag that clears once resolved', async () => {
    let release!: (b: Uint8Array) => void
    const fetchBytes = vi.fn(() => new Promise<Uint8Array>((r) => { release = r }))
    const readDisk = vi.fn(async () => null)
    const makeUrl = vi.fn((b: Uint8Array) => `blob:l/${b.length}`)
    const { loading } = useProxiedImage(() => 'http://p/loading.jpg', { readDisk, fetchBytes, makeUrl })
    await flush()
    expect(loading.value).toBe(true)
    release(new Uint8Array([1]))
    await flush()
    expect(loading.value).toBe(false)
  })

  it('reacts to a reactive src changing', async () => {
    const current = ref<string | null>('http://p/one.jpg')
    const fetchBytes = vi.fn(async (u: string) => new TextEncoder().encode(u))
    const makeUrl = vi.fn((b: Uint8Array) => `blob:${new TextDecoder().decode(b)}`)
    const { url } = useProxiedImage(() => current.value, { fetchBytes, makeUrl })
    await flush()
    expect(url.value).toBe('blob:http://p/one.jpg')

    current.value = 'http://p/two.jpg'
    await flush()
    expect(url.value).toBe('blob:http://p/two.jpg')
  })
})
