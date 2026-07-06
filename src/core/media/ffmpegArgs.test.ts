import { describe, it, expect } from 'vitest'
import { buildLiveArgs } from './ffmpegArgs'

describe('buildLiveArgs', () => {
  const args = buildLiveArgs({ inputUrl: 'http://h/live/u/p/1.ts', playlistPath: '/c/s/index.m3u8', segmentPath: '/c/s/seg_%05d.ts' })
  it('reconnects, disables http keep-alive, remuxes video, transcodes audio to aac', () => {
    expect(args).toContain('-reconnect'); expect(args).toContain('-reconnect_streamed')
    expect(args.join(' ')).toContain('-http_persistent 0') // CDN/HLS segment-fetch robustness (before -i)
    expect(args.indexOf('-http_persistent')).toBeLessThan(args.indexOf('-i')) // input option
    expect(args.join(' ')).toContain('-c:v copy')
    expect(args.join(' ')).toContain('-c:a aac')
  })
  it('emits a rolling live HLS window to the given paths', () => {
    expect(args).toContain('-f'); expect(args).toContain('hls')
    expect(args).toContain('-hls_time'); expect(args).toContain('4')
    expect(args).toContain('-hls_list_size'); expect(args).toContain('6')
    expect(args).toContain('delete_segments+append_list+omit_endlist')
    expect(args).toContain('-hls_segment_filename'); expect(args).toContain('/c/s/seg_%05d.ts')
    expect(args[args.length - 1]).toBe('/c/s/index.m3u8') // playlist is the output (last arg)
    expect(args).toContain('http://h/live/u/p/1.ts')
  })
})
