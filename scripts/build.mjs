#!/usr/bin/env node
// Builds the extension for each browser from one source tree.
//
//   node scripts/build.mjs                 all browsers
//   node scripts/build.mjs chrome firefox  only some
//
// Output: dist/<browser>/ (load it unpacked while developing) and
// dist/spider-block-<browser>-<version>.zip (upload it to the store).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const TARGETS = ['chrome', 'edge', 'firefox', 'safari'];
const FIREFOX_ID = 'spider-block@threetailsdev.github.io';

// TensorFlow.js runs the image classifier. Copied unmodified from npm.
const VENDOR = {
  'tf-core.min.js': '@tensorflow/tfjs-core/dist/tf-core.min.js',
  'tf-backend-cpu.min.js': '@tensorflow/tfjs-backend-cpu/dist/tf-backend-cpu.min.js',
  'tf-converter.min.js': '@tensorflow/tfjs-converter/dist/tf-converter.min.js',
  'tf-backend-wasm.min.js': '@tensorflow/tfjs-backend-wasm/dist/tf-backend-wasm.min.js',
  'tfjs-backend-wasm.wasm': '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm',
  'tfjs-backend-wasm-simd.wasm': '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm',
};

const BACKGROUND_SCRIPTS = [
  'vendor/tf-core.min.js',
  'vendor/tf-backend-cpu.min.js',
  'vendor/tf-converter.min.js',
  'vendor/tf-backend-wasm.min.js',
  'shared/browser-api.js',
  'shared/settings.js',
  'background/classifier.js',
  'background/image-loader.js',
  'background/background.js',
];

const CONTENT_SCRIPTS = [
  'shared/browser-api.js',
  'shared/settings.js',
  'shared/terms.js',
  'content/assets.js',
  'content/content.js',
];

// Source-only files that are not shipped.
const SKIP = new Set(['content/content.css', 'images/icon.svg', 'images/icon-off.svg']);

function manifest(target, version) {
  const icons = Object.fromEntries([16, 32, 48, 96, 128].map((s) => [s, `images/icon-${s}.png`]));
  const base = {
    manifest_version: 3,
    name: 'Spider Block',
    version,
    description:
      'Hides pictures of spiders as you browse, for people with arachnophobia. Works privately on your device.',
    icons,
    action: {
      default_title: 'Spider Block',
      default_popup: 'popup/popup.html',
      default_icon: { 16: icons[16], 32: icons[32], 48: icons[48] },
    },
    options_ui: { page: 'options/options.html', open_in_tab: true },
    permissions: ['storage', 'contextMenus', 'scripting'],
    host_permissions: ['<all_urls>'],
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: CONTENT_SCRIPTS,
        css: ['content/content.css'],
        run_at: 'document_start',
        all_frames: true,
        match_about_blank: true,
      },
    ],
    commands: {
      'hide-all-images': {
        suggested_key: { default: 'Alt+Shift+H' },
        description: 'Hide or show all images on the current page',
      },
    },
    content_security_policy: {
      // WebAssembly runs the image classifier; no other code is ever evaluated.
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  };

  switch (target) {
    case 'chrome':
    case 'edge':
      return {
        ...base,
        minimum_chrome_version: '110',
        background: { service_worker: 'background/background.js' },
        content_scripts: [{ ...base.content_scripts[0], match_origin_as_fallback: true }],
      };
    case 'firefox':
      return {
        ...base,
        // Firefox protects already-open tabs by itself, so it needs no "scripting".
        permissions: ['storage', 'contextMenus'],
        background: { scripts: BACKGROUND_SCRIPTS },
        browser_specific_settings: {
          gecko: {
            id: FIREFOX_ID,
            // 140 (the current ESR) is the first version that understands the
            // data_collection_permissions declaration addons.mozilla.org requires.
            strict_min_version: '140.0',
            data_collection_permissions: { required: ['none'] },
          },
          gecko_android: { strict_min_version: '142.0' },
        },
      };
    case 'safari':
      return {
        ...base,
        background: { scripts: BACKGROUND_SCRIPTS, persistent: false },
        browser_specific_settings: { safari: { strict_min_version: '16.4' } },
      };
    default:
      throw new Error(`Unknown target ${target}`);
  }
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function svgDataUri(svg) {
  // Compact and safe inside url("...") in CSS and in JS strings.
  const compact = svg.replace(/\s*\n\s*/g, ' ').trim();
  return `data:image/svg+xml,${encodeURIComponent(compact).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/')}`;
}

async function assets() {
  const shield = svgDataUri(await fs.readFile(path.join(SRC, 'images', 'cover-shield.svg'), 'utf8'));
  const sceneFiles = (await fs.readdir(path.join(SRC, 'images', 'scenes'))).filter((f) => f.endsWith('.svg')).sort();
  const scenes = [];
  for (const f of sceneFiles) scenes.push(svgDataUri(await fs.readFile(path.join(SRC, 'images', 'scenes', f), 'utf8')));
  return { shield, scenes };
}

async function contentCss({ shield, scenes }) {
  let css = await fs.readFile(path.join(SRC, 'content', 'content.css'), 'utf8');
  css = css.replaceAll('%%shield%%', shield);
  scenes.forEach((uri, i) => (css = css.replaceAll(`%%scene-${i}%%`, uri)));
  const leftover = css.match(/%%[\w-]+%%/);
  if (leftover) throw new Error(`content.css: no image for ${leftover[0]}`);
  return css;
}

// ------------------------------------------------------------------ zip writer

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  // files: [{ name, data }]; fixed timestamp keeps builds reproducible.
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1; // 1980-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ----------------------------------------------------------------------- build

async function build(target, version, shared) {
  const out = path.join(DIST, target);
  await fs.rm(out, { recursive: true, force: true });
  const files = new Map(); // relative path -> Buffer

  for (const rel of await walk(SRC)) {
    if (!SKIP.has(rel)) files.set(rel, await fs.readFile(path.join(SRC, rel)));
  }
  files.set('content/content.css', Buffer.from(shared.css));
  files.set(
    'content/assets.js',
    Buffer.from(
      '// Generated by scripts/build.mjs from src/images. Inline images avoid web-accessible files.\n' +
        `globalThis.SpiderBlockAssets = ${JSON.stringify(shared.assets)};\n`,
    ),
  );
  for (const [name, from] of Object.entries(VENDOR)) {
    files.set(`vendor/${name}`, await fs.readFile(path.join(ROOT, 'node_modules', from)));
  }
  // The Apache-2.0 notices for TensorFlow.js and the model travel with the package.
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) files.set(name, await fs.readFile(path.join(ROOT, name)));
  const m = manifest(target, version);
  files.set('manifest.json', Buffer.from(JSON.stringify(m, null, 2) + '\n'));

  // Every file the manifest points at must exist.
  const referenced = [
    ...Object.values(m.icons),
    m.action.default_popup,
    m.options_ui.page,
    ...m.content_scripts.flatMap((c) => [...c.js, ...c.css]),
    ...(m.background.scripts || [m.background.service_worker]),
    'model/model.json',
  ];
  for (const ref of referenced) if (!files.has(ref)) throw new Error(`${target}: missing ${ref}`);

  const sorted = [...files.keys()].sort();
  for (const rel of sorted) {
    await fs.mkdir(path.dirname(path.join(out, rel)), { recursive: true });
    await fs.writeFile(path.join(out, rel), files.get(rel));
  }
  const archive = zip(sorted.map((name) => ({ name, data: files.get(name) })));
  const zipPath = path.join(DIST, `spider-block-${target}-${version}.zip`);
  await fs.writeFile(zipPath, archive);
  console.log(`${target.padEnd(8)} dist/${target}/  ${path.relative(ROOT, zipPath)} (${(archive.length / 1e6).toFixed(1)} MB)`);
}

async function main() {
  const wanted = process.argv.slice(2);
  const targets = wanted.length ? wanted : TARGETS;
  for (const t of targets) if (!TARGETS.includes(t)) throw new Error(`Unknown browser "${t}". Use: ${TARGETS.join(', ')}`);
  const { version } = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const imageAssets = await assets();
  const shared = { assets: imageAssets, css: await contentCss(imageAssets) };
  await fs.mkdir(DIST, { recursive: true });
  for (const target of targets) await build(target, version, shared);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
