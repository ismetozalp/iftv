// Plaintext backup bundle — build/parse. Pure, no cockpit/DOM/Date.now (exportedAt is passed in).
// The bundle is only ever kept in memory/encrypted on disk (see crypto.ts) — never written raw.

export const BACKUP_FILES = ['accounts.json', 'settings.json', 'library.json', 'tabs.json'] as const

export interface ParsedBundle {
  version: number
  exportedAt: number
  files: Record<string, unknown>
}

export function buildBundle(files: Record<string, unknown>, exportedAt: number): string {
  return JSON.stringify({ app: 'inflighttv', kind: 'backup', version: 1, exportedAt, files })
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
  return { version: o.version, exportedAt: o.exportedAt, files: o.files }
}
