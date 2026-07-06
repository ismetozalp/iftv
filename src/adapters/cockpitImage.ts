import cockpit from 'cockpit'

// Fetch image bytes server-side via curl. Cockpit runs over HTTPS with a CSP that only
// allows img-src 'self' data: blob:, so an <img> can't point at an external http(s) poster
// URL directly (CSP + mixed-content block it). Fetching the bytes host-side and handing the
// component a blob: URL sidesteps both. curl -sL follows redirects and handles http/https
// transparently; the UA mirrors the one used for stream playback.
export async function fetchImageBytes(url: string): Promise<Uint8Array> {
  return cockpit.spawn(
    ['curl', '-sL', '--max-time', '15', '--user-agent', 'VLC/3.0.20 LibVLC/3.0.20', url],
    { binary: true, err: 'message' },
  )
}
