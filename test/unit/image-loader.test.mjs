import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'background', 'image-loader.js');

// Loads image-loader.js with a fake fetch, and a clock where every timer fires
// after 20 ms so the download time limit can be tested quickly.
function loader(fetch) {
  const context = vm.createContext({
    AbortController,
    URL,
    fetch,
    setTimeout: (fn) => setTimeout(fn, 20),
    clearTimeout,
    createImageBitmap: async (blob) => ({ width: 1, height: 1, size: blob.size }),
  });
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, { filename: 'image-loader.js' });
  return context.SpiderBlockImages;
}

// A response whose body sends a few bytes and then never finishes.
function endless(signal, type = 'image/png') {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16));
      signal.addEventListener('abort', () => controller.error(signal.reason));
    },
  });
  return new Response(body, { headers: { 'content-type': type } });
}

test('a body that never finishes downloading times out', async () => {
  const Images = loader(async (url, { signal }) => endless(signal));
  await assert.rejects(Images.load('https://example.com/stalled.png'), (err) => err.message === 'timeout');
});

test('webcam streams are not downloaded', async () => {
  const Images = loader(async (url, { signal }) => endless(signal, 'multipart/x-mixed-replace; boundary=frame'));
  await assert.rejects(Images.load('https://example.com/cam.mjpg'), (err) => err.message === 'stream');
});

test('ordinary images still load, and errors keep their reasons', async () => {
  let calls = [];
  const Images = loader(async (url, { credentials }) => {
    calls.push(credentials);
    if (url.endsWith('private.png') && credentials === 'omit') return new Response('', { status: 403 });
    if (url.endsWith('missing.png')) return new Response('', { status: 404 });
    if (url.endsWith('.svg')) return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
    return new Response(new Uint8Array(32), { headers: { 'content-type': 'image/png' } });
  });
  assert.equal((await Images.load('https://example.com/a.png')).size, 32);
  calls = [];
  assert.equal((await Images.load('https://example.com/private.png', 'https://www.example.com/page')).size, 32);
  assert.deepEqual(calls, ['omit', 'include']);
  await assert.rejects(Images.load('https://example.com/missing.png'), (err) => err.message === 'http-404');
  await assert.rejects(Images.load('https://example.com/a.svg'), (err) => err.message === 'svg');
  await assert.rejects(Images.load('blob:https://example.com/x'), (err) => err.message === 'unsupported-url');
});

test("cookies are only sent to the page's own site", async () => {
  const calls = [];
  const Images = loader(async (url, { credentials }) => {
    calls.push(`${new URL(url).hostname} ${credentials}`);
    return new Response('', { status: credentials === 'omit' ? 403 : 200 });
  });
  const refused = (err) => err.message === 'http-403';
  await assert.rejects(Images.load('https://bank.example/transfer', 'https://evil.test/page'), refused);
  await assert.rejects(Images.load('http://192.168.0.1/reboot', 'https://evil.test/page'), refused);
  await assert.rejects(Images.load('https://notexample.com/a.png', 'https://example.com/'), refused);
  await assert.rejects(Images.load('https://example.com/a.png'), refused);
  assert.deepEqual(calls, [
    'bank.example omit',
    '192.168.0.1 omit',
    'notexample.com omit',
    'example.com omit',
  ]);
});
