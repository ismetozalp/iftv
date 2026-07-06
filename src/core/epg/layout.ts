// Pure grid-layout math for the Guide view. No DOM, no Date.now() — all times are passed in by
// the caller (the view owns `nowMs`/window state; this module just turns ms into pixels).
import type { Programme } from './types'

export interface ProgrammeBlock {
  title: string
  startMs: number
  stopMs: number
  leftPx: number
  widthPx: number
}

export interface TimeTick {
  ms: number
  leftPx: number
}

const MIN_WIDTH_PX = 2
const MS_PER_HOUR = 3_600_000

// Clip each programme to [windowStartMs, windowEndMs), drop ones that don't overlap the window
// at all, and position/size the rest in pixels at `pxPerHour`. A minimum width keeps very short
// (or heavily clipped) programmes visible/clickable.
export function programmeBlocks(
  programmes: Programme[],
  windowStartMs: number,
  windowEndMs: number,
  pxPerHour: number,
): ProgrammeBlock[] {
  const pxPerMs = pxPerHour / MS_PER_HOUR
  const blocks: ProgrammeBlock[] = []
  for (const p of programmes) {
    if (p.stopMs <= windowStartMs || p.startMs >= windowEndMs) continue
    const clippedStart = Math.max(p.startMs, windowStartMs)
    const clippedStop = Math.min(p.stopMs, windowEndMs)
    blocks.push({
      title: p.title,
      startMs: p.startMs,
      stopMs: p.stopMs,
      leftPx: (clippedStart - windowStartMs) * pxPerMs,
      widthPx: Math.max(MIN_WIDTH_PX, (clippedStop - clippedStart) * pxPerMs),
    })
  }
  return blocks
}

// Evenly spaced tick marks across the window, every `stepMin` minutes. Returns raw ms — the view
// formats the label (locale/HH:MM), keeping this module free of Date/Intl.
export function timeTicks(windowStartMs: number, windowEndMs: number, stepMin: number, pxPerHour: number): TimeTick[] {
  const stepMs = Math.max(1, stepMin) * 60_000
  const pxPerMs = pxPerHour / MS_PER_HOUR
  const ticks: TimeTick[] = []
  for (let ms = windowStartMs; ms <= windowEndMs; ms += stepMs) {
    ticks.push({ ms, leftPx: (ms - windowStartMs) * pxPerMs })
  }
  return ticks
}

// Horizontal position of the "now" line relative to the window's left edge. Can be negative or
// beyond the window width — the view decides whether/how to clip it.
export function nowMarkerPx(nowMs: number, windowStartMs: number, pxPerHour: number): number {
  return (nowMs - windowStartMs) * (pxPerHour / MS_PER_HOUR)
}
