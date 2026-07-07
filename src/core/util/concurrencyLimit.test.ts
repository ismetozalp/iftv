import { describe, it, expect } from 'vitest'
import { createLimiter } from './concurrencyLimit'

describe('createLimiter', () => {
  it('never runs more than `max` tasks concurrently and completes them all', async () => {
    const lim = createLimiter(3)
    let active = 0
    let maxActive = 0
    const defer = () => { let r!: () => void; const p = new Promise<void>((res) => (r = res)); return { p, r } }
    const gates = Array.from({ length: 10 }, defer)
    const results: number[] = []
    const runs = gates.map((g, i) =>
      lim.run(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await g.p
        active--
        results.push(i)
        return i
      }),
    )
    // at this microtask point at most 3 should have started
    await Promise.resolve()
    expect(active).toBe(3)
    // release them one at a time; concurrency must never exceed 3
    for (const g of gates) { g.r(); await Promise.resolve(); await Promise.resolve() }
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(maxActive).toBe(3)
  })

  it('a rejecting task frees its slot (does not deadlock the queue)', async () => {
    const lim = createLimiter(1)
    await expect(lim.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await lim.run(async () => 'ok')).toBe('ok') // slot freed → next task runs
  })
})
