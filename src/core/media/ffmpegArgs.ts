// User-agent for fetching the upstream stream. Some Xtream panels/CDNs gate on it.
export const STREAM_USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20'

export interface CurlArgsInput {
  url: string
  outPath: string // FIFO the stream is written into
  userAgent: string
}

// curl fetches the upstream stream into a local FIFO. It follows cross-host 302 redirects
// (which ffmpeg's HTTP demuxer stalls on for many Xtream panels) and retries a flaky source.
export function buildCurlArgs({ url, outPath, userAgent }: CurlArgsInput): string[] {
  return [
    '-sL',
    '--user-agent', userAgent,
    '--connect-timeout', '15',
    '--retry', '5',
    '--retry-delay', '2',
    '--retry-all-errors',
    '-o', outPath,
    url,
  ]
}

// Maps a requested video codec to its ffmpeg flags. 'copy' passes video through untouched
// (default, cheapest); 'nvenc'/'x264' transcode to H.264 for browsers that can't decode the
// source codec (chiefly HEVC) — args spike-verified against the host's ffmpeg/NVENC.
export function videoCodecArgs(codec: 'copy' | 'nvenc' | 'x264'): string[] {
  if (codec === 'nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-b:v', '0', '-cq', '23']
  if (codec === 'x264') return ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '23']
  return ['-c:v', 'copy']
}

export interface LiveRemuxArgsInput {
  inputPath: string // local FIFO fed by curl
  liveWindow: number // segments retained for live (sized from the buffer setting)
  playlistPath: string
  segmentPath: string
  videoCodec?: 'copy' | 'nvenc' | 'x264' // default 'copy'
}

// ffmpeg reads the local FIFO (no network — no redirect/HTTP quirks), remuxes video and
// transcodes audio to AAC into HLS. A rolling window: old segments deleted, no ENDLIST
// (the stream keeps going).
export function buildLiveRemuxArgs({ inputPath, liveWindow, playlistPath, segmentPath, videoCodec = 'copy' }: LiveRemuxArgsInput): string[] {
  return [
    '-y',
    '-i', inputPath,
    ...videoCodecArgs(videoCodec),
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', String(liveWindow),
    '-hls_flags', 'delete_segments+append_list+omit_endlist',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', segmentPath,
    playlistPath,
  ]
}

export interface VodRemuxArgsInput {
  inputUrl: string // panel movie/episode url — ffmpeg reads it directly (HTTP range-seekable, no redirect)
  offsetSeconds: number // -ss before -i: fast input seek via HTTP range
  burstSeconds: number // seconds to burst-read before pacing to realtime (fills the buffer)
  playlistPath: string
  segmentPath: string
  videoCodec?: 'copy' | 'nvenc' | 'x264' // default 'copy'
}

// ffmpeg reads the panel movie/episode URL directly (spike-proven: HTTP range-seekable,
// no redirect) with `-ss` for a fast input seek to the requested offset. Burst the first
// `burstSeconds` (fills the player buffer for a smooth start), then pace to realtime so
// ffmpeg (copy is far faster than realtime) can't race the file. EVENT playlist keeps ALL
// segments so hls.js knows the duration, can seek, and never skips (ENDLIST written when
// ffmpeg finishes). (HEVC video needs a video transcode — deferred to Plan 3c.)
export function buildVodRemuxArgs({ inputUrl, offsetSeconds, burstSeconds, playlistPath, segmentPath, videoCodec = 'copy' }: VodRemuxArgsInput): string[] {
  return [
    '-y',
    '-user_agent', STREAM_USER_AGENT,
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-ss', String(offsetSeconds),                  // input seek → HTTP range, fast
    '-readrate', '1', '-readrate_initial_burst', String(burstSeconds),
    '-i', inputUrl,
    ...videoCodecArgs(videoCodec), '-c:a', 'aac', '-b:a', '128k',
    '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_flags', 'append_list',
    '-hls_segment_type', 'mpegts', '-hls_segment_filename', segmentPath,
    playlistPath,
  ]
}
