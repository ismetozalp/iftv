import { describe, it, expect, vi } from 'vitest'
import { verifyAccount, type VerifyDeps } from './verify'
import type { XtreamAuth } from '@/core/xtream/auth'

const XTREAM = { type: 'xtream' as const, name: 'P', url: 'http://h:8080', username: 'u', password: 'p' }
const M3U = { type: 'm3u' as const, name: 'F', url: 'http://host/list.m3u', username: '', password: '' }

function deps(over: Partial<VerifyDeps>): VerifyDeps {
  return {
    xtreamLogin: vi.fn(async () => ({ auth: true, status: 'Active', active: true, expDate: null, maxConnections: null, allowedOutputFormats: [] } as XtreamAuth)),
    fetchText: vi.fn(async () => '#EXTM3U\n'),
    ...over,
  }
}

describe('verifyAccount — xtream', () => {
  it('ok when login is active', async () => {
    expect(await verifyAccount(XTREAM, deps({}))).toEqual({ ok: true, detail: expect.any(String) })
  })
  it('fails with status detail when inactive', async () => {
    const d = deps({ xtreamLogin: async () => ({ auth: false, status: 'Disabled', active: false, expDate: null, maxConnections: null, allowedOutputFormats: [] }) })
    const r = await verifyAccount(XTREAM, d)
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/not active/i)
  })
  it('reports connectivity failure clearly (not "not active")', async () => {
    const d = deps({ xtreamLogin: async () => { throw new Error('network') } })
    const r = await verifyAccount(XTREAM, d)
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/could not reach/i)
  })
})

describe('verifyAccount — m3u', () => {
  it('ok for a valid playlist', async () => {
    const r = await verifyAccount(M3U, deps({ fetchText: async () => '#EXTM3U\n#EXTINF:-1,C\nhttp://s/1.ts' }))
    expect(r.ok).toBe(true)
  })
  it('fails for a non-playlist body', async () => {
    const r = await verifyAccount(M3U, deps({ fetchText: async () => '<html>nope</html>' }))
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/not a valid m3u/i)
  })
  it('fails clearly when the URL is unreachable', async () => {
    const r = await verifyAccount(M3U, deps({ fetchText: async () => { throw new Error('dns') } }))
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/could not reach/i)
  })
  it('does not attempt an xtream login for m3u', async () => {
    const login = vi.fn()
    await verifyAccount(M3U, deps({ xtreamLogin: login as never }))
    expect(login).not.toHaveBeenCalled()
  })
})
