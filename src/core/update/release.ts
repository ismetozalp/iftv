export const DEFAULT_REPO = 'ismetozalp/iftv'

export interface ReleaseAsset {
  name: string
  browser_download_url: string
}

// Accept "owner/repo", a github.com URL, or a releases URL → "owner/repo". Empty → default.
export function normalizeRepo(input: string): string {
  let r = String(input ?? '').trim()
  if (!r) return DEFAULT_REPO
  const m = r.match(/github\.com[/:]([^/]+\/[^/#?]+)/i)
  if (m) r = m[1]
  else r = r.split(/[#?]/)[0] // drop any query/hash on a bare owner/repo
  r = r.replace(/\.git$/i, '').replace(/\/+$/, '')
  // Keep only the first two path segments (owner/repo); anything else → default.
  const parts = r.split('/').filter(Boolean)
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : DEFAULT_REPO
}

export function parseVersion(v: string): number[] {
  return String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
}

export function isNewer(remote: string, local: string): boolean {
  const a = parseVersion(remote)
  const b = parseVersion(local)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0)
    if (d) return d > 0
  }
  return false
}

export function pickAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  return (assets || []).find((a) => /^inflighttv-.*\.zip$/.test(a.name)) ?? null
}
