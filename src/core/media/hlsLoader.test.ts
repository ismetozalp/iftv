import { describe, it, expect, vi } from 'vitest'
import { createCockpitLoaderClass } from './hlsLoader'

const enc = (s: string) => new TextEncoder().encode(s)

function callbacks() {
  return { onSuccess: vi.fn(), onError: vi.fn(), onTimeout: vi.fn(), onProgress: vi.fn() }
}
const cfg = {} as never

describe('createCockpitLoaderClass', () => {
  it('returns playlist text via onSuccess (text responseType)', async () => {
    const read = vi.fn(async () => enc('#EXTM3U\n#EXTINF:4,\nseg_00000.ts'))
    const Loader = createCockpitLoaderClass(read, (u) => `/dir/${u.split('/').pop()}`)
    const l = new Loader()
    const cb = callbacks()
    l.load({ url: 'iftv://s/index.m3u8', responseType: '' }, cfg, cb)
    await Promise.resolve(); await Promise.resolve()
    expect(read).toHaveBeenCalledWith('/dir/index.m3u8')
    expect(cb.onError).not.toHaveBeenCalled()
    const [resp, stats] = cb.onSuccess.mock.calls[0]
    expect(typeof resp.data).toBe('string')
    expect(resp.data).toContain('#EXTM3U')
    expect(stats.loaded).toBeGreaterThan(0)
    expect(stats.loading.end).toBeGreaterThanOrEqual(0)
  })

  it('returns fragment bytes as an ArrayBuffer (arraybuffer responseType)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const Loader = createCockpitLoaderClass(async () => bytes, (u) => `/dir/${u.split('/').pop()}`)
    const l = new Loader()
    const cb = callbacks()
    l.load({ url: 'iftv://s/seg_00000.ts', responseType: 'arraybuffer' }, cfg, cb)
    await Promise.resolve(); await Promise.resolve()
    const [resp] = cb.onSuccess.mock.calls[0]
    expect(resp.data).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(resp.data)).toEqual(bytes)
  })

  it('calls onError with 404 when the file is missing (null)', async () => {
    const Loader = createCockpitLoaderClass(async () => null, (u) => u)
    const l = new Loader()
    const cb = callbacks()
    l.load({ url: 'iftv://s/index.m3u8', responseType: '' }, cfg, cb)
    await Promise.resolve(); await Promise.resolve()
    expect(cb.onSuccess).not.toHaveBeenCalled()
    expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 404 }), expect.anything(), null, expect.anything())
  })

  it('calls onError when the reader throws', async () => {
    const Loader = createCockpitLoaderClass(async () => { throw new Error('boom') }, (u) => u)
    const l = new Loader()
    const cb = callbacks()
    l.load({ url: 'iftv://s/x', responseType: '' }, cfg, cb)
    await Promise.resolve(); await Promise.resolve()
    expect(cb.onError).toHaveBeenCalled()
  })

  it('after abort(), a resolving read does not call onSuccess', async () => {
    let resolve!: (v: Uint8Array) => void
    const Loader = createCockpitLoaderClass(() => new Promise((r) => { resolve = r }), (u) => u)
    const l = new Loader()
    const cb = callbacks()
    l.load({ url: 'iftv://s/index.m3u8', responseType: '' }, cfg, cb)
    l.abort()
    resolve(enc('#EXTM3U'))
    await Promise.resolve(); await Promise.resolve()
    expect(cb.onSuccess).not.toHaveBeenCalled()
    expect(l.stats.aborted).toBe(true)
  })
})
