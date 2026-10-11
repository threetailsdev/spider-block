#!/usr/bin/env node
// Renders src/images/icon*.svg to the PNG sizes browsers and stores want, plus
// the 1024x1024 app icon Apple's App Store needs for the Safari version (opaque,
// so it is drawn on a background). The PNGs are committed; run this after
// editing the SVGs.
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

  // Not shipped in the extension: added to the Xcode project by hand (docs/safari.md).
  const APP = 1024;
  const svg = await fs.readFile(path.join(IMAGES, 'icon.svg'), 'utf8');
  await page.setViewportSize({ width: APP, height: APP });
  await page.setContent(
    `<style>html,body{margin:0;background:#eef6f3;display:grid;place-items:center;height:100%}</style>` +
      `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="${APP * 0.72}" height="${APP * 0.72}">`,
  );
  await page.locator('img').evaluate((img) => img.decode());
  await fs.mkdir(path.join(ROOT, 'docs', 'safari'), { recursive: true });
  await page.screenshot({ path: path.join(ROOT, 'docs', 'safari', 'app-icon-1024.png') });
  console.log(`Rendered ${SIZES.length * 2} icons into src/images/ and the app icon into docs/safari/`);
} finally {
  await browser.close();
}
