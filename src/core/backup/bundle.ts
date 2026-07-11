// Plaintext backup bundle — build/parse. Pure, no cockpit/DOM/Date.now (exportedAt is passed in).
// The bundle is only ever kept in memory/encrypted on disk (see crypto.ts) — never written raw.

export const BACKUP_FILES = ['accounts.json', 'settings.json', 'library.json', 'tabs.json'] as const

export interface ParsedBundle {
  version: number
  exportedAt: number
  files: Record<string, unknown>
  // Optional cached posters/logos, filename → base64 bytes. Present only when the user opted to
  // include them at export time; absent bundles restore exactly as before (backward compatible).
  posters?: Record<string, string>
}

export function buildBundle(
  files: Record<string, unknown>,
  exportedAt: number,
  posters?: Record<string, string>,
): string {
  const bundle: Record<string, unknown> = { app: 'inflighttv', kind: 'backup', version: 1, exportedAt, files }
  if (posters && Object.keys(posters).length > 0) bundle.posters = posters
  return JSON.stringify(bundle)
}

export function parseBundle(text: string): ParsedBundle {
  let o: any
  try {
    o = JSON.parse(text)
  } catch {
    throw new Error('Not a valid backup file')
  }
  if (!o || o.app !== 'inflighttv' || o.kind !== 'backup' || !o.files || typeof o.files !== 'object') {
    throw new Error('Not a valid backup file')
  }
  const posters = o.posters && typeof o.posters === 'object' ? (o.posters as Record<string, string>) : undefined
  return { version: o.version, exportedAt: o.exportedAt, files: o.files, posters }
}
