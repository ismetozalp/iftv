import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from './player'
import { useSettingsStore } from './settings'
import { useWorkspaceStore } from './workspace'
import type { PlaybackEngine, PlaybackSession } from '@/core/media/PlaybackEngine'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const ACCT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h', username: 'u', password: 'p', createdAt: 1 }
const ACCT2: Account = { id: 'b', type: 'xtream', name: 'Y', url: 'http://h2', username: 'u2', password: 'p2', createdAt: 2 }
const item: ContentItem = { id: 'x:live:1', kind: 'live', name: 'CNN', logo: '', epgId: '', categoryId: '1', streamId: '1', seriesId: null, containerExtension: null, url: null }

const MOVIE: ContentItem = { id: 'x:movie:9', kind: 'movie', name: 'A Movie', logo: '', epgId: '', categoryId: '1', streamId: '9', seriesId: null, containerExtension: 'mkv', url: null }

function engineWith(session: Partial<PlaybackSession> = {}): { engine: PlaybackEngine; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn(async () => {})
  const engine: PlaybackEngine = {
    start: vi.fn(async () => ({ sourceUrl: 'iftv://s/index.m3u8', isLive: false, createLoader: () => class {}, stop, readSubtitle: async () => null, ...session })),
  }
  return { engine, stop }
}

// Per-account harness: tracks concurrently-active sessions AND stop() calls, keyed by accountId —
// proves per-account maxActive===1 while different accounts run genuinely concurrently.
function crossAccountEngine() {
  const active = new Map<string, number>()
  const maxActive = new Map<string, number>()
  const stopsCalled = new Map<string, number>()
  const engine: PlaybackEngine = {
    start: vi.fn(async (account: Account) => {
      const cur = (active.get(account.id) ?? 0) + 1
      active.set(account.id, cur)
      maxActive.set(account.id, Math.max(maxActive.get(account.id) ?? 0, cur))
      return {
        sourceUrl: 's', isLive: false, createLoader: () => class {}, readSubtitle: async () => null,
        stop: async () => {
          active.set(account.id, (active.get(account.id) ?? 1) - 1)
          stopsCalled.set(account.id, (stopsCalled.get(account.id) ?? 0) + 1)
        },
      }
    }),
  }
  return { engine, active, maxActive, stopsCalled }
}

describe('usePlayerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // ACCT is the active tab by default so the existing (pre-per-account) single-slot scenarios,
    // which call actions without an explicit `account` arg, keep exercising ACCT's slot.
    useWorkspaceStore().$patch({
      accounts: { accounts: [ACCT, ACCT2] },
      tabs: { openTabIds: [ACCT.id, ACCT2.id], activeTabId: ACCT.id },
    })
  })

  it('play() starts the engine and becomes playing with the session', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item)
    expect(engine.start).toHaveBeenCalledWith(ACCT, item, { bufferSeconds: 30, startOffsetSeconds: 0, videoCodec: 'copy', audioIndex: 0, subtitleIndex: null, cancelled: expect.any(Function) })
    expect(p.status).toBe('playing')
    expect(p.item?.id).toBe('x:live:1')
    expect(p.session?.sourceUrl).toBe('iftv://s/index.m3u8')
  })

  it('prev/next channel walk the playlist and clamp (disable) at the boundaries', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine })
    const c0 = { ...item, id: 'x:live:1', streamId: '1', name: 'C0' }
    const c1 = { ...item, id: 'x:live:2', streamId: '2', name: 'C1' }
    const c2 = { ...item, id: 'x:live:3', streamId: '3', name: 'C2' }
    const list = [c0, c1, c2]
    await p.play(ACCT, c1, { playlist: list })
    const slot = p.slots[ACCT.id]
    expect(p.channelIndex(slot)).toBe(1)

    await p.nextChannel(ACCT)
    expect(slot.item?.id).toBe('x:live:3')
    expect(p.channelIndex(slot)).toBe(2)

    await p.nextChannel(ACCT) // at the last channel → no-op (button would be disabled)
    expect(slot.item?.id).toBe('x:live:3')

    await p.prevChannel(ACCT)
    await p.prevChannel(ACCT)
    expect(slot.item?.id).toBe('x:live:1')
    expect(p.channelIndex(slot)).toBe(0)

    await p.prevChannel(ACCT) // at the first channel → no-op
    expect(slot.item?.id).toBe('x:live:1')
  })

  it('a listless play (no playlist) clears the channel nav', async () => {
    const { engine } = engineWith()
    const p = usePlayerStore()
    p.$configure({ engine })
    await p.play(ACCT, item, { playlist: [item, { ...item, id: 'x:live:2' }] })
    expect(p.slots[ACCT.id].playlist.length).toBe(2)
    await p.play(ACCT, MOVIE) // e.g. resume from Library — no list
    expect(p.slots[ACCT.id].playlist).toEqual([])
    expect(p.channelIndex(p.slots[ACCT.id])).toBe(-1)
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

  it('restartStalled() reconnects a LIVE session (stop→settle→start); no-op for VOD', async () => {
    const order: string[] = []
    const stop = vi.fn(async () => { order.push('stop') })
    const engine: PlaybackEngine = {
      start: vi.fn(async () => { order.push('start'); return { sourceUrl: 's', isLive: true, createLoader: () => class {}, stop, readSubtitle: async () => null } }),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => { order.push('settle') } })
    await p.play(ACCT, item) // live (no durationSeconds → duration null)
    order.length = 0
    await p.restartStalled(ACCT)
    expect(order).toEqual(['stop', 'settle', 'start']) // reconnected at the edge

    await p.play(ACCT, MOVIE, { durationSeconds: 100 }) // VOD
    order.length = 0
    await p.restartStalled(ACCT)
    expect(order).toEqual([]) // finite-duration VOD is not treated as a live stall
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

  // --- Per-account slots: cross-account concurrency + isolation -----------------------------
  // This is the connection-leak-sensitive core, now keyed by accountId. Every test below proves
  // an invariant: per-account maxActive===1, AND two accounts run genuinely concurrently, AND an
  // op on one account's slot can never observe/stop/supersede another account's slot or `_mx`.
  describe('cross-account isolation', () => {
    it('two accounts play concurrently — both sessions alive, one connection EACH (maxActive per account===1)', async () => {
      const { engine, active, maxActive } = crossAccountEngine()
      const p = usePlayerStore()
      p.$configure({ engine, sleep: async () => {} })
      // Started in parallel — proves the two accounts' single-flight locks are independent
      // (same-account concurrent calls would coalesce; different accounts must not).
      await Promise.all([p.play(ACCT, item), p.play(ACCT2, item)])
      expect(active.get(ACCT.id)).toBe(1)
      expect(active.get(ACCT2.id)).toBe(1)
      expect(maxActive.get(ACCT.id)).toBe(1) // per-account single-flight preserved
      expect(maxActive.get(ACCT2.id)).toBe(1)
      expect(p.slots[ACCT.id].status).toBe('playing')
      expect(p.slots[ACCT2.id].status).toBe('playing')
    })

    it('an op on account A never stops or supersedes account B', async () => {
      const { engine, stopsCalled } = crossAccountEngine()
      const p = usePlayerStore()
      p.$configure({ engine, sleep: async () => {} })
      await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
      await p.play(ACCT2, item)
      const bSessionBefore = p.slots[ACCT2.id].session
      await p.seek(1200, ACCT) // restarts ONLY A's connection
      expect(p.slots[ACCT.id].startOffset).toBe(1200)
      expect(stopsCalled.get(ACCT.id) ?? 0).toBe(1) // A's old session was torn down
      expect(p.slots[ACCT2.id].session).toBe(bSessionBefore) // B's session identity is untouched
      expect(p.slots[ACCT2.id].status).toBe('playing')
      expect(stopsCalled.get(ACCT2.id) ?? 0).toBe(0) // B was never stopped
    })

    it('play() refreshes slot.account to the latest object for that id (edited creds/URL reach _restart)', async () => {
      const { engine } = crossAccountEngine()
      const p = usePlayerStore()
      p.$configure({ engine, sleep: async () => {} })
      await p.play(ACCT, item)
      const edited = { ...ACCT, url: 'http://new-host', password: 'changed' } // same id, new object (as updateAccount produces)
      await p.play(edited, item)
      // slot tracks the latest object's values → seek/track-change reconnect with fresh creds (assert by value; Pinia proxies the object)
      expect(p.slots[ACCT.id].account.url).toBe('http://new-host')
      expect(p.slots[ACCT.id].account.password).toBe('changed')
    })

    it('stop(A) leaves B playing', async () => {
      const { engine, stopsCalled } = crossAccountEngine()
      const p = usePlayerStore()
      p.$configure({ engine, sleep: async () => {} })
      await p.play(ACCT, item)
      await p.play(ACCT2, item)
      await p.stop(ACCT)
      expect(p.slots[ACCT.id].status).toBe('idle')
      expect(p.slots[ACCT.id].session).toBeNull()
      expect(p.slots[ACCT2.id].status).toBe('playing')
      expect(p.slots[ACCT2.id].session).not.toBeNull()
      expect(stopsCalled.get(ACCT2.id) ?? 0).toBe(0)
    })

    it('switching channel within A replaces only A (A stays single-flight), B untouched', async () => {
      const { engine, active, maxActive, stopsCalled } = crossAccountEngine()
      const p = usePlayerStore()
      p.$configure({ engine, sleep: async () => {} })
      await p.play(ACCT, { ...item, id: 'x:live:1', streamId: '1' })
      await p.play(ACCT2, item)
      const bSession = p.slots[ACCT2.id].session
      await p.play(ACCT, { ...item, id: 'x:live:2', streamId: '2' })
      expect(p.slots[ACCT.id].item?.id).toBe('x:live:2')
      expect(maxActive.get(ACCT.id)).toBe(1) // never two A-sessions alive at once
      expect(active.get(ACCT.id)).toBe(1) // no leak on A
      expect(p.slots[ACCT2.id].session).toBe(bSession) // B's session identity unchanged
      expect(p.slots[ACCT2.id].item?.id).toBe(item.id)
      expect(stopsCalled.get(ACCT2.id) ?? 0).toBe(0)
    })

    it('minimize/restore(account) toggles only that account\'s slot.minimized, never touches the session', async () => {
      const { engine, stopsCalled } = crossAccountEngine()
      const p = usePlayerStore()
      p.$configure({ engine, sleep: async () => {} })
      await p.play(ACCT, item)
      await p.play(ACCT2, item)
      const aSession = p.slots[ACCT.id].session
      const bSession = p.slots[ACCT2.id].session
      p.minimize(ACCT)
      expect(p.slots[ACCT.id].minimized).toBe(true)
      expect(p.slots[ACCT2.id].minimized).toBe(false) // B untouched
      expect(p.slots[ACCT.id].session).toBe(aSession) // no restart
      expect(p.slots[ACCT2.id].session).toBe(bSession)
      expect(stopsCalled.size).toBe(0) // minimize never stops anything
      p.restore(ACCT)
      expect(p.slots[ACCT.id].minimized).toBe(false)
      expect(p.slots[ACCT.id].session).toBe(aSession)
      expect(stopsCalled.size).toBe(0)
    })

    it('back-compat proxies (status/item/session) reflect the ACTIVE tab only', async () => {
      const { engine } = crossAccountEngine()
      const p = usePlayerStore()
      const ws = useWorkspaceStore()
      p.$configure({ engine, sleep: async () => {} })
      await p.play(ACCT, { ...item, id: 'x:live:1', streamId: '1' })
      await p.play(ACCT2, { ...item, id: 'x:live:2', streamId: '2' })
      expect(p.item?.id).toBe('x:live:1') // ACCT is the active tab (see beforeEach)
      expect(p.session).toBe(p.slots[ACCT.id].session)
      ws.$patch({ tabs: { activeTabId: ACCT2.id } })
      expect(p.item?.id).toBe('x:live:2') // now reflects ACCT2's slot
      expect(p.session).toBe(p.slots[ACCT2.id].session)
    })

    it('playingSlots/anyPlaying reflect ALL playing accounts, not just the active tab', async () => {
      const { engine } = crossAccountEngine()
      const p = usePlayerStore()
      p.$configure({ engine, sleep: async () => {} })
      expect(p.anyPlaying).toBe(false)
      expect(p.playingSlots).toEqual([])
      await p.play(ACCT, item)
      await p.play(ACCT2, item)
      expect(p.anyPlaying).toBe(true)
      expect(p.playingSlots.map((s) => s.accountId).sort()).toEqual([ACCT.id, ACCT2.id].sort())
      await p.stop(ACCT)
      expect(p.anyPlaying).toBe(true) // B still playing
      expect(p.playingSlots.map((s) => s.accountId)).toEqual([ACCT2.id])
    })

    it('activeSlot falls back to an idle sentinel when there is no active tab', () => {
      useWorkspaceStore().$patch({ tabs: { activeTabId: null } })
      const p = usePlayerStore()
      expect(p.status).toBe('idle')
      expect(p.item).toBeNull()
      expect(p.session).toBeNull()
      expect(p.minimized).toBe(false)
    })
  })
})
