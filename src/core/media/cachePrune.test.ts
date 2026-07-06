import { describe, it, expect } from 'vitest'
import { selectDirsToPrune } from './cachePrune'

const GB = 1024 ** 3

describe('selectDirsToPrune', () => {
  it('under limit → prune nothing', () => {
    expect(selectDirsToPrune([{ id: 'a', sizeBytes: GB, mtime: 1 }], 5 * GB, 'new')).toEqual([])
  })
  it('over limit → delete oldest first until under, never keepId', () => {
    const e = [
      { id: 'new', sizeBytes: 2 * GB, mtime: 9 },
      { id: 'old1', sizeBytes: 2 * GB, mtime: 1 },
      { id: 'old2', sizeBytes: 2 * GB, mtime: 2 },
    ]
    // total 6GB, limit 5GB → must drop 1GB+; oldest is old1 (mtime 1). Dropping old1 → 4GB ≤ 5GB.
    expect(selectDirsToPrune(e, 5 * GB, 'new')).toEqual(['old1'])
  })
  it('never selects keepId even if it is the biggest/oldest', () => {
    const e = [{ id: 'new', sizeBytes: 10 * GB, mtime: 0 }]
    expect(selectDirsToPrune(e, 1 * GB, 'new')).toEqual([])
  })
})
