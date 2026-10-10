// Test harness: a local web server for the fixture pages and Chromium with the
// built extension (dist/chrome) loaded.
//
// Fixture images are plain generated colour blocks. The words "spider" etc. only
// appear in their alt text, captions and file names; no test needs a real photo.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXTENSION = path.join(ROOT, 'dist', 'chrome');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
export const PHOTOS = path.join(ROOT, 'test', '.spider-photos');

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// A width x height PNG: a colour block with a lighter diagonal band.
export function png(width, height, hex = '6aa3c8') {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const band = Math.abs(x - y) < Math.min(width, height) / 6 ? 40 : 0;
      raw[row + 1 + x * 3] = Math.min(255, r + band);
      raw[row + 2 + x * 3] = Math.min(255, g + band);
      raw[row + 3 + x * 3] = Math.min(255, b + band);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

export async function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/img/') || url.pathname.startsWith('/slow/')) {
        // /img/<any-name>.png?w=320&h=200&c=6aa3c8   /slow/... waits ?delay ms first
        const delay = Number(url.searchParams.get('delay') || 0);
        if (delay) await new Promise((r) => setTimeout(r, delay));
        const w = Number(url.searchParams.get('w') || 320);
        const h = Number(url.searchParams.get('h') || 200);
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
        res.end(png(w, h, url.searchParams.get('c') || '6aa3c8'));
        return;
      }
      const base = url.pathname.startsWith('/photo/') ? PHOTOS : FIXTURES;
      const rel = url.pathname.replace(/^\/photo\//, '/');
      const file = path.join(base, path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, ''));
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

export async function launch() {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', // the full browser: extensions work in its headless mode
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  // Close the welcome tab opened on install.
  await new Promise((r) => setTimeout(r, 300));
  for (const page of context.pages()) if (page.url().includes('/welcome/')) await page.close();
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId };
}

// Change settings the way the settings page does.
export async function setSettings(worker, partial) {
  await worker.evaluate((p) => chrome.storage.sync.set(p), partial);
}

export async function resetSettings(worker) {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
  });
}

// Waits until every listed element has a final state, then returns
// { id: { state, why } }.
export async function states(page, ids, { timeout = 15000 } = {}) {
  await page.waitForFunction(
    (list) =>
      list.every((id) => {
        const el = document.getElementById(id) || document.querySelector(`[data-test="${id}"]`);
        const s = el?.getAttribute('data-sb');
        return s && s !== 'pending';
      }),
    ids,
    { timeout },
  );
  return page.evaluate(
    (list) =>
      Object.fromEntries(
        list.map((id) => {
          const el = document.getElementById(id) || document.querySelector(`[data-test="${id}"]`);
          return [id, { state: el.getAttribute('data-sb'), why: el.getAttribute('data-sb-why') }];
        }),
      ),
    ids,
  );
}

export async function tabId(worker, url) {
  return worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(u))?.id, url);
}
