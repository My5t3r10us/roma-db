// Génère assets/icon.png (1024²) et assets/icon.ico : icône 3D façon macOS (squircle + cylindre de base de données en verre).
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";

const S = 1024;
// usage : node scripts/make-icon.mjs [palette] | --preview <fichier.png>
const args = process.argv.slice(2);
const PREVIEW = args[0] === "--preview" ? args[1] : null;
const SS = PREVIEW ? 1 : 3;
const CX = 512;
const CY = 500;
const A = 412; // demi-côté du squircle (grille macOS 824/1024)
const N = 5; // exposant du superellipse
const RX = 228;
const RY = 76;
const DISC_H = 118;
const GAP = 24;
const TOP0 = CY - (3 * DISC_H + 2 * GAP + 2 * RY) / 2 + RY;
const DISCS = [2, 1, 0].map((i) => ({ i, top: TOP0 + i * (DISC_H + GAP) }));

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c, d, t) => [lerp(c[0], d[0], t), lerp(c[1], d[1], t), lerp(c[2], d[2], t)];
const smooth = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const hex = (h) => [h >> 16, (h >> 8) & 255, h & 255];

// palettes : fond (haut-gauche, milieu, bas-droite), verre, faces supérieures, ombre, lueur, bords
const PALETTES = {
  violet: [0x9d8cff, 0x6a4cf2, 0x3a1fb8, 0x7f69ee, 0xf3f0ff, 0xd9d1ff, 0x1a0b5c, 0xb7a8ff, 0x24107a, 0x5a3fd6],
  ocean: [0x7fd4ff, 0x1f8bff, 0x0a3fb0, 0x5f9ff0, 0xf0f7ff, 0xcfe4ff, 0x061a4a, 0x9fd0ff, 0x08287a, 0x2f6fd0],
  graphite: [0x5b616e, 0x2a2e37, 0x0e0f13, 0x8a93a6, 0xf4f6fa, 0xd5dae4, 0x000000, 0x6c7488, 0x000000, 0x4a5163],
  sunset: [0xb69cff, 0xff7eb6, 0xffb36b, 0xe58fc0, 0xfff5f8, 0xffdbe8, 0x5a1a4a, 0xffd0e4, 0x7a2050, 0xd0609a],
  emerald: [0x7af0c4, 0x14b88a, 0x055c4a, 0x52c4a0, 0xf0fff9, 0xcdf5e6, 0x022a22, 0xa0f0d4, 0x033d30, 0x1e8f6e],
  aurora: [0x7af0c4, 0x1f8f9e, 0x1a3466, 0x5fa8b8, 0xf0fffa, 0xd0ecf0, 0x061a2c, 0x9fe8dc, 0x0a2240, 0x2a6f8a],
  postgres: [0x6fa8e8, 0x336791, 0x16304d, 0x6f94bf, 0xf2f7fc, 0xd2e1f0, 0x0a1a2c, 0x8fb8e0, 0x0c2238, 0x2c5884],
};
const WHITE = [255, 255, 255];
let BG_TL, BG_MID, BG_BR, GLASS_DARK, TOP_BACK, TOP_FRONT, SHADOW, GLOW, RIM_DARK, EDGE;
const GLASS_LIGHT = WHITE;
function usePalette(name) {
  [BG_TL, BG_MID, BG_BR, GLASS_DARK, TOP_BACK, TOP_FRONT, SHADOW, GLOW, RIM_DARK, EDGE] = PALETTES[name].map(hex);
}

// distance signée approximative au squircle
function squircle(x, y, ox = 0, oy = 0, a = A) {
  const u = Math.abs(x - CX - ox) / a;
  const v = Math.abs(y - CY - oy) / a;
  return (Math.pow(Math.pow(u, N) + Math.pow(v, N), 1 / N) - 1) * a;
}
const ellipseD = (x, y, cx, cy, rx, ry) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);

// composition « over » sur [r,g,b,a] (couleur non prémultipliée)
function over(dst, col, a) {
  if (a <= 0) return;
  const oa = a + dst[3] * (1 - a);
  for (let k = 0; k < 3; k++) dst[k] = (col[k] * a + dst[k] * dst[3] * (1 - a)) / oa;
  dst[3] = oa;
}

function background(x, y) {
  const t = clamp((x - (CX - A) + (y - (CY - A))) / (4 * A));
  let c = t < 0.5 ? mix(BG_TL, BG_MID, t * 2) : mix(BG_MID, BG_BR, (t - 0.5) * 2);
  // reflet doux en haut à gauche
  c = mix(c, WHITE, 0.22 * Math.exp(-(((x - 330) / 380) ** 2 + ((y - 230) / 300) ** 2)));
  // lueur douce derrière le cylindre
  c = mix(c, GLOW, 0.25 * Math.exp(-(((x - CX) / 300) ** 2 + ((y - CY) / 320) ** 2)));
  return c;
}

function sample(x, y) {
  const out = [0, 0, 0, 0];
  // ombres portées de l'icône (diffuse + contact)
  over(out, SHADOW, 0.32 * (1 - smooth(-30, 46, squircle(x, y, 0, 18, A - 6))));
  over(out, SHADOW, 0.25 * (1 - smooth(-6, 10, squircle(x, y, 0, 5, A - 2))));

  const d = squircle(x, y);
  if (d > 0) return out;
  let c = background(x, y);
  // bord intérieur : liseré clair en haut, plus sombre en bas
  const rim = 1 - smooth(0, 10, -d);
  c = mix(c, WHITE, 0.45 * rim * clamp((CY - y) / A));
  c = mix(c, RIM_DARK, 0.35 * rim * clamp((y - CY) / A));

  // ombre du cylindre posée sur le fond
  const sh = ellipseD(x, y, CX + 10, DISCS[0].top + DISC_H + 34, RX + 30, RY + 26);
  c = mix(c, SHADOW, 0.42 * (1 - smooth(-60, 50, sh)));

  const dx = (x - CX) / RX;
  for (const { i, top } of DISCS) {
    const bottom = top + DISC_H;
    if (Math.abs(dx) <= 1) {
      const s = Math.sqrt(1 - dx * dx);
      if (y >= top && y <= bottom + RY * s) {
        // face latérale : éclairage cylindrique, lumière en haut à gauche
        const lam = clamp(-0.5 * dx + 0.86 * s);
        const spec = Math.pow(clamp(-0.28 * dx + 0.96 * s), 60);
        const vy = clamp((y - top) / (DISC_H + RY * s));
        let sc = mix(GLASS_DARK, GLASS_LIGHT, 0.25 + 0.75 * lam);
        sc = mix(sc, GLASS_DARK, 0.18 * vy);
        sc = mix(sc, WHITE, 0.8 * spec);
        // arête inférieure plus marquée
        sc = mix(sc, EDGE, 0.35 * (1 - smooth(0, 5, bottom + RY * s - y)));
        // ombre portée par le disque du dessus
        if (i > 0) sc = mix(sc, SHADOW, 0.25 * (1 - smooth(0, 26, y - (top + RY * s))));
        c = sc;
      }
    }
    // face supérieure
    const et = Math.hypot(dx, (y - top) / RY);
    if (et <= 1) {
      let tc = mix(TOP_BACK, TOP_FRONT, clamp((y - (top - RY)) / (2 * RY)));
      tc = mix(tc, WHITE, 0.7 * Math.exp(-(((x - CX + 70) / 120) ** 2 + ((y - top + 22) / 34) ** 2)));
      tc = mix(tc, WHITE, 0.9 * smooth(0.9, 1, et) * (y > top ? 1 : 0.5));
      if (i > 0) tc = mix(tc, GLASS_DARK, 0.55);
      c = tc;
    }
  }
  over(out, c, 1);
  return out;
}

function render() {
const px = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
    }
    const i = (y * S + x) * 4;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
    px[i + 3] = (a / (SS * SS)) * 255;
  }
}
return px;
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

if (PREVIEW) {
  // planche : toutes les palettes en 256², fond gris clair
  const names = Object.keys(PALETTES), T = 256, W = T * names.length;
  const sheet = Buffer.alloc(W * W * 4);
  for (let k = 0; k < W * T; k++) sheet.set([236, 236, 238, 255], k * 4);
  names.forEach((name, n) => {
    usePalette(name);
    const ic = downscale(render(), S, T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const o = (y * W + n * T + x) * 4, k = (y * T + x) * 4, al = ic[k + 3] / 255;
      for (let c = 0; c < 3; c++) sheet[o + c] = ic[k + c] * al + sheet[o + c] * (1 - al);
    }
  });
  // png() attend une image carrée : on ne garde que la première bande
  const raw = Buffer.alloc((W * 4 + 1) * T);
  for (let y = 0; y < T; y++) sheet.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(T, 4); ihdr[8] = 8; ihdr[9] = 6;
  await writeFile(PREVIEW, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  console.log(names.join(" | "));
  process.exit(0);
}

usePalette(args[0] ?? "aurora");
const px = render();
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
