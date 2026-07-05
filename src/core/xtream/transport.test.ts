import { describe, it, expect } from 'vitest'
import { buildPlayerApiParams, type XtreamTransport } from './transport'

describe('buildPlayerApiParams', () => {
  it('includes credentials', () => {
    expect(buildPlayerApiParams('u', 'p')).toEqual({ username: 'u', password: 'p' })
  })
  it('merges extra params', () => {
    expect(buildPlayerApiParams('u', 'p', { action: 'get_live_streams' })).toEqual({
      username: 'u', password: 'p', action: 'get_live_streams',
    })
  })
})

describe('XtreamTransport contract', () => {
  it('a fake transport can satisfy the interface', async () => {
    const fake: XtreamTransport = {
      async getJson(base, path, params) {
        return { base, path, params }
      },
    }
    const out = await fake.getJson({ scheme: 'http', host: 'h', port: 80 }, '/player_api.php', { username: 'u' })
    expect(out).toEqual({ base: { scheme: 'http', host: 'h', port: 80 }, path: '/player_api.php', params: { username: 'u' } })
  })
})
