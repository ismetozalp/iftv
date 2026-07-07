import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUpdaterStore } from './updater'
import type { UpdateAdapter, LatestRelease } from '@/adapters/cockpitUpdate'

vi.mock('@/core/version', () => ({ APP_VERSION: '1.0.0' }))

function fakeAdapter(over: Partial<UpdateAdapter> = {}): UpdateAdapter {
  return {
    fetchLatestRelease: async () => null,
    downloadReleaseZip: async () => '/tmp/x/inflighttv-1.1.0.zip',
    runInstall: async (_z, _v, onLine) => {
      onLine('Installing')
      onLine('Done.')
      return 0
    },
    ...over,
  }
}
const rel = (version: string): LatestRelease => ({ tag: `v${version}`, version, assets: [] })

describe('updater store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('check(): no newer release → not available', async () => {
    const u = useUpdaterStore()
    u.$configure(fakeAdapter({ fetchLatestRelease: async () => rel('1.0.0') }))
    await u.check(true)
    expect(u.available).toBe(false)
    expect(u.latest?.version).toBe('1.0.0')
  })

  it('check(): newer release → available + latest set', async () => {
    const u = useUpdaterStore()
    u.$configure(fakeAdapter({ fetchLatestRelease: async () => rel('1.1.0') }))
    await u.check(true)
    expect(u.available).toBe(true)
    expect(u.latest?.version).toBe('1.1.0')
  })

  it('check(): no releases → error surfaced only when manual', async () => {
    const u = useUpdaterStore()
    u.$configure(fakeAdapter({ fetchLatestRelease: async () => null }))
    await u.check(false)
    expect(u.error).toBe('')
    await u.check(true)
    expect(u.error).toMatch(/no releases/i)
  })

  it('update(): streams the install log and marks installing', async () => {
    const u = useUpdaterStore()
    u.$configure(fakeAdapter({ fetchLatestRelease: async () => rel('1.1.0') }))
    await u.check(true)
    await u.update()
    expect(u.log.join('\n')).toContain('Done.')
  })

  it('check() is guarded against concurrent runs', async () => {
    let calls = 0
    const u = useUpdaterStore()
    u.$configure(
      fakeAdapter({
        fetchLatestRelease: async () => {
          calls++
          await new Promise((r) => setTimeout(r, 5))
          return rel('1.0.0')
        },
      }),
    )
    await Promise.all([u.check(false), u.check(false)])
    expect(calls).toBe(1)
  })
})
