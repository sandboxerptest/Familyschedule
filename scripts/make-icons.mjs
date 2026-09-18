/**
 * Renders the PWA icons from the same shapes as hearth.svg.
 *
 * Writing a tiny PNG encoder here keeps the project dependency-free — the
 * alternative was pulling in a rasteriser just to produce two static files.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));

function png(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size / 64;
  const put = (x, y, [r, g, b], alpha = 1) => {
    const i = (y * size + x) * 4;
    const blend = (channel, value) => Math.round(channel * (1 - alpha) + value * alpha);
    pixels[i] = blend(pixels[i], r);
    pixels[i + 1] = blend(pixels[i + 1], g);
    pixels[i + 2] = blend(pixels[i + 2], b);
    pixels[i + 3] = 255;
  };

  const inRoundedRect = (x, y, rx, ry, w, h, radius) => {
    if (x < rx || y < ry || x >= rx + w || y >= ry + h) return false;
    const cx = Math.min(Math.max(x, rx + radius), rx + w - radius);
    const cy = Math.min(Math.max(y, ry + radius), ry + h - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 + radius;
  };

  const dots = [[22, 35], [32, 35], [42, 35], [22, 45], [32, 45]];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!inRoundedRect(x, y, 0, 0, size, size, 16 * s)) continue;
      put(x, y, [11, 15, 22]);

      if (inRoundedRect(x, y, 12 * s, 14 * s, 40 * s, 38 * s, 8 * s)) {
        // Diagonal accent gradient, matching the SVG.
        const t = (x / size + y / size) / 2;
        put(x, y, [
          Math.round(116 + (155 - 116) * t),
          Math.round(165 + (123 - 165) * t),
          Math.round(255 + (240 - 255) * t),
        ]);
      }
      if (inRoundedRect(x, y, 12 * s, 14 * s, 40 * s, 11 * s, 8 * s) || (x >= 12 * s && x < 52 * s && y >= 20 * s && y < 25 * s)) {
        put(x, y, [255, 255, 255], 0.92);
      }
      for (const [dx, dy] of dots) {
        if ((x - dx * s) ** 2 + (y - dy * s) ** 2 <= (3.2 * s) ** 2) put(x, y, [11, 15, 22], 0.85);
      }
    }
  }

  return png(size, size, pixels);
}

for (const size of [192, 512]) {
  writeFileSync(`${OUT}hearth-${size}.png`, render(size));
  console.log(`wrote hearth-${size}.png`);
}
