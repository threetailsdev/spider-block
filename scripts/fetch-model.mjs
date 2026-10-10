#!/usr/bin/env node
// Downloads Google's MobileNet v2 (1.0, 224px) image classifier in TensorFlow.js
// format, verifies it against pinned checksums, shrinks the weights, and writes
// the result to src/model/. The output is committed to the repo, so you only
// need to run this to reproduce or update the bundled model.
//
//   node scripts/fetch-model.mjs [--dtype float16|uint8|float32] [--from <dir>] [--out <dir>]
//
// The model is licensed under Apache-2.0 (see THIRD_PARTY_NOTICES.md).

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/';
const FILES = {
  'model.json': '12e180771864a87473ae06988b8564d9fd077b11c1854030e90509917203cf6f',
  'group1-shard1of4': 'b837ab72b76b59e217750e0afed94b8f877fce7fff71b8d9cead71fc11612d8c',
  'group1-shard2of4': '4b9b02a59ecfea1a698a576f1400e876170ef78abe0e06b16195ebfe2983f6d5',
  'group1-shard3of4': 'fab6533531d17b78ad67223c82d9a452263ccc4d309a20db91a5de3714aa6a00',
  'group1-shard4of4': '617fd3639ac5cfb94a971bef032fcdfa7690816d524117f54a9cc693d0b2c5f4',
};

// float16 is the default because it is lossless for this model. Per-tensor uint8
// halves the size again but drops ImageNet top-1 accuracy from ~87% to ~74% and
// misses some spider photos entirely.
function parseArgs(argv) {
  const args = { dtype: 'float16', from: null, out: path.join(ROOT, 'src', 'model') };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args)) throw new Error(`Unknown option ${argv[i]}`);
    args[key] = argv[++i];
  }
  if (!['uint8', 'float16', 'float32'].includes(args.dtype)) throw new Error(`Unsupported dtype ${args.dtype}`);
  return args;
}

async function readSource(name, fromDir) {
  let buf;
  if (fromDir) {
    buf = await fs.readFile(path.join(fromDir, name));
  } else {
    const res = await fetch(BASE_URL + name);
    if (!res.ok) throw new Error(`Download failed for ${name}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const digest = createHash('sha256').update(buf).digest('hex');
  if (digest !== FILES[name]) throw new Error(`Checksum mismatch for ${name}: got ${digest}`);
  return buf;
}

// IEEE 754 binary32 -> binary16 with round-to-nearest-even.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toFloat16(value) {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let half = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    if (rem > mid || (rem === mid && (half & 1))) half++;
    return sign | half;
  }
  let half = sign | (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half++;
  return half;
}

function quantize(values, dtype) {
  if (dtype === 'float32') return { data: Buffer.from(values.buffer, values.byteOffset, values.byteLength) };
  if (dtype === 'float16') {
    const out = new Uint16Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = toFloat16(values[i]);
    return { data: Buffer.from(out.buffer), quantization: { dtype: 'float16' } };
  }
  // Affine uint8: value ~= q * scale + min. The range is nudged so that 0.0 is
  // exactly representable, matching the official tfjs converter.
  let min = 0;
  let max = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max === min) max = min + 1;
  let scale = (max - min) / 255;
  const zero = Math.round(-min / scale);
  min = -zero * scale;
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round((values[i] - min) / scale)));
  }
  return { data: Buffer.from(out.buffer), quantization: { dtype: 'uint8', min, scale } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const model = JSON.parse((await readSource('model.json', args.from)).toString('utf8'));
  const [group] = model.weightsManifest;
  const shards = [];
  for (const p of group.paths) shards.push(await readSource(p, args.from));
  const blob = Buffer.concat(shards);

  const chunks = [];
  const weights = [];
  let offset = 0;
  for (const spec of group.weights) {
    if (spec.dtype !== 'float32') throw new Error(`Unexpected dtype ${spec.dtype} for ${spec.name}`);
    const count = spec.shape.reduce((a, b) => a * b, 1);
    const values = new Float32Array(blob.buffer.slice(blob.byteOffset + offset, blob.byteOffset + offset + count * 4));
    offset += count * 4;
    const { data, quantization } = quantize(values, args.dtype);
    chunks.push(data);
    weights.push(quantization ? { ...spec, quantization } : spec);
  }
  if (offset !== blob.length) throw new Error('Weight manifest does not match shard sizes');

  await fs.mkdir(args.out, { recursive: true });
  const weightsFile = 'mobilenet_v2.bin';
  const output = {
    format: 'graph-model',
    generatedBy: `spider-block scripts/fetch-model.mjs (${args.dtype})`,
    modelTopology: model.modelTopology,
    weightsManifest: [{ paths: [weightsFile], weights }],
  };
  await fs.writeFile(path.join(args.out, 'model.json'), JSON.stringify(output));
  await fs.writeFile(path.join(args.out, weightsFile), Buffer.concat(chunks));
  const size = chunks.reduce((s, c) => s + c.length, 0);
  console.log(`Wrote ${path.relative(ROOT, args.out)}/ (${(size / 1e6).toFixed(1)} MB of ${args.dtype} weights)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
