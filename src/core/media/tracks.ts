export interface AudioTrack {
  index: number
  language: string
  codec: string
}
export interface SubtitleTrack {
  index: number
  language: string
  codec: string
  text: boolean
}

const TEXT_SUBS = new Set(['subrip', 'mov_text', 'webvtt', 'ass', 'ssa', 'text'])

function lang(s: Record<string, unknown>): string {
  const tags = (s.tags && typeof s.tags === 'object' ? s.tags : {}) as Record<string, unknown>
  return String(tags.language || tags.LANGUAGE || '')
}

export function parseTracks(streams: unknown[]): { audio: AudioTrack[]; subtitles: SubtitleTrack[] } {
  const audio: AudioTrack[] = []
  const subtitles: SubtitleTrack[] = []
  for (const raw of Array.isArray(streams) ? streams : []) {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const codec = String(s.codec_name || '')
    if (s.codec_type === 'audio') audio.push({ index: audio.length, language: lang(s), codec })
    else if (s.codec_type === 'subtitle')
      subtitles.push({ index: subtitles.length, language: lang(s), codec, text: TEXT_SUBS.has(codec) })
  }
  return { audio, subtitles }
}
