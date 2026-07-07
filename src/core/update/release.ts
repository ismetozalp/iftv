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
  // Keep only the first two path segments (owner/repo). Each must be a plain GitHub-ish slug
  // ([A-Za-z0-9._-]) — this rejects spaces, shell metacharacters, and leading '-' so the value is
  // safe to place in an argv/URL (no command- or argument-injection). Anything else → default.
  const parts = r.split('/').filter(Boolean)
  const seg = /^[A-Za-z0-9][A-Za-z0-9._-]*$/ // must start alphanumeric (rejects leading '-'/'.')
  if (parts.length >= 2 && seg.test(parts[0]) && seg.test(parts[1])) return `${parts[0]}/${parts[1]}`
  return DEFAULT_REPO
}

// A release tag safe to pass as an argv (e.g. to `gh release download`): starts alphanumeric,
// then word/dot/plus/hyphen. Rejects leading '-' (flag smuggling) and shell metacharacters.
export function isSafeTag(tag: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(String(tag))
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
