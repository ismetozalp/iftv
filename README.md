# InFlight TV — a Cockpit IPTV client plugin

InFlight TV turns [Cockpit](https://cockpit-project.org/)'s web console into a
full **IPTV client** for your server — Live TV, movies, series, an EPG guide,
and a personal library, streamed straight to your browser. Point it at an
**Xtream Codes** subscription or an **M3U** playlist and watch without leaving
Cockpit or installing a set-top app. Playback is remuxed/transcoded on the host
with `ffmpeg` (the browser only ever sees plain HLS), so it plays codecs the
browser can't decode on its own.

> Named for Cockpit ("in-flight"). It is **not** for aircraft use.

**Highlights**

- 📺 **Live TV, Movies & Series** from Xtream Codes panels or M3U playlists —
  categories, search, channel logos, and instant playback.
- 🗓️ **EPG / TV guide** — now/next on live channels plus a full **channel × time
  guide grid**, from a configurable external XMLTV source (name-matched to your
  channels).
- 👥 **Multiple accounts in tabs** — open several providers at once. Each account
  keeps its **own single connection**; play on one while another keeps running.
- 🔽 **Minimizable player** — dock playback to a bottom bar and keep browsing
  while it plays; restore to full anytime. Seek bar for movies/episodes.
- 🎞️ **Host-side transcoding** — copies H.264 as-is; transcodes what the browser
  can't decode (e.g. HEVC), trying **GPU (NVENC)** first, then **CPU (x264)**.
- 🔊 **Audio & subtitle tracks** — pick the language / subtitle stream per title.
- ⭐ **Personal library** — favorites, custom lists, watch-later, **continue
  watching** (resume where you left off), and history.
- 💾 **Cache & backup** — a relocatable, size-capped segment cache, and an
  **encrypted backup** you can export/import (accounts + settings + library).
- 🎨 **Light / Dark / System theme**, following your Cockpit / OS theme.

Everything runs through Cockpit's own bridge (`cockpit.spawn`/`cockpit.file`);
there's no extra server daemon. The plugin targets
`/usr/share/cockpit/inflighttv/`.

---

## Disclaimer

This project was generated with AI (Anthropic's Claude Opus models). It's
something built for personal use and shared as-is — nothing more. There are
**no guarantees** of any kind: it may have bugs, and it's provided without
warranty.

You're welcome to open tickets for bug fixes or feature requests, but please
understand there's **no promise that they'll be answered or acted on** — this
isn't a maintained product, just a personal project.

You are free to do whatever you like with it — use it, modify it, fork it,
redistribute it. **Bring your own IPTV subscription / playlist**; none is
included, and this project is not affiliated with any provider.

---

## Screenshots

> Real screenshots. The actual video image is intentionally replaced with a
> **"video appears here"** placeholder — no stream content is shown.

**Live TV — channel grid with now/next EPG**

![Live TV grid](screenshots/live.png)

Categories on the left, channels as cards with logos and a ● now/next line where
guide data is matched. ★ favorites and ＋ add-to-list are on every card.

**EPG — channel × time guide grid**

![TV guide](screenshots/guide.png)

A scrollable guide: channels down the side, a time axis across the top,
programme blocks positioned by start/duration, with a live "now" marker. Click a
programme to see details and play the channel.

**Player + minimizable bottom bar**

![Full player](screenshots/player.png)

The full player shows the transcode status ("No transcode needed" / GPU / CPU),
a minimize (—) button, and Close. Minimize it and keep browsing while it plays:

![Minimized bar](screenshots/minibar.png)

The docked bar (bottom) keeps the stream playing — title, play/pause, restore,
close — while the rest of the app stays fully interactive.

**Library — favorites, lists, continue-watching, history**

![Library](screenshots/library.png)

**Settings — theme, buffer, transcoding, cache, EPG, backup**

![Settings](screenshots/settings.png)

Pick the theme, buffer size, transcoding mode (with an encoder self-test), the
cache directory + size cap, the EPG URL, and export/import an encrypted backup.

---

## Requirements

- **Cockpit ≥ 215** on the server.
- **`ffmpeg`** on the host (stream remux + transcode). For GPU transcoding, an
  NVENC-capable NVIDIA setup (`ffmpeg` built with `h264_nvenc`); otherwise it
  falls back to CPU `libx264`.
- **`curl`** on the host (used to fetch the upstream stream).
- **Node ≥ 20** to build from source.

## Install

Two steps: install Cockpit (if you haven't), then drop the plugin into Cockpit's
package path.

### 1. Install Cockpit

**Fedora / RHEL / Rocky / Alma / CentOS Stream**
```bash
sudo dnf install cockpit ffmpeg
sudo systemctl enable --now cockpit.socket
sudo firewall-cmd --add-service=cockpit --permanent && sudo firewall-cmd --reload
```

**Debian / Ubuntu / derivatives**
```bash
sudo apt update && sudo apt install cockpit ffmpeg
sudo systemctl enable --now cockpit.socket
# If UFW is enabled: sudo ufw allow 9090/tcp
```

**Arch / Manjaro**
```bash
sudo pacman -S cockpit ffmpeg
sudo systemctl enable --now cockpit.socket
```

Then open `https://<server-ip>:9090` and log in with any local Linux account
(the self-signed cert warning is expected).

### 2. Install the InFlight TV plugin

From a release zip:
```bash
unzip inflighttv-<version>.zip -d /tmp/
sudo cp -r /tmp/inflighttv /usr/share/cockpit/inflighttv
sudo systemctl try-restart cockpit
```

Or from source with the Makefile (it builds `dist/` with Vite, then installs it):
```bash
make build              # npm ci && npm run build  →  dist/
sudo make install       # → /usr/share/cockpit/inflighttv
sudo make uninstall     # remove
make zip                # produce inflighttv-<version>.zip
make publish            # build + publish a GitHub release (needs gh)
make help               # list all targets
```

Reload Cockpit in the browser and look under **Tools → InFlight TV**. Add your
Xtream account or M3U URL under **＋ Accounts**.

## Develop

```bash
make dev-link       # build dist/ + symlink it into ~/.local/share/cockpit (no root)
npm run dev:watch   # rebuild on save — reload the Cockpit tab to see changes
```

## Test

```bash
npm run test        # unit tests (Vitest)
npm run typecheck   # vue-tsc
npm run test:smoke  # SPA smoke (Playwright)
make test           # test + typecheck
```

## License

Apache-2.0.
