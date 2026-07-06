import cockpit from 'cockpit'

// Fetch an XMLTV EPG document. The feed is usually gzip-compressed (epgshare01 serves .xml.gz);
// try piping through gunzip first, fall back to a plain fetch if that fails (already-plain XML).
// The URL is user-settable, so it's passed as $0 to sh — never interpolated into the script text.
export async function fetchEpgXml(url: string): Promise<string> {
  return (await cockpit.spawn(
    ['sh', '-c', 'curl -fsSL --max-time 60 "$0" | gunzip -c 2>/dev/null || curl -fsSL --max-time 60 "$0"', url],
    { err: 'message' },
  )) as unknown as string
}
