# InFlight TV

A Cockpit plugin that turns any Xtream Codes IPTV subscription into a browser TV client
(Live TV, VOD, Series, EPG) with favorites, custom lists, watch-later, continue-watching,
multiple accounts opened in tabs, GPU-accelerated transcoding, and encrypted cloud backup.

> Named for Cockpit ("in-flight") — it is not for aircraft use.

## Requirements
- Cockpit >= 215
- `ffmpeg` on the host (used for stream remux/transcode; added in a later milestone)
- Node >= 20 to build

## Develop
```bash
npm install
make dev-link      # builds dist/ and symlinks it into ~/.local/share/cockpit/inflighttv
npm run dev:watch  # rebuild on save; reload the Cockpit tab
```
Open Cockpit -> Tools -> **InFlight TV**.

## Install (system-wide)
```bash
sudo make install
sudo systemctl try-restart cockpit
```

## Test
```bash
npm run test        # unit (Vitest)
npm run test:smoke  # SPA smoke (Playwright)
```

## License
Apache-2.0 (applied at first public release).
