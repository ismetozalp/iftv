import { describe, it, expect, vi } from 'vitest'

describe('APP_VERSION', () => {
  it('exposes the baked __IFTV_VERSION__ (or "" when undefined)', async () => {
    vi.stubGlobal('__IFTV_VERSION__', '9.9.9')
    vi.resetModules()
    const { APP_VERSION } = await import('./version')
    expect(APP_VERSION).toBe('9.9.9')
  })
})
