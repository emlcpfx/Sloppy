/**
 * Scratch: explore splat DIRECTIONS, not parameter tweaks. Not part of the build.
 *
 *   node packages/brand/sweep.mjs [out.png]
 */
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { blobsToShape, rng } from './splat.mjs';

const rad = (d) => (d * Math.PI) / 180;
const OUT = process.argv[2] ?? '/tmp/splat_sweep.png';

/**
 * A spec has four kinds of part, and each does a different job:
 *
 *   core       the mass. Several offset lobes, never one circle.
 *   rim        small TIGHT blobs sitting on the silhouette. These are what stop
 *              the gaps between arms being clean arcs - the single biggest
 *              reason the first attempt read as a starfish rather than liquid.
 *   arms       tendrils. Thin relative to the core and tapering hard; a droplet
 *              head is a garnish on two or three of them, not a rule.
 *   satellites detached, sizes varying several-fold.
 */
/**
 * A tendril, spaced BY RADIUS rather than by count.
 *
 * The previous model put N links at even intervals and shrank each by a fixed
 * factor. Radius then falls geometrically while spacing stays constant, so past
 * the third link the blobs cannot reach each other and the arm shatters into a
 * string of beads - which is what round 2 did, 21 contours of it.
 *
 * Here the walk is `d += spacing * r`, with r falling LINEARLY from base to tip.
 * Overlap is constant along the whole arm, so a tendril stays connected however
 * far it reaches and naturally gets finer near the tip. Detachment stops being
 * an accident of the parameters and becomes an explicit choice: `fling` places a
 * droplet past a deliberate gap.
 */
function arm(cx, cy, angleDeg, length, baseR, opts = {}) {
  const {
    tipR = 0.18,      // tip radius as a fraction of the base
    spacing = 1.15,   // centre-to-centre step, in units of the local radius
    curve = 0,
    start = 0.3,
    fling = 0,        // detached droplet past the tip, as a fraction of length
    flingR = 0.45,    // its radius, as a fraction of the base
  } = opts;

  const blobs = [];
  const d0 = length * start;
  let d = d0;

  while (d <= length) {
    const t = (d - d0) / Math.max(1e-6, length - d0);
    const r = baseR * (1 - t * (1 - tipR));
    const a = rad(angleDeg + curve * t * t);
    blobs.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r });
    d += spacing * r;
  }

  if (fling > 0) {
    const d2 = length * (1 + fling);
    const a = rad(angleDeg + curve);
    blobs.push({ x: cx + Math.cos(a) * d2, y: cy + Math.sin(a) * d2, r: baseR * flingR });
  }

  return blobs;
}

function build(spec) {
  const r = rng(spec.seed ?? 20260808);
  const j = (a) => (r() - 0.5) * 2 * a;
  const [cx, cy] = spec.centre ?? [50, 50];
  const blobs = [{ x: cx, y: cy, r: spec.core.r }];

  for (const [angle, dist, radius] of spec.core.lobes ?? []) {
    blobs.push({
      x: cx + Math.cos(rad(angle)) * dist,
      y: cy + Math.sin(rad(angle)) * dist,
      r: radius,
    });
  }

  for (const [angle, dist, radius] of spec.rim ?? []) {
    blobs.push({
      x: cx + Math.cos(rad(angle + j(4))) * dist,
      y: cy + Math.sin(rad(angle + j(4))) * dist,
      r: radius,
      // Tight influence, so it reads as a lump ON the edge rather than
      // inflating the whole silhouette outwards.
      k: spec.rimK ?? 1.45,
    });
  }

  for (const [angle, length, baseR, opts = {}] of spec.arms ?? []) {
    blobs.push(...arm(cx, cy, angle + j(2.5), length, baseR, opts));
  }

  const sats = (spec.satellites ?? []).map(([angle, dist, radius]) => ({
    x: cx + Math.cos(rad(angle)) * dist,
    y: cy + Math.sin(rad(angle)) * dist,
    r: radius,
  }));

  return { blobs, sats };
}

// ---------------------------------------------------------------------------
// Four directions
// ---------------------------------------------------------------------------

/**
 * Round 4. 'Bold' had the mass and the small-size legibility; 'goo' had the
 * character. These four cross the two.
 */

const RIM = [
  [-4, 23, 6], [34, 23, 5.2], [-70, 23, 6], [-118, 22, 5.4],
  [-160, 23, 6], [196, 22, 5], [104, 22, 5.6], [148, 22, 5.4],
];

/** J1: bold, with the flung droplets knocked off-axis. */
const J1 = {
  seed: 2277,
  centre: [48, 49],
  core: { r: 17, lobes: [[-38, 10, 13.5], [142, 11, 12.5], [66, 10, 11]] },
  rim: RIM,
  arms: [
    [-72, 46, 8.0, { tipR: 0.2, curve: 14, fling: 0.2, flingR: 0.42 }],
    [-16, 36, 6.8, { tipR: 0.18, curve: -10 }],
    [56, 30, 6.0, { tipR: 0.18, curve: 9 }],
    [100, 38, 6.6, { tipR: 0.19, curve: -12, fling: 0.18, flingR: 0.3 }],
    [176, 40, 7.2, { tipR: 0.2, curve: -8 }],
    [-134, 30, 6.0, { tipR: 0.18, curve: 7 }],
  ],
  satellites: [[-58, 60, 4.6], [30, 49, 2.4], [-150, 47, 3.4], [136, 52, 1.7]],
};

/** J2: bold mass, goo behaviour - two hanging drips along the bottom. */
const J2 = {
  seed: 4488,
  centre: [48, 45],
  core: { r: 16.5, lobes: [[-38, 10, 13], [142, 11, 12], [66, 10, 10.5]] },
  rim: RIM,
  arms: [
    [-70, 46, 7.8, { tipR: 0.2, curve: 13, fling: 0.2, flingR: 0.42 }],
    [-14, 34, 6.6, { tipR: 0.18, curve: -10 }],
    [60, 26, 5.6, { tipR: 0.18, curve: 9 }],
    // Drips: narrow, then swell.
    [86, 36, 5.6, { tipR: 0.85, spacing: 1.0, curve: 4 }],
    [112, 27, 4.8, { tipR: 0.8, spacing: 1.0, curve: -5 }],
    [176, 38, 7.0, { tipR: 0.2, curve: -8 }],
    [-136, 28, 5.8, { tipR: 0.18, curve: 7 }],
  ],
  satellites: [[-58, 58, 4.4], [28, 48, 2.3], [-150, 46, 3.2], [96, 58, 1.6]],
};

/** J3: same, but the mass comes in and the tendrils go further. */
const J3 = {
  ...J2,
  seed: 6611,
  core: { r: 15, lobes: [[-38, 10, 12], [142, 11, 11], [66, 10, 9.5]] },
  rim: RIM.map(([a, d, r]) => [a, d - 1.5, r * 0.92]),
  arms: [
    [-70, 54, 7.4, { tipR: 0.17, curve: 13, fling: 0.18, flingR: 0.42 }],
    [-14, 40, 6.2, { tipR: 0.16, curve: -11 }],
    [60, 30, 5.4, { tipR: 0.16, curve: 9 }],
    [86, 42, 5.4, { tipR: 0.8, spacing: 1.0, curve: 4 }],
    [114, 30, 4.6, { tipR: 0.75, spacing: 1.0, curve: -5 }],
    [176, 44, 6.6, { tipR: 0.17, curve: -8, fling: 0.14, flingR: 0.3 }],
    [-136, 32, 5.6, { tipR: 0.17, curve: 7 }],
  ],
};

/** J4: heaviest mass, shortest tendrils - the favicon-first cut. */
const J4 = {
  seed: 1919,
  centre: [49, 49],
  core: { r: 18.5, lobes: [[-38, 10, 15], [142, 11, 14], [66, 10, 12]] },
  rim: RIM.map(([a, d, r]) => [a, d + 2, r * 1.1]),
  arms: [
    [-72, 44, 9.0, { tipR: 0.24, curve: 13, fling: 0.2, flingR: 0.4 }],
    [-14, 34, 7.6, { tipR: 0.22, curve: -10 }],
    [58, 29, 6.8, { tipR: 0.22, curve: 9 }],
    [98, 36, 7.4, { tipR: 0.23, curve: -11 }],
    [176, 38, 8.0, { tipR: 0.24, curve: -8 }],
    [-134, 29, 6.8, { tipR: 0.22, curve: 7 }],
  ],
  satellites: [[-58, 58, 4.8], [30, 49, 2.6], [-150, 47, 3.4]],
};

const VARIANTS = [
  ['J1 · bold, off-axis flings', J1],
  ['J2 · bold + drips', J2],
  ['J3 · leaner mass, longer reach', J3],
  ['J4 · favicon-first', J4],
];

// ---------------------------------------------------------------------------

const CELL_W = 470;
const CELL_H = 400;
const cols = 2;
const rows = Math.ceil(VARIANTS.length / cols);

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * CELL_W}" height="${rows * CELL_H}">
<rect width="100%" height="100%" fill="#f2f3f0"/>`;

VARIANTS.forEach(([name, spec], i) => {
  const { blobs, sats } = build(spec);
  const union = blobsToShape([...blobs, ...sats], { res: 720, fit: { size: 100, margin: 3 } });
  const x = (i % cols) * CELL_W;
  const y = Math.floor(i / cols) * CELL_H;

  svg += `<g transform="translate(${x + 24} ${y + 20}) scale(2.7)"><path d="${union.d}" fill="#3E9B27"/></g>`;

  // The sizes it has to survive.
  let px = x + 24;
  for (const s of [16, 24, 32, 48]) {
    svg += `<rect x="${px - 4}" y="${y + 306}" width="${s + 8}" height="${s + 8}" fill="#fff"/>`;
    svg += `<g transform="translate(${px} ${y + 310}) scale(${s / 100})"><path d="${union.d}" fill="#3E9B27"/></g>`;
    px += s + 22;
  }

  svg += `<text x="${x + 24}" y="${y + 384}" fill="#4a534a" font-family="monospace" font-size="14">${name} · ${union.contours} contours</text>`;
});

svg += '</svg>';
writeFileSync(OUT, new Resvg(svg, { fitTo: { mode: 'width', value: cols * CELL_W } }).render().asPng());
console.log(`wrote ${OUT}`);
