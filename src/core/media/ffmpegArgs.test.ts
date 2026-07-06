import { describe, it, expect } from 'vitest'
import { buildCurlArgs, buildLiveRemuxArgs, buildVodRemuxArgs, videoCodecArgs, STREAM_USER_AGENT } from './ffmpegArgs'

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

describe('buildLiveRemuxArgs', () => {
  const base = { inputPath: '/c/s/in.ts', playlistPath: '/c/s/index.m3u8', segmentPath: '/c/s/seg_%05d.ts' }
  it('remuxes the local input (copy video, aac audio) with the playlist last', () => {
    const args = buildLiveRemuxArgs({ ...base, liveWindow: 6 })
    expect(args).toContain('-i'); expect(args).toContain('/c/s/in.ts')
    expect(args.join(' ')).toContain('-c:v copy')
    expect(args.join(' ')).toContain('-c:a aac')
    expect(args).toContain('-hls_time'); expect(args).toContain('4')
    expect(args).toContain('-hls_segment_filename'); expect(args).toContain('/c/s/seg_%05d.ts')
    expect(args[args.length - 1]).toBe('/c/s/index.m3u8')
  })
  it('a rolling window: delete old segments, no ENDLIST, sized by liveWindow, no -re', () => {
    const args = buildLiveRemuxArgs({ ...base, liveWindow: 10 })
    expect(args).toContain('-hls_list_size'); expect(args).toContain('10')
    expect(args).toContain('delete_segments+append_list+omit_endlist')
    expect(args).not.toContain('event')
    expect(args).not.toContain('-re') // live source is already realtime
  })
  it('has NO http/reconnect flags (input is a local FIFO, not a URL)', () => {
    const args = buildLiveRemuxArgs({ ...base, liveWindow: 6 })
    expect(args).not.toContain('-reconnect')
    expect(args).not.toContain('-http_persistent')
  })
})

describe('buildVodRemuxArgs', () => {
  const a = buildVodRemuxArgs({ inputUrl: 'http://h/movie/u/p/9.mkv', offsetSeconds: 300, burstSeconds: 30, playlistPath: '/c/index.m3u8', segmentPath: '/c/seg_%05d.ts' })
  it('range-seeks to the offset, paces, reads the URL directly, EVENT keep-all', () => {
    expect(a.join(' ')).toContain('-ss 300')
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'))          // input seek (fast)
    expect(a.join(' ')).toContain('-readrate 1 -readrate_initial_burst 30')
    expect(a.join(' ')).toContain(`-i http://h/movie/u/p/9.mkv`)
    expect(a).toContain('-user_agent'); expect(a).toContain(STREAM_USER_AGENT)
    expect(a).toContain('-reconnect')
    expect(a.join(' ')).toContain('-hls_list_size 0')
    expect(a.join(' ')).toContain('-hls_playlist_type event')
    expect(a[a.length - 1]).toBe('/c/index.m3u8')
  })
  it('offset 0 still emits -ss 0', () => {
    expect(buildVodRemuxArgs({ inputUrl: 'u', offsetSeconds: 0, burstSeconds: 30, playlistPath: 'p', segmentPath: 's' }).join(' ')).toContain('-ss 0')
  })
})

describe('videoCodecArgs', () => {
  it('maps codecs', () => {
    expect(videoCodecArgs('copy')).toEqual(['-c:v', 'copy'])
    expect(videoCodecArgs('nvenc').join(' ')).toBe('-c:v h264_nvenc -preset p4 -tune ll -b:v 0 -cq 23')
    expect(videoCodecArgs('x264').join(' ')).toBe('-c:v libx264 -preset veryfast -tune zerolatency -crf 23')
  })
})

describe('builders honor videoCodec', () => {
  const live = { inputPath: '/c/in.ts', liveWindow: 6, playlistPath: '/c/i.m3u8', segmentPath: '/c/s_%05d.ts' }
  it('live default is copy; nvenc swaps it', () => {
    expect(buildLiveRemuxArgs(live).join(' ')).toContain('-c:v copy')
    expect(buildLiveRemuxArgs({ ...live, videoCodec: 'nvenc' }).join(' ')).toContain('-c:v h264_nvenc')
    expect(buildLiveRemuxArgs({ ...live, videoCodec: 'nvenc' }).join(' ')).not.toContain('-c:v copy')
  })
  it('vod honors x264 and keeps -ss + event', () => {
    const a = buildVodRemuxArgs({ inputUrl: 'http://h/m.mkv', offsetSeconds: 60, burstSeconds: 30, playlistPath: '/c/i.m3u8', segmentPath: '/c/s.ts', videoCodec: 'x264' }).join(' ')
    expect(a).toContain('-c:v libx264'); expect(a).toContain('-ss 60'); expect(a).toContain('-hls_playlist_type event')
  })
})
