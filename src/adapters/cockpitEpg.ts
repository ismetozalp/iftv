import cockpit from 'cockpit'

// Fetch an XMLTV EPG document. The feed is usually gzip-compressed (epgshare01 serves .xml.gz).
// Download to a private temp file FIRST (so concurrent per-account fetches never interleave), then
// decompress if it's gzip else emit as-is. Crucially this never pipes curl→gunzip: a truncated
// download used to make gunzip fail and the old `|| curl` fallback appended raw compressed bytes,
// yielding a partial-XML+garbage blob that parsed to a near-empty index. Here a failed/partial
// download makes curl -f exit non-zero → the whole spawn rejects (caught upstream), never a partial.
// The URL is user-settable, so it's passed as $0 to sh — never interpolated into the script text.
export async function fetchEpgXml(url: string): Promise<string> {
  const script =
    'set -e; f="$(mktemp)"; trap \'rm -f "$f"\' EXIT; ' +
    'curl -fsSL --max-time 60 -o "$f" "$0"; ' +
    'if gzip -t "$f" 2>/dev/null; then gunzip -c "$f"; else cat "$f"; fi'
  return (await cockpit.spawn(['sh', '-c', script, url], { err: 'message' })) as unknown as string
}
