// What a test page shows: the highlight the page agent registered, and what is actually
// painted, read from a Playwright screenshot's pixels.
import { inflateSync } from 'node:zlib';

// The texts of the ranges in the Pyramid Reader highlight, whitespace collapsed as the reader
// reads them (a range spans raw DOM text), or null when there is no highlight.
export const highlighted = (page) => page.evaluate(() => {
  const h = CSS.highlights.get('pyramid-reader');
  return h ? [...h].map((r) => r.toString().replace(/\s+/g, ' ').trim()) : null;
});

// The page's paint (the page agent's paint op): each pr-* highlight's range texts, as above.
export const painted = (page) => page.evaluate(() => Object.fromEntries([...CSS.highlights]
  .filter(([name]) => name.startsWith('pr-'))
  .map(([name, h]) => [name, [...h].map((r) => r.toString().replace(/\s+/g, ' ').trim())])));

// Handles the PNGs Chrome emits: 8-bit RGB or RGBA, not interlaced.
function decodePng(buf) {
  let pos = 8;
  let width, height, channels;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colorType, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) throw new Error('unsupported PNG');
      channels = colorType === 6 ? 4 : 3;
    }
    if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a
        : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][filter];
      out[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { width, height, pixel: (x, y) => [...out.subarray((y * width + x) * channels, (y * width + x) * channels + 3)] };
}

// Share of pixels within `tolerance` (per channel) of the colour [r, g, b].
export function colorShare(png, [r, g, b], tolerance = 12) {
  const { width, height, pixel } = decodePng(png);
  let hits = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [pr, pg, pb] = pixel(x, y);
      if (Math.abs(pr - r) <= tolerance && Math.abs(pg - g) <= tolerance && Math.abs(pb - b) <= tolerance) hits++;
    }
  }
  return hits / (width * height);
}
