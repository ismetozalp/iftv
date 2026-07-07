import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '@/core/storage/appState'
import { gatherFiles, restoreFiles } from './cockpitBackup'

describe('cockpitBackup', () => {
  it('gathers only the backup files present in the store, skipping absent ones', async () => {
    const mem = createMemoryStore({
      'accounts.json': { accounts: [{ id: 'a1' }] },
      'settings.json': { bufferSeconds: 30 },
      'library.json': { favorites: ['x'] },
      'tabs.json': { openTabIds: ['a1'], activeTabId: 'a1' },
    })
    const files = await gatherFiles(mem)
    expect(files).toEqual({
      'accounts.json': { accounts: [{ id: 'a1' }] },
      'settings.json': { bufferSeconds: 30 },
      'library.json': { favorites: ['x'] },
      'tabs.json': { openTabIds: ['a1'], activeTabId: 'a1' },
    })
  })

  it('skips backup files absent from the store', async () => {
    const mem = createMemoryStore({ 'accounts.json': { accounts: [] } })
    const files = await gatherFiles(mem)
    expect(files).toEqual({ 'accounts.json': { accounts: [] } })
  })

  it('restoreFiles writes the given files back to the store (round-trip)', async () => {
    const mem = createMemoryStore()
    const files = {
      'accounts.json': { accounts: [{ id: 'a1' }] },
      'settings.json': { bufferSeconds: 45 },
    }
    await restoreFiles(files, mem)
    expect(await gatherFiles(mem)).toEqual(files)
  })

  it('restoreFiles ignores unknown keys not in BACKUP_FILES', async () => {
    const mem = createMemoryStore()
    await restoreFiles({ 'accounts.json': { accounts: [] }, 'not-a-backup-file.json': { x: 1 } }, mem)
    expect(await mem.load('not-a-backup-file.json', null)).toBeNull()
    expect(await mem.load('accounts.json', null)).toEqual({ accounts: [] })
  })
})
