import cockpit from 'cockpit'
import { pickAsset, type ReleaseAsset } from '@/core/update/release'

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

// `repo`/`tag` are normalizeRepo()'d / release tags (owner/repo, vX.Y.Z) — safe in an argv/URL.
const API = 'https://api.github.com/repos/'

async function ghAvailable(): Promise<boolean> {
  try {
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

// Single-quote a value for safe embedding in an sh -c string.
function q(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

// Privileged install: copy the built dist into place + restart Cockpit detached. iftv's release
// zip is the built plugin (top-level inflighttv/…), so this is a copy — NOT `make install`.
function installScript(zip: string, version: string): string {
  return [
    'set -e',
    'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'echo "== IF TV plugin self-update =="',
    `echo "Installing v${version} ..."`,
    'command -v unzip >/dev/null 2>&1 || { echo "ERROR: unzip not installed"; exit 1; }',
    'TMP="$(mktemp -d)"',
    `unzip -oq ${q(zip)} -d "$TMP"`,
    '[ -f "$TMP/inflighttv/manifest.json" ] || { echo "ERROR: archive has no inflighttv/manifest.json"; rm -rf "$TMP"; exit 1; }',
    'rm -rf /usr/share/cockpit/inflighttv',
    'mkdir -p /usr/share/cockpit/inflighttv',
    'cp -r "$TMP/inflighttv/." /usr/share/cockpit/inflighttv/',
    'install -d /etc/cockpit/inflighttv',
    `printf '%s\\n' ${q(version)} > /etc/cockpit/inflighttv/installed-version`,
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
}

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
      return toRelease(await cockpit.spawn(['sh', '-c', `curl -fsSL ${q(API + repo + '/releases/latest')}`], { err: 'message' }))
    } catch {
      return null
    }
  },

  async downloadReleaseZip(repo, tag) {
    const tmp = (await cockpit.spawn(['mktemp', '-d'], { err: 'message' })).trim()
    if (await ghAvailable()) {
      await cockpit.spawn(
        ['env', 'GH_PROMPT_DISABLED=1', 'gh', 'release', 'download', tag, '-R', repo, '--pattern', 'inflighttv-*.zip', '--dir', tmp, '--clobber'],
        { err: 'message' },
      )
    } else {
      const meta = await cockpit.spawn(['sh', '-c', `curl -fsSL ${q(API + repo + '/releases/tags/' + tag)}`], { err: 'message' })
      const asset = pickAsset(JSON.parse(meta).assets || [])
      if (!asset) throw new Error(`release ${tag} has no inflighttv-*.zip asset`)
      await cockpit.spawn(['sh', '-c', `curl -fsSL -o ${q(tmp + '/' + asset.name)} ${q(asset.browser_download_url)}`], { err: 'message' })
    }
    const found = (await cockpit.spawn(['sh', '-c', `ls -1 ${q(tmp)}/inflighttv-*.zip 2>/dev/null | head -1`], { err: 'message' })).trim()
    if (!found) throw new Error('no inflighttv-*.zip was downloaded')
    return found
  },

  runInstall(zipPath, version, onLine) {
    const proc = cockpit.spawn(['sh', '-c', installScript(zipPath, version)], { superuser: 'require', err: 'out' })
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
