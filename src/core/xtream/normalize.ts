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
  // EPG titles usually arrive base64-encoded, but some panels send plain text.
  // Only decode when the string looks like canonical base64; otherwise return it as-is.
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return s
  try {
    const binary = atob(s)
    if (btoa(binary) !== s) return s // non-canonical base64 → treat as plain text
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
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
