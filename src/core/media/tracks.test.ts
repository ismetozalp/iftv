import { describe, it, expect } from 'vitest'
import { parseTracks } from './tracks'

const streams = [
  { codec_type: 'video', codec_name: 'h264' },
  { codec_type: 'audio', codec_name: 'aac', tags: { language: 'tur' } },
  { codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } },
  { codec_type: 'subtitle', codec_name: 'dvb_subtitle', tags: { language: 'tur' } },
  { codec_type: 'video', codec_name: 'png' }, // embedded poster — ignored
]

describe('parseTracks', () => {
  it('extracts type-relative audio + subtitle tracks, flags text vs bitmap', () => {
    const t = parseTracks(streams)
    expect(t.audio).toEqual([{ index: 0, language: 'tur', codec: 'aac' }])
    expect(t.subtitles).toEqual([
      { index: 0, language: 'eng', codec: 'subrip', text: true },
      { index: 1, language: 'tur', codec: 'dvb_subtitle', text: false },
    ])
  })

  it('handles missing tags/empty', () => {
    expect(parseTracks([{ codec_type: 'audio', codec_name: 'aac' }]).audio[0].language).toBe('')
    expect(parseTracks([])).toEqual({ audio: [], subtitles: [] })
  })
})
