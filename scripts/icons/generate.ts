/**
 * Генератор іконок PWA: `npm run icons`.
 *
 * Малює іконку кодом і сам кодує PNG (zlib + CRC32), без ImageMagick/sharp:
 * інакше збірка іконок залежала б від того, що встановлено на машині, а
 * бінарники в репозиторії стали б файлами «звідкись».
 *
 * Сюжет іконки той самий, що й в апці: світла лінія маршруту з червоною дірою
 * посередині. На 192 px деталей більше не читається, тому їх і немає.
 */
import { crc32, deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = 'public/icons';

const BG = '#0b1120';
const ROUTE = '#e8eefc';
const ZONE = '#ef4444';

/** Згладжування: малюємо в 3× і усереднюємо. Дешевше за будь-який растеризатор. */
const SSAA = 3;

type RGBA = [number, number, number, number];

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Усі фігури в частках від сторони — один опис для будь-якого розміру. */
type Shape =
  | { kind: 'rrect'; x: number; y: number; w: number; h: number; r: number; color: string }
  | { kind: 'capsule'; x1: number; y1: number; x2: number; y2: number; r: number; color: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; color: string };

function insideRRect(s: Extract<Shape, { kind: 'rrect' }>, x: number, y: number): boolean {
  const dx = Math.max(s.x + s.r - x, 0, x - (s.x + s.w - s.r));
  const dy = Math.max(s.y + s.r - y, 0, y - (s.y + s.h - s.r));
  if (x < s.x || x > s.x + s.w || y < s.y || y > s.y + s.h) return false;
  return dx * dx + dy * dy <= s.r * s.r;
}

function insideCapsule(s: Extract<Shape, { kind: 'capsule' }>, x: number, y: number): boolean {
  const vx = s.x2 - s.x1;
  const vy = s.y2 - s.y1;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - s.x1) * vx + (y - s.y1) * vy) / len2));
  const dx = x - (s.x1 + t * vx);
  const dy = y - (s.y1 + t * vy);
  return dx * dx + dy * dy <= s.r * s.r;
}

function inside(shape: Shape, x: number, y: number): boolean {
  switch (shape.kind) {
    case 'rrect':
      return insideRRect(shape, x, y);
    case 'capsule':
      return insideCapsule(shape, x, y);
    case 'circle': {
      const dx = x - shape.cx;
      const dy = y - shape.cy;
      return dx * dx + dy * dy <= shape.r * shape.r;
    }
  }
}

/**
 * @param bleed фон на всю площу (maskable / apple-touch: систему цікавлять свої кути)
 * @param glyphScale масштаб малюнка навколо центру (0.8 — safe zone maskable-іконки)
 */
function shapes(bleed: boolean, glyphScale: number): Shape[] {
  const s = (v: number) => 0.5 + (v - 0.5) * glyphScale;
  const y = 0.5;
  const lineR = 0.055 * glyphScale;

  return [
    {
      kind: 'rrect',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      r: bleed ? 0 : 0.22,
      color: BG,
    },
    { kind: 'capsule', x1: s(0.12), y1: y, x2: s(0.88), y2: y, r: lineR, color: ROUTE },
    // Спершу вирізаємо в лінії розрив кольором фону, потім кладемо в нього
    // червону зону: інакше червоне читається як намистина на лінії, а не як діра.
    { kind: 'capsule', x1: s(0.42), y1: y, x2: s(0.68), y2: y, r: lineR * 1.3, color: BG },
    { kind: 'capsule', x1: s(0.47), y1: y, x2: s(0.63), y2: y, r: lineR, color: ZONE },
    { kind: 'circle', cx: s(0.19), cy: y, r: 0.032 * glyphScale, color: BG },
    { kind: 'circle', cx: s(0.81), cy: y, r: 0.032 * glyphScale, color: BG },
  ];
}

function render(size: number, bleed: boolean, glyphScale: number): Buffer {
  const layers = shapes(bleed, glyphScale);
  const colors = layers.map((shape) => hexToRgb(shape.color));
  const out = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Премультиплікована сума субсемплів: інакше на межі фігур лізе темна кайма.
      const acc: RGBA = [0, 0, 0, 0];
      for (let sy = 0; sy < SSAA; sy++) {
        for (let sx = 0; sx < SSAA; sx++) {
          const x = (px + (sx + 0.5) / SSAA) / size;
          const y = (py + (sy + 0.5) / SSAA) / size;
          let hit = -1;
          for (let i = 0; i < layers.length; i++) if (inside(layers[i] as Shape, x, y)) hit = i;
          if (hit < 0) continue;
          const [r, g, b] = colors[hit] as [number, number, number];
          acc[0] += r;
          acc[1] += g;
          acc[2] += b;
          acc[3] += 1;
        }
      }
      const n = SSAA * SSAA;
      const i = (py * size + px) * 4;
      const cover = acc[3];
      if (cover > 0) {
        out[i] = Math.round(acc[0] / cover);
        out[i + 1] = Math.round(acc[1] / cover);
        out[i + 2] = Math.round(acc[2] / cover);
      }
      out[i + 3] = Math.round((cover / n) * 255);
    }
  }
  return out;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, tail]);
}

function encodePng(rgba: Buffer, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // біт на канал
  ihdr[9] = 6; // truecolor + alpha
  // Фільтр 0 на кожному рядку: картинка з великих однотонних плям, deflate і так її з'їдає.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Той самий сюжет вектором — для favicon і будь-якого розміру в браузері. */
function svg(): string {
  const layers = shapes(false, 1);
  const body = layers
    .map((shape) => {
      const f = `fill="${shape.color}"`;
      if (shape.kind === 'rrect') {
        return `<rect x="0" y="0" width="512" height="512" rx="${shape.r * 512}" ${f}/>`;
      }
      if (shape.kind === 'circle') {
        return `<circle cx="${shape.cx * 512}" cy="${shape.cy * 512}" r="${shape.r * 512}" ${f}/>`;
      }
      const stroke = `stroke="${shape.color}" stroke-width="${shape.r * 2 * 512}" stroke-linecap="round"`;
      return `<line x1="${shape.x1 * 512}" y1="${shape.y1 * 512}" x2="${shape.x2 * 512}" y2="${shape.y2 * 512}" ${stroke}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${body}</svg>\n`;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, bleed: false, glyph: 1 },
  { file: 'icon-512.png', size: 512, bleed: false, glyph: 1 },
  // maskable: система ріже під свою форму, глиф має влізти в центральні 80%.
  { file: 'icon-maskable-512.png', size: 512, bleed: true, glyph: 0.8 },
  { file: 'apple-touch-icon.png', size: 180, bleed: true, glyph: 1 },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  for (const target of TARGETS) {
    const png = encodePng(render(target.size, target.bleed, target.glyph), target.size);
    await writeFile(path.join(OUT_DIR, target.file), png);
    console.log(`[icons] ${target.file} — ${(png.length / 1024).toFixed(1)} КБ`);
  }
  await writeFile('public/favicon.svg', svg());
  console.log('[icons] favicon.svg');
}

await main();
