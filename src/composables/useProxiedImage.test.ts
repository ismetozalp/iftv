import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { useProxiedImage } from './useProxiedImage'

describe('useProxiedImage', () => {
  it('returns empty url for empty src', async () => {
    const fetchBytes = vi.fn()
    const makeUrl = vi.fn()
    const { url, failed } = useProxiedImage(() => '', { fetchBytes, makeUrl })
    await nextTick()
    expect(url.value).toBe('')
    expect(failed.value).toBe(false)
    expect(fetchBytes).not.toHaveBeenCalled()
  })

  it('returns empty url for null/undefined src', async () => {
    const fetchBytes = vi.fn()
    const { url } = useProxiedImage(() => null, { fetchBytes })
    await nextTick()
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
    await nextTick()
    await nextTick()
    expect(fetchBytes).toHaveBeenCalledWith('http://p/a.jpg')
    expect(url.value).toBe('blob:fake/3')
    expect(failed.value).toBe(false)
  })

  it('sets failed on fetch rejection', async () => {
    const fetchBytes = vi.fn(async () => {
      throw new Error('curl failed')
    })
    const { url, failed } = useProxiedImage(() => 'http://p/broken.jpg', { fetchBytes })
    await nextTick()
    await nextTick()
    expect(failed.value).toBe(true)
    expect(url.value).toBe('')
  })

  it('reuses cache for the same src (fetchBytes called once)', async () => {
    const bytes = new Uint8Array([9])
    const fetchBytes = vi.fn(async () => bytes)
    const makeUrl = vi.fn((b: Uint8Array) => `blob:fake2/${b.length}`)
    const src = 'http://p/cached.jpg'

    const first = useProxiedImage(() => src, { fetchBytes, makeUrl })
    await nextTick()
    await nextTick()
    expect(first.url.value).toBe('blob:fake2/1')
    expect(fetchBytes).toHaveBeenCalledTimes(1)

    const second = useProxiedImage(() => src, { fetchBytes, makeUrl })
    await nextTick()
    await nextTick()
    expect(second.url.value).toBe('blob:fake2/1')
    expect(fetchBytes).toHaveBeenCalledTimes(1)
  })

  it('reacts to a reactive src changing', async () => {
    const current = ref<string | null>('http://p/one.jpg')
    const fetchBytes = vi.fn(async (u: string) => new TextEncoder().encode(u))
    const makeUrl = vi.fn((b: Uint8Array) => `blob:${new TextDecoder().decode(b)}`)
    const { url } = useProxiedImage(() => current.value, { fetchBytes, makeUrl })
    await nextTick()
    await nextTick()
    expect(url.value).toBe('blob:http://p/one.jpg')

    current.value = 'http://p/two.jpg'
    await nextTick()
    await nextTick()
    expect(url.value).toBe('blob:http://p/two.jpg')
  })
})
