export interface LiveArgsInput {
  inputUrl: string
  playlistPath: string
  segmentPath: string
}

// Remux video (cheap), transcode audio to AAC (browser-safe), rolling live HLS window.
// (HEVC video needs a video transcode — deferred to Plan 3b.)
export function buildLiveArgs({ inputUrl, playlistPath, segmentPath }: LiveArgsInput): string[] {
  return [
    '-y',
    // Disable HTTP keep-alive: some CDNs (and nested HLS/M3U upstreams) fail segment
    // fetches with persistent connections; harmless for a direct MPEG-TS input.
    '-http_persistent', '0',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_delay_max', '5',
    '-i', inputUrl,
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
