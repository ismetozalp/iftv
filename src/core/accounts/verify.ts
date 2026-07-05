import type { NewAccount } from './accounts'
import type { XtreamAuth } from '@/core/xtream/auth'
import { isValidM3u } from './m3u'

export interface VerifyResult {
  ok: boolean
  detail: string
}

export interface VerifyDeps {
  xtreamLogin(url: string, username: string, password: string): Promise<XtreamAuth>
  fetchText(url: string): Promise<string>
}

export async function verifyAccount(input: NewAccount, deps: VerifyDeps): Promise<VerifyResult> {
  if (input.type === 'm3u') {
    let text: string
    try {
      text = await deps.fetchText(input.url)
    } catch {
      return { ok: false, detail: 'Could not reach the playlist URL' }
    }
    return isValidM3u(text)
      ? { ok: true, detail: 'Valid M3U playlist' }
      : { ok: false, detail: 'Not a valid M3U playlist (missing #EXTM3U)' }
  }
  let auth: XtreamAuth
  try {
    auth = await deps.xtreamLogin(input.url, input.username, input.password)
  } catch {
    return { ok: false, detail: 'Could not reach the Xtream panel' }
  }
  return auth.active
    ? { ok: true, detail: 'Account active' }
    : { ok: false, detail: `Account not active (auth=${auth.auth}, status="${auth.status}")` }
}
