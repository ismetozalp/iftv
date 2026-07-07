import { describe, expect, it } from 'vitest'
import { encryptBackup, decryptBackup } from './crypto'

describe('crypto', () => {
  it('round-trips plaintext with the right password', async () => {
    const env = await encryptBackup('secret-data-💾', 'hunter2')
    expect(env).not.toContain('secret-data') // ciphertext, not plaintext
    expect(await decryptBackup(env, 'hunter2')).toBe('secret-data-💾')
  })

  it('wrong password throws', async () => {
    const env = await encryptBackup('x', 'right')
    await expect(decryptBackup(env, 'wrong')).rejects.toThrow()
  })

  it('tampered ciphertext throws (GCM auth)', async () => {
    const env = JSON.parse(await encryptBackup('x', 'p'))
    env.ct = env.ct.slice(0, -4) + 'AAAA'
    await expect(decryptBackup(JSON.stringify(env), 'p')).rejects.toThrow()
  })

  it('envelope carries kdf params + is not plaintext', async () => {
    const env = JSON.parse(await encryptBackup('hello', 'p'))
    expect(env).toMatchObject({
      kind: 'backup-enc',
      v: 1,
      cipher: 'AES-GCM',
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 },
    })
    expect(env.salt && env.iv && env.ct).toBeTruthy()
  })

  it('two exports of the same data differ (random salt+iv)', async () => {
    expect(await encryptBackup('x', 'p')).not.toBe(await encryptBackup('x', 'p'))
  })
})
