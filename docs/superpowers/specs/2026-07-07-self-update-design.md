# In-flight TV — GitHub self-update (design spec)

**Date:** 2026-07-07
**Status:** approved

## Goal

Let the plugin update itself from its GitHub releases, exactly like the sibling `explorer`
Cockpit plugin: a version **badge** on the main screen and a **Settings → Plugin update**
section that check `github.com/<owner>/<repo>`'s latest release, and — if newer — download the
built plugin, install it (as root), and restart Cockpit. Default repo: **`ismetozalp/iftv`**.

Faithful to explorer's mechanism, with two deliberate trims: **no "reset settings" option**
(never risk the user's saved accounts) and **no custom-actions framework** (iftv runs the
privileged install command directly via `cockpit`).

## Key adaptation vs explorer

Explorer ships source (incl. `Makefile`) in its release zip, so it installs with `make install`.
**iftv's release zip is the built `dist/`** (`inflighttv-<version>.zip` → `inflighttv/…`, per the
Makefile `zip` target — no Makefile inside). So the privileged install step is a **copy**, not
`make install`:

```
set -e
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
TMP=$(mktemp -d)
unzip -oq <zip> -d "$TMP"
[ -f "$TMP/inflighttv/manifest.json" ] || { echo "ERROR: archive has no inflighttv/manifest.json"; rm -rf "$TMP"; exit 1; }
rm -rf /usr/share/cockpit/inflighttv
mkdir -p /usr/share/cockpit/inflighttv
cp -r "$TMP/inflighttv/." /usr/share/cockpit/inflighttv/
install -d /etc/cockpit/inflighttv
printf '%s\n' "<newVersion>" > /etc/cockpit/inflighttv/installed-version
rm -rf "$TMP"
echo "Installed v<newVersion>. Restarting Cockpit (you will be disconnected briefly)…"
if command -v systemd-run >/dev/null 2>&1; then
  systemd-run --no-block --collect /bin/sh -c 'sleep 2; systemctl restart cockpit || systemctl restart cockpit.socket' >/dev/null 2>&1 ||
  setsid /bin/sh -c 'sleep 2; systemctl restart cockpit || systemctl restart cockpit.socket' </dev/null >/dev/null 2>&1 &
else
  setsid /bin/sh -c 'sleep 2; systemctl restart cockpit || systemctl restart cockpit.socket' </dev/null >/dev/null 2>&1 &
fi
echo "Done. When Cockpit returns, reload this page (Ctrl+Shift+R)."
```

The restart is detached (`systemd-run`/`setsid` + `sleep 2`) so `systemctl restart cockpit` does
not kill the very channel streaming this output before it finishes — identical to explorer.

## Components

### 1. Baked version — `__IFTV_VERSION__`
The running plugin must know its own version. Add a Vite `define` in `vite.config.ts` that reads
the repo-root `VERSION` file at build time:
`define: { __IFTV_VERSION__: JSON.stringify(readFileSync('VERSION','utf8').trim()) }`.
Declare `declare const __IFTV_VERSION__: string` in `src/env.d.ts` (or a `globals.d.ts`). A tiny
`core/version.ts` re-exports it as `APP_VERSION` for the app + tests (tests stub it).

### 2. Pure update logic — `core/update/release.ts` (unit-tested, no cockpit)
- `normalizeRepo(input: string): string` — accept `owner/repo`, a full `github.com/owner/repo[.git]`
  URL, or a releases URL; return `owner/repo` (strip scheme/host/`.git`/trailing slash). Empty →
  falls back to the default `ismetozalp/iftv`.
- `parseVersion(v: string): number[]` — strip a leading `v`, split on `.`, map to ints.
- `isNewer(remote: string, local: string): boolean` — tuple compare, remote > local.
- `pickAsset(assets, /^inflighttv-.*\.zip$/)` — choose the release zip asset.
These are the only version/repo rules and are fully unit-tested.

### 3. Cockpit adapter — `adapters/cockpitUpdate.ts`
Thin wrappers over `cockpit.spawn`/`cockpit.channel` (mirrors explorer's gh-then-curl):
- `fetchLatestRelease(repo): Promise<{ tag: string; version: string; assets: {name,browser_download_url}[] } | null>`
  — try `gh api repos/<repo>/releases/latest` (avoids anon rate limits); on any failure fall back to
  `sh -c "curl -fsSL https://api.github.com/repos/<repo>/releases/latest"`. Parse JSON; return null if
  no `tag_name`. No root needed.
- `downloadReleaseZip(repo, tag): Promise<string>` — `mktemp -d`; `gh release download <tag> -R <repo>
  --pattern 'inflighttv-*.zip' --dir tmp --clobber` if `gh` present, else `curl` the matched asset's
  `browser_download_url` (fetch tag metadata first). Return the local zip path. No root needed.
- `runInstall(zipPath, version, onLine): Promise<number>` — open a `cockpit.channel({ payload:'stream',
  spawn:['sh','-c', <install script above with {zip}/{version} filled>], superuser:'require', err:'out' })`,
  stream each line to `onLine`, resolve with the exit status. Root required (Cockpit prompts for the
  admin password); the detached restart survives the channel closing.
  URLs/paths are passed as separate argv or single-quoted; never interpolate untrusted text into the shell.

### 4. Store — `stores/updater.ts` (Pinia)
State: `checking`, `installing`, `current` (= `APP_VERSION`), `latest: {version,tag}|null`,
`available: boolean`, `error: string`, `log: string[]`, `repo` (getter → `normalizeRepo(settings.updateRepo)`).
Actions:
- `check(manual: boolean)` — guard against concurrency; `fetchLatestRelease(repo)`; set `latest`/`available =
  isNewer(latest, current)`; on `manual` surface outcomes (see badge/section UX); swallow errors when silent.
- `update()` — `downloadReleaseZip` → `runInstall` streaming into `log`; set `installing`; on success the
  UI shows "restarting… reload when Cockpit returns". Never deletes settings/accounts.
- `startupCheck()` — called ~4s after app mount (silent `check(false)`), so the badge can flag availability.

### 5. Settings — `updateRepo`
Add `updateRepo: string` to `PersistedSettings` + store state (default `ismetozalp/iftv`), included in
save/load of `settings.json`. New **"Plugin update"** section in `SettingsView.vue`:
- repo text input (`#iftv-update-repo`, bound to `settings.updateRepo`, placeholder/default `ismetozalp/iftv`),
- current version line ("Installed: v<current>"),
- **Check for updates** button → `updater.check(true)`,
- when `available`: an **Update & restart Cockpit** button (confirm) → `updater.update()`, plus a note
  showing the new version,
- a monospace **output pane** bound to `updater.log` (shown while installing / after).

### 6. Badge — main screen (`App.vue` header)
A small badge in the header (top-right, near ⚙ Settings), e.g. **`IF TV v1.0.0`**. Clicking it:
- runs `updater.check(true)` (chatty). While checking, show "Checking…".
- **up to date** → a brief inline note/toast "You're up to date (v<current>)".
- **update available** → **ask the user** ("Update available: v<new>. Update now and restart Cockpit?").
  On confirm → `updater.update()` (opens Settings' Plugin-update section so the streamed log is visible),
  then the detached Cockpit restart. On cancel → do nothing.
- If `startupCheck` already found an update, the badge shows an **"update available" dot/highlight** before
  it's clicked.

Confirmation uses the existing app confirm affordance (a small inline confirm/modal consistent with the
current UI — no browser `confirm()`).

## Error handling
- No `gh`, anon rate-limited, or network down → check fails gracefully: manual shows the error; silent
  startup check is swallowed (badge stays plain).
- Repo has no releases yet (current state until `make publish`) → "No releases found at <repo>."
- Install failure (bad archive, permission denied, user cancels the sudo prompt) → the non-zero exit +
  stderr stream into the log; `installing` clears; nothing is left half-written beyond the copy step
  (the copy is the last mutating step before restart; a failed copy leaves the previous install intact
  only if it failed before `rm -rf` — acceptable, matching explorer, and the log makes it explicit).
- Version unknown (`APP_VERSION` empty) → checking is disabled with a note (shouldn't happen once baked).

## Testing
- `core/update/release.ts`: unit tests for `normalizeRepo` (plain, URL, `.git`, releases URL, empty→default),
  `parseVersion`, `isNewer` (older/newer/equal/different lengths/`v` prefix), `pickAsset`.
- `stores/updater.ts`: unit tests with injected fake adapter — `check` sets available true/false, manual vs
  silent, error path; `update` streams log + calls install; concurrency guard.
- Adapter (`cockpitUpdate.ts`) is thin and cockpit-bound → covered by an E2E smoke: the **Settings section
  renders**, **Check for updates** runs against `ismetozalp/iftv` and reports a result (currently "no
  releases found"), and the **badge** shows `v1.0.0` and responds to a click. Full download+install+restart
  is validated manually against a real cut release (out of automated scope — it restarts Cockpit).

## Out of scope (v1)
Reset/delete-settings during update; auto-apply without confirmation; downgrade/pinning; release channels;
verifying signatures/checksums of the downloaded zip (trusts the configured GitHub repo, like explorer).
