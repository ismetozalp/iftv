import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from './player'
import type { PlaybackEngine, PlaybackSession } from '@/core/media/PlaybackEngine'
import type { Account } from '@/core/accounts/accounts'
import type { ContentItem } from '@/core/content/types'

const ACCT: Account = { id: 'a', type: 'xtream', name: 'X', url: 'http://h', username: 'u', password: 'p', createdAt: 1 }
const item: ContentItem = { id: 'x:live:1', kind: 'live', name: 'CNN', logo: '', categoryId: '1', streamId: '1', seriesId: null, containerExtension: null, url: null }

function engineWith(session: Partial<PlaybackSession> = {}): { engine: PlaybackEngine; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn(async () => {})
  const engine: PlaybackEngine = {
    start: vi.fn(async () => ({ sourceUrl: 'iftv://s/index.m3u8', createLoader: () => class {}, stop, ...session })),
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
    expect(engine.start).toHaveBeenCalledWith(ACCT, item)
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
})
