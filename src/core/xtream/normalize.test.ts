import { describe, it, expect } from 'vitest'
import { toStr, toNum, toBool01, decodeB64, parseXtreamUrl } from './normalize'

describe('toStr', () => {
  it('maps nullish to empty string', () => {
    expect(toStr(null)).toBe('')
    expect(toStr(undefined)).toBe('')
    expect(toStr(5)).toBe('5')
    expect(toStr('x')).toBe('x')
  })
})

describe('toNum', () => {
  it('parses numeric strings and numbers', () => {
    expect(toNum('42')).toBe(42)
    expect(toNum(42)).toBe(42)
    expect(toNum('3.5')).toBe(3.5)
  })
  it('returns null for non-numeric', () => {
    expect(toNum('abc')).toBeNull()
    expect(toNum(null)).toBeNull()
    expect(toNum('')).toBeNull()
  })
})

describe('toBool01', () => {
  it('treats 1/"1"/true as true, else false', () => {
    expect(toBool01(1)).toBe(true)
    expect(toBool01('1')).toBe(true)
    expect(toBool01(true)).toBe(true)
    expect(toBool01(0)).toBe(false)
    expect(toBool01('0')).toBe(false)
    expect(toBool01(null)).toBe(false)
  })
})

describe('decodeB64', () => {
  it('decodes base64 to utf-8', () => {
    // "Hello" base64 = SGVsbG8=
    expect(decodeB64('SGVsbG8=')).toBe('Hello')
  })
  it('returns empty for empty input', () => {
    expect(decodeB64('')).toBe('')
    expect(decodeB64(null)).toBe('')
  })
  it('returns plain text unchanged when it is not valid base64', () => {
    expect(decodeB64('News Update')).toBe('News Update')   // space → not base64
    expect(decodeB64('Hello World!')).toBe('Hello World!') // punctuation → not base64
  })
})

describe('parseXtreamUrl', () => {
  it('parses scheme/host/port', () => {
    expect(parseXtreamUrl('http://host.example:8080')).toEqual({ scheme: 'http', host: 'host.example', port: 8080 })
  })
  it('defaults ports by scheme', () => {
    expect(parseXtreamUrl('http://host')).toEqual({ scheme: 'http', host: 'host', port: 80 })
    expect(parseXtreamUrl('https://host')).toEqual({ scheme: 'https', host: 'host', port: 443 })
  })
  it('tolerates trailing slash and path', () => {
    expect(parseXtreamUrl('http://host:8000/')).toEqual({ scheme: 'http', host: 'host', port: 8000 })
  })
})
