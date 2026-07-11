import { describe, it, expect } from 'vitest'
import { cyrb53 } from './hash'

describe('cyrb53', () => {
  it('is deterministic for the same input', () => {
    expect(cyrb53('http://p/logo.png')).toBe(cyrb53('http://p/logo.png'))
  })
  it('differs for different inputs', () => {
    expect(cyrb53('http://p/a.png')).not.toBe(cyrb53('http://p/b.png'))
  })
  it('returns a non-empty hex string', () => {
    const h = cyrb53('anything')
    expect(h).toMatch(/^[0-9a-f]+$/)
    expect(h.length).toBeGreaterThan(0)
  })
  it('handles empty string', () => {
    expect(cyrb53('')).toMatch(/^[0-9a-f]+$/)
  })
})
