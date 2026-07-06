import { describe, expect, it } from 'vitest'
import { normalizeChannelName as n } from './normalize'

describe('normalizeChannelName', () => {
  it('strips country prefix + quality tags + diacritics, lowercases', () => {
    expect(n('TR: TRT SPOR HD')).toBe('trt spor')
    expect(n('TRT SPOR HD')).toBe('trt spor') // feed side matches panel side
    expect(n('TR | Show TV FHD')).toBe('show tv')
    expect(n('ATV HD')).toBe('atv')
    expect(n('TR: beIN SPORTS 1 HQ')).toBe('bein sports 1') // HQ/RAW/MULTI also stripped (real panel variants)
    expect(n('KANAL D')).toBe('kanal d')
    expect(n('İ Ş Ğ Ü Ö Ç ı')).toBe('i s g u o c i') // Turkish letter folding
    expect(n('  Star   TV  4K ')).toBe('star tv')
  })
})
