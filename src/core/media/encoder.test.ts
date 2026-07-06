import { describe, it, expect } from 'vitest'
import { resolveEncoder } from './encoder'

describe('resolveEncoder', () => {
  it('auto tries GPU first (then CPU via runtime fallback) unless a probe marked nvenc broken', () => {
    expect(resolveEncoder('auto', { nvenc: true, x264: true, testedAt: 1 })).toBe('nvenc')
    expect(resolveEncoder('auto', { nvenc: false, x264: true, testedAt: 1 })).toBe('x264') // known broken → CPU
    expect(resolveEncoder('auto', null)).toBe('nvenc') // untested → try GPU first
  })

  it('explicit modes', () => {
    expect(resolveEncoder('gpu', null)).toBe('nvenc')
    expect(resolveEncoder('software', { nvenc: true, x264: true, testedAt: 1 })).toBe('x264')
    expect(resolveEncoder('off', null)).toBe('x264') // 'off' is handled by the store (won't transcode); resolveEncoder still returns a safe default
  })
})
