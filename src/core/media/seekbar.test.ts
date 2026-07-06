import { describe, expect, it } from 'vitest'
import { formatTime, clampFraction } from './seekbar'

describe('formatTime', () => {
  it('formats time', () => {
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(3661)).toBe('1:01:01')
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(NaN)).toBe('0:00')
  })
})

describe('clampFraction', () => {
  it('clamps fractions', () => {
    expect(clampFraction(-1)).toBe(0)
    expect(clampFraction(2)).toBe(1)
    expect(clampFraction(0.5)).toBe(0.5)
  })
})
