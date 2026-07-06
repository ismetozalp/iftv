import cockpit from 'cockpit'

// Enumerate a stream's tracks. Works for VOD (direct URL) and HLS (.m3u8) live; direct-.ts live may
// fail (redirect) → caller treats a throw as "no track info".
export async function probeStreams(url: string): Promise<unknown[]> {
  const out = await cockpit.spawn(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', url], { err: 'message' })
  try {
    return (JSON.parse(out as string).streams as unknown[]) ?? []
  } catch {
    return []
  }
}
