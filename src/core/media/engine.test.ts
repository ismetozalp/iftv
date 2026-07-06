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
    mkfifo: vi.fn(async () => {}),
    rmrf: vi.fn(async () => {}),
    spawn: vi.fn(() => ({ close: vi.fn() })),
    readFile: vi.fn(async () => new TextEncoder().encode('#EXTM3U')), // playlist ready immediately
    wait: vi.fn(async () => {}),
    ...over,
  }
}

function spawnArgs(d: EngineDeps): string[][] {
  return (d.spawn as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string[])
}

describe('createPlaybackEngine.start', () => {
  it('mkdirs + mkfifo, spawns curl (upstream url) and ffmpeg (reads the fifo), returns the source url', async () => {
    const d = deps()
    const eng = createPlaybackEngine(d)
    const s = await eng.start(XT, item)
    expect(d.mkdir).toHaveBeenCalledWith('/home/u/.cache/inflighttv/sid')
    expect(d.mkfifo).toHaveBeenCalledWith('/home/u/.cache/inflighttv/sid/in.ts')

    const calls = spawnArgs(d)
    const curl = calls.find((a) => a[0] === 'curl')!
    expect(curl).toContain('http://h:8080/live/u/p/7.ts') // curl fetches the upstream url
    expect(curl).toContain('/home/u/.cache/inflighttv/sid/in.ts') // ...into the fifo

    const ff = calls.find((a) => a[0] === 'ffmpeg')!
    expect(ff).toContain('-i')
    expect(ff).toContain('/home/u/.cache/inflighttv/sid/in.ts') // ffmpeg reads the fifo
    expect(ff).not.toContain('http://h:8080/live/u/p/7.ts') // ffmpeg never touches the panel url
    expect(ff[ff.length - 1]).toBe('/home/u/.cache/inflighttv/sid/index.m3u8')

    expect(s.sourceUrl).toBe('iftv://sid/index.m3u8')
    expect(typeof s.createLoader()).toBe('function')
  })

  it('waits (polls) for the playlist to appear before returning', async () => {
    let n = 0
    const d = deps({ readFile: vi.fn(async () => (++n < 3 ? null : new TextEncoder().encode('#EXTM3U'))) })
    const eng = createPlaybackEngine(d)
    await eng.start(XT, item)
    expect((d.readFile as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(d.wait).toHaveBeenCalled()
  })

  it('kills BOTH curl and ffmpeg and cleans up if the playlist never appears', async () => {
    const close = vi.fn()
    const d = deps({ readFile: async () => null, spawn: () => ({ close }) })
    const eng = createPlaybackEngine(d)
    await expect(eng.start(XT, item)).rejects.toThrow(/did not start/i)
    expect(close).toHaveBeenCalledWith('timeout')
    expect(close).toHaveBeenCalledTimes(2) // curl + ffmpeg
    expect(d.rmrf).toHaveBeenCalledWith('/home/u/.cache/inflighttv/sid')
  })

  it('throws for a non-playable item without spawning', async () => {
    const d = deps()
    const eng = createPlaybackEngine(d)
    await expect(eng.start(XT, { ...item, streamId: null, url: null })).rejects.toThrow(/not playable/i)
    expect(d.spawn).not.toHaveBeenCalled()
  })

  it('stop() kills both processes with a problem code and removes the dir', async () => {
    const close = vi.fn()
    const d = deps({ spawn: () => ({ close }) })
    const eng = createPlaybackEngine(d)
    const s = await eng.start(XT, item)
    await s.stop()
    expect(close).toHaveBeenCalledWith('terminated')
    expect(close).toHaveBeenCalledTimes(2) // curl + ffmpeg
    expect(d.rmrf).toHaveBeenCalledWith('/home/u/.cache/inflighttv/sid')
  })
})
