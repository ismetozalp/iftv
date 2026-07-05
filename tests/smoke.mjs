// Smoke test: serves dist/ as a plain static site with a stubbed cockpit.js and
// asserts the SPA mounts, renders the shell + tab bar, and the accounts manager form.
// Does NOT touch a real Cockpit.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const COCKPIT_STUB = `window.cockpit = {
  user: async () => ({ home: '/tmp', name: 'test' }),
  file: () => ({ read: async () => null, replace: async () => '', close() {} }),
  http: () => ({ get: async () => '{}' }),
  spawn: async () => '',
};`

const server = createServer(async (req, res) => {
  let path = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  if (path.endsWith('/base1/cockpit.js')) {
    res.setHeader('content-type', 'text/javascript'); res.end(COCKPIT_STUB); return
  }
  try {
    const body = await readFile(join(DIST, path))
    res.setHeader('content-type', TYPES[extname(path)] || 'application/octet-stream')
    res.end(body)
  } catch { res.statusCode = 404; res.end('not found') }
})

await new Promise((r) => server.listen(0, r))
const port = server.address().port
const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(`http://localhost:${port}/index.html`)
await page.waitForSelector('text=InFlight TV')
await page.waitForSelector('.iftv-tabbar')
await page.goto(`http://localhost:${port}/index.html#/accounts`)
await page.waitForSelector('input[placeholder="http://host:port"]')
await browser.close()
server.close()
if (errors.length) { console.error('Console errors:', errors); process.exit(1) }
console.log('smoke OK')
