import cockpit from 'cockpit'
import type { EngineDeps, PlaybackEngine } from '@/core/media/PlaybackEngine'
import { createPlaybackEngine } from '@/core/media/engine'
import { cacheRoot } from '@/core/media/session'

export async function createCockpitPlaybackEngine(): Promise<PlaybackEngine> {
  const user = await cockpit.user()
  const root = cacheRoot(user.home)
  // Best-effort cleanup of stale session dirs from prior/crashed runs.
  cockpit.spawn(['sh', '-c', `rm -rf ${root}/* 2>/dev/null || true`], { superuser: 'try' }).catch(() => {})

  const deps: EngineDeps = {
    home: async () => user.home,
    newId: () => crypto.randomUUID(),
    mkdir: async (dir) => { await cockpit.spawn(['mkdir', '-p', dir]) },
    rmrf: async (dir) => { await cockpit.spawn(['rm', '-rf', dir]).catch(() => {}) },
    spawn: (argv) => cockpit.spawn(argv, { err: 'message' }) as unknown as { close(p: string): void },
    readFile: async (path) => {
      const handle = cockpit.file<Uint8Array>(path, { binary: true })
      try {
        return await handle.read()
      } catch {
        return null
      } finally {
        handle.close()
      }
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  }
  return createPlaybackEngine(deps)
}
