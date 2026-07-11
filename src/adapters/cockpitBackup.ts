// Backup gather/restore over a JsonStore (Cockpit files by default) + browser download/upload
// helpers. No crypto here — see core/backup/crypto.ts. Never log passwords/plaintext.

import type { JsonStore } from '@/core/storage/appState'
import { createCockpitStore } from '@/adapters/cockpitFile'
import { BACKUP_FILES } from '@/core/backup/bundle'
import { listCachedPosters, readPosterFile, writePosterFile } from '@/adapters/cockpitPosterCache'
import { bytesToBase64, base64ToBytes } from '@/core/backup/binary'

export async function gatherFiles(store?: JsonStore): Promise<Record<string, unknown>> {
  const s = store ?? (await createCockpitStore())
  const out: Record<string, unknown> = {}
  for (const name of BACKUP_FILES) {
    const v = await s.load<unknown>(name, null)
    if (v != null) out[name] = v
  }
  return out
}

export async function restoreFiles(files: Record<string, unknown>, store?: JsonStore): Promise<void> {
  const s = store ?? (await createCockpitStore())
  for (const name of BACKUP_FILES) {
    if (name in files) await s.save(name, files[name])
  }
}

// Read every cached poster into a filename → base64 map for inclusion in a backup (opt-in).
export async function gatherPosters(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const name of await listCachedPosters()) {
    const bytes = await readPosterFile(name)
    if (bytes) out[name] = bytesToBase64(bytes)
  }
  return out
}

// Write a restored filename → base64 poster map back into the on-disk cache (best-effort).
export async function restorePosters(posters: Record<string, string>): Promise<void> {
  for (const [name, b64] of Object.entries(posters)) {
    try {
      await writePosterFile(name, base64ToBytes(b64))
    } catch {
      /* skip a corrupt entry rather than abort the whole restore */
    }
  }
}

export function downloadTextFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function readUploadedFile(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsText(file)
  })
}
