// End-to-end test: Firefox stops the idle background page (Manifest V3 event
// page). Here it is stopped after one idle second instead of thirty.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, open, states, until, sleep } from './harness.mjs';

let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await launch({ prefs: { 'extensions.background.idle.timeout': 1000 } });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

// Waits until the background has been stopped and started again.
async function restarted(page, before) {
  await until(async () => (await page.bg('run-id')) !== before, { timeout: 20000, what: 'background restart' });
}

test('the badge keeps the count when Firefox stops the idle background', async () => {
  const page = await open(browser, server.origin + '/words.html');
  await states(page, ['alt', 'card', 'german', 'plain'], { timeout: 30000 });
  await until(async () => (await page.bg('badge')) === '9', { what: 'badge 9' });
  const run = await page.bg('run-id');
  await sleep(3000);
  await restarted(page, run);

  // A frame that loads afterwards reports its own count (9 more).
  await page.evaluate((src) => {
    const frame = document.createElement('iframe');
    frame.src = src;
    document.body.append(frame);
  }, server.origin + '/words.html');
  await until(async () => (await page.bg('badge')) === '18', { what: 'badge 18' });
});

test('the toolbar shows protection back on when a pause ends while the background is stopped', async () => {
  for (const p of await browser.pages()) if (!p.url().startsWith('about:')) await p.close();
  // A page with no images, so nothing else wakes the background when the pause ends.
  const page = await open(browser, server.origin + '/no-such-page.html');
  const resume = Date.now() + 5000;
  await page.bg('set', { pausedUntil: resume });
  await until(async () => (await page.bg('title')) === 'Spider Block (paused)', { what: 'paused title' });
  await sleep(resume + 3000 - Date.now());
  // The page resumes on its own when the pause ends, and must also wake the
  // background so it can turn the toolbar icon back on.
  const starts = await page.bg('starts');
  assert.ok(
    starts.some((t) => t >= resume && t < resume + 1500),
    `the page woke the background when the pause ended (${starts.map((t) => t - resume).join(', ')} ms)`,
  );
  assert.equal(await page.bg('title'), 'Spider Block');
});
