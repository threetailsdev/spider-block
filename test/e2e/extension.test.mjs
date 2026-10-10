// End-to-end tests: the built Chrome extension in a real Chromium.
// Run with: npm run test:e2e
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, setSettings, resetSettings, states, tabId } from './harness.mjs';

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

beforeEach(async () => {
  await resetSettings(browser.worker);
  for (const page of browser.context.pages().slice(1)) await page.close();
});

async function open(path) {
  const page = await browser.context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err));
  await page.goto(server.origin + path);
  page.errors = errors;
  return page;
}

test('hides images whose words mention spiders, in several languages', async () => {
  const page = await open('/words.html');
  const hidden = ['alt', 'file', 'camel', 'caption', 'card', 'link', 'spanish', 'japanese', 'german'];
  const result = await states(page, hidden);
  for (const id of hidden) assert.deepEqual(result[id], { state: 'blocked', why: 'text' }, id);
  assert.deepEqual(page.errors, []);
});

test('leaves Spider-Man, spider plants, cars, icons and ordinary photos alone', async () => {
  const page = await open('/words.html');
  const visible = ['spiderman', 'plant', 'car', 'plain', 'icon', 'neighbour'];
  const result = await states(page, visible);
  for (const id of visible) assert.equal(result[id].state, 'ok', id);
  // Fully visible once the short fade-in finishes.
  await page.waitForFunction(() => getComputedStyle(document.getElementById('plain')).opacity === '1');
});

test('a caption only counts for its own picture, not the whole gallery', async () => {
  const page = await open('/cards.html');
  const result = await states(page, ['gallery-1', 'gallery-2', 'gallery-3', 'tile-thumb', 'tile-avatar', 'tile-2-thumb']);
  assert.equal(result['gallery-2'].state, 'blocked');
  assert.equal(result['gallery-1'].state, 'ok');
  assert.equal(result['gallery-3'].state, 'ok');
  // A video tile: the title hides the thumbnail; another tile is unaffected.
  assert.equal(result['tile-thumb'].state, 'blocked');
  assert.equal(result['tile-2-thumb'].state, 'ok');
});

test('the default cover keeps the layout and swaps the picture for a calm tile', async () => {
  const page = await open('/words.html');
  await states(page, ['alt']);
  const style = await page.$eval('#alt', (el) => {
    const cs = getComputedStyle(el);
    return { objectPosition: cs.objectPosition, background: cs.backgroundImage, width: el.offsetWidth };
  });
  assert.equal(style.objectPosition, '-99999px -99999px');
  assert.match(style.background, /data:image\/svg\+xml/);
  assert.equal(style.width, 320);
});

test('images are invisible until they have been checked', async () => {
  const page = await open('/dynamic.html');
  // /slow/ answers after 1.5 s, so the image is still waiting to load here.
  const early = await page.$eval('#slow', (el) => ({ state: el.getAttribute('data-sb'), opacity: getComputedStyle(el).opacity }));
  assert.equal(early.state, 'pending');
  assert.equal(early.opacity, '0');
  const result = await states(page, ['slow']);
  assert.equal(result.slow.state, 'ok');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('slow')).opacity === '1');
});

test('catches images and text that arrive after the page loaded', async () => {
  const page = await open('/dynamic.html');
  await states(page, ['swap', 'late-title']);
  await page.evaluate(() => {
    document.getElementById('swap').src = '/img/tarantula-closeup.png';
    const img = document.createElement('img');
    img.id = 'added';
    img.src = '/img/new.png';
    img.alt = 'Orb weaver in the garden';
    document.getElementById('feed').append(img);
    document.getElementById('slot').textContent = 'Giant spider found in the garage';
  });
  await page.waitForFunction(() => document.getElementById('swap').getAttribute('data-sb') === 'blocked');
  const result = await states(page, ['added', 'late-title']);
  assert.equal(result.added.state, 'blocked');
  assert.equal(result['late-title'].state, 'blocked');
});

test('handles CSS background images and images inside shadow DOM', async () => {
  const page = await open('/dynamic.html');
  const result = await states(page, ['bg', 'bg-plain']);
  assert.equal(result.bg.state, 'blocked');
  assert.equal(result['bg-plain'].state, 'ok');
  const bg = await page.$eval('#bg', (el) => getComputedStyle(el).backgroundImage);
  assert.match(bg, /data:image\/svg\+xml/);
  assert.doesNotMatch(bg, /garden-spider/);

  // Playwright's locators see into open shadow roots.
  const shadow = page.locator('[data-test="shadow"]');
  await shadow.and(page.locator('[data-sb="blocked"]')).waitFor({ timeout: 10000 });
  const pos = await shadow.evaluate((el) => getComputedStyle(el).objectPosition);
  assert.equal(pos, '-99999px -99999px');
});

test('hidden background images are rechecked by their own picture, not the cover', async () => {
  const page = await open('/dynamic.html');
  await states(page, ['bg', 'bg-plain']);
  // A detection setting changes, so every image is checked again.
  await setSettings(browser.worker, { sensitivity: 'strict' });
  await page.waitForTimeout(2500);
  assert.deepEqual((await states(page, ['bg'])).bg, { state: 'blocked', why: 'text' });

  // A lazy loader swaps the real picture in while the placeholder is being checked.
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'lazy-bg';
    div.style.cssText = 'width:300px;height:200px;background-image:url(/slow/placeholder.png?delay=1500)';
    document.body.prepend(div);
  });
  await page.waitForFunction(() => document.getElementById('lazy-bg').getAttribute('data-sb') === 'pending');
  await page.evaluate(() => (document.getElementById('lazy-bg').style.backgroundImage = 'url(/img/wolf-spider.png)'));
  assert.deepEqual((await states(page, ['lazy-bg']))['lazy-bg'], { state: 'blocked', why: 'text' });
});

test('hides every image on a page about spiders, except small icons', async () => {
  const page = await open('/spider-page.html');
  const result = await states(page, ['one', 'two', 'logo']);
  assert.deepEqual(result.one, { state: 'blocked', why: 'page' });
  assert.deepEqual(result.two, { state: 'blocked', why: 'page' });
  assert.equal(result.logo.state, 'ok');

  // "Only hide images that look like spiders" from the popup.
  const id = await tabId(browser.worker, server.origin + '/spider-page.html');
  await browser.worker.evaluate((t) => chrome.tabs.sendMessage(t, { type: 'page-override', on: true }), id);
  await page.waitForFunction(() => document.getElementById('one').getAttribute('data-sb-why') !== 'page');
  const after = await states(page, ['one', 'two']);
  assert.equal(after.one.state, 'ok');
});

test('clicking a hidden image asks first, and does not follow its link', async () => {
  const page = await open('/words.html');
  await states(page, ['link']);
  const before = page.url();
  await page.click('#link');
  await page.waitForTimeout(150);
  assert.equal(page.url(), before);
  // The panel focuses "Keep hidden"; Tab moves to "Show image".
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('link').getAttribute('data-sb') === 'revealed');
  assert.equal(await page.$eval('#link', (el) => getComputedStyle(el).objectPosition), '50% 50%');
});

test('"never" reveal mode lets clicks through and offers no way to show', async () => {
  await setSettings(browser.worker, { reveal: 'never' });
  const page = await open('/words.html');
  await states(page, ['alt']);
  const cursor = await page.$eval('#alt', (el) => getComputedStyle(el).cursor);
  assert.notEqual(cursor, 'pointer');
});

test('other styles: calming scene, blank space and blur', async () => {
  const page = await open('/words.html');
  await states(page, ['alt']);
  await setSettings(browser.worker, { style: 'scene' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-sb-style') === 'scene');
  assert.match(await page.$eval('#alt', (el) => getComputedStyle(el).backgroundImage), /data:image\/svg\+xml/);
  await setSettings(browser.worker, { style: 'hide' });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('alt')).visibility === 'hidden');
  await setSettings(browser.worker, { style: 'blur' });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('alt')).filter.includes('blur'));
});

test('turning off for a site, pausing and switching off restore the page', async () => {
  const page = await open('/words.html');
  await states(page, ['alt']);
  await setSettings(browser.worker, { disabledSites: ['127.0.0.1'] });
  await page.waitForFunction(() => !document.querySelector('[data-sb]') && !document.documentElement.hasAttribute('data-sb-shield'));
  await setSettings(browser.worker, { disabledSites: [] });
  await states(page, ['alt']);
  await setSettings(browser.worker, { pausedUntil: Date.now() + 60000 });
  await page.waitForFunction(() => !document.querySelector('[data-sb]'));
  await setSettings(browser.worker, { pausedUntil: 0, enabled: false });
  await page.waitForFunction(() => !document.querySelector('[data-sb]'));
  await setSettings(browser.worker, { enabled: true });
  const result = await states(page, ['alt', 'plain']);
  assert.equal(result.alt.state, 'blocked');
});

test('hide-all mode hides every image and can be undone', async () => {
  const page = await open('/words.html');
  await states(page, ['plain']);
  const id = await tabId(browser.worker, server.origin + '/words.html');
  await browser.worker.evaluate((t) => chrome.tabs.sendMessage(t, { type: 'set-panic', on: true }), id);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('plain')).visibility === 'hidden');
  await browser.worker.evaluate((t) => chrome.tabs.sendMessage(t, { type: 'set-panic', on: false }), id);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('plain')).visibility === 'visible');
});

test('right-click corrections are remembered', async () => {
  const page = await open('/words.html');
  await states(page, ['plain', 'alt']);
  const id = await tabId(browser.worker, server.origin + '/words.html');
  // "Hide this image" on an ordinary photo.
  await page.click('#plain', { button: 'right' });
  await browser.worker.evaluate((t) => chrome.tabs.sendMessage(t, { type: 'menu', action: 'hide', srcUrl: '' }, { frameId: 0 }), id);
  await page.waitForFunction(() => document.getElementById('plain').getAttribute('data-sb-why') === 'user');
  // "This isn't a spider" on a hidden one.
  await page.click('#alt', { button: 'right' });
  await page.keyboard.press('Escape');
  await browser.worker.evaluate((t) => chrome.tabs.sendMessage(t, { type: 'menu', action: 'show', srcUrl: '' }, { frameId: 0 }), id);
  await page.waitForFunction(() => document.getElementById('alt').getAttribute('data-sb') === 'ok');

  // Both choices survive a reload.
  await page.reload();
  const result = await states(page, ['plain', 'alt']);
  assert.deepEqual(result.plain, { state: 'blocked', why: 'user' });
  assert.equal(result.alt.state, 'ok');
});

test('a page that keeps mentioning spiders counts as a page about spiders', async () => {
  const page = await open('/story.html');
  const result = await states(page, ['cabin', 'lake']);
  assert.deepEqual(result.cabin, { state: 'blocked', why: 'page' });
  assert.deepEqual(result.lake, { state: 'blocked', why: 'page' });
});

test('optional word covering marks spider words in text, but not Spider-Man', async () => {
  await setSettings(browser.worker, { redactWords: true });
  const page = await open('/story.html');
  await states(page, ['cabin']);
  const words = await page.evaluate(() => {
    const h = CSS.highlights.get('spider-block-words');
    return h ? [...h].map((r) => r.toString()) : null;
  });
  assert.ok(words, 'highlight registered');
  assert.ok(words.includes('spider'));
  assert.ok(words.includes('tarantulas'));
  assert.ok(!words.some((w) => /man/i.test(w)));
});

test('the toolbar badge counts hidden images', async () => {
  const page = await open('/words.html');
  await states(page, ['alt', 'card', 'german', 'plain']);
  const id = await tabId(browser.worker, server.origin + '/words.html');
  await page.waitForTimeout(600);
  const text = await browser.worker.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), id);
  assert.equal(text, '9');
});

test('the badge stops counting an embedded frame once it is removed', async () => {
  const page = await open('/words.html');
  await states(page, ['alt', 'card', 'german', 'plain']);
  const id = await tabId(browser.worker, server.origin + '/words.html');
  const badge = () => browser.worker.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), id);
  const badgeIs = async (text) => {
    for (let i = 0; i < 30 && (await badge()) !== text; i++) await page.waitForTimeout(300);
    assert.equal(await badge(), text);
  };
  await badgeIs('9');
  await page.evaluate((src) => {
    const frame = document.createElement('iframe');
    frame.id = 'extra';
    frame.src = src;
    document.body.append(frame);
  }, server.origin + '/words.html');
  await badgeIs('18');
  await page.evaluate(() => document.getElementById('extra').remove());
  await badgeIs('9');
});

test('the settings page says so when a list is too long to save', async () => {
  const page = await browser.context.newPage();
  await page.goto(`chrome-extension://${browser.extensionId}/options/options.html`);
  // Synced settings hold about 8 KB each; 200 long words is well over that.
  const words = Array.from({ length: 200 }, (_, i) => `word${i}-${'x'.repeat(60)}`).join('\n');
  await page.locator('[data-key="customBlockWords"]').fill(words);
  await page.locator('[data-key="customBlockWords"]').blur();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('too long'));
  await page.close();
});

test('the AI scan checks every photo in a grid as it scrolls into view', async () => {
  const page = await open('/lazy-grid.html');
  const ids = Array.from({ length: 24 }, (_, i) => 'g' + i);
  const started = Date.now();
  const result = await states(page, ids, { timeout: 60000 });
  for (const id of ids) assert.equal(result[id].state, 'ok', id);
  console.log(`  24 photos checked in ${Date.now() - started} ms`);
});

test('settings, popup and welcome pages load without errors', async () => {
  for (const path of ['options/options.html', 'popup/popup.html', 'welcome/welcome.html']) {
    const page = await browser.context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    await page.goto(`chrome-extension://${browser.extensionId}/${path}`);
    await page.waitForTimeout(400);
    assert.deepEqual(errors, [], path);
    await page.close();
  }
  // A setting changed on the settings page is saved.
  const page = await browser.context.newPage();
  await page.goto(`chrome-extension://${browser.extensionId}/options/options.html`);
  await page.locator('input[value="scene"]').check({ force: true });
  await page.waitForFunction(async () => (await chrome.storage.sync.get('style')).style === 'scene');
  await page.waitForFunction(() => document.getElementById('engine').textContent.includes('ready'));
});
