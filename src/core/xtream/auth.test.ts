import { describe, it, expect, vi } from 'vitest'
import { xtreamLogin } from './auth'
import type { XtreamTransport } from './transport'

function transportReturning(payload: unknown): XtreamTransport {
  return { getJson: vi.fn(async () => payload) }
}

describe('xtreamLogin', () => {
  it('reports active on auth=1 + status Active', async () => {
    const t = transportReturning({
      user_info: { auth: 1, status: 'Active', exp_date: '1735689600', max_connections: '2', allowed_output_formats: ['ts', 'm3u8'] },
      server_info: {},
    })
    const res = await xtreamLogin(t, 'http://host:8080', 'u', 'p')
    expect(res).toEqual({
      auth: true, status: 'Active', active: true,
      expDate: 1735689600, maxConnections: 2, allowedOutputFormats: ['ts', 'm3u8'],
    })
  })

  it('reports inactive on auth=0', async () => {
    const t = transportReturning({ user_info: { auth: 0, status: 'Disabled' } })
    const res = await xtreamLogin(t, 'http://host', 'u', 'bad')
    expect(res.active).toBe(false)
    expect(res.auth).toBe(false)
  })

  it('reports inactive on Expired status even if auth=1', async () => {
    const t = transportReturning({ user_info: { auth: 1, status: 'Expired' } })
    const res = await xtreamLogin(t, 'http://host', 'u', 'p')
    expect(res.active).toBe(false)
  })

  it('treats empty/garbage body as inactive', async () => {
    const t = transportReturning(null)
    const res = await xtreamLogin(t, 'http://host', 'u', 'p')
    expect(res.active).toBe(false)
    expect(res.allowedOutputFormats).toEqual([])
  })

  it('calls the transport with parsed base and credentials', async () => {
    const t = transportReturning({ user_info: { auth: 1, status: 'Active' } })
    await xtreamLogin(t, 'https://host.example:443', 'u', 'p')
    expect(t.getJson).toHaveBeenCalledWith(
      { scheme: 'https', host: 'host.example', port: 443 },
      '/player_api.php',
      { username: 'u', password: 'p' },
    )
  })
})
