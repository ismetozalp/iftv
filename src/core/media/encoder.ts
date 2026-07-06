export type TranscodeMode = 'auto' | 'gpu' | 'software' | 'off'

export interface EncoderTest {
  nvenc: boolean
  x264: boolean
  testedAt: number
}

export function resolveEncoder(mode: TranscodeMode, test: EncoderTest | null): 'nvenc' | 'x264' {
  if (mode === 'gpu') return 'nvenc'
  if (mode === 'software' || mode === 'off') return 'x264'
  return test?.nvenc ? 'nvenc' : 'x264' // auto
}
