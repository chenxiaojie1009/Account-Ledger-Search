const fs = require('fs');
const zlib = require('zlib');

function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.slice(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

function stats(png, rx, ry, rw, rh) {
  const { w, h, bpp, data } = png;
  const x0 = Math.max(0, Math.round(rx * w)), y0 = Math.max(0, Math.round(ry * h));
  const x1 = Math.min(w, Math.round((rx + rw) * w)), y1 = Math.min(h, Math.round((ry + rh) * h));
  let sum = [0, 0, 0], n = 0, colorful = 0, bright = 0, dark = 0;
  const colors = new Set();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * bpp;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      sum[0] += r; sum[1] += g; sum[2] += b;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      if (Math.abs(r - g) > 18 || Math.abs(g - b) > 18) colorful++;
      if (r > 110 && g > 110 && b > 110) bright++;
      if (r < 140 && g < 140 && b < 140) dark++;
      n++;
    }
  }
  if (!n) return { error: 'empty region' };
  return {
    avg: sum.map((v) => Math.round(v / n)),
    unique: colors.size,
    colorfulPct: Math.round((colorful / n) * 100),
    brightPct: Math.round((bright / n) * 100),
    darkPct: +((dark / n) * 100).toFixed(2)
  };
}

module.exports = { decodePNG, stats };
