import { describe, expect, it } from 'vitest'
import { buildIndex, nowNext, programmesInWindow, daySchedule } from './index'
import type { ParsedEpg, Programme } from './types'

const HOUR = 3600_000

function prog(channelId: string, startMs: number, stopMs: number, title: string): Programme {
  return { channelId, startMs, stopMs, title, desc: '' }
}

describe('buildIndex', () => {
  it('keys programmes under every normalized display-name, sorted by startMs', () => {
    const parsed: ParsedEpg = {
      channels: [{ id: 'TRT.1.HD.tr', names: ['TRT 1 HD', 'TRT1'] }],
      programmes: [
        prog('TRT.1.HD.tr', 2 * HOUR, 3 * HOUR, 'Second'),
        prog('TRT.1.HD.tr', 1 * HOUR, 2 * HOUR, 'First'),
      ],
    }
    const idx = buildIndex(parsed)
    // 'HD' is a quality token stripped by normalizeChannelName, so 'TRT 1 HD' -> 'trt 1'
    expect(Object.keys(idx).sort()).toEqual(['trt 1', 'trt1'].sort())
    expect(idx['trt 1'].map((p) => p.title)).toEqual(['First', 'Second'])
    expect(idx['trt1'].map((p) => p.title)).toEqual(['First', 'Second'])
  })

  it('handles multiple channels independently', () => {
    const parsed: ParsedEpg = {
      channels: [
        { id: 'a', names: ['Alpha'] },
        { id: 'b', names: ['Beta'] },
      ],
      programmes: [prog('a', 0, HOUR, 'A1'), prog('b', 0, HOUR, 'B1')],
    }
    const idx = buildIndex(parsed)
    expect(idx['alpha'].map((p) => p.title)).toEqual(['A1'])
    expect(idx['beta'].map((p) => p.title)).toEqual(['B1'])
  })
})

describe('nowNext', () => {
  const progs = [prog('c', 0, HOUR, 'P0'), prog('c', HOUR, 2 * HOUR, 'P1'), prog('c', 2 * HOUR, 3 * HOUR, 'P2')]

  it('returns the containing programme as now and the following as next', () => {
    expect(nowNext(progs, 30 * 60_000)).toEqual({ now: progs[0], next: progs[1] })
    expect(nowNext(progs, HOUR + 1)).toEqual({ now: progs[1], next: progs[2] })
  })

  it('returns null now/next before the first programme', () => {
    expect(nowNext(progs, -1)).toEqual({ now: null, next: progs[0] })
  })

  it('returns null next after the last programme', () => {
    expect(nowNext(progs, 3 * HOUR)).toEqual({ now: null, next: null })
    expect(nowNext(progs, 2 * HOUR + 1)).toEqual({ now: progs[2], next: null })
  })

  it('handles an empty list', () => {
    expect(nowNext([], 0)).toEqual({ now: null, next: null })
  })
})

describe('programmesInWindow', () => {
  const progs = [prog('c', 0, HOUR, 'P0'), prog('c', HOUR, 2 * HOUR, 'P1'), prog('c', 2 * HOUR, 3 * HOUR, 'P2')]

  it('returns programmes overlapping the window', () => {
    expect(programmesInWindow(progs, 30 * 60_000, HOUR + 30 * 60_000).map((p) => p.title)).toEqual(['P0', 'P1'])
  })

  it('excludes programmes entirely outside the window', () => {
    expect(programmesInWindow(progs, 10 * HOUR, 11 * HOUR)).toEqual([])
  })

  it('includes a programme that exactly touches the window boundary', () => {
    expect(programmesInWindow(progs, HOUR, HOUR).map((p) => p.title)).toEqual(['P0', 'P1'])
  })
})

describe('daySchedule', () => {
  const progs = [prog('c', 0, HOUR, 'P0'), prog('c', HOUR, 2 * HOUR, 'P1'), prog('c', 2 * HOUR, 3 * HOUR, 'P2')]

  it('returns programmes from now through the end of that day', () => {
    expect(daySchedule(progs, HOUR + 1).map((p) => p.title)).toEqual(['P1', 'P2'])
  })

  it('returns an empty list when now is after the last programme', () => {
    expect(daySchedule(progs, 3 * HOUR + 1)).toEqual([])
  })
})
