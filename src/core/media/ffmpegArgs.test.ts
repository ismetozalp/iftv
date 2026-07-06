import { describe, it, expect } from 'vitest'
import { buildCurlArgs, buildRemuxArgs, STREAM_USER_AGENT } from './ffmpegArgs'

describe('buildCurlArgs', () => {
  const args = buildCurlArgs({ url: 'http://h/live/u/p/1.ts', outPath: '/c/s/in.ts', userAgent: STREAM_USER_AGENT })
  it('follows redirects, sets a UA, retries, and writes to the out path with the url last', () => {
    expect(args).toContain('-sL') // silent + follow redirects
    expect(args).toContain('--user-agent'); expect(args).toContain(STREAM_USER_AGENT)
    expect(args).toContain('--retry')
    expect(args).toContain('-o'); expect(args).toContain('/c/s/in.ts')
    expect(args[args.length - 1]).toBe('http://h/live/u/p/1.ts')
  })
})

describe('buildRemuxArgs', () => {
  const base = { inputPath: '/c/s/in.ts', playlistPath: '/c/s/index.m3u8', segmentPath: '/c/s/seg_%05d.ts' }
  it('remuxes the local input (copy video, aac audio) with the playlist last', () => {
    const args = buildRemuxArgs(base)
    expect(args).toContain('-i'); expect(args).toContain('/c/s/in.ts')
    expect(args.join(' ')).toContain('-c:v copy')
    expect(args.join(' ')).toContain('-c:a aac')
    expect(args).toContain('-hls_time'); expect(args).toContain('4')
    expect(args).toContain('-hls_segment_filename'); expect(args).toContain('/c/s/seg_%05d.ts')
    expect(args[args.length - 1]).toBe('/c/s/index.m3u8')
  })
  it('LIVE (default) = a rolling window: delete old segments, no ENDLIST, sized by liveWindow, no -re', () => {
    const args = buildRemuxArgs({ ...base, live: true, liveWindow: 10 })
    expect(args).toContain('-hls_list_size'); expect(args).toContain('10')
    expect(args).toContain('delete_segments+append_list+omit_endlist')
    expect(args).not.toContain('event')
    expect(args).not.toContain('-re') // live source is already realtime
  })
  it('VOD (live:false) = burst-then-realtime EVENT playlist keeping every segment (duration + seek, no delete)', () => {
    const args = buildRemuxArgs({ ...base, live: false, burstSeconds: 30 })
    expect(args.join(' ')).toContain('-readrate 1 -readrate_initial_burst 30 -i') // burst then pace, before input
    expect(args.join(' ')).toContain('-hls_list_size 0')
    expect(args.join(' ')).toContain('-hls_playlist_type event')
    expect(args).not.toContain('delete_segments+append_list+omit_endlist')
    expect(args.join(' ')).not.toContain('omit_endlist') // ENDLIST written when ffmpeg finishes
  })
  it('has NO http/reconnect flags (input is a local FIFO, not a URL)', () => {
    const args = buildRemuxArgs(base)
    expect(args).not.toContain('-reconnect')
    expect(args).not.toContain('-http_persistent')
  })
})
