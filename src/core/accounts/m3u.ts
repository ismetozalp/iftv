// Minimal M3U validity check used to verify an m3u-type account is reachable and
// actually a playlist. Full channel parsing belongs to the content-browsing plan.
export function isValidM3u(text: string): boolean {
  return text.replace(/^﻿/, '').trimStart().startsWith('#EXTM3U')
}
