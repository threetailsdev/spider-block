// Downloads an image and cuts it into the 224x224 views the classifier reads.
(function (root) {
  'use strict';

  const SIZE = 224;
  const MAX_BYTES = 30 * 1024 * 1024;
  const TIMEOUT_MS = 15000;

  // Views of the image as [x, y, width, height] fractions. The whole image catches
  // most spiders; the zoomed views find small ones in larger photos.
  const WHOLE = [0, 0, 1, 1];
  const CENTER = [0.2, 0.2, 0.6, 0.6];
  const CORNERS = [
    [0, 0, 0.6, 0.6],
    [0.4, 0, 0.6, 0.6],
    [0, 0.4, 0.6, 0.6],
    [0.4, 0.4, 0.6, 0.6],
  ];

  // Zoomed views of a small image add little, so thumbnails get fewer views.
  function views(bitmap, set) {
    const shortSide = Math.min(bitmap.width, bitmap.height);
    if (set === 'corners') return shortSide >= 200 ? CORNERS : [];
    return shortSide >= 160 ? [WHOLE, CENTER] : [WHOLE];
  }

  class ScanError extends Error {}

  async function download(url, credentials) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { signal: controller.signal, credentials, cache: 'force-cache' });
    } finally {
      clearTimeout(timer);
    }
  }

  async function load(url) {
    if (!/^(https?|data):/i.test(url)) throw new ScanError('unsupported-url');
    let res = await download(url, 'omit');
    // Some sites only serve images to signed-in visitors.
    if (res.status === 401 || res.status === 403) res = await download(url, 'include');
    if (!res.ok) throw new ScanError(`http-${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (/svg/i.test(type)) throw new ScanError('svg');
    const blob = await res.blob();
    if (blob.size > MAX_BYTES) throw new ScanError('too-large');
    try {
      return await createImageBitmap(blob);
    } catch {
      throw new ScanError('undecodable');
    }
  }

  function makeCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  // Returns the views in `set` ('first' or 'corners') as one Float32Array of
  // RGB values in 0..1.
  function toPixels(bitmap, set = 'first') {
    const w = bitmap.width;
    const h = bitmap.height;
    const crops = views(bitmap, set);
    const canvas = makeCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const plane = SIZE * SIZE * 3;
    const out = new Float32Array(crops.length * plane);
    crops.forEach(([x, y, cw, ch], i) => {
      // Transparent areas become white rather than black.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(bitmap, x * w, y * h, cw * w, ch * h, 0, 0, SIZE, SIZE);
      const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
      let o = i * plane;
      for (let p = 0; p < rgba.length; p += 4) {
        out[o++] = rgba[p] / 255;
        out[o++] = rgba[p + 1] / 255;
        out[o++] = rgba[p + 2] / 255;
      }
    });
    return { pixels: out, count: crops.length };
  }

  root.SpiderBlockImages = Object.freeze({ load, toPixels, ScanError });
})(globalThis);
