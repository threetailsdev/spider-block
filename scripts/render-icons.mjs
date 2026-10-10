#!/usr/bin/env node
// Renders src/images/icon*.svg to the PNG sizes browsers and stores want.
// The PNGs are committed; run this after editing the SVGs.
//
//   node scripts/render-icons.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(ROOT, 'src', 'images');
const SIZES = [16, 32, 48, 96, 128];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const name of ['icon', 'icon-off']) {
    const svg = await fs.readFile(path.join(IMAGES, `${name}.svg`), 'utf8');
    for (const size of SIZES) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}</style>` +
          `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="${size}" height="${size}">`,
      );
      await page.locator('img').evaluate((img) => img.decode());
      await page.screenshot({ path: path.join(IMAGES, `${name}-${size}.png`), omitBackground: true });
    }
  }
  console.log(`Rendered ${SIZES.length * 2} icons into src/images/`);
} finally {
  await browser.close();
}
