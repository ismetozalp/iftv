import cockpit from 'cockpit'
import type { EngineDeps, PlaybackEngine } from '@/core/media/PlaybackEngine'
import { createPlaybackEngine } from '@/core/media/engine'
import { resolveCacheRoot } from '@/core/media/session'
import { useSettingsStore } from '@/stores/settings'
import { listSessionDirs as cacheListSessionDirs } from '@/adapters/cockpitCache'

export async function createCockpitPlaybackEngine(): Promise<PlaybackEngine> {
  const user = await cockpit.user()
  const root = resolveCacheRoot(user.home, useSettingsStore().cacheDir)
  // Reap orphaned playback processes from a prior crashed / abruptly-closed session BEFORE clearing
  // the cache. Every ffmpeg/curl we spawn has this session cache `root` in its argv (playlist/segment
  // /FIFO paths), so `pkill -f <root>` matches exactly our leftovers and never another user's ffmpeg.
  // Directly-spawned (no shell) so pkill can't match its own parent. This is the guarantee that no
  // ffmpeg lingers across the browser closing — cockpit kills them on a clean disconnect, and this
  // catches anything a crash left behind, on the next load. Then wipe the cache dirs.
  await cockpit.spawn(['pkill', '-9', '-f', root]).catch(() => {})
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
