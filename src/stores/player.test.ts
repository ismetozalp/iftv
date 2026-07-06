import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from './player'
import type { PlaybackEngine, PlaybackSession } from '@/core/media/PlaybackEngine'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const ACCT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h', username: 'u', password: 'p', createdAt: 1 }
const item: ContentItem = { id: 'x:live:1', kind: 'live', name: 'CNN', logo: '', categoryId: '1', streamId: '1', seriesId: null, containerExtension: null, url: null }

const MOVIE: ContentItem = { id: 'x:movie:9', kind: 'movie', name: 'A Movie', logo: '', categoryId: '1', streamId: '9', seriesId: null, containerExtension: 'mkv', url: null }

function engineWith(session: Partial<PlaybackSession> = {}): { engine: PlaybackEngine; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn(async () => {})
  const engine: PlaybackEngine = {
    start: vi.fn(async () => ({ sourceUrl: 'iftv://s/index.m3u8', isLive: false, createLoader: () => class {}, stop, ...session })),
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
    expect(engine.start).toHaveBeenCalledWith(ACCT, item, { bufferSeconds: 30, startOffsetSeconds: 0 })
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

  it('seek() stops the current session BEFORE starting the next (one connection) and sets startOffset', async () => {
    const order: string[] = []
    const stop = vi.fn(async () => { order.push('stop') })
    const engine: PlaybackEngine = {
      start: vi.fn(async () => { order.push('start'); return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop } }),
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
        return { sourceUrl: 's', isLive: false, createLoader: () => class {}, stop: async () => { active-- } }
      }),
    }
    const p = usePlayerStore()
    p.$configure({ engine, sleep: async () => {} })
    await p.play(ACCT, MOVIE, { durationSeconds: 5400 })
    await Promise.all([p.seek(60), p.seek(120), p.seek(180)])
    expect(maxActive).toBe(1) // never two live sessions
    expect(p.startOffset).toBe(180) // latest wins
  })
})
