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

  it('uses a rolling live window for live, and a realtime-paced keep-all VOD event playlist for a movie', async () => {
    const dLive = deps()
    const sLive = await createPlaybackEngine(dLive).start(XT, item) // kind: 'live'
    const ffLive = spawnArgs(dLive).find((a) => a[0] === 'ffmpeg')!.join(' ')
    expect(ffLive).toContain('delete_segments+append_list+omit_endlist')
    expect(ffLive).not.toContain('event')
    expect(ffLive).not.toContain('-re')
    expect(sLive.isLive).toBe(true)

    const movie = { ...item, id: 'x:movie:9', kind: 'movie' as const, streamId: '9', containerExtension: 'mkv' }
    const dVod = deps()
    const sVod = await createPlaybackEngine(dVod).start(XT, movie)
    const ffVod = spawnArgs(dVod).find((a) => a[0] === 'ffmpeg')!.join(' ')
    expect(ffVod).toContain('-readrate 1 -readrate_initial_burst 30 -i')
    expect(ffVod).toContain('-hls_playlist_type event')
    expect(ffVod).toContain('-hls_list_size 0')
    expect(ffVod).not.toContain('omit_endlist')
    expect(sVod.isLive).toBe(false)
  })

  it('LIVE = curl+ffmpeg over a FIFO; VOD = a single ffmpeg reading the URL directly with -ss (no curl/fifo)', async () => {
    const dLive = deps()
    const sLive = await createPlaybackEngine(dLive).start(XT, item) // live
    expect(sLive.isLive).toBe(true)
    expect(dLive.mkfifo).toHaveBeenCalled()
    const liveCalls = spawnArgs(dLive).map((a) => a[0]); expect(liveCalls).toContain('curl'); expect(liveCalls).toContain('ffmpeg')

    const movie = { ...item, id: 'x:movie:9', kind: 'movie' as const, streamId: '9', containerExtension: 'mkv' }
    const dVod = deps()
    const sVod = await createPlaybackEngine(dVod).start(XT, movie, { startOffsetSeconds: 120 })
    expect(sVod.isLive).toBe(false)
    expect(dVod.mkfifo).not.toHaveBeenCalled()                    // no FIFO for VOD
    const vodCalls = spawnArgs(dVod).map((a) => a[0]); expect(vodCalls).not.toContain('curl') // no curl for VOD
    const ff = spawnArgs(dVod).find((a) => a[0] === 'ffmpeg')!.join(' ')
    expect(ff).toContain('-ss 120')
    expect(ff).toContain('http://h:8080/movie/u/p/9.mkv')          // reads the panel url directly
    expect(ff).toContain('-hls_playlist_type event')
  })

  it('HLS (.m3u8) live URL → ffmpeg reads it directly, no curl/FIFO (M3U channels)', async () => {
    const m3u = { ...item, kind: 'live' as const, streamId: null, url: 'http://h/stream.m3u8' }
    const d = deps()
    await createPlaybackEngine(d).start(XT, m3u)
    expect(d.mkfifo).not.toHaveBeenCalled()
    const calls = spawnArgs(d).map((a) => a[0])
    expect(calls).not.toContain('curl') // no curl for an .m3u8 (would capture only the playlist)
    expect(calls).toContain('ffmpeg')
    expect(spawnArgs(d).find((a) => a[0] === 'ffmpeg')!).toContain('http://h/stream.m3u8')
  })

  it('forwards videoCodec into the ffmpeg args (nvenc transcode for a movie)', async () => {
    const movie = { ...item, id: 'x:movie:9', kind: 'movie' as const, streamId: '9', containerExtension: 'mkv' }
    const d = deps()
    await createPlaybackEngine(d).start(XT, movie, { videoCodec: 'nvenc' })
    const ff = spawnArgs(d).find((a) => a[0] === 'ffmpeg')!
    expect(ff).toContain('-c:v')
    expect(ff).toContain('h264_nvenc')
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
