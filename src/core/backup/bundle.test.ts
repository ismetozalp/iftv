import { describe, expect, it } from 'vitest'
import { buildBundle, parseBundle, BACKUP_FILES } from './bundle'

describe('bundle', () => {
  it('builds a versioned bundle and round-trips', () => {
    const files = { 'accounts.json': { accounts: [{ id: 'a' }] }, 'settings.json': { bufferSeconds: 30 } }
    const json = buildBundle(files, 1720000000000)
    const b = parseBundle(json)
    expect(b.version).toBe(1)
    expect(b.exportedAt).toBe(1720000000000)
    expect(b.files).toEqual(files)
  })

  it('parseBundle rejects a non-backup / malformed blob', () => {
    expect(() => parseBundle('{"hello":1}')).toThrow()
    expect(() => parseBundle('not json')).toThrow()
    expect(() =>
      parseBundle(JSON.stringify({ app: 'inflighttv', kind: 'backup', version: 1, exportedAt: 0 }))
    ).toThrow() // no files
  })

  it('BACKUP_FILES is the 4 config files (no epg cache)', () => {
    expect(BACKUP_FILES).toEqual(['accounts.json', 'settings.json', 'library.json', 'tabs.json'])
  })

  it('omits posters when none given (backward-compatible bundle)', () => {
    const json = buildBundle({ 'settings.json': {} }, 1)
    expect(JSON.parse(json).posters).toBeUndefined()
    expect(parseBundle(json).posters).toBeUndefined()
  })

  it('round-trips an optional posters map', () => {
    const posters = { deadbeef: 'AAEC', cafef00d: 'Zm9v' }
    const json = buildBundle({ 'settings.json': {} }, 1, posters)
    expect(parseBundle(json).posters).toEqual(posters)
  })
})
