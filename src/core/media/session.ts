export function cacheRoot(home: string): string {
  return `${home}/.cache/inflighttv`
}
export function sessionDir(root: string, id: string): string {
  return `${root}/${id}`
}
export function playlistPath(dir: string): string {
  return `${dir}/index.m3u8`
}
export function segmentPattern(dir: string): string {
  return `${dir}/seg_%05d.ts`
}
// hls.js loads this fake URL; segment URIs in the playlist resolve against it.
export function sourceUrl(id: string): string {
  return `iftv://${id}/index.m3u8`
}
export function fileNameFromUrl(url: string): string {
  return (url.split('/').pop() ?? '').split('?')[0]
}
export function resolveInDir(dir: string, url: string): string {
  return `${dir}/${fileNameFromUrl(url)}`
}
