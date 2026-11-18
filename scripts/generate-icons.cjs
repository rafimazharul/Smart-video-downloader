/**
 * Generates crisp multi-resolution PNG and ICO icons for Smart Video Downloader
 * using pure Node.js (zero native dependencies).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    r
  );
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.6 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Normalized coordinates [-1, 1]
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;

      // Outer rounded square background
      const dBg = sdRoundedBox(u, v, 0.88, 0.88, 0.38);
      const bgAlpha = 1 - smoothstep(-aa, aa, dBg);

      if (bgAlpha <= 0.001) {
        continue;
      }

      // Diagonal Emerald (#10B981) -> Aqua-Teal (#2DD4BF) gradient
      const t = clamp((u + v + 1.8) / 3.6, 0, 1);
      let r = 16 * (1 - t) + 45 * t;
      let g = 185 * (1 - t) + 212 * t;
      let b = 129 * (1 - t) + 191 * t;

      // Subtle inner glossy highlight at top-left
      const glow = Math.exp(-((u + 0.45) ** 2 + (v + 0.55) ** 2) * 1.8) * 0.22;
      r = clamp(r + glow * 255, 0, 255);
      g = clamp(g + glow * 255, 0, 255);
      b = clamp(b + glow * 255, 0, 255);

      // Subtle inner border ring
      const borderAlpha =
        (1 - smoothstep(0.0, aa * 2, Math.abs(dBg + 0.035))) * 0.25;
      r = r * (1 - borderAlpha) + 255 * borderAlpha;
      g = g * (1 - borderAlpha) + 255 * borderAlpha;
      b = b * (1 - borderAlpha) + 255 * borderAlpha;

      // White bold downward download arrow + tray bar
      const dShaft = sdSegment(u, v, 0, -0.44, 0, 0.16) - 0.105;
      const dLeft = sdSegment(u, v, -0.34, -0.06, 0, 0.27) - 0.105;
      const dRight = sdSegment(u, v, 0.34, -0.06, 0, 0.27) - 0.105;
      const dTray = sdSegment(u, v, -0.44, 0.52, 0.44, 0.52) - 0.088;

      const dGlyph = Math.min(dShaft, dLeft, dRight, dTray);
      const glyphAlpha = 1 - smoothstep(-aa, aa, dGlyph);

      // Soft drop shadow behind glyph
      const dShadow = Math.min(
        sdSegment(u, v - 0.05, 0, -0.44, 0, 0.16) - 0.11,
        sdSegment(u, v - 0.05, -0.34, -0.06, 0, 0.27) - 0.11,
        sdSegment(u, v - 0.05, 0.34, -0.06, 0, 0.27) - 0.11,
        sdSegment(u, v - 0.05, -0.44, 0.52, 0.44, 0.52) - 0.095
      );
      const shadowAlpha = (1 - smoothstep(-aa * 4, aa * 6, dShadow)) * 0.22;

      r = r * (1 - shadowAlpha) + 15 * shadowAlpha;
      g = g * (1 - shadowAlpha) + 23 * shadowAlpha;
      b = b * (1 - shadowAlpha) + 42 * shadowAlpha;

      // Composite white glyph
      r = r * (1 - glyphAlpha) + 255 * glyphAlpha;
      g = g * (1 - glyphAlpha) + 255 * glyphAlpha;
      b = b * (1 - glyphAlpha) + 255 * glyphAlpha;

      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(clamp(r, 0, 255));
      rgba[idx + 1] = Math.round(clamp(g, 0, 255));
      rgba[idx + 2] = Math.round(clamp(b, 0, 255));
      rgba[idx + 3] = Math.round(clamp(bgAlpha * 255, 0, 255));
    }
  }
  return encodePng(size, size, rgba);
}

function buildIco(pngEntries) {
  const count = pngEntries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (const { size, data } of pngEntries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngEntries.map((e) => e.data)]);
}

const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'assets');
const buildDir = path.join(rootDir, 'build');
const extIconsDir = path.join(rootDir, 'browser-extension', 'icons');
fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(extIconsDir, { recursive: true });

const sizes = [16, 32, 48, 64, 128, 256];
const entries = sizes.map((size) => ({ size, data: renderIcon(size) }));

const icoData = buildIco(entries);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), entries.find((e) => e.size === 256).data);
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), entries.find((e) => e.size === 32).data);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoData);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoData);

for (const extSize of [16, 32, 48, 128]) {
  fs.writeFileSync(
    path.join(extIconsDir, `icon${extSize}.png`),
    entries.find((e) => e.size === extSize).data
  );
}

console.log('Generated app, tray, ICO, and browser-extension icons successfully.');
