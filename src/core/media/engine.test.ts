import { describe, it, expect, vi } from 'vitest'
import { createPlaybackEngine } from './engine'
import type { EngineDeps } from './PlaybackEngine'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const XT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h:8080', username: 'u', password: 'p', createdAt: 1 }
const item: ContentItem = { id: 'x:live:7', kind: 'live', name: 'C', logo: '', categoryId: '1', streamId: '7', seriesId: null, containerExtension: null, url: null }

function deps(over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    home: async () => '/home/u',
    newId: () => 'sid',
    mkdir: vi.fn(async () => {}),
    rmrf: vi.fn(async () => {}),
    spawn: vi.fn(() => ({ close: vi.fn() })),
    readFile: vi.fn(async () => new TextEncoder().encode('#EXTM3U')), // playlist ready immediately
    wait: vi.fn(async () => {}),
    ...over,
  }
}

describe('createPlaybackEngine.start', () => {
  it('mkdirs the session dir, spawns ffmpeg with the input URL, returns the source url', async () => {
    const d = deps()
    const eng = createPlaybackEngine(d)
    const s = await eng.start(XT, item)
    expect(d.mkdir).toHaveBeenCalledWith('/home/u/.cache/inflighttv/sid')
    const argv = (d.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(argv[0]).toBe('ffmpeg')
    expect(argv).toContain('http://h:8080/live/u/p/7.ts')
    expect(argv[argv.length - 1]).toBe('/home/u/.cache/inflighttv/sid/index.m3u8')
    expect(s.sourceUrl).toBe('iftv://sid/index.m3u8')
    expect(typeof s.createLoader()).toBe('function') // a loader class
  })

  it('waits (polls) for the playlist to appear before returning', async () => {
    let n = 0
    const d = deps({ readFile: vi.fn(async () => (++n < 3 ? null : new TextEncoder().encode('#EXTM3U'))) })
    const eng = createPlaybackEngine(d)
    await eng.start(XT, item)
    expect((d.readFile as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(d.wait).toHaveBeenCalled()
  })

  it('kills ffmpeg and cleans up if the playlist never appears', async () => {
    const close = vi.fn()
    const d = deps({ readFile: async () => null, spawn: () => ({ close }) })
    const eng = createPlaybackEngine(d)
    await expect(eng.start(XT, item)).rejects.toThrow(/did not start/i)
    expect(close).toHaveBeenCalledWith(expect.any(String))
    expect(d.rmrf).toHaveBeenCalledWith('/home/u/.cache/inflighttv/sid')
  })

  it('throws for a non-playable item without spawning', async () => {
    const d = deps()
    const eng = createPlaybackEngine(d)
    await expect(eng.start(XT, { ...item, streamId: null, url: null })).rejects.toThrow(/not playable/i)
    expect(d.spawn).not.toHaveBeenCalled()
  })

  it('stop() kills ffmpeg with a problem code and removes the dir', async () => {
    const close = vi.fn()
    const d = deps({ spawn: () => ({ close }) })
    const eng = createPlaybackEngine(d)
    const s = await eng.start(XT, item)
    await s.stop()
    expect(close).toHaveBeenCalledWith('terminated')
    expect(d.rmrf).toHaveBeenCalledWith('/home/u/.cache/inflighttv/sid')
  })
})
