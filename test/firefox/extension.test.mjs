// End-to-end tests: the built Firefox add-on in real Firefox.
// Run with: npm run test:firefox   (set FIREFOX_BIN if Firefox is not found)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, open as openTab, states, until, sleep } from './harness.mjs';

let server;
let browser;
let control; // a fixture tab kept open to reach the background

before(async () => {
  server = await startServer();
  browser = await launch();
  // A page with no images (the server answers 404), so nothing on it changes the badge.
  control = await openTab(browser, server.origin + '/control.html');
});

after(async () => {
  await browser?.close();
  await server?.close();
});

beforeEach(async () => {
  await control.bg('reset');
  for (const page of await browser.pages()) if (page !== control && !page.url().startsWith('about:')) await page.close();
  await control.bg('logs'); // start each test with an empty log
});

const open = (path) => openTab(browser, server.origin + path);
const attr = (page, id, name) => page.$eval(`#${id}`, (el, n) => el.getAttribute(n), name);
const style = (page, id, prop) => page.$eval(`#${id}`, (el, p) => getComputedStyle(el)[p], prop);

async function assertNoBackgroundErrors() {
  assert.deepEqual(await control.bg('logs'), []);
}

test('opens the welcome page once, on install', async () => {
  const views = await until(async () => {
    const list = await control.bg('views');
    return list.some((v) => v.path === 'welcome/welcome.html') && list;
  }, { what: 'welcome page' });
  assert.deepEqual(views, [{ path: 'welcome/welcome.html', errors: [] }]);
  await control.bg('close', { path: 'welcome/welcome.html' });
});

test('hides images whose words mention spiders, in several languages', async () => {
  const page = await open('/words.html');
  const hidden = ['alt', 'file', 'camel', 'caption', 'card', 'link', 'spanish', 'japanese', 'german'];
  const result = await states(page, hidden);
  for (const id of hidden) assert.deepEqual(result[id], { state: 'blocked', why: 'text' }, id);
  assert.deepEqual(page.errors, []);
});

test('the AI scan runs and leaves Spider-Man, spider plants, cars, icons and ordinary photos alone', async () => {
  const page = await open('/words.html');
  const visible = ['spiderman', 'plant', 'car', 'plain', 'icon', 'neighbour'];
  const result = await states(page, visible, { timeout: 30000 });
  for (const id of visible) assert.equal(result[id].state, 'ok', id);
  await until(async () => (await style(page, 'plain', 'opacity')) === '1', { what: 'fade-in' });
  await assertNoBackgroundErrors();
});

test('a caption only counts for its own picture, not the whole gallery', async () => {
  const page = await open('/cards.html');
  const result = await states(page, ['gallery-1', 'gallery-2', 'gallery-3', 'tile-thumb', 'tile-avatar', 'tile-2-thumb'], { timeout: 30000 });
  assert.equal(result['gallery-2'].state, 'blocked');
  assert.equal(result['gallery-1'].state, 'ok');
  assert.equal(result['gallery-3'].state, 'ok');
  assert.equal(result['tile-thumb'].state, 'blocked');
  assert.equal(result['tile-2-thumb'].state, 'ok');
});

test('the default cover keeps the layout and swaps the picture for a calm tile', async () => {
  const page = await open('/words.html');
  await states(page, ['alt']);
  const s = await page.$eval('#alt', (el) => {
    const cs = getComputedStyle(el);
    return { objectPosition: cs.objectPosition, background: cs.backgroundImage, width: el.offsetWidth };
  });
  assert.equal(s.objectPosition, '-99999px -99999px');
  assert.match(s.background, /data:image\/svg\+xml/);
  assert.equal(s.width, 320);
});

test('images are invisible until they have been checked', async () => {
  const page = await open('/dynamic.html');
  // /slow/ answers after 1.5 s, so the image is still waiting to load here.
  assert.equal(await attr(page, 'slow', 'data-sb'), 'pending');
  assert.equal(await style(page, 'slow', 'opacity'), '0');
  const result = await states(page, ['slow'], { timeout: 30000 });
  assert.equal(result.slow.state, 'ok');
  await until(async () => (await style(page, 'slow', 'opacity')) === '1', { what: 'fade-in' });
});

test('catches images and text that arrive after the page loaded', async () => {
  const page = await open('/dynamic.html');
  await states(page, ['swap', 'late-title'], { timeout: 30000 });
  await page.evaluate(() => {
    document.getElementById('swap').src = '/img/tarantula-closeup.png';
    const img = document.createElement('img');
    img.id = 'added';
    img.src = '/img/new.png';
    img.alt = 'Orb weaver in the garden';
    document.getElementById('feed').append(img);
    document.getElementById('slot').textContent = 'Giant spider found in the garage';
  });
  await until(async () => (await attr(page, 'swap', 'data-sb')) === 'blocked', { what: 'swapped image' });
  const result = await states(page, ['added', 'late-title']);
  assert.equal(result.added.state, 'blocked');
  assert.equal(result['late-title'].state, 'blocked');
});

test('handles CSS background images and images inside shadow DOM', async () => {
  const page = await open('/dynamic.html');
  const result = await states(page, ['bg', 'bg-plain', 'shadow'], { timeout: 30000 });
  assert.equal(result.bg.state, 'blocked');
  assert.equal(result['bg-plain'].state, 'ok');
  assert.equal(result.shadow.state, 'blocked');
  const bg = await style(page, 'bg', 'backgroundImage');
  assert.match(bg, /data:image\/svg\+xml/);
  assert.doesNotMatch(bg, /garden-spider/);
  const pos = await page.evaluate(
    () => getComputedStyle(document.querySelector('photo-card').shadowRoot.querySelector('img')).objectPosition,
  );
  assert.equal(pos, '-99999px -99999px');
});

test('hides every image on a page about spiders, except small icons', async () => {
  const page = await open('/spider-page.html');
  const result = await states(page, ['one', 'two', 'logo'], { timeout: 30000 });
  assert.deepEqual(result.one, { state: 'blocked', why: 'page' });
  assert.deepEqual(result.two, { state: 'blocked', why: 'page' });
  assert.equal(result.logo.state, 'ok');
  // "Only hide images that look like spiders" from the popup.
  await page.bg('tab-message', { msg: { type: 'page-override', on: true } });
  await until(async () => (await attr(page, 'one', 'data-sb-why')) !== 'page', { what: 'override' });
  assert.equal((await states(page, ['one'], { timeout: 30000 })).one.state, 'ok');
});

test('clicking a hidden image asks first, and does not follow its link', async () => {
  const page = await open('/words.html');
  await states(page, ['link']);
  const before = page.url();
  await page.click('#link');
  await sleep(300);
  assert.equal(page.url(), before);
  // The panel focuses "Keep hidden"; Tab moves to "Show image".
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await until(async () => (await attr(page, 'link', 'data-sb')) === 'revealed', { what: 'reveal' });
  assert.equal(await style(page, 'link', 'objectPosition'), '50% 50%');
});

test('other styles: calming scene, blank space and blur', async () => {
  const page = await open('/words.html');
  await states(page, ['alt']);
  await page.bg('set', { style: 'scene' });
  await until(() => page.evaluate(() => document.documentElement.getAttribute('data-sb-style') === 'scene'), { what: 'scene' });
  assert.match(await style(page, 'alt', 'backgroundImage'), /data:image\/svg\+xml/);
  await page.bg('set', { style: 'hide' });
  await until(async () => (await style(page, 'alt', 'visibility')) === 'hidden', { what: 'hide' });
  await page.bg('set', { style: 'blur' });
  await until(async () => (await style(page, 'alt', 'filter')).includes('blur'), { what: 'blur' });
});

test('turning off for a site, pausing and switching off restore the page', async () => {
  const page = await open('/words.html');
  await states(page, ['alt']);
  const clean = () => page.evaluate(() => !document.querySelector('[data-sb]'));
  await page.bg('set', { disabledSites: ['127.0.0.1'] });
  await until(clean, { what: 'site off' });
  await page.bg('set', { disabledSites: [] });
  await states(page, ['alt']);
  await page.bg('set', { pausedUntil: Date.now() + 60000 });
  await until(clean, { what: 'pause' });
  assert.equal(await page.bg('title'), 'Spider Block (paused)');
  await page.bg('set', { pausedUntil: 0, enabled: false });
  await until(clean, { what: 'off' });
  assert.equal(await page.bg('title'), 'Spider Block (off)');
  await page.bg('set', { enabled: true });
  assert.equal((await states(page, ['alt', 'plain'], { timeout: 30000 })).alt.state, 'blocked');
  assert.equal(await page.bg('title'), 'Spider Block');
});

test('hide-all mode hides every image and can be undone', async () => {
  const page = await open('/words.html');
  await states(page, ['plain'], { timeout: 30000 });
  await page.bg('tab-message', { msg: { type: 'set-panic', on: true } });
  await until(async () => (await style(page, 'plain', 'visibility')) === 'hidden', { what: 'panic on' });
  await page.bg('tab-message', { msg: { type: 'set-panic', on: false } });
  await until(async () => (await style(page, 'plain', 'visibility')) === 'visible', { what: 'panic off' });
});

test('right-click corrections are remembered', async () => {
  const page = await open('/words.html');
  await states(page, ['plain', 'alt'], { timeout: 30000 });
  // "Hide this image" on an ordinary photo.
  await page.click('#plain', { button: 'right' });
  await page.keyboard.press('Escape');
  await page.bg('tab-message', { msg: { type: 'menu', action: 'hide', srcUrl: '' }, options: { frameId: 0 } });
  await until(async () => (await attr(page, 'plain', 'data-sb-why')) === 'user', { what: 'hide' });
  // "This isn't a spider" on a hidden one.
  await page.click('#alt', { button: 'right' });
  await page.keyboard.press('Escape');
  await page.bg('tab-message', { msg: { type: 'menu', action: 'show', srcUrl: '' }, options: { frameId: 0 } });
  await until(async () => (await attr(page, 'alt', 'data-sb')) === 'ok', { what: 'show' });
  // Both choices survive a reload.
  await page.reload();
  const result = await states(page, ['plain', 'alt'], { timeout: 30000 });
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
  await control.bg('set', { redactWords: true });
  const page = await open('/story.html');
  await states(page, ['cabin']);
  const words = await until(() =>
    page.evaluate(() => {
      const h = CSS.highlights?.get('spider-block-words');
      return h && h.size ? [...h].map((r) => r.toString()) : null;
    }),
    { what: 'highlight' },
  );
  assert.ok(words.includes('spider'));
  assert.ok(words.includes('tarantulas'));
  assert.ok(!words.some((w) => /man/i.test(w)));
});

test('the toolbar badge counts hidden images, and stops counting a removed frame', async () => {
  const page = await open('/words.html');
  await states(page, ['alt', 'card', 'german', 'plain'], { timeout: 30000 });
  const badgeIs = (text) => until(async () => (await page.bg('badge')) === text, { what: `badge ${text}` });
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

test('the AI scan checks every photo in a grid as it scrolls into view', async () => {
  const page = await open('/lazy-grid.html');
  const ids = Array.from({ length: 24 }, (_, i) => 'g' + i);
  const started = Date.now();
  // Scroll down, as a person would; images far below the screen wait their turn.
  const scrolling = (async () => {
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await sleep(300);
    }
  })();
  const result = await states(page, ids, { timeout: 60000 });
  await scrolling;
  for (const id of ids) assert.equal(result[id].state, 'ok', id);
  console.log(`  24 photos checked in ${Date.now() - started} ms`);
  await assertNoBackgroundErrors();
});

test('settings, popup and welcome pages load without errors, and settings are saved', async () => {
  const pages = ['options/options.html', 'popup/popup.html', 'welcome/welcome.html'];
  for (const path of pages) await control.bg('open', { path });
  await until(async () => (await control.bg('views')).length === pages.length, { what: 'pages open' });
  await until(async () => /ready/.test(await control.bg('text', { path: 'options/options.html', selector: '#engine' })), {
    timeout: 20000,
    what: 'engine ready',
  });
  await control.bg('click', { path: 'options/options.html', selector: 'input[value="scene"]' });
  await until(async () => (await control.bg('get')).style === 'scene', { what: 'saved style' });
  for (const view of await control.bg('views')) assert.deepEqual(view.errors, [], view.path);
  for (const path of pages) await control.bg('close', { path });
  await assertNoBackgroundErrors();
});
