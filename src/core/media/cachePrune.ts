export interface DirEntry {
  id: string
  sizeBytes: number
  mtime: number
}

// Delete oldest-first (by mtime) until total <= limit; NEVER the active session (keepId).
export function selectDirsToPrune(entries: DirEntry[], limitBytes: number, keepId: string): string[] {
  let total = entries.reduce((s, e) => s + e.sizeBytes, 0)
  if (total <= limitBytes) return []
  const victims = entries.filter((e) => e.id !== keepId).sort((a, b) => a.mtime - b.mtime)
  const out: string[] = []
  for (const v of victims) {
    if (total <= limitBytes) break
    out.push(v.id)
    total -= v.sizeBytes
  }
  return out
}
