/**
 * Build the brand assets from the generator.
 *
 *   node packages/brand/build.mjs        (or: pnpm brand)
 *
 * Emits:
 *   assets/splat.svg          the mark, shaded
 *   assets/splat-flat.svg     one flat fill, tintable via currentColor
 *   assets/splat-compact.svg  the small-size cut
 *   assets/icon/*.png         extension + store icon sizes
 *   generated/splat-path.ts   path data, inlined by the content script
 *
 * The PNGs are rasterised from the very SVG that ships, so the toolbar icon and
 * the in-page button cannot drift apart.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

import { blobsToShape, splatBlobs, splatBlobsCompact, splatSatellites } from './splat.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, 'assets');
const GENERATED = join(HERE, 'generated');
/**
 * The extension's icons are written here too rather than copied by a separate
 * step. WXT picks up public/icon/{size}.png automatically, and one writer means
 * the toolbar icon cannot go stale against the mark.
 */
const EXTENSION_ICONS = join(HERE, '..', '..', 'apps', 'extension', 'public', 'icon');

/** Toxic-goo green. Bright enough to read on LinkedIn's grey, not neon. */
export const PALETTE = {
  light: '#B4F25A',
  mid: '#5FCB37',
  // Not very dark. An earlier deep stop turned the drips and the far tendrils
  // near-black, which made the mark read as airbrushed rather than as a graphic.
  deep: '#3AA83C',
  shadow: '#1B6B2A',
  flat: '#4CAF34',
};

/** Below this, the full mark's arms rasterise away to nothing. */
const COMPACT_BELOW = 48;
const SIZES = [16, 32, 48, 96, 128, 512];

/**
 * Shaded mark.
 *
 * The body gradient is `userSpaceOnUse` and centred on the core rather than on
 * the bounding box. With objectBoundingBox the far corners land on the darkest
 * stop, which made the two corner satellites read as a different colour of
 * green than the mass they were flung from.
 *
 * Satellites are a separate path with their own flatter fill for the same
 * reason - they are airborne, so they have no business carrying the core's
 * shading.
 */
function markSvg(main, drops, { size = 100, gloss = true } = {}) {
  const glossLayer = gloss
    ? `
    <ellipse cx="70" cy="84" rx="36" ry="26" fill="url(#pool)"/>
    <ellipse cx="40" cy="35" rx="17" ry="10" fill="#ffffff" opacity="0.26" filter="url(#soft)" transform="rotate(-24 40 35)"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Sloppy">
  <defs>
    <radialGradient id="body" gradientUnits="userSpaceOnUse" cx="42" cy="36" r="72">
      <stop offset="0%" stop-color="${PALETTE.light}"/>
      <stop offset="52%" stop-color="${PALETTE.mid}"/>
      <stop offset="100%" stop-color="${PALETTE.deep}"/>
    </radialGradient>
    <linearGradient id="drop" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="${PALETTE.light}"/>
      <stop offset="100%" stop-color="${PALETTE.mid}"/>
    </linearGradient>
    <radialGradient id="pool" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${PALETTE.shadow}" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="${PALETTE.shadow}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="5"/>
    </filter>
    <clipPath id="inside"><path d="${main}"/></clipPath>
  </defs>
  <path d="${main}" fill="url(#body)"/>
  <g clip-path="url(#inside)">${glossLayer}
  </g>${drops ? `\n  <path d="${drops}" fill="url(#drop)"/>` : ''}
</svg>
`;
}

function flatSvg(d, { size = 100 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Sloppy">
  <path d="${d}" fill="currentColor"/>
</svg>
`;
}

/** Fit both groups into one frame, using the transform the union establishes. */
function buildMark(coreBlobs, satelliteBlobs, { res = 760, margin = 3 } = {}) {
  const union = blobsToShape([...coreBlobs, ...satelliteBlobs], {
    res,
    fit: { size: 100, margin },
  });
  const main = blobsToShape(coreBlobs, { res, transform: union.transform });
  const drops = satelliteBlobs.length
    ? blobsToShape(satelliteBlobs, { res, transform: union.transform })
    : null;
  return { union, main, drops };
}

function main() {
  mkdirSync(join(ASSETS, 'icon'), { recursive: true });
  mkdirSync(GENERATED, { recursive: true });

  const full = buildMark(splatBlobs(), splatSatellites());
  const compact = buildMark(splatBlobsCompact(), [], { margin: 4 });

  const fullSvg = markSvg(full.main.d, full.drops.d);
  const compactSvg = markSvg(compact.main.d, null, { gloss: false });

  writeFileSync(join(ASSETS, 'splat.svg'), fullSvg);
  writeFileSync(join(ASSETS, 'splat-compact.svg'), compactSvg);
  writeFileSync(join(ASSETS, 'splat-flat.svg'), flatSvg(full.union.d));

  mkdirSync(EXTENSION_ICONS, { recursive: true });
  for (const size of SIZES) {
    const src = size < COMPACT_BELOW ? compactSvg : fullSvg;
    const png = new Resvg(src, { fitTo: { mode: 'width', value: size } }).render().asPng();
    writeFileSync(join(ASSETS, 'icon', `${size}.png`), png);
    if (size !== 512) writeFileSync(join(EXTENSION_ICONS, `${size}.png`), png);
  }

  writeFileSync(
    join(GENERATED, 'splat-path.ts'),
    `// GENERATED by packages/brand/build.mjs - do not edit by hand.\n` +
      `// Regenerate with: pnpm brand\n` +
      `//\n` +
      `// Inlined rather than fetched. The content script draws this inside a closed\n` +
      `// shadow root, and inlining avoids a web_accessible_resources entry - which\n` +
      `// would otherwise let any page on the internet probe for the extension.\n` +
      `export const SPLAT_PATH =\n  '${full.union.d}';\n\n` +
      `export const SPLAT_PATH_COMPACT =\n  '${compact.main.d}';\n\n` +
      `export const SPLAT_VIEWBOX = '0 0 100 100';\n\n` +
      `export const SPLAT_COLORS = ${JSON.stringify(PALETTE, null, 2)} as const;\n`,
  );

  const b = full.union.bbox;
  console.log(
    `[brand] full: ${full.main.contours} mass + ${full.drops.contours} droplets, ` +
      `bbox ${b.x0.toFixed(1)},${b.y0.toFixed(1)} -> ${b.x1.toFixed(1)},${b.y1.toFixed(1)}`,
  );
  console.log(`[brand] compact: ${compact.main.contours} contour(s), used below ${COMPACT_BELOW}px`);
  console.log(`[brand] wrote ${ASSETS}`);
}

main();
