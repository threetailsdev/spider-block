// End-to-end test: the browser stops the idle service worker. Kept in its own
// file because the restarted worker is not reachable through the old handle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, states, tabId } from './harness.mjs';

let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  await browser?.context.close();
  await server?.close();
});

test('the badge keeps the count when the browser stops the idle background', async () => {
  const page = await browser.context.newPage();
  await page.goto(server.origin + '/words.html');
  await states(page, ['alt', 'card', 'german', 'plain']);
  const id = await tabId(browser.worker, server.origin + '/words.html');
  const ext = await browser.context.newPage();
  await ext.goto(`chrome-extension://${browser.extensionId}/options/options.html`);
  const badge = () => ext.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), id);
  const badgeIs = async (text) => {
    for (let i = 0; i < 30 && (await badge()) !== text; i++) await page.waitForTimeout(500);
  };
  await badgeIs('9');
  assert.equal(await badge(), '9');

  // Stop the service worker, as the browser does after it has been idle.
  const cdp = await browser.context.newCDPSession(ext);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await page.waitForTimeout(500);

  // A frame that loads afterwards reports its own count (9 more).
  await page.evaluate((src) => {
    const frame = document.createElement('iframe');
    frame.src = src;
    document.body.append(frame);
  }, server.origin + '/words.html');
  await badgeIs('18');
  assert.equal(await badge(), '18');
});

test('the toolbar shows protection back on when a pause ends while the background is stopped', async () => {
  // Only a page with no images, so nothing else wakes the background when the pause ends.
  for (const open of browser.context.pages().slice(1)) await open.close();
  const page = await browser.context.newPage();
  await page.goto(server.origin + '/no-such-page.html');
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-sb-style'));
  const ext = await browser.context.newPage();
  await ext.goto(`chrome-extension://${browser.extensionId}/options/options.html`);
  const title = () => ext.evaluate(() => chrome.action.getTitle({}));
  await ext.evaluate(() => chrome.storage.sync.set({ pausedUntil: Date.now() + 3000 }));
  for (let i = 0; i < 20 && (await title()) !== 'Spider Block (paused)'; i++) await page.waitForTimeout(100);
  assert.equal(await title(), 'Spider Block (paused)');

  const cdp = await browser.context.newCDPSession(ext);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  // The page resumes on its own when the pause ends; it must also wake the background.
  await page.waitForTimeout(4500);
  assert.equal(await title(), 'Spider Block');
});
