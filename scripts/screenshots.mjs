#!/usr/bin/env node
// Takes the screenshots in docs/screenshots/ (README and store listings) using
// the built Chrome extension and the spider-free demo page.
//
//   npm run build:chrome && node scripts/screenshots.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launch, setSettings, states, tabId } from '../test/e2e/harness.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
const server = await startServer();
const { context, worker, extensionId } = await launch();
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });

try {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const style of ['cover', 'scene']) {
    await setSettings(worker, { style });
    await page.goto(server.origin + '/demo.html');
    await states(page, ['hidden-1', 'hidden-2']);
    await page.waitForTimeout(400);
    await shot(page, `page-${style}`);
  }

  await setSettings(worker, { style: 'cover' });
  await page.reload();
  await states(page, ['hidden-1', 'hidden-2']);
  await page.click('#hidden-1');
  await page.waitForTimeout(300);
  await shot(page, 'reveal-panel');
  await page.keyboard.press('Escape');

  const id = await tabId(worker, server.origin + '/demo.html');
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 400 });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${id}`);
  await popup.waitForTimeout(600);
  await shot(popup, 'popup', { clip: { x: 0, y: 0, width: 358, height: await popup.evaluate(() => document.body.scrollHeight) } });

  const options = await context.newPage();
  await options.setViewportSize({ width: 1000, height: 1600 });
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.waitForTimeout(800);
  await shot(options, 'settings', { fullPage: true });

  const welcome = await context.newPage();
  await welcome.setViewportSize({ width: 1100, height: 900 });
  await welcome.goto(`chrome-extension://${extensionId}/welcome/welcome.html`);
  await welcome.waitForTimeout(500);
  await shot(welcome, 'welcome', { fullPage: true });

  await options.emulateMedia({ colorScheme: 'dark' });
  await options.waitForTimeout(300);
  await shot(options, 'settings-dark', { clip: { x: 0, y: 0, width: 1000, height: 900 } });

  // The Chrome Web Store only takes 1280x800 or 640x400 screenshots.
  await options.setViewportSize({ width: 1280, height: 800 });
  await options.waitForTimeout(300);
  await shot(options, 'store-settings-dark');
  await options.emulateMedia({ colorScheme: 'light' });
  await options.waitForTimeout(300);
  await shot(options, 'store-settings');

  // The popup, drawn over the demo page as if opened from the toolbar.
  const dataUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  const pageShot = await page.screenshot();
  const popupShot = await popup.screenshot({ clip: { x: 0, y: 0, width: 358, height: await popup.evaluate(() => document.body.scrollHeight) } });
  const composite = await context.newPage();
  await composite.setViewportSize({ width: 1280, height: 800 });
  await composite.setContent(`
    <body style="margin:0;width:1280px;height:800px;position:relative;overflow:hidden">
      <img src="${dataUri(pageShot)}" style="position:absolute;inset:0;filter:brightness(.92)">
      <img src="${dataUri(popupShot)}" style="position:absolute;top:12px;right:16px;border-radius:8px;
        box-shadow:0 8px 28px rgba(0,0,0,.28),0 0 0 1px rgba(0,0,0,.08)">
    </body>`);
  await composite.waitForTimeout(200);
  await shot(composite, 'store-popup');

  // Store promo tile (440x280).
  const promo = await context.newPage();
  await promo.setViewportSize({ width: 440, height: 280 });
  // Any extension page gives the tile an origin that may load the extension's icon.
  await promo.goto(`chrome-extension://${extensionId}/ui/ui.css`);
  await promo.setContent(`
    <body style="margin:0;width:440px;height:280px;display:flex;align-items:center;gap:22px;padding:0 34px;box-sizing:border-box;
      background:linear-gradient(135deg,#e3f0eb,#d3e5ee);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1d2b27">
      <img src="chrome-extension://${extensionId}/images/icon-128.png" width="104" height="104">
      <div><div style="font-size:34px;font-weight:750;line-height:1.1">Spider Block</div>
      <div style="font-size:17px;margin-top:8px;color:#3d524b">Browse without the scare.<br>Spider pictures, hidden.</div></div>
    </body>`);
  await promo.waitForTimeout(300);
  await shot(promo, 'promo-440x280');
  console.log(`Screenshots saved to ${path.relative(process.cwd(), OUT)}/`);
} finally {
  await context.close();
  await server.close();
}
