import cockpit from 'cockpit'

// Probe whether a user-chosen cache directory is writable, without touching the raw path itself:
// always create/test inside our own `/inflighttv` subdir (paths passed as argv/$0, never interpolated
// into shell script text — dir is user input).
export async function probeWritable(dir: string): Promise<boolean> {
  try {
    await cockpit.spawn(
      ['sh', '-c', 'd="$0/inflighttv"; mkdir -p "$d" && t="$d/.wtest.$$" && : > "$t" && rm -f "$t"', dir],
      { err: 'message' },
    )
    return true
  } catch {
    return false
  }
}

// Size of the resolved cache root (already includes the /inflighttv subdir — see resolveCacheRoot).
export async function cacheSizeBytes(root: string): Promise<number> {
  try {
    const o = (await cockpit.spawn(['du', '-sb', root], { err: 'message' })) as unknown as string
    return parseInt(String(o).split(/\s+/)[0], 10) || 0
  } catch {
    return 0
  }
}

// Wipe the resolved cache root. Safe: root already carries our own /inflighttv subdir
// (resolveCacheRoot), so this never touches the user's raw chosen directory.
export async function clearCache(root: string): Promise<void> {
  await cockpit.spawn(['rm', '-rf', root], { err: 'message' }).catch(() => {})
}

// One dir per line: "<bytes> <mtime-epoch> <name>" — root passed as $0, children globbed (no injection).
export async function listSessionDirs(root: string): Promise<{ id: string; sizeBytes: number; mtime: number }[]> {
  try {
    const o = (await cockpit.spawn(
      ['sh', '-c', 'for d in "$0"/*/; do [ -d "$d" ] || continue; printf "%s %s %s\\n" "$(du -sb "$d"|cut -f1)" "$(stat -c %Y "$d")" "$(basename "$d")"; done', root],
      { err: 'message' },
    )) as unknown as string
    return String(o)
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [b, m, ...n] = l.split(' ')
        return { id: n.join(' '), sizeBytes: +b || 0, mtime: +m || 0 }
      })
  } catch {
    return []
  }
}
