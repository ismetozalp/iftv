import cockpit from 'cockpit'

// Fetch image bytes server-side via curl. Cockpit runs over HTTPS with a CSP that only
// allows img-src 'self' data: blob:, so an <img> can't point at an external http(s) poster
// URL directly (CSP + mixed-content block it). Fetching the bytes host-side and handing the
// component a blob: URL sidesteps both. curl -sL follows redirects and handles http/https
// transparently; the UA mirrors the one used for stream playback.
export async function fetchImageBytes(url: string): Promise<Uint8Array> {
  // The URL comes from the (semi-trusted) panel, so harden the curl call:
  //  - require an http(s) URL → rejects file://, gopher://, etc. (no local-file read / scheme SSRF)
  //  - pin curl to http/https on the request AND on redirects, and cap redirects (SSRF via redirect)
  //  - pass `--` so a "-"-prefixed URL can't smuggle curl flags (argv flag injection)
  // Residual: the panel could still point this at an internal http host; impact is limited since the
  // bytes are only rendered as an image in the user's own session (not returned to the panel).
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('invalid image url')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('unsupported image url scheme')
  }
  return cockpit.spawn(
    [
      'curl', '-sL',
      '--proto', '=http,https', '--proto-redir', '=http,https', '--max-redirs', '5',
      // 6s cap: IPTV playlists are full of dead logo URLs — a long timeout lets a handful of them hog
      // the concurrency limiter's lanes and stall the whole grid. Fail fast, fall back to initials.
      '--max-time', '6', '--connect-timeout', '4', '--user-agent', 'VLC/3.0.20 LibVLC/3.0.20',
      '--', parsed.toString(),
    ],
    { binary: true, err: 'message' },
  )
}
