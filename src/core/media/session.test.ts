import { describe, it, expect } from 'vitest'
import { cacheRoot, sessionDir, playlistPath, segmentPattern, sourceUrl, fileNameFromUrl, resolveInDir, resolveCacheRoot } from './session'

describe('session paths', () => {
  it('builds cache root, session dir, playlist + segment paths under home', () => {
    const root = cacheRoot('/home/ismet')
    expect(root).toBe('/home/ismet/.cache/inflighttv')
    const dir = sessionDir(root, 'sid')
    expect(dir).toBe('/home/ismet/.cache/inflighttv/sid')
    expect(playlistPath(dir)).toBe('/home/ismet/.cache/inflighttv/sid/index.m3u8')
    expect(segmentPattern(dir)).toBe('/home/ismet/.cache/inflighttv/sid/seg_%05d.ts')
  })
  it('sourceUrl is a fake iftv:// playlist url per session', () => {
    expect(sourceUrl('sid')).toBe('iftv://sid/index.m3u8')
  })
  it('maps an hls.js-requested url back to a file in the session dir', () => {
    const dir = '/c/sid'
    expect(fileNameFromUrl('iftv://sid/index.m3u8')).toBe('index.m3u8')
    expect(fileNameFromUrl('iftv://sid/seg_00007.ts?x=1')).toBe('seg_00007.ts')
    expect(resolveInDir(dir, 'iftv://sid/seg_00007.ts')).toBe('/c/sid/seg_00007.ts')
  })
})

describe('resolveCacheRoot', () => {
  it('default when cacheDir empty', () => expect(resolveCacheRoot('/home/u', '')).toBe('/home/u/.cache/inflighttv'))
  it('appends the app subdir to a custom dir (so cleanup never nukes the raw path)', () => {
    expect(resolveCacheRoot('/home/u', '/data/media')).toBe('/data/media/inflighttv')
    expect(resolveCacheRoot('/home/u', '/data/media/')).toBe('/data/media/inflighttv') // trailing slash tolerated
  })
})
