import { describe, it, expect } from 'vitest'
import { normalizeRepo, parseVersion, isNewer, pickAsset, DEFAULT_REPO } from './release'

describe('normalizeRepo', () => {
  it('passes through owner/repo', () => expect(normalizeRepo('ismetozalp/iftv')).toBe('ismetozalp/iftv'))
  it('extracts from an https URL', () => expect(normalizeRepo('https://github.com/ismetozalp/iftv')).toBe('ismetozalp/iftv'))
  it('strips .git and trailing slash', () => expect(normalizeRepo('github.com/a/b.git/')).toBe('a/b'))
  it('extracts from a releases URL', () => expect(normalizeRepo('https://github.com/a/b/releases/latest')).toBe('a/b'))
  it('falls back to the default when empty', () => expect(normalizeRepo('   ')).toBe(DEFAULT_REPO))
  it('falls back to the default when not owner/repo', () => expect(normalizeRepo('justoneword')).toBe(DEFAULT_REPO))
})

describe('parseVersion', () => {
  it('strips a leading v and splits', () => expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]))
  it('treats junk as 0', () => expect(parseVersion('1.x.4')).toEqual([1, 0, 4]))
})

describe('isNewer', () => {
  it('true when remote > local', () => expect(isNewer('1.1.0', '1.0.9')).toBe(true))
  it('false when equal', () => expect(isNewer('1.0.0', '1.0.0')).toBe(false))
  it('false when older', () => expect(isNewer('0.9.0', '1.0.0')).toBe(false))
  it('handles v-prefix + differing lengths', () => expect(isNewer('v1.2', '1.1.9')).toBe(true))
})

describe('pickAsset', () => {
  it('picks the inflighttv-*.zip asset', () =>
    expect(
      pickAsset([
        { name: 'x.txt', browser_download_url: 'u1' },
        { name: 'inflighttv-1.0.0.zip', browser_download_url: 'u2' },
      ])?.browser_download_url,
    ).toBe('u2'))
  it('returns null when none match', () =>
    expect(pickAsset([{ name: 'a.zip', browser_download_url: 'u' }])).toBeNull())
})
