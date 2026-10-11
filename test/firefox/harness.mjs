// Test harness for Firefox: the fixture server from the Chromium tests, and real
// Firefox driven over WebDriver BiDi with dist/firefox installed as a temporary
// add-on.
//
// Firefox comes from FIREFOX_BIN, or the usual install location. WebDriver may
// not open moz-extension:// pages, so the add-on under test is a copy of
// dist/firefox (dist/firefox-test) with test-only scripts added: a test page
// sends commands with `page.bg(cmd, args)` and the background runs them.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export { startServer } from '../e2e/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BUILT = path.join(ROOT, 'dist', 'firefox');
export const EXTENSION = path.join(ROOT, 'dist', 'firefox-test');

function firefoxPath() {
  const candidates = [
    process.env.FIREFOX_BIN,
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    '/usr/lib/firefox/firefox',
    '/usr/bin/firefox',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Firefox not found. Set FIREFOX_BIN to the firefox executable.');
  return found;
}

async function testBuild() {
  const manifestFile = path.join(BUILT, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('Run `npm run build:firefox` first.');
  await fsp.rm(EXTENSION, { recursive: true, force: true });
  await fsp.cp(BUILT, EXTENSION, { recursive: true });
  for (const f of ['bridge-background.js', 'bridge-content.js', 'bridge-page.js']) await fsp.copyFile(path.join(HERE, f), path.join(EXTENSION, f));
  for (const page of ['options/options.html', 'popup/popup.html', 'welcome/welcome.html']) {
    const file = path.join(EXTENSION, page);
    const html = await fsp.readFile(file, 'utf8');
    const first = html.indexOf('<script');
    if (first < 0) throw new Error(`${page} has no script`);
    await fsp.writeFile(file, html.slice(0, first) + '<script src="../bridge-page.js"></script>\n    ' + html.slice(first));
  }
  const manifest = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
  // First, so it also records warnings logged while the other scripts load.
  manifest.background.scripts.unshift('bridge-background.js');
  manifest.content_scripts.push({ matches: ['http://127.0.0.1/*'], js: ['bridge-content.js'], run_at: 'document_start' });
  await fsp.writeFile(path.join(EXTENSION, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

// prefs: extra Firefox preferences, e.g. a short idle time for the background.
export async function launch({ prefs = {} } = {}) {
  await testBuild();
  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: firefoxPath(),
    headless: !process.env.HEADED,
    defaultViewport: { width: 1280, height: 720 },
    extraPrefsFirefox: prefs,
  });
  try {
    await browser.installExtension(EXTENSION);
  } catch (err) {
    await browser.close();
    throw err;
  }
  return browser;
}

// Opens a fixture page in a new foreground tab. Firefox does not lay out
// background tabs, so images there never come into view.
export async function open(browser, url) {
  const page = await browser.newPage();
  page.errors = [];
  page.on('pageerror', (err) => page.errors.push(err));
  await page.bringToFront();
  await page.goto(url);
  page.bg = async (cmd, args = {}) => {
    const reply = await page.evaluate(
      (cmd, args) =>
        new Promise((resolve) => {
          const id = Math.random();
          const onReply = (e) => {
            if (e.data?.sbTestReply?.id !== id) return;
            removeEventListener('message', onReply);
            resolve(e.data.sbTestReply);
          };
          addEventListener('message', onReply);
          postMessage({ sbTest: { id, cmd, args } }, '*');
          setTimeout(() => resolve({ error: 'no answer from the background' }), 10000);
        }),
      cmd,
      args,
    );
    if (reply.error) throw new Error(`${cmd}: ${reply.error}`);
    return reply.value;
  };
  return page;
}

// Waits until every listed element (also inside open shadow roots) has a final
// state, then returns { id: { state, why } }.
export async function states(page, ids, { timeout = 15000 } = {}) {
  const read = (list) => {
    const find = (id) =>
      document.getElementById(id) ||
      document.querySelector(`[data-test="${id}"]`) ||
      [...document.querySelectorAll('*')].map((el) => el.shadowRoot?.querySelector(`[data-test="${id}"]`)).find(Boolean);
    return Object.fromEntries(
      list.map((id) => {
        const el = find(id);
        return [id, el && { state: el.getAttribute('data-sb'), why: el.getAttribute('data-sb-why') }];
      }),
    );
  };
  const deadline = Date.now() + timeout;
  for (;;) {
    const result = await page.evaluate(read, ids);
    if (Object.values(result).every((r) => r?.state && r.state !== 'pending')) return result;
    if (Date.now() > deadline) throw new Error(`Still waiting: ${JSON.stringify(result)}`);
    await sleep(150);
  }
}

// Polls fn until it returns something truthy.
export async function until(fn, { timeout = 10000, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(150);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
