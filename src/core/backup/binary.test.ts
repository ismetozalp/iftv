import { describe, it, expect } from 'vitest'
import { bytesToBase64, base64ToBytes } from './binary'

describe('backup binary base64', () => {
  it('round-trips an empty array', () => {
    expect(Array.from(base64ToBytes(bytesToBase64(new Uint8Array([]))))).toEqual([])
  })
  it('round-trips small bytes', () => {
    const b = new Uint8Array([0, 1, 2, 255, 128, 77])
    expect(Array.from(base64ToBytes(bytesToBase64(b)))).toEqual(Array.from(b))
  })
  it('round-trips a large array (past the 0x8000 chunk boundary)', () => {
    const b = new Uint8Array(100000)
    for (let i = 0; i < b.length; i++) b[i] = i % 256
    const back = base64ToBytes(bytesToBase64(b))
    expect(back.length).toBe(b.length)
    expect(back[0]).toBe(0)
    expect(back[99999]).toBe(99999 % 256)
  })
})
