import { describe, expect, it } from 'vitest'
import { parseXmltv } from './parseXmltv'

const XML = `<?xml version="1.0"?><tv>
<channel id="TRT.1.HD.tr"><display-name>TRT 1 HD</display-name><display-name>TRT1</display-name></channel>
<programme start="20260706120000 +0300" stop="20260706130000 +0300" channel="TRT.1.HD.tr"><title lang="tr">Haber &amp; Spor</title><desc lang="tr">Günün haberleri</desc></programme>
<programme start="20260706130000 +0300" stop="20260706140000 +0300" channel="TRT.1.HD.tr"><title>Dizi</title></programme></tv>`

describe('parseXmltv', () => {
  it('parses channels, programmes, entities, tz offset → ms', () => {
    const p = parseXmltv(XML)
    expect(p.channels[0]).toEqual({ id: 'TRT.1.HD.tr', names: ['TRT 1 HD', 'TRT1'] })
    expect(p.programmes[0].title).toBe('Haber & Spor')
    expect(p.programmes[0].desc).toBe('Günün haberleri')
    expect(p.programmes[0].startMs).toBe(Date.UTC(2026, 6, 6, 9, 0, 0)) // 12:00 +03:00 == 09:00 UTC
    expect(p.programmes[1].desc).toBe('') // missing desc tolerated
  })

  it('decodes remaining XML entities and skips malformed programmes without throwing', () => {
    const xml = `<tv>
<channel id="c1"><display-name>Quotes &quot;Q&quot; &#39;A&#39; &lt;tag&gt; &#65;</display-name></channel>
<programme start="not-a-date" stop="20260706130000 +0300" channel="c1"><title>Bad</title></programme>
<programme start="20260706120000 +0300" stop="20260706130000 +0300" channel="c1"><title>Good</title></programme>
</tv>`
    expect(() => parseXmltv(xml)).not.toThrow()
    const p = parseXmltv(xml)
    expect(p.channels[0].names[0]).toBe('Quotes "Q" \'A\' <tag> A')
    expect(p.programmes.length).toBe(1)
    expect(p.programmes[0].title).toBe('Good')
  })

  it('parses programme attributes regardless of order (channel-first source)', () => {
    const xml = `<tv><programme channel="c1" stop="20260706130000 +0300" start="20260706120000 +0300"><title>Ordered</title></programme></tv>`
    const p = parseXmltv(xml)
    expect(p.programmes.length).toBe(1)
    expect(p.programmes[0]).toMatchObject({ channelId: 'c1', title: 'Ordered', startMs: Date.UTC(2026, 6, 6, 9, 0, 0) })
  })
})
