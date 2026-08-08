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
    waist = 0,        // mid-arm pinch, 0..0.5
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
    // Widest at the base, pinched through the middle, swelling to a rounded
    // club at the tip. That waisted profile is what makes a splat finger read
    // as thrown liquid instead of as a cone or a sausage.
    const r = baseR * (1 - t * (1 - tipR)) * (1 - waist * Math.sin(Math.PI * t));
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
 * Round 6. K2 had the idiom; the gaps between fingers were too shallow because
 * the rim lumps were filling them in. Smaller rim, longer fingers.
 */

/** Rim lumps: smaller and closer in, so the gaps between fingers stay deep. */
const RIM = [
  [-4, 20, 4.4], [34, 20, 4.0], [-70, 20, 4.4], [-118, 19, 4.2],
  [-160, 20, 4.4], [196, 19, 3.8], [104, 19, 4.2], [148, 19, 4.0],
];

const FINGER = { waist: 0.30, spacing: 1.0 };
const DRIP = { waist: 0.36, spacing: 1.0 };

/** L1: fingers +18%, rim pulled back. */
const L1 = {
  seed: 5512,
  centre: [49, 45],
  core: { r: 14.5, lobes: [[-38, 9, 12], [142, 10, 11], [66, 9, 10]] },
  rim: RIM,
  arms: [
    [-74, 50, 7.4, { ...FINGER, tipR: 0.80, curve: 8 }],
    [-20, 40, 6.6, { ...FINGER, tipR: 0.76, curve: -9 }],
    [34, 33, 6.0, { ...FINGER, tipR: 0.78, curve: 8 }],
    [84, 50, 5.6, { ...DRIP, tipR: 0.95, curve: 4 }],
    [110, 37, 4.8, { ...DRIP, tipR: 0.90, curve: -5 }],
    [178, 47, 7.0, { ...FINGER, tipR: 0.80, curve: -8 }],
    [-132, 36, 6.2, { ...FINGER, tipR: 0.76, curve: 7 }],
  ],
  satellites: [[-104, 48, 4.0], [22, 49, 2.5], [146, 48, 2.9]],
};

/** L2: further again, and a leaner mass. */
const L2 = {
  ...L1,
  seed: 6620,
  core: { r: 13.5, lobes: [[-38, 9, 11], [142, 10, 10], [66, 9, 9]] },
  rim: RIM.map(([a, d, r]) => [a, d - 1, r * 0.9]),
  arms: [
    [-74, 55, 7.2, { ...FINGER, tipR: 0.78, curve: 8 }],
    [-20, 44, 6.4, { ...FINGER, tipR: 0.74, curve: -9 }],
    [34, 36, 5.8, { ...FINGER, tipR: 0.76, curve: 8 }],
    [84, 55, 5.4, { ...DRIP, tipR: 0.95, curve: 4 }],
    [110, 40, 4.6, { ...DRIP, tipR: 0.90, curve: -5 }],
    [178, 52, 6.8, { ...FINGER, tipR: 0.78, curve: -8 }],
    [-132, 39, 6.0, { ...FINGER, tipR: 0.74, curve: 7 }],
  ],
};

/** L3: L1 with an eighth finger, so no gap is wide enough to read as a bite. */
const L3 = {
  ...L1,
  seed: 8801,
  arms: [
    ...L1.arms,
    [-46, 40, 5.4, { ...FINGER, tipR: 0.74, curve: -6 }],
  ],
};

/** L4: L1 with a directional bias - longer up-right, stubbier down-left. */
const L4 = {
  ...L1,
  seed: 3390,
  centre: [47, 47],
  arms: [
    [-70, 56, 7.6, { ...FINGER, tipR: 0.82, curve: 9 }],
    [-24, 46, 6.8, { ...FINGER, tipR: 0.78, curve: -9 }],
    [30, 34, 5.8, { ...FINGER, tipR: 0.76, curve: 8 }],
    [84, 48, 5.6, { ...DRIP, tipR: 0.95, curve: 4 }],
    [112, 34, 4.8, { ...DRIP, tipR: 0.90, curve: -5 }],
    [176, 42, 6.6, { ...FINGER, tipR: 0.78, curve: -8 }],
    [-134, 33, 5.8, { ...FINGER, tipR: 0.74, curve: 7 }],
  ],
  satellites: [[-100, 50, 4.2], [20, 48, 2.4], [150, 46, 2.8]],
};

const VARIANTS = [
  ['L1 · fingers +18%', L1],
  ['L2 · leaner mass, longer', L2],
  ['L3 · eight fingers', L3],
  ['L4 · directional', L4],
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
