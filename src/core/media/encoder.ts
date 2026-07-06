export type TranscodeMode = 'auto' | 'gpu' | 'software' | 'off'

export interface EncoderTest {
  nvenc: boolean
  x264: boolean
  testedAt: number
}

export function resolveEncoder(mode: TranscodeMode, test: EncoderTest | null): 'nvenc' | 'x264' {
  if (mode === 'gpu') return 'nvenc'
  if (mode === 'software' || mode === 'off') return 'x264'
  // auto: try GPU first (the player's runtime fallback drops to CPU if nvenc fails), unless a
  // prior self-test explicitly marked nvenc as broken.
  return test && test.nvenc === false ? 'x264' : 'nvenc'
}
