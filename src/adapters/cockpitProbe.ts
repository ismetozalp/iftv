import cockpit from 'cockpit'

// Enumerate a stream's tracks. Works for VOD (direct URL) and HLS (.m3u8) live; direct-.ts live may
// fail (redirect) → caller treats a throw/empty as "no track info".
// The URL comes from the (semi-trusted) panel/M3U, so: require http(s) — this rejects a "-"-prefixed
// URL (no ffprobe flag smuggling) and non-http schemes; and pin the protocol whitelist so ffprobe
// can't be steered into reading local files (file://) via the URL or an HLS redirect.
export async function probeStreams(url: string): Promise<unknown[]> {
  if (!/^https?:\/\//i.test(url)) return []
  try {
    const out = await cockpit.spawn(
      ['ffprobe', '-v', 'error', '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-show_streams', '-of', 'json', url],
      { err: 'message' },
    )
    return (JSON.parse(out as string).streams as unknown[]) ?? []
  } catch {
    return []
  }
}
