import type { Account } from '@/core/accounts/accounts'
import { parseXtreamUrl } from '@/core/xtream/normalize'

// Resolve the XMLTV EPG URL for an account, in priority order:
//   1. a manual per-account URL (Account.epgUrl) — always wins,
//   2. the provider's own guide — Xtream `xmltv.php`, or an M3U's declared `url-tvg` (tvgUrl),
//   3. the global fallback (Settings default EPG URL) — may be '' (⇒ no guide for that account).
export function resolveEpgUrl(account: Account, globalUrl: string, tvgUrl: string): string {
  const manual = (account.epgUrl ?? '').trim()
  if (manual) return manual
  if (account.type === 'xtream') {
    try {
      const { scheme, host, port } = parseXtreamUrl(account.url)
      const u = `${encodeURIComponent(account.username)}`
      const p = `${encodeURIComponent(account.password)}`
      return `${scheme}://${host}:${port}/xmltv.php?username=${u}&password=${p}`
    } catch {
      /* malformed account URL → fall through to the global fallback */
    }
  }
  if (account.type === 'm3u' && tvgUrl.trim()) return tvgUrl.trim()
  return (globalUrl ?? '').trim()
}
