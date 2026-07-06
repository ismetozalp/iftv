import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from './player'
import { useSettingsStore } from './settings'
import type { PlaybackEngine, PlaybackSession } from '@/core/media/PlaybackEngine'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const ACCT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h', username: 'u', password: 'p', createdAt: 1 }
const item: ContentItem = { id: 'x:live:1', kind: 'live', name: 'CNN', logo: '', categoryId: '1', streamId: '1', seriesId: null, containerExtension: null, url: null }

const MOVIE: ContentItem = { id: 'x:movie:9', kind: 'movie', name: 'A Movie', logo: '', categoryId: '1', streamId: '9', seriesId: null, containerExtension: 'mkv', url: null }

function engineWith(session: Partial<PlaybackSession> = {}): { engine: PlaybackEngine; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn(async () => {})
  const engine: PlaybackEngine = {
    start: vi.fn(async () => ({ sourceUrl: 'iftv://s/index.m3u8', isLive: false, createLoader: () => class {}, stop, readSubtitle: async () => null, ...session })),
  }
  return { engine, stop }
}

describe('usePlayerStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('play() starts the engine and becomes playing with the session', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item)
    expect(engine.start).toHaveBeenCalledWith(ACCT, item, { bufferSeconds: 30, startOffsetSeconds: 0, videoCodec: 'copy', audioIndex: 0, subtitleIndex: null })
    expect(p.status).toBe('playing')
    expect(p.item?.id).toBe('x:live:1')
    expect(p.session?.sourceUrl).toBe('iftv://s/index.m3u8')
  })

  it('play() while already playing stops the previous session first', async () => {
    const { engine, stop } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item)
    await p.play(ACCT, { ...item, id: 'x:live:2', streamId: '2' })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(p.item?.id).toBe('x:live:2')
  })

  it('records an error when the engine throws', async () => {
    const engine: PlaybackEngine = { start: vi.fn(async () => { throw new Error('no playlist') }) }
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item)
    expect(p.status).toBe('error')
    expect(p.error).toMatch(/no playlist/)
    expect(p.session).toBeNull()
  })

  it('stop() stops the session and returns to idle', async () => {
    const { engine, stop } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item)
    await p.stop()
    expect(stop).toHaveBeenCalled()
    expect(p.status).toBe('idle')
    expect(p.session).toBeNull()
  })

  it('fail() stops the session but stays in error with the message', async () => {
    const { engine, stop } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item)
    await p.fail('boom')
    expect(stop).toHaveBeenCalled()
    expect(p.status).toBe('error')
    expect(p.error).toBe('boom')
    expect(p.session).toBeNull()
  })

  it('play() records duration + starts at offset 0', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    expect(p.duration).toBe(5400)
    expect(p.startOffset).toBe(0)
    expect(engine.start).toHaveBeenCalledWith(ACCT, MOVIE, expect.objectContaining({ startOffsetSeconds: 0 }))
  })

  it('play() with startOffsetSeconds resumes from the saved offset', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400, startOffsetSeconds: 300 })
    expect(p.startOffset).toBe(300)
    expect(engine.start).toHaveBeenCalledWith(ACCT, MOVIE, expect.objectContaining({ startOffsetSeconds: 300 }))
  })

  it('seek() stops the current session BEFORE starting the next (one connection) and sets startOffset', async () => {
    const order: string[] = []
    const stop = vi.fn(async () => { order.push('stop') })
    const engine: PlaybackEngine = {
      start: vi.fn(async () => { order.push('start'); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop, readSubtitle: async () => null } }),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => { order.push('settle') } })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    order.length = 0
    await p.seek(1200)
    expect(order).toEqual(['stop', 'settle', 'start']) // stop → settle → start, never overlapped
    expect(p.startOffset).toBe(1200)
    expect(engine.start).toHaveBeenLastCalledWith(ACCT, MOVIE, expect.objectContaining({ startOffsetSeconds: 1200 }))
  })

  it('seek() clamps to [0, duration]', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    await p.play(ACCT, MOVIE, { durationSeconds: 100 })
    await p.seek(999)
    expect(p.startOffset).toBe(100)
    await p.seek(-5)
    expect(p.startOffset).toBe(0)
  })

  it('rapid seeks coalesce to the latest and never start two sessions at once', async () => {
    let active = 0
    let maxActive = 0
    const engine: PlaybackEngine = {
      start: vi.fn(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => { active-- }, readSubtitle: async () => null }
      }),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await Promise.all([p.seek(60), p.seek(120), p.seek(180)])
    expect(maxActive).toBe(1) // never two live sessions
    expect(p.startOffset).toBe(180) // latest wins
  })

  it('play() during an in-flight seek never leaves two sessions alive (one connection) and the later play wins', async () => {
    let active = 0
    let maxActive = 0
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const engine: PlaybackEngine = {
      start: vi.fn(async () => {
        active++; maxActive = Math.max(maxActive, active)
        return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => { active-- }, readSubtitle: async () => null }
      }),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: () => gate }) // seek blocks in settle until released
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 }) // active=1
    const seekP = p.seek(1200) // stops current, parks at the settle gate
    await new Promise((r) => setTimeout(r, 0)) // let seek reach the gate
    const playP = p.play(ACCT, { ...MOVIE, id: 'x:movie:22', streamId: '22' }, { durationSeconds: 100 })
    release()
    await Promise.all([seekP, playP])
    expect(maxActive).toBe(1) // never two panel connections
    expect(active).toBe(1) // exactly one session left (no leak)
    expect(p.item?.id).toBe('x:movie:22') // the later play wins
  })

  it('stop() during an in-flight seek ends idle (not error)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine, sleep: () => gate })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    const seekP = p.seek(1200)
    await new Promise((r) => setTimeout(r, 0))
    const stopP = p.stop()
    release()
    await Promise.all([seekP, stopP])
    expect(p.status).toBe('idle')
    expect(p.session).toBeNull()
  })

  it('retryWithTranscode restarts the SAME item at the same offset with a resolved encoder, once', async () => {
    const starts: unknown[] = []
    const engine: PlaybackEngine = {
      start: vi.fn(async (_a, _i, o) => { starts.push(o); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => {}, readSubtitle: async () => null } }),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    useSettingsStore().$patch({ transcodeMode: 'gpu', encoderTest: { nvenc: true, x264: true, testedAt: 1 } })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await p.seek(1200)
    starts.length = 0
    await p.retryWithTranscode()
    expect(p.transcode).toBe(true)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ startOffsetSeconds: 1200, videoCodec: 'nvenc' }) // same offset, GPU
  })

  it('a seek after transcoding stays transcoded', async () => {
    const engine: PlaybackEngine = {
      start: vi.fn(async () => ({ sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => {}, readSubtitle: async () => null })),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    useSettingsStore().$patch({ transcodeMode: 'gpu', encoderTest: { nvenc: true, x264: true, testedAt: 1 } })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await p.retryWithTranscode()
    await p.seek(1800)
    expect(p.transcode).toBe(true)
    expect(engine.start).toHaveBeenLastCalledWith(ACCT, MOVIE, expect.objectContaining({ startOffsetSeconds: 1800, videoCodec: 'nvenc' }))
  })

  it('play() resets transcode to copy', async () => {
    const engine: PlaybackEngine = {
      start: vi.fn(async () => ({ sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => {}, readSubtitle: async () => null })),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    useSettingsStore().$patch({ transcodeMode: 'gpu', encoderTest: { nvenc: true, x264: true, testedAt: 1 } })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await p.retryWithTranscode()
    expect(p.transcode).toBe(true)
    await p.play(ACCT, { ...MOVIE, id: 'x:movie:22', streamId: '22' }, { durationSeconds: 100 })
    expect(p.transcode).toBe(false)
    expect(engine.start).toHaveBeenLastCalledWith(ACCT, { ...MOVIE, id: 'x:movie:22', streamId: '22' }, expect.objectContaining({ videoCodec: 'copy' }))
  })

  it('retryWithTranscode with transcodeMode "off" sets an error and does NOT start a new session', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    useSettingsStore().$patch({ transcodeMode: 'off' })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    ;(engine.start as ReturnType<typeof vi.fn>).mockClear()
    await p.retryWithTranscode()
    expect(p.transcode).toBe(false)
    expect(p.status).toBe('error')
    expect(p.error).toMatch(/transcod/i)
    expect(engine.start).not.toHaveBeenCalled()
  })

  it('retryWithTranscode falls back from nvenc to x264 when the engine rejects the nvenc attempt', async () => {
    const starts: unknown[] = []
    const engine: PlaybackEngine = {
      start: vi.fn(async (_a, _i, o) => {
        starts.push(o)
        if (o?.videoCodec === 'nvenc') throw new Error('nvenc init failed')
        return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => {}, readSubtitle: async () => null }
      }),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    useSettingsStore().$patch({ transcodeMode: 'gpu', encoderTest: { nvenc: true, x264: true, testedAt: 1 } })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    starts.length = 0
    await p.retryWithTranscode()
    expect(starts).toHaveLength(2)
    expect(starts[0]).toMatchObject({ videoCodec: 'nvenc' })
    expect(starts[1]).toMatchObject({ videoCodec: 'x264' })
    expect(p.status).toBe('playing')
    expect(p.transcode).toBe(true)
    expect(p.currentCodec).toBe('x264') // reflects the codec that actually started
  })

  it('fallbackToSoftware restarts ONCE on x264 when the active session is nvenc, at the same offset', async () => {
    const starts: string[] = []
    const engine: PlaybackEngine = {
      start: vi.fn(async (_a, _i, o) => { starts.push(o?.videoCodec); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => {}, readSubtitle: async () => null } }),
    }
    const p = usePlayerStore(); p.$configure({ engine, sleep: async () => {} })
    useSettingsStore().$patch({ transcodeMode: 'gpu', encoderTest: { nvenc: true, x264: true, testedAt: 1 } })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await p.seek(1200)
    await p.retryWithTranscode()
    expect(p.currentCodec).toBe('nvenc')
    starts.length = 0
    await p.fallbackToSoftware()
    expect(starts).toEqual(['x264'])
    expect(p.currentCodec).toBe('x264')
    expect(p.transcode).toBe(true)
    expect(p.startOffset).toBe(1200)
  })

  it('a mid-stream nvenc failure sticks to software for later seeks', async () => {
    const starts: string[] = []
    const engine: PlaybackEngine = {
      start: vi.fn(async (_a, _i, o) => { starts.push(o?.videoCodec); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => {}, readSubtitle: async () => null } }),
    }
    const p = usePlayerStore(); p.$configure({ engine, sleep: async () => {} })
    useSettingsStore().$patch({ transcodeMode: 'gpu', encoderTest: { nvenc: true, x264: true, testedAt: 1 } })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await p.retryWithTranscode() // nvenc
    await p.fallbackToSoftware() // → x264 (sticky)
    starts.length = 0
    await p.seek(600)
    expect(starts).toEqual(['x264']) // seek stays on software, doesn't re-try nvenc
  })

  it('fallbackToSoftware is a no-op when not transcoding on nvenc', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore(); p.$configure({ engine, sleep: async () => {} })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 }) // copy
    ;(engine.start as ReturnType<typeof vi.fn>).mockClear()
    await p.fallbackToSoftware()
    expect(engine.start).not.toHaveBeenCalled()
  })

  it('play() discovers tracks (via injected probe) and defaults to audio 0 / no subtitle', async () => {
    const { engine } = engineWith()
    const probe = vi.fn(async () => ({
      audio: [{ index: 0, language: 'tur', codec: 'aac' }],
      subtitles: [{ index: 0, language: 'eng', codec: 'subrip', text: true }],
    }))
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {}, probe })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await Promise.resolve() // let discovery settle
    expect(p.selectedAudio).toBe(0)
    expect(p.selectedSubtitle).toBeNull()
    expect(p.audioTracks.length).toBe(1)
    expect(p.subtitleTracks.length).toBe(1)
    expect(probe).toHaveBeenCalledWith(ACCT, MOVIE)
  })

  it('play() does NOT probe a LIVE channel (a 2nd connection would stall the feed on 1-connection panels)', async () => {
    const { engine } = engineWith()
    const probe = vi.fn(async () => ({ audio: [{ index: 0, language: 'tur', codec: 'aac' }], subtitles: [] }))
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {}, probe })
    await p.play(ACCT, item) // `item` is the live channel
    await Promise.resolve()
    expect(probe).not.toHaveBeenCalled()
    expect(p.audioTracks).toEqual([])
    expect(p.subtitleTracks).toEqual([])
  })

  it('VOD probes BEFORE opening the playback connection (never two connections at once)', async () => {
    const order: string[] = []
    const engine: PlaybackEngine = {
      start: vi.fn(async () => { order.push('start'); return { sourceUrl: 'iftv://s', isLive: false, createLoader: () => class {}, stop: vi.fn(async () => {}), readSubtitle: async () => null } }),
    }
    const probe = vi.fn(async () => { order.push('probe'); return { audio: [{ index: 0, language: 'tur', codec: 'aac' }], subtitles: [] } })
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {}, probe })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    expect(order).toEqual(['probe', 'start']) // probe finished before the playback connection opened
    expect(p.audioTracks.length).toBe(1)
  })

  it('setSubtitle restarts ONCE at the same offset with subtitleIndex, single-flight', async () => {
    const starts: unknown[] = []
    const engine: PlaybackEngine = {
      start: vi.fn(async (_a, _i, o) => { starts.push(o); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, readSubtitle: async () => null, stop: async () => {} } }),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {}, probe: async () => ({ audio: [], subtitles: [{ index: 0, language: 'eng', codec: 'subrip', text: true }] }) })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await p.seek(600)
    starts.length = 0
    await p.setSubtitle(0)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ startOffsetSeconds: 600, subtitleIndex: 0 })
    expect(p.selectedSubtitle).toBe(0)
  })

  it('a seek after picking audio/subtitle keeps the selection', async () => {
    const starts: unknown[] = []
    const engine: PlaybackEngine = {
      start: vi.fn(async (_a, _i, o) => { starts.push(o); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, readSubtitle: async () => null, stop: async () => {} } }),
    }
    const p = usePlayerStore()
    p.$configure({
      engine,
      sleep: async () => {},
      probe: async () => ({
        audio: [{ index: 0, language: '', codec: 'aac' }, { index: 1, language: '', codec: 'ac3' }],
        subtitles: [{ index: 0, language: 'eng', codec: 'subrip', text: true }],
      }),
    })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await p.setAudioTrack(1)
    await p.setSubtitle(0)
    starts.length = 0
    await p.seek(900)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ startOffsetSeconds: 900, audioIndex: 1, subtitleIndex: 0 })
  })

  it('rapid track changes never start two sessions (maxActive===1)', async () => {
    let active = 0
    let maxActive = 0
    const engine: PlaybackEngine = {
      start: vi.fn(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => { active-- }, readSubtitle: async () => null }
      }),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await Promise.all([p.setAudioTrack(1), p.setSubtitle(0), p.setAudioTrack(0)])
    expect(maxActive).toBe(1) // never two live sessions
    expect(active).toBe(1) // exactly one session left (no leak)
  })

  it('stop() and fail() reset track selections and discovered lists', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({
      engine,
      sleep: async () => {},
      probe: async () => ({ audio: [{ index: 0, language: '', codec: 'aac' }], subtitles: [{ index: 0, language: 'eng', codec: 'subrip', text: true }] }),
    })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await p.setAudioTrack(0)
    await Promise.resolve()
    expect(p.audioTracks.length).toBe(1)
    await p.stop()
    expect(p.audioTracks).toEqual([])
    expect(p.subtitleTracks).toEqual([])
    expect(p.selectedAudio).toBe(0)
    expect(p.selectedSubtitle).toBeNull()

    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await Promise.resolve()
    await p.fail('boom')
    expect(p.audioTracks).toEqual([])
    expect(p.subtitleTracks).toEqual([])
  })
})
