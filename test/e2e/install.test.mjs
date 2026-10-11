// End-to-end test: installing the extension while tabs are already open, as a
// person does from the web store. Kept in its own file because the browser
// starts without the extension.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, states, EXTENSION } from './harness.mjs';

let server;
let context;

before(async () => {
  server = await startServer();
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    // Lets the test install the extension later, through the DevTools protocol.
    args: ['--enable-unsafe-extension-debugging'],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
});

after(async () => {
  await context?.close();
  await server?.close();
});

const welcomeTabs = () => context.pages().filter((p) => p.url().includes('/welcome/welcome.html'));

test('installing protects tabs that were already open and shows the welcome page once', async () => {
  const page = await context.newPage();
  await page.goto(server.origin + '/words.html');
  assert.equal(await page.$eval('#alt', (el) => el.getAttribute('data-sb')), null);

  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send('Extensions.loadUnpacked', { path: EXTENSION });
  const result = await states(page, ['alt', 'german', 'spiderman', 'plain']);
  assert.equal(result.alt.state, 'blocked');
  assert.equal(result.german.state, 'blocked');
  assert.equal(result.spiderman.state, 'ok');
  assert.equal(result.plain.state, 'ok');

  // Images added after install are checked too.
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.id = 'late';
    img.src = '/img/late-tarantula.png';
    document.body.append(img);
  });
  assert.equal((await states(page, ['late'])).late.state, 'blocked');

  for (let i = 0; i < 20 && !welcomeTabs().length; i++) await page.waitForTimeout(250);
  assert.equal(welcomeTabs().length, 1);

  // An update (here: loading it again) re-protects the tab without a second
  // welcome page. (The browser closes the first one as it reloads the extension.)
  const opened = [];
  context.on('page', (p) => opened.push(p));
  await cdp.send('Extensions.loadUnpacked', { path: EXTENSION });
  await page.waitForTimeout(1500);
  assert.deepEqual(
    opened.map((p) => p.url()).filter((url) => url.includes('/welcome/')),
    [],
  );
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.id = 'after-update';
    img.src = '/img/after-update-wolf-spider.png';
    document.body.append(img);
  });
  assert.equal((await states(page, ['after-update']))['after-update'].state, 'blocked');
});
