import assert from 'node:assert/strict';
import { inflateSync, crc32 } from 'node:zlib';
import { encodeCompactGrayscalePng, encodeGrayscalePng } from '../src/pngEncoder.ts';

// Decode independently of the encoder and check the actual transport format.
function decode(bytes, width, height) {
  const png = Buffer.from(bytes);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  const idat = [];
  const types = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(png.readUInt32BE(offset + 8 + length), crc32(png.subarray(offset + 4, offset + 8 + length)));
    types.push(type);
    if (type === 'IHDR') {
      assert.equal(data.readUInt32BE(0), width);
      assert.equal(data.readUInt32BE(4), height);
      assert.deepEqual([...data.subarray(8)], [8, 0, 0, 0, 0]);
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, (width + 1) * height);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width + 1)], 0);
    pixels.set(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width);
  }
  return pixels;
}

let fixtures = 0;
for (const [width, height] of [[1, 1], [7, 11], [200, 144], [200,126], [244,122], [100,120]]) {
  for (const pattern of [(i) => i % 256, (i) => i % 4 === 0 ? 102 : 0, () => 0]) {
    const pixels = Uint8Array.from({ length: width * height }, (_, i) => pattern(i));
    assert.deepEqual(decode(await encodeCompactGrayscalePng(width, height, pixels), width, height), pixels);
    fixtures++;
  }
}

const original = globalThis.CompressionStream;
const pixels = Uint8Array.from({ length: 200 * 144 }, (_, i) => i % 8 ? 0 : 34);
try {
  for (const unsupported of [undefined, class { constructor() { throw Error('Unsupported WebView'); } }]) {
    globalThis.CompressionStream = unsupported;
    const png = await encodeCompactGrayscalePng(200, 144, pixels);
    assert.deepEqual(png, encodeGrayscalePng(200, 144, pixels));
    assert.deepEqual(decode(png, 200, 144), pixels);
  }
} finally { globalThis.CompressionStream = original; }
console.log(JSON.stringify({ passed: true, decodedFixtures: fixtures, fallbackCases: 2 }));
