import { describe, it, expect } from 'vitest'
import { resolveEpgUrl } from './source'
import type { Account } from '@/core/accounts/accounts'

const xt = (over: Partial<Account> = {}): Account => ({ id: 'a', type: 'xtream', name: 'X', url: 'http://host:8080', username: 'u', password: 'p', createdAt: 1, ...over })
const m3 = (over: Partial<Account> = {}): Account => ({ id: 'b', type: 'm3u', name: 'M', url: 'http://h/list.m3u', username: '', password: '', createdAt: 2, ...over })

describe('resolveEpgUrl', () => {
  it('manual per-account URL always wins', () => {
    expect(resolveEpgUrl(xt({ epgUrl: 'http://mine/epg.xml' }), 'http://global/epg.xml', 'http://tvg/epg.xml')).toBe('http://mine/epg.xml')
  })
  it('xtream derives the panel xmltv.php (scheme/host/port + creds)', () => {
    expect(resolveEpgUrl(xt(), '', '')).toBe('http://host:8080/xmltv.php?username=u&password=p')
  })
  it('xtream url-encodes credentials', () => {
    expect(resolveEpgUrl(xt({ username: 'a b', password: 'p/w&x' }), '', '')).toBe('http://host:8080/xmltv.php?username=a%20b&password=p%2Fw%26x')
  })
  it('m3u uses the declared url-tvg when present', () => {
    expect(resolveEpgUrl(m3(), 'http://global/epg.xml', 'http://tvg/epg.xml')).toBe('http://tvg/epg.xml')
  })
  it('m3u falls back to the global URL when no url-tvg', () => {
    expect(resolveEpgUrl(m3(), 'http://global/epg.xml', '')).toBe('http://global/epg.xml')
  })
  it('returns "" when nothing resolves (m3u, no tvg, no global)', () => {
    expect(resolveEpgUrl(m3(), '', '')).toBe('')
  })
})
