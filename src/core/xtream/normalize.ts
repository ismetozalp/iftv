export function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function toBool01(v: unknown): boolean {
  return v === 1 || v === '1' || v === true || v === 'true'
}

export function decodeB64(v: unknown): string {
  const s = toStr(v)
  if (!s) return ''
  try {
    const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return s
  }
}

export function parseXtreamUrl(url: string): { scheme: 'http' | 'https'; host: string; port: number } {
  const u = new URL(url)
  const scheme = u.protocol === 'https:' ? 'https' : 'http'
  const port = u.port ? Number(u.port) : scheme === 'https' ? 443 : 80
  return { scheme, host: u.hostname, port }
}
