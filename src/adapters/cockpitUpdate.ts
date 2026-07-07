import cockpit from 'cockpit'
import { pickAsset, isSafeTag, type ReleaseAsset } from '@/core/update/release'

export interface LatestRelease {
  tag: string
  version: string
  assets: ReleaseAsset[]
}

export interface UpdateAdapter {
  fetchLatestRelease(repo: string): Promise<LatestRelease | null>
  downloadReleaseZip(repo: string, tag: string): Promise<string>
  runInstall(zipPath: string, version: string, onLine: (s: string) => void): Promise<number>
}

// `repo` is always normalizeRepo()'d ("owner/repo" of safe slug chars). `tag` is validated with
// isSafeTag() before use. Values are passed as separate argv (no shell) or as sh positional args
// ($1/$2) — NEVER interpolated into an `sh -c` script — so there is no command/argument injection.
const API = 'https://api.github.com/repos/'

async function ghAvailable(): Promise<boolean> {
  try {
    // Fixed script, no interpolation.
    await cockpit.spawn(['sh', '-c', 'command -v gh'], { err: 'message' })
    return true
  } catch {
    return false
  }
}

function toRelease(json: string): LatestRelease | null {
  const j = JSON.parse(json)
  if (!j || !j.tag_name) return null
  const assets: ReleaseAsset[] = (j.assets || []).map(
    (a: { name: string; browser_download_url: string }) => ({ name: a.name, browser_download_url: a.browser_download_url }),
  )
  return { tag: j.tag_name, version: String(j.tag_name).replace(/^v/i, ''), assets }
}

// Privileged install script. References only positional args: $1 = zip path, $2 = version. It never
// interpolates caller data, so it is injection-proof regardless of the zip path / version contents.
// iftv's release zip is the built plugin (top-level inflighttv/…) → this is a copy, NOT `make install`.
const INSTALL_SCRIPT = [
  'set -e',
  'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'ZIP="$1"; VER="$2"',
  'echo "== IF TV plugin self-update =="',
  'echo "Installing v$VER ..."',
  'command -v unzip >/dev/null 2>&1 || { echo "ERROR: unzip not installed"; exit 1; }',
  'TMP="$(mktemp -d)"',
  'unzip -oq "$ZIP" -d "$TMP"',
  '[ -f "$TMP/inflighttv/manifest.json" ] || { echo "ERROR: archive has no inflighttv/manifest.json"; rm -rf "$TMP"; exit 1; }',
  'rm -rf /usr/share/cockpit/inflighttv',
  'mkdir -p /usr/share/cockpit/inflighttv',
  'cp -r "$TMP/inflighttv/." /usr/share/cockpit/inflighttv/',
  'install -d /etc/cockpit/inflighttv',
  "printf '%s\\n' \"$VER\" > /etc/cockpit/inflighttv/installed-version",
  'rm -rf "$TMP"',
  'echo "Installed. Restarting Cockpit (you will be disconnected briefly)..."',
  'if command -v systemd-run >/dev/null 2>&1; then',
  "  systemd-run --no-block --collect /bin/sh -c 'sleep 2; systemctl restart cockpit || systemctl restart cockpit.socket' >/dev/null 2>&1 || \\",
  "  setsid /bin/sh -c 'sleep 2; systemctl restart cockpit || systemctl restart cockpit.socket' </dev/null >/dev/null 2>&1 &",
  'else',
  "  setsid /bin/sh -c 'sleep 2; systemctl restart cockpit || systemctl restart cockpit.socket' </dev/null >/dev/null 2>&1 &",
  'fi',
  'echo "Done. When Cockpit returns, reload this page (Ctrl+Shift+R)."',
].join('\n')

export const cockpitUpdate: UpdateAdapter = {
  async fetchLatestRelease(repo) {
    if (await ghAvailable()) {
      try {
        return toRelease(await cockpit.spawn(['gh', 'api', `repos/${repo}/releases/latest`], { err: 'message' }))
      } catch {
        /* fall through to anonymous curl */
      }
    }
    try {
      // Direct argv (no shell); `--` ends option parsing so the URL can't be read as a flag.
      return toRelease(await cockpit.spawn(['curl', '-fsSL', '--', `${API}${repo}/releases/latest`], { err: 'message' }))
    } catch {
      return null
    }
  },

  async downloadReleaseZip(repo, tag) {
    if (!isSafeTag(tag)) throw new Error(`unsafe release tag: ${tag}`)
    const tmp = (await cockpit.spawn(['mktemp', '-d'], { err: 'message' })).trim()
    if (await ghAvailable()) {
      // gh args are separate argv; tag is validated (no leading '-') so it can't smuggle a flag.
      await cockpit.spawn(
        ['env', 'GH_PROMPT_DISABLED=1', 'gh', 'release', 'download', tag, '-R', repo, '--pattern', 'inflighttv-*.zip', '--dir', tmp, '--clobber'],
        { err: 'message' },
      )
    } else {
      const meta = await cockpit.spawn(['curl', '-fsSL', '--', `${API}${repo}/releases/tags/${tag}`], { err: 'message' })
      const asset = pickAsset(JSON.parse(meta).assets || [])
      if (!asset) throw new Error(`release ${tag} has no inflighttv-*.zip asset`)
      if (asset.name.includes('/') || asset.name.includes('..')) throw new Error('unsafe asset name')
      await cockpit.spawn(['curl', '-fsSL', '-o', `${tmp}/${asset.name}`, '--', asset.browser_download_url], { err: 'message' })
    }
    // Glob needs a shell; pass tmp as a positional arg ($1) so it is never interpolated.
    const found = (
      await cockpit.spawn(['sh', '-c', 'ls -1 "$1"/inflighttv-*.zip 2>/dev/null | head -1', 'sh', tmp], { err: 'message' })
    ).trim()
    if (!found) throw new Error('no inflighttv-*.zip was downloaded')
    return found
  },

  runInstall(zipPath, version, onLine) {
    // zipPath/version passed as sh positional args ($1/$2) — never interpolated into the script.
    const proc = cockpit.spawn(['sh', '-c', INSTALL_SCRIPT, 'sh', zipPath, version], { superuser: 'require', err: 'out' })
    let buf = ''
    proc.stream((data: string) => {
      buf += data
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) onLine(l)
    })
    return proc.then(
      () => {
        if (buf) onLine(buf)
        return 0
      },
      (e: { exit_status?: number; message?: string }) => {
        if (buf) onLine(buf)
        onLine(`error: ${e?.message ?? 'install failed'}`)
        return typeof e?.exit_status === 'number' ? e.exit_status : 1
      },
    )
  },
}
