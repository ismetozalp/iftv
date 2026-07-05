import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorkspaceStore } from './workspace'
import { createMemoryStore } from '@/core/storage/appState'
import type { XtreamTransport } from '@/core/xtream/transport'

const NEW = { name: 'P1', url: 'http://h:8080', username: 'u', password: 'p' }

function transport(auth: number, status = 'Active'): XtreamTransport {
  return { getJson: vi.fn(async () => ({ user_info: { auth, status } })), fetchText: async () => '' }
}
function seq() {
  let n = 0
  return () => ({ id: `id${++n}`, createdAt: n })
}

describe('useWorkspaceStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('init on empty store yields no accounts and no active tab', async () => {
    const s = useWorkspaceStore()
    s.$configure({ store: createMemoryStore(), transport: transport(1), ids: seq() })
    await s.init()
    expect(s.allAccounts).toHaveLength(0)
    expect(s.openTabs).toHaveLength(0)
    expect(s.activeAccount).toBeNull()
  })

  it('add opens the new account in a tab and makes it active', async () => {
    const s = useWorkspaceStore()
    s.$configure({ store: createMemoryStore(), transport: transport(1), ids: seq() })
    await s.init()
    await s.add(NEW, false)
    expect(s.allAccounts).toHaveLength(1)
    expect(s.openTabs.map((a) => a.id)).toEqual(['id1'])
    expect(s.activeAccount?.name).toBe('P1')
  })

  it('persists accounts and tabs across a reload', async () => {
    const store = createMemoryStore()
    const s = useWorkspaceStore()
    s.$configure({ store, transport: transport(1), ids: seq() })
    await s.init()
    await s.add(NEW, false)
    const s2 = useWorkspaceStore()
    s2.$configure({ store, transport: transport(1), ids: seq() })
    await s2.init()
    expect(s2.allAccounts).toHaveLength(1)
    expect(s2.activeAccount?.id).toBe('id1')
  })

  it('auto-opens a sole account on init even when no tabs were stored', async () => {
    const store = createMemoryStore()
    await store.save('accounts.json', {
      accounts: [{ id: 'solo', name: 'S', url: 'http://h', username: 'u', password: 'p', createdAt: 1 }],
    })
    const s = useWorkspaceStore()
    s.$configure({ store, transport: transport(1), ids: seq() })
    await s.init()
    expect(s.openTabs.map((a) => a.id)).toEqual(['solo'])
    expect(s.activeAccount?.id).toBe('solo')
  })

  it('add with verify=true throws and adds nothing when inactive', async () => {
    const s = useWorkspaceStore()
    s.$configure({ store: createMemoryStore(), transport: transport(0), ids: seq() })
    await s.init()
    await expect(s.add(NEW, true)).rejects.toThrow(/not active/i)
    expect(s.allAccounts).toHaveLength(0)
  })

  it('close hides a tab without deleting the account; open re-adds it', async () => {
    const s = useWorkspaceStore()
    s.$configure({ store: createMemoryStore(), transport: transport(1), ids: seq() })
    await s.init()
    await s.add(NEW, false)
    await s.add({ ...NEW, name: 'P2' }, false)
    await s.close('id1')
    expect(s.openTabs.map((a) => a.id)).toEqual(['id2'])
    expect(s.allAccounts).toHaveLength(2)
    await s.open('id1')
    expect(s.openTabs.map((a) => a.id)).toEqual(['id2', 'id1'])
    expect(s.activeAccount?.id).toBe('id1')
  })

  it('remove deletes the account and closes its tab', async () => {
    const s = useWorkspaceStore()
    s.$configure({ store: createMemoryStore(), transport: transport(1), ids: seq() })
    await s.init()
    await s.add(NEW, false)
    await s.remove('id1')
    expect(s.allAccounts).toHaveLength(0)
    expect(s.openTabs).toHaveLength(0)
    expect(s.activeAccount).toBeNull()
  })
})
