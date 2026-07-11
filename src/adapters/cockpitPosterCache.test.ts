import { describe, it, expect } from 'vitest'
import { isSafePosterName } from './cockpitPosterCache'
import { cyrb53 } from '@/core/util/hash'

describe('isSafePosterName (path-traversal guard for poster restore)', () => {
  it('accepts a real cyrb53 hash', () => {
    expect(isSafePosterName(cyrb53('http://example/logo.png'))).toBe(true)
    expect(isSafePosterName('1a2b3c4d')).toBe(true)
  })

  it('rejects traversal / escaping / non-hex names from an untrusted backup', () => {
    for (const bad of [
      '../evil',
      '../../etc/passwd',
      '/etc/cockpit/foo',
      'a/b',
      '.hidden',
      '..',
      'name.png',
      'ABCDEF', // uppercase — cyrb53 only emits lowercase hex
      'deadbeef; rm -rf',
      '',
      'z123', // 'z' not hex
    ]) {
      expect(isSafePosterName(bad)).toBe(false)
    }
  })
})
