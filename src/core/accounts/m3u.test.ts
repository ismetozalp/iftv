import { describe, it, expect } from 'vitest'
import { isValidM3u } from './m3u'

describe('isValidM3u', () => {
  it('accepts a body starting with #EXTM3U', () => {
    expect(isValidM3u('#EXTM3U\n#EXTINF:-1,Chan\nhttp://s/1.ts')).toBe(true)
  })
  it('tolerates a leading BOM and whitespace', () => {
    expect(isValidM3u('﻿  \n#EXTM3U\n')).toBe(true)
  })
  it('rejects non-playlist bodies (HTML error page, empty, JSON)', () => {
    expect(isValidM3u('<html>error</html>')).toBe(false)
    expect(isValidM3u('')).toBe(false)
    expect(isValidM3u('{"error":true}')).toBe(false)
  })
})
