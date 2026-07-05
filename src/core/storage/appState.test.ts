import { describe, it, expect } from 'vitest'
import { createMemoryStore } from './appState'

describe('createMemoryStore', () => {
  it('returns fallback when key is absent', async () => {
    const s = createMemoryStore()
    expect(await s.load('accounts', { x: 1 })).toEqual({ x: 1 })
  })

  it('persists and reloads a value', async () => {
    const s = createMemoryStore()
    await s.save('accounts', { list: ['a'] })
    expect(await s.load('accounts', null)).toEqual({ list: ['a'] })
  })

  it('deep-clones on save and load (no shared references)', async () => {
    const s = createMemoryStore()
    const obj = { n: 1 }
    await s.save('k', obj)
    obj.n = 2
    const loaded = await s.load<{ n: number }>('k', { n: 0 })
    expect(loaded.n).toBe(1)
  })

  it('honors seed data', async () => {
    const s = createMemoryStore({ settings: { theme: 'auto' } })
    expect(await s.load('settings', null)).toEqual({ theme: 'auto' })
  })
})
