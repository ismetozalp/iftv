import { describe, it, expect } from 'vitest'
import { resolveEncoder } from './encoder'

describe('resolveEncoder', () => {
  it('auto prefers nvenc when it tested OK, else x264', () => {
    expect(resolveEncoder('auto', { nvenc: true, x264: true, testedAt: 1 })).toBe('nvenc')
    expect(resolveEncoder('auto', { nvenc: false, x264: true, testedAt: 1 })).toBe('x264')
    expect(resolveEncoder('auto', null)).toBe('x264') // untested → safe software
  })

  it('explicit modes', () => {
    expect(resolveEncoder('gpu', null)).toBe('nvenc')
    expect(resolveEncoder('software', { nvenc: true, x264: true, testedAt: 1 })).toBe('x264')
    expect(resolveEncoder('off', null)).toBe('x264') // 'off' is handled by the store (won't transcode); resolveEncoder still returns a safe default
  })
})
