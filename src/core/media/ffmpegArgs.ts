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

export interface RemuxArgsInput {
  inputPath: string // local FIFO fed by curl
  playlistPath: string
  segmentPath: string
  live?: boolean // true = rolling live window; false = VOD (keep every segment)
  liveWindow?: number // segments retained for live (sized from the buffer setting)
}

// ffmpeg reads the local FIFO (no network — no redirect/HTTP quirks), remuxes video and
// transcodes audio to AAC into HLS. LIVE = a rolling window (old segments deleted, no ENDLIST).
// VOD (movie/episode, finite) = an EVENT playlist keeping ALL segments so hls.js knows the
// duration, can seek, and never skips (ENDLIST is written when ffmpeg finishes).
// (HEVC video needs a video transcode — deferred to Plan 3c.)
export function buildRemuxArgs({ inputPath, playlistPath, segmentPath, live = true, liveWindow = 6 }: RemuxArgsInput): string[] {
  const hls = live
    ? ['-hls_list_size', String(liveWindow), '-hls_flags', 'delete_segments+append_list+omit_endlist']
    : ['-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_flags', 'append_list']
  return [
    '-y',
    // VOD: pace to realtime so ffmpeg (copy is far faster than realtime) can't race the file and
    // push the "edge" minutes ahead of the playhead. Live is already realtime — no -re.
    ...(live ? [] : ['-re']),
    '-i', inputPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'hls',
    '-hls_time', '4',
    ...hls,
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', segmentPath,
    playlistPath,
  ]
}
