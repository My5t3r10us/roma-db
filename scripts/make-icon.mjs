// Génère assets/icon.png (1024²) et assets/icon.ico : cylindre de base de données sur carré arrondi.
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";

const S = 1024;
const SS = 3;
const R = 230;
const CX = 512;
const RX = 240;
const RY = 100;
const TOP = 330;
const BOT = 694;
const BANDS = [462, 578];
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [h >> 16, (h >> 8) & 255, h & 255];
const C0 = hex(0x7d66ff);
const C1 = hex(0x4a30d8);
const CAP = [255, 255, 255];
const BODY = hex(0xe4dfff);
const LINE = hex(0x5a3fe6);

function sample(x, y) {
  // carré arrondi
  const qx = Math.abs(x - S / 2) - (S / 2 - 64 - R);
  const qy = Math.abs(y - S / 2) - (S / 2 - 64 - R);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R;
  if (out > 0) return null;
  const t = y / S;
  let c = [lerp(C0[0], C1[0], t), lerp(C0[1], C1[1], t), lerp(C0[2], C1[2], t)];
  const dx = (x - CX) / RX;
  const ell = (cy) => Math.hypot(dx, (y - cy) / RY);
  const inTop = ell(TOP) <= 1;
  const inBody = Math.abs(dx) <= 1 && y >= TOP && y <= BOT;
  const inBot = ell(BOT) <= 1;
  if (inTop) return CAP;
  if (inBody || inBot) {
    for (const cy of BANDS) {
      if (Math.abs(y - (cy + RY * Math.sqrt(1 - dx * dx))) < 13) return LINE;
    }
    return BODY;
  }
  return c;
}

const px = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
    }
    const i = (y * S + x) * 4;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
    px[i + 3] = (a / (SS * SS)) * 255;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(rgba, w) {
  const raw = Buffer.alloc((w * 4 + 1) * w);
  for (let y = 0; y < w; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
function downscale(src, from, to) {
  const f = from / to;
  const out = Buffer.alloc(to * to * 4);
  for (let y = 0; y < to; y++) for (let x = 0; x < to; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
      const k = ((y * f + j) * from + x * f + i) * 4;
      const w = src[k + 3];
      r += src[k] * w; g += src[k + 1] * w; b += src[k + 2] * w; a += w;
    }
    const o = (y * to + x) * 4;
    if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    out[o + 3] = a / (f * f);
  }
  return out;
}

const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map((s) => png(downscale(px, S, s), s));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = head.length;
sizes.forEach((s, n) => {
  const e = 6 + n * 16;
  head[e] = s === 256 ? 0 : s; head[e + 1] = s === 256 ? 0 : s;
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(images[n].length, e + 8); head.writeUInt32LE(off, e + 12);
  off += images[n].length;
});
await mkdir("assets", { recursive: true });
await writeFile("assets/icon.png", png(px, S));
await writeFile("assets/icon.ico", Buffer.concat([head, ...images]));
console.log("assets/icon.png et assets/icon.ico générés");
