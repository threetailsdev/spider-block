// Opt-in test of the on-device image recognition with real photos.
//
//   npm run test:ai
//
// WARNING: this downloads real photos of spiders into test/.spider-photos/
// (ignored by git, with neutral file names). Nothing is shown on screen, but
// don't open that folder if you'd rather not see them.
//
// The photos come from a public set of ImageNet samples. The model was trained on
// ImageNet, so these are easy cases: this checks that the pipeline works end to
// end, not how accurate it is on the wider web.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startServer, launch, states, PHOTOS } from './e2e/harness.mjs';

const SOURCE = 'https://raw.githubusercontent.com/EliSchwartz/imagenet-sample-images/master/';
const SPIDERS = [
  'n01773797_garden_spider',
  'n01774384_black_widow',
  'n01774750_tarantula',
  'n01775062_wolf_spider',
  'n01773157_black_and_gold_garden_spider',
  'n01773549_barn_spider',
  'n01770081_harvestman',
];
const OTHERS = [
  'n02099601_golden_retriever',
  'n02123045_tabby',
  'n09468604_valley',
  'n09428293_seashore',
  'n04285008_sports_car',
  'n07873807_pizza',
  'n03792782_mountain_bike',
  'n07747607_orange',
  'n11939491_daisy',
  'n02165456_ladybug',
  'n01978455_rock_crab',
];

let server;
let browser;

async function download(name, file) {
  try {
    await fs.access(file);
    return;
  } catch {
    // not cached yet
  }
  const res = await fetch(SOURCE + name + '.JPEG');
  if (!res.ok) throw new Error(`Could not download test photo ${name}: HTTP ${res.status}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

before(async () => {
  await fs.mkdir(PHOTOS, { recursive: true });
  const all = [...SPIDERS.map((n, i) => [n, `s${i}.jpg`]), ...OTHERS.map((n, i) => [n, `o${i}.jpg`])];
  await Promise.all(all.map(([name, file]) => download(name, path.join(PHOTOS, file))));
  // Neutral ids and file names: only the image content can give a spider away.
  const imgs = all.map(([, file]) => `<img id="${file.replace('.jpg', '')}" src="/photo/${file}" width="300">`).join('\n');
  await fs.writeFile(path.join(PHOTOS, 'index.html'), `<!doctype html><title>Photos</title><body>${imgs}</body>`);
  server = await startServer();
  browser = await launch();
});

after(async () => {
  await browser?.context.close();
  await server?.close();
});

test('recognises spider photos and leaves other photos alone', async () => {
  const page = await browser.context.newPage();
  const started = Date.now();
  await page.goto(server.origin + '/photo/index.html');
  // Images are scanned as they come near the screen, so scroll through the page.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
  });
  const spiderIds = SPIDERS.map((_, i) => `s${i}`);
  const otherIds = OTHERS.map((_, i) => `o${i}`);
  const result = await states(page, [...spiderIds, ...otherIds], { timeout: 60000 });
  const elapsed = Date.now() - started;

  const missed = spiderIds.filter((id) => result[id].state !== 'blocked').map((id) => SPIDERS[+id.slice(1)]);
  const wronglyHidden = otherIds.filter((id) => result[id].state !== 'ok').map((id) => OTHERS[+id.slice(1)]);
  console.log(`  ${SPIDERS.length + OTHERS.length} photos in ${elapsed} ms; missed: ${missed.join(', ') || 'none'}; wrongly hidden: ${wronglyHidden.join(', ') || 'none'}`);
  for (const id of spiderIds) assert.equal(result[id].why, 'ai', id);
  assert.deepEqual(missed, []);
  assert.deepEqual(wronglyHidden, []);
});
