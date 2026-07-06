import { describe, expect, it } from 'vitest'
import { programmeBlocks, timeTicks, nowMarkerPx } from './layout'
import type { Programme } from './types'

const HOUR = 3_600_000
const WIN_START = Date.UTC(2026, 6, 6, 12, 0, 0)
const WIN_END = WIN_START + 6 * HOUR
const PX_PER_HOUR = 240 // 4px/min

function prog(startMs: number, stopMs: number, title = 'P'): Programme {
  return { channelId: 'c', startMs, stopMs, title, desc: '' }
}

describe('programmeBlocks', () => {
  it('positions a programme fully inside the window at its natural size', () => {
    const p = prog(WIN_START + HOUR, WIN_START + 2 * HOUR, 'News')
    const [b] = programmeBlocks([p], WIN_START, WIN_END, PX_PER_HOUR)
    expect(b).toEqual({ title: 'News', startMs: p.startMs, stopMs: p.stopMs, leftPx: PX_PER_HOUR, widthPx: PX_PER_HOUR })
  })

  it('clips a programme that starts before the window to the window edge', () => {
    const p = prog(WIN_START - HOUR, WIN_START + HOUR, 'Overnight')
    const [b] = programmeBlocks([p], WIN_START, WIN_END, PX_PER_HOUR)
    expect(b.leftPx).toBe(0)
    expect(b.widthPx).toBe(PX_PER_HOUR) // only the 1h that overlaps the window
    expect(b.startMs).toBe(p.startMs) // original times preserved for the popover
    expect(b.stopMs).toBe(p.stopMs)
  })

  it('clips a programme that ends after the window to the window edge', () => {
    const p = prog(WIN_END - HOUR, WIN_END + 2 * HOUR, 'Late')
    const [b] = programmeBlocks([p], WIN_START, WIN_END, PX_PER_HOUR)
    expect(b.leftPx).toBe(5 * PX_PER_HOUR)
    expect(b.widthPx).toBe(PX_PER_HOUR)
  })

  it('drops programmes that do not overlap the window at all', () => {
    const before = prog(WIN_START - 2 * HOUR, WIN_START - HOUR)
    const after = prog(WIN_END + HOUR, WIN_END + 2 * HOUR)
    const touching = prog(WIN_START - HOUR, WIN_START) // ends exactly at window start
    expect(programmeBlocks([before, after, touching], WIN_START, WIN_END, PX_PER_HOUR)).toEqual([])
  })

  it('enforces a minimum width for very short/heavily-clipped programmes', () => {
    const tiny = prog(WIN_START, WIN_START + 100, 'Tiny') // 100ms — sub-pixel at this scale
    const [b] = programmeBlocks([tiny], WIN_START, WIN_END, PX_PER_HOUR)
    expect(b.widthPx).toBe(2)
  })

  it('preserves input order across multiple programmes', () => {
    const p1 = prog(WIN_START, WIN_START + HOUR, 'A')
    const p2 = prog(WIN_START + HOUR, WIN_START + 2 * HOUR, 'B')
    const blocks = programmeBlocks([p1, p2], WIN_START, WIN_END, PX_PER_HOUR)
    expect(blocks.map((b) => b.title)).toEqual(['A', 'B'])
  })
})

describe('timeTicks', () => {
  it('generates evenly spaced ticks across the window at the given step', () => {
    const ticks = timeTicks(WIN_START, WIN_START + 2 * HOUR, 60, PX_PER_HOUR)
    expect(ticks).toEqual([
      { ms: WIN_START, leftPx: 0 },
      { ms: WIN_START + HOUR, leftPx: PX_PER_HOUR },
      { ms: WIN_START + 2 * HOUR, leftPx: 2 * PX_PER_HOUR },
    ])
  })

  it('supports sub-hour steps', () => {
    const ticks = timeTicks(WIN_START, WIN_START + HOUR, 30, PX_PER_HOUR)
    expect(ticks.map((t) => t.leftPx)).toEqual([0, PX_PER_HOUR / 2, PX_PER_HOUR])
  })
})

describe('nowMarkerPx', () => {
  it('is 0 at the window start', () => {
    expect(nowMarkerPx(WIN_START, WIN_START, PX_PER_HOUR)).toBe(0)
  })

  it('scales linearly with elapsed time since window start', () => {
    expect(nowMarkerPx(WIN_START + 1.5 * HOUR, WIN_START, PX_PER_HOUR)).toBe(1.5 * PX_PER_HOUR)
  })

  it('can go negative (now before the window) — the view decides whether to hide it', () => {
    expect(nowMarkerPx(WIN_START - HOUR, WIN_START, PX_PER_HOUR)).toBe(-PX_PER_HOUR)
  })
})
