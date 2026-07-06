import cockpit from 'cockpit'
import type { EngineDeps, PlaybackEngine } from '@/core/media/PlaybackEngine'
import { createPlaybackEngine } from '@/core/media/engine'
import { resolveCacheRoot } from '@/core/media/session'
import { useSettingsStore } from '@/stores/settings'
import { listSessionDirs as cacheListSessionDirs } from '@/adapters/cockpitCache'

export async function createCockpitPlaybackEngine(): Promise<PlaybackEngine> {
  const user = await cockpit.user()
  const root = resolveCacheRoot(user.home, useSettingsStore().cacheDir)
  // Best-effort cleanup of stale session dirs from prior/crashed runs. Remove the whole
  // cache root (a later session's `mkdir -p` recreates it). Pass the path as an argv element
  // — no shell, so it can't be command-injected via an odd home dir — and AWAIT it so it
  // can't race a subsequent session's mkdir.
  await cockpit.spawn(['rm', '-rf', root]).catch(() => {})

  const deps: EngineDeps = {
    home: async () => user.home,
    newId: () => crypto.randomUUID(),
    mkdir: async (dir) => { await cockpit.spawn(['mkdir', '-p', dir]) },
    mkfifo: async (path) => { await cockpit.spawn(['mkfifo', path]) },
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
    cacheDir: async () => useSettingsStore().cacheDir,
    cacheLimitBytes: async () => useSettingsStore().cacheLimitGb * 1024 ** 3,
    listSessionDirs: (root) => cacheListSessionDirs(root),
  }
  return createPlaybackEngine(deps)
}
