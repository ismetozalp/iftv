import cockpit from 'cockpit'
import { cyrb53 } from '@/core/util/hash'

// Persistent on-disk cache for channel logos / posters. Without it, every page load re-fetches every
// visible poster from its (often slow, sometimes dead) remote host — the dominant source of slow grid
// loads. Posters live in a hidden `.posters/` subdir of the media cache root so they're counted by the
// cache-size readout and wiped by "Clear cache", but hidden from the `root/*/` session listing and
// never touched by per-session teardown. We write via cockpit.file (not `curl -o`) so the cache path
// never appears in a curl argv — the orphan-cleanup `pkill -f <root>` can't kill a poster write.

let dir: string | null = null
let ensured: Promise<void> | null = null

// Called once at startup (and when the cache dir setting changes) with the resolved media cache root.
export function configurePosterCache(root: string): void {
  const next = `${root}/.posters`
  if (next === dir) return
  dir = next
  ensured = cockpit
    .spawn(['mkdir', '-p', dir], { err: 'message' })
    .then(() => undefined)
    .catch(() => undefined)
}

export function posterCacheDir(): string | null {
  return dir
}

function fileOf(url: string): string | null {
  return dir ? `${dir}/${cyrb53(url)}` : null
}

// Poster cache filenames are always a bare cyrb53 hex hash. Enforce that before any name reaches
// cockpit.file — the name in restorePosters() comes from an untrusted backup file, so a crafted key
// like "../../.config/cockpit/foo" must never escape the .posters/ dir (path-traversal / arbitrary write).
const SAFE_NAME = /^[0-9a-f]{1,20}$/
export function isSafePosterName(name: string): boolean {
  return SAFE_NAME.test(name)
}

// Fast local read — returns null (miss) if the cache isn't configured, the file is absent, or empty.
export async function readCachedPoster(url: string): Promise<Uint8Array | null> {
  const path = fileOf(url)
  if (!path) return null
  const handle = cockpit.file<Uint8Array>(path, { binary: true } as never)
  try {
    const bytes = await handle.read()
    return bytes && bytes.length > 0 ? bytes : null
  } catch {
    return null
  } finally {
    handle.close()
  }
}

// Best-effort populate — silently no-ops if unconfigured or given empty bytes; never blocks playback.
export async function writeCachedPoster(url: string, bytes: Uint8Array): Promise<void> {
  const path = fileOf(url)
  if (!path || !bytes || bytes.length === 0) return
  try {
    if (ensured) await ensured
    const handle = cockpit.file<Uint8Array>(path, { binary: true } as never)
    try {
      await handle.replace(bytes)
    } finally {
      handle.close()
    }
  } catch {
    // A cache write failing is non-fatal — the poster still renders from the fetched bytes this session.
  }
}

// --- Backup / restore support -------------------------------------------------------------------
// The cache is keyed by a deterministic URL hash, so backing up + restoring the raw files (by their
// hash filename) is enough for a restored install to hit cache immediately — no URLs needed.

// Basenames of every cached poster file (empty if unconfigured / dir missing).
export async function listCachedPosters(): Promise<string[]> {
  if (!dir) return []
  try {
    const out = (await cockpit.spawn(
      ['sh', '-c', 'ls -1 "$0" 2>/dev/null || true', dir],
      { err: 'message' },
    )) as unknown as string
    return String(out).split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export async function readPosterFile(name: string): Promise<Uint8Array | null> {
  if (!dir || !isSafePosterName(name)) return null
  const handle = cockpit.file<Uint8Array>(`${dir}/${name}`, { binary: true } as never)
  try {
    const bytes = await handle.read()
    return bytes && bytes.length > 0 ? bytes : null
  } catch {
    return null
  } finally {
    handle.close()
  }
}

export async function writePosterFile(name: string, bytes: Uint8Array): Promise<void> {
  if (!dir || !bytes || bytes.length === 0 || !isSafePosterName(name)) return
  try {
    if (ensured) await ensured
    const handle = cockpit.file<Uint8Array>(`${dir}/${name}`, { binary: true } as never)
    try {
      await handle.replace(bytes)
    } finally {
      handle.close()
    }
  } catch {
    /* best-effort */
  }
}
