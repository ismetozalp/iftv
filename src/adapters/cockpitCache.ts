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
