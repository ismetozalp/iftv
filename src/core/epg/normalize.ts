// Pure channel-name normalizer — matches XMLTV feed display-names to panel channel
// names regardless of country-prefix/quality-tag noise and Turkish letter casing.
// No imports — keep this file trivially unit-testable.

const TURKISH_LETTERS: Record<string, string> = {
  İ: 'i',
  I: 'i',
  ı: 'i',
  Ş: 's',
  ş: 's',
  Ğ: 'g',
  ğ: 'g',
  Ü: 'u',
  ü: 'u',
  Ö: 'o',
  ö: 'o',
  Ç: 'c',
  ç: 'c',
}

const COUNTRY_PREFIX_RE = /^(?:[A-Z]{2,3}\s*[:|]\s*|\[[A-Z]{2}\]\s*)/
const QUALITY_TOKEN_RE = /\b(?:HD|SD|FHD|UHD|4K|H265|HEVC)\b/g
const NON_ALNUM_RE = /[^a-zA-Z0-9 ]+/g
const MULTI_SPACE_RE = /\s+/g

export function normalizeChannelName(name: string): string {
  const folded = name.replace(/[İIıŞşĞğÜüÖöÇç]/g, (ch) => TURKISH_LETTERS[ch] ?? ch)
  const withoutPrefix = folded.replace(COUNTRY_PREFIX_RE, '')
  const withoutQuality = withoutPrefix.replace(QUALITY_TOKEN_RE, '')
  const alnumOnly = withoutQuality.replace(NON_ALNUM_RE, '')
  const collapsed = alnumOnly.replace(MULTI_SPACE_RE, ' ').trim()
  return collapsed.toLowerCase()
}
