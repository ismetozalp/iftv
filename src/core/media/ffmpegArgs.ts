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
}

// ffmpeg reads the local FIFO (no network — no redirect/HTTP quirks), remuxes video and
// transcodes audio to AAC into a rolling live HLS window.
// (HEVC video needs a video transcode — deferred to Plan 3b.)
export function buildRemuxArgs({ inputPath, playlistPath, segmentPath }: RemuxArgsInput): string[] {
  return [
    '-y',
    '-i', inputPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list+omit_endlist',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', segmentPath,
    playlistPath,
  ]
}
