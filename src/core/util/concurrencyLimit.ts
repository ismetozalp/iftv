// A simple FIFO concurrency gate: at most `max` tasks run at once; the rest queue.
//
// Used to cap concurrent external image fetches. A large M3U playlist (e.g. iptv-org, ~13k
// channels with ~11k EXTERNAL logo URLs) renders a grid whose visible cards each fetch their
// logo host-side via a `cockpit.spawn(curl)` — dozens firing at once, many to slow/dead hosts
// that hold a cockpit channel for the full curl timeout. Alongside an active playback session's
// own frequent cockpit I/O (segment/playlist reads) this floods the Cockpit bridge and crashes
// the renderer. Bounding concurrency keeps the number of simultaneous cockpit channels small.
export function createLimiter(max: number): { run<T>(task: () => Promise<T>): Promise<T> } {
  let active = 0
  const queue: (() => void)[] = []
  const pump = () => {
    while (active < max && queue.length) {
      const start = queue.shift()!
      start()
    }
  }
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          active++
          task().then(resolve, reject).finally(() => {
            active--
            pump()
          })
        }
        queue.push(start)
        pump()
      })
    },
  }
}
