/**
 * Scratch: tune the compact (small-size) cut by looking at it at the sizes it
 * will actually be rasterised to. Not part of the build.
 */
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { blobsToShape, rng } from './splat.mjs';

const rad = (d) => (d * Math.PI) / 180;

function compact({ core, lobeR, arms, cx = 50, cy = 51, seed = 20260808 }) {
  const r = rng(seed);
  const j = (a) => (r() - 0.5) * 2 * a;
  const blobs = [
    { x: cx, y: cy, r: core },
    { x: cx + Math.cos(rad(-40)) * 7, y: cy + Math.sin(rad(-40)) * 7, r: lobeR },
    { x: cx + Math.cos(rad(150)) * 8, y: cy + Math.sin(rad(150)) * 8, r: lobeR * 0.92 },
  ];
  for (const [angle, length, baseR, opts] of arms) {
    const { links = 3, taper = 0.8, tipScale = 1.45, curve = 0, start = 0.3 } = opts ?? {};
    for (let i = 1; i <= links; i++) {
      const t = i / links;
      const a = rad(angle + j(2) + curve * t * t);
      const d = length * (start + (1 - start) * t);
      blobs.push({
        x: cx + Math.cos(a) * d,
        y: cy + Math.sin(a) * d,
        r: baseR * taper ** i * (i === links ? tipScale : 1),
      });
    }
  }
  return blobs;
}

const ARMS = [
  [-78, 40, 8.5, { links: 3, tipScale: 1.55, curve: 10 }],
  [-18, 30, 7.2, { links: 3, tipScale: 1.4, curve: -12 }],
  [42, 25, 6.8, { links: 2, tipScale: 1.35, curve: 10 }],
  [94, 35, 7.6, { links: 3, tipScale: 1.4, curve: -8 }],
  [176, 38, 8.0, { links: 3, tipScale: 1.5, curve: -10 }],
  [-138, 28, 6.8, { links: 2, tipScale: 1.4, curve: 8 }],
];

const VARIANTS = [
  { name: 'core11 lobe9 r1.0', cfg: { core: 11, lobeR: 9, arms: ARMS } },
  { name: 'core9 lobe8 r1.0', cfg: { core: 9, lobeR: 8, arms: ARMS } },
  {
    name: 'core11 arms x1.15',
    cfg: { core: 11, lobeR: 9, arms: ARMS.map(([a, l, r, o]) => [a, l * 1.15, r, o]) },
  },
  {
    name: 'core9 fat arms',
    cfg: { core: 9, lobeR: 8, arms: ARMS.map(([a, l, r, o]) => [a, l * 1.1, r * 1.12, { ...o, taper: 0.84 }]) },
  },
];

const CELL_W = 420;
const CELL_H = 190;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL_W * 2}" height="${CELL_H * 2}"><rect width="100%" height="100%" fill="#ededed"/>`;

VARIANTS.forEach((v, i) => {
  const blobs = compact(v.cfg);
  const shape = blobsToShape(blobs, { res: 700, fit: { size: 100, margin: 4 } });
  const x = (i % 2) * CELL_W;
  const y = Math.floor(i / 2) * CELL_H;
  let px = x + 16;
  for (const s of [16, 24, 32, 48, 96]) {
    svg += `<g transform="translate(${px} ${y + 20 + (96 - s) / 2}) scale(${s / 100})"><path d="${shape.d}" fill="#4CAF34"/></g>`;
    px += s + 18;
  }
  svg += `<text x="${x + 16}" y="${y + CELL_H - 20}" fill="#555" font-size="12" font-family="monospace">${v.name} (${shape.contours})</text>`;
});
svg += '</svg>';

writeFileSync('/tmp/compact_sweep.png', new Resvg(svg, { fitTo: { mode: 'width', value: CELL_W * 2 } }).render().asPng());
console.log('wrote /tmp/compact_sweep.png');
