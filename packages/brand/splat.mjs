/**
 * The Sloppy splat, generated rather than drawn.
 *
 * The mark is a metaball field - a core mass, a set of thrown arms each built
 * from a chain of shrinking circles ending in a bulbous droplet head, and a few
 * detached satellites. The outline is the iso-contour of that field, extracted
 * with marching squares, resampled by arc length and fitted with cubic Beziers.
 *
 * Why generate it instead of drawing it:
 *
 *   1. A radial r(theta) starburst cannot make a splat. A real splat arm
 *      PINCHES at the neck and BULGES at the tip, which is not a star-shaped
 *      polygon, so no "wobble the radius" approach gets there. Summed circle
 *      fields do it for free - two overlapping circles always meet in a
 *      concave fillet, which is exactly the neck.
 *   2. It is reproducible from a seed and provably nobody else's artwork.
 *   3. Retuning the mark is editing numbers, not pushing bezier handles.
 *
 * The kernel has COMPACT SUPPORT - (1 - (d/R)^2)^3 out to R and exactly zero
 * past it - rather than the textbook r^2/d^2. With an inverse-square kernel
 * every blob pulls on every other blob forever, so detached droplets grow faint
 * bridges back to the core and the satellites stop being satellites.
 */

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

/** mulberry32: tiny, seedable, good enough for jitter. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/**
 * Influence radius as a multiple of the visual radius - the "gooeyness" dial.
 *
 * Chosen by eye from a contact sheet (packages/brand/sweep.mjs). Too high and
 * the summed field inflates until the arms are swallowed into one lumpy ball;
 * too low and the arms bead up into a string of disconnected dots. 1.8 is the
 * value where necks pinch but hold.
 */
export let K = 1.8;
export function setK(k) { K = k; }
const ISO = 1;
/** Chosen so an isolated blob's iso-contour lands exactly on its own radius. */
const weightFor = (k) => ISO / (1 - 1 / (k * k)) ** 3;

const rad = (deg) => (deg * Math.PI) / 180;

/**
 * A tendril, spaced BY RADIUS rather than by a fixed link count.
 *
 * The first version of this placed N links at even intervals and shrank each by
 * a constant factor. Radius then falls geometrically while spacing stays
 * constant, so past the third link the blobs can no longer reach each other and
 * the arm shatters into a string of beads - a 40-unit tendril arriving as seven
 * separate dots.
 *
 * Here the walk is `d += spacing * r` with r falling LINEARLY from base to tip.
 * Overlap is constant along the whole arm, so a tendril stays connected however
 * far it reaches, and it naturally gets finer near the tip because the steps get
 * smaller. Detachment stops being an accident of the parameters and becomes a
 * choice: `fling` places a droplet past a deliberate gap.
 *
 * `tipR` above ~0.6 narrows and then swells instead of tapering - that is a
 * drip, with a heavy head hanging below a thin neck.
 */
function arm(cx, cy, angleDeg, length, baseR, opts = {}) {
  const {
    tipR = 0.18,     // tip radius, as a fraction of the base
    waist = 0,       // mid-arm pinch, 0..0.5
    spacing = 1.15,  // centre-to-centre step, in units of the local radius
    curve = 0,       // degrees of bend over the arm's length
    start = 0.3,     // where the arm begins, as a fraction of its length
    fling = 0,       // detached droplet beyond the tip, as a fraction of length
    flingR = 0.45,   // its radius, as a fraction of the base
  } = opts;

  const blobs = [];
  const d0 = length * start;
  let d = d0;

  while (d <= length) {
    const t = (d - d0) / Math.max(1e-6, length - d0);
    // Widest at the base, pinched through the middle, swelling to a rounded
    // club at the tip. That waisted profile is what a thrown-liquid finger
    // actually does, and it is the difference between a splat and a starburst.
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

/**
 * A mark is four kinds of part, and each does a job the others cannot:
 *
 *   core        the mass. Several offset lobes - one circle reads as a dot.
 *   rim         small blobs sitting ON the silhouette, with a TIGHT influence
 *               radius of their own. These break up the arcs between arms, and
 *               they are the single biggest reason this stopped reading as a
 *               starfish. Without them the gaps between tendrils are clean
 *               circular segments, which no thrown liquid has ever produced.
 *   arms        tendrils, thin relative to the core and tapering hard. A
 *               droplet head is a garnish on two or three, not a rule.
 *   satellites  detached, with sizes varying several-fold. Evenly-sized dots
 *               evenly spaced read as decoration rather than debris.
 */
function buildSpec(spec, seed) {
  const r = rng(seed ?? spec.seed);
  const j = (amt) => (r() - 0.5) * 2 * amt;
  const [cx, cy] = spec.centre;

  const blobs = [{ x: cx, y: cy, r: spec.core.r }];

  for (const [angle, dist, radius] of spec.core.lobes) {
    blobs.push({
      x: cx + Math.cos(rad(angle)) * dist,
      y: cy + Math.sin(rad(angle)) * dist,
      r: radius,
    });
  }

  for (const [angle, dist, radius] of spec.rim) {
    blobs.push({
      x: cx + Math.cos(rad(angle + j(4))) * dist,
      y: cy + Math.sin(rad(angle + j(4))) * dist,
      r: radius,
      // Tight support: a lump on the edge, not an inflation of the whole mass.
      k: spec.rimK ?? 1.45,
    });
  }

  for (const [angle, length, baseR, opts] of spec.arms) {
    blobs.push(...arm(cx, cy, angle + j(2.5), length, baseR, opts));
  }

  return blobs;
}

function satellitesOf(spec) {
  const [cx, cy] = spec.centre;
  return spec.satellites.map(([angle, dist, radius]) => ({
    x: cx + Math.cos(rad(angle)) * dist,
    y: cy + Math.sin(rad(angle)) * dist,
    r: radius,
  }));
}

/**
 * Silhouette lumps. Small and pulled in close on purpose.
 *
 * An earlier set was larger and further out, and it filled the gaps BETWEEN
 * the fingers - which is what a splat's negative space is made of. Big rim
 * lumps give you a continuously bumpy amoeba; small ones let each finger read
 * as a separate projection with a deep notch either side.
 */
const RIM = [
  [-4, 20, 4.4], [34, 20, 4.0], [-70, 20, 4.4], [-118, 19, 4.2],
  [-160, 20, 4.4], [196, 19, 3.8], [104, 19, 4.2], [148, 19, 4.0],
];

/** Shared arm profiles. A finger tapers slightly; a drip narrows then hangs. */
const FINGER = { waist: 0.3, spacing: 1.0 };
const DRIP = { waist: 0.36, spacing: 1.0 };

/**
 * The mark.
 *
 * A solid lumpy mass with five fat fingers thrown out of it and two drips
 * hanging off the bottom, plus three pieces of debris. Every finger is waisted
 * and ends in a rounded club, which is the classic splat idiom and is what the
 * reference material actually looks like - thin tapering tendrils read as a
 * starburst or a spider, not as thrown paint.
 *
 * Nothing is evenly spaced and no two fingers are the same length. Seven equal
 * arms is a snowflake, and the eye catches that regularity instantly.
 */
const MARK = {
  seed: 5512,
  centre: [49, 45],
  core: { r: 14.5, lobes: [[-38, 9, 12], [142, 10, 11], [66, 9, 10]] },
  rim: RIM,
  arms: [
    [-74, 50, 7.4, { ...FINGER, tipR: 0.8, curve: 8 }],   // dominant, up
    [-20, 40, 6.6, { ...FINGER, tipR: 0.76, curve: -9 }],
    [34, 33, 6.0, { ...FINGER, tipR: 0.78, curve: 8 }],
    [84, 50, 5.6, { ...DRIP, tipR: 0.95, curve: 4 }],     // long drip
    [110, 37, 4.8, { ...DRIP, tipR: 0.9, curve: -5 }],    // short drip
    [178, 47, 7.0, { ...FINGER, tipR: 0.8, curve: -8 }],  // counterweight, left
    [-132, 36, 6.2, { ...FINGER, tipR: 0.76, curve: 7 }],
  ],
  /**
   * Three, and placed in the GAPS between finger tips.
   *
   * An earlier version had five and put one almost exactly where a finger's
   * flung droplet landed. Two circles overlapping by a third of their radius
   * does not read as debris; it reads as a mistake.
   */
  satellites: [[-104, 48, 4.0], [22, 49, 2.5], [146, 48, 2.9]],
};

/**
 * The small-size cut.
 *
 * At 16px a finger two pixels wide is gone after rasterisation and what
 * survives of the full mark is an anonymous green dot. So the toolbar icon gets
 * its own geometry from the same family: heavier core, shorter and fatter
 * fingers, drips shortened so they do not become a stray pixel. Same character,
 * drawn for the size it will actually be seen at - which is what an icon
 * designer would do by hand anyway.
 */
const COMPACT = {
  seed: 1919,
  centre: [49, 46],
  core: { r: 15, lobes: [[-38, 9, 12.5], [142, 10, 11.5], [66, 9, 10.5]] },
  // Only slightly fatter than the mark's. Pushed further and the lumps close
  // the notches between fingers, and the icon goes back to being an amoeba.
  rim: RIM.map(([a, d, r]) => [a, d + 1, r * 1.1]),
  arms: [
    [-74, 46, 8.2, { ...FINGER, tipR: 0.84, curve: 8 }],
    [-20, 38, 7.4, { ...FINGER, tipR: 0.8, curve: -9 }],
    [34, 32, 6.6, { ...FINGER, tipR: 0.82, curve: 8 }],
    [84, 46, 6.2, { ...DRIP, tipR: 0.95, curve: 4 }],
    [112, 34, 5.4, { ...DRIP, tipR: 0.9, curve: -5 }],
    [178, 43, 7.8, { ...FINGER, tipR: 0.84, curve: -8 }],
    [-132, 34, 6.8, { ...FINGER, tipR: 0.8, curve: 7 }],
  ],
  satellites: [[-104, 46, 4.4], [24, 47, 2.8], [146, 46, 3.2]],
};

export function splatBlobs(seed) {
  return buildSpec(MARK, seed);
}

export function splatBlobsCompact(seed) {
  return buildSpec(COMPACT, seed);
}

/**
 * Detached droplets. Separate contours by construction - they sit outside every
 * influence radius, so the field is exactly zero between them and the mass.
 */
export function splatSatellites() {
  return satellitesOf(MARK);
}

export function splatSatellitesCompact() {
  return satellitesOf(COMPACT);
}

/**
 * Compact-support field: sums to >= ISO inside the shape, exactly 0 far away.
 *
 * Each blob may carry its own `k`, which is what lets one mark hold two scales
 * of detail at once. A low k keeps a blob's influence tight so it reads as a
 * distinct lump ON the silhouette; the default k lets the big masses flow into
 * each other. With a single global k you get to pick one or the other, and the
 * result is either a smooth amoeba or a string of beads.
 */
export function makeField(blobs) {
  const prepared = blobs.map((b) => {
    const k = b.k ?? K;
    return { ...b, R2: (b.r * k) ** 2, w: weightFor(k) };
  });
  return (x, y) => {
    let sum = 0;
    for (const b of prepared) {
      const dx = x - b.x;
      const dy = y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= b.R2) continue;
      const t = 1 - d2 / b.R2;
      sum += b.w * t * t * t;
    }
    return sum;
  };
}

export function fieldBounds(blobs, pad = 1) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of blobs) {
    const R = b.r * (b.k ?? K);
    x0 = Math.min(x0, b.x - R);
    y0 = Math.min(y0, b.y - R);
    x1 = Math.max(x1, b.x + R);
    y1 = Math.max(y1, b.y + R);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

// ---------------------------------------------------------------------------
// Marching squares
// ---------------------------------------------------------------------------

/**
 * Extract iso-contours as closed loops.
 *
 * Rather than the 16-case lookup table, this collects the edges the contour
 * crosses and pairs them up. Same result, far less to get subtly wrong - and
 * the ambiguous saddle is then an explicit two-line decision instead of two
 * table rows nobody checks.
 */
export function contours(field, bounds, res = 700, iso = ISO) {
  const { x0, y0, x1, y1 } = bounds;
  const nx = res;
  const ny = Math.max(1, Math.round((res * (y1 - y0)) / (x1 - x0)));
  const dx = (x1 - x0) / nx;
  const dy = (y1 - y0) / ny;

  const v = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      v[j * (nx + 1) + i] = field(x0 + i * dx, y0 + j * dy);
    }
  }
  const at = (i, j) => v[j * (nx + 1) + i];

  /** Linear crossing along an edge - this is what makes the outline smooth. */
  const lerp = (pa, va, pb, vb) => {
    const t = (iso - va) / (vb - va || 1e-12);
    return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
  };

  const segs = [];

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const px = x0 + i * dx;
      const py = y0 + j * dy;
      const tl = at(i, j);
      const tr = at(i + 1, j);
      const br = at(i + 1, j + 1);
      const bl = at(i, j + 1);

      const inTL = tl > iso;
      const inTR = tr > iso;
      const inBR = br > iso;
      const inBL = bl > iso;
      const code = (inTL ? 8 : 0) | (inTR ? 4 : 0) | (inBR ? 2 : 0) | (inBL ? 1 : 0);
      if (code === 0 || code === 15) continue;

      const P = {
        top: inTL !== inTR ? lerp([px, py], tl, [px + dx, py], tr) : null,
        right: inTR !== inBR ? lerp([px + dx, py], tr, [px + dx, py + dy], br) : null,
        bottom: inBL !== inBR ? lerp([px, py + dy], bl, [px + dx, py + dy], br) : null,
        left: inTL !== inBL ? lerp([px, py], tl, [px, py + dy], bl) : null,
      };

      const crossings = ['top', 'right', 'bottom', 'left'].filter((k) => P[k]);

      if (crossings.length === 2) {
        segs.push([P[crossings[0]], P[crossings[1]]]);
      } else if (crossings.length === 4) {
        // Saddle. The cell centre decides which way the two strands run.
        const centre = field(px + dx / 2, py + dy / 2) > iso;
        if (centre === inTL) {
          segs.push([P.left, P.top], [P.right, P.bottom]);
        } else {
          segs.push([P.top, P.right], [P.bottom, P.left]);
        }
      }
    }
  }

  return stitch(segs, Math.min(dx, dy) * 0.5);
}

/** Join unordered segments into closed loops by endpoint proximity. */
function stitch(segs, tol) {
  const key = ([x, y]) => `${Math.round(x / tol)}:${Math.round(y / tol)}`;
  const index = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(i);
    }
  });

  const used = new Array(segs.length).fill(false);
  const loops = [];

  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const loop = [segs[start][0], segs[start][1]];

    for (;;) {
      const tail = loop[loop.length - 1];
      const candidates = index.get(key(tail)) ?? [];
      let advanced = false;
      for (const ci of candidates) {
        if (used[ci]) continue;
        const [a, b] = segs[ci];
        if (key(a) === key(tail)) {
          loop.push(b);
        } else if (key(b) === key(tail)) {
          loop.push(a);
        } else {
          continue;
        }
        used[ci] = true;
        advanced = true;
        break;
      }
      if (!advanced) break;
      if (key(loop[loop.length - 1]) === key(loop[0])) break;
    }

    if (loop.length >= 8) loops.push(loop);
  }

  return loops;
}

// ---------------------------------------------------------------------------
// Polygon -> smooth path
// ---------------------------------------------------------------------------

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Even spacing along the perimeter, so Bezier handles stay well conditioned. */
export function resample(pts, count) {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i % n];
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const total = cum[n];
  if (!(total > 0)) return pts.slice();

  const out = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / count;
    while (seg < n - 1 && cum[seg + 1] < target) seg++;
    const t = (target - cum[seg]) / (cum[seg + 1] - cum[seg] || 1e-12);
    const [ax, ay] = pts[seg];
    const [bx, by] = pts[(seg + 1) % n];
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return out;
}

/** Closed Catmull-Rom converted to cubic Beziers - C1 continuous everywhere. */
export function toBezierPath(pts, precision = 2) {
  const n = pts.length;
  const f = (v) => Number(v.toFixed(precision));
  const at = (i) => pts[((i % n) + n) % n];

  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])},${f(c2[0])} ${f(c2[1])},${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/**
 * Full pipeline: blobs -> one SVG path `d` covering every contour.
 *
 * Point budget scales with perimeter so a 5-unit droplet does not get the same
 * 96 control points as the main mass.
 */
export function blobsToPath(blobs, opts = {}) {
  return blobsToShape(blobs, opts).d;
}

/**
 * Full pipeline: blobs -> one SVG path `d` covering every contour, plus the
 * bounding box it actually occupies.
 *
 * `fit` re-frames the result into a square of the given size with a margin.
 * Without it the mark sits wherever the blob coordinates happened to put it,
 * which shows up as an icon that looks off-centre in the browser toolbar and
 * nowhere else.
 */
export function blobsToShape(blobs, { res = 700, minArea = 0.6, pointsPer100 = 34, fit = null, transform = null } = {}) {
  const field = makeField(blobs);
  const loops = contours(field, fieldBounds(blobs), res);

  const shaped = [];
  for (const loop of loops) {
    if (Math.abs(signedArea(loop)) < minArea) continue;
    let perim = 0;
    for (let i = 0; i < loop.length; i++) {
      const [ax, ay] = loop[i];
      const [bx, by] = loop[(i + 1) % loop.length];
      perim += Math.hypot(bx - ax, by - ay);
    }
    const count = Math.max(12, Math.round((perim / 100) * pointsPer100));
    let pts = resample(loop, count);
    // Consistent winding keeps nonzero fill from punching holes.
    if (signedArea(pts) < 0) pts = pts.reverse();
    shaped.push(pts);
  }

  let bbox = bboxOf(shaped.flat());
  let applied = transform;

  if (fit && !transform) {
    const { size = 100, margin = 3 } = fit;
    const inner = size - margin * 2;
    const scale = Math.min(inner / (bbox.x1 - bbox.x0), inner / (bbox.y1 - bbox.y0));
    applied = {
      scale,
      ox: margin + (inner - (bbox.x1 - bbox.x0) * scale) / 2 - bbox.x0 * scale,
      oy: margin + (inner - (bbox.y1 - bbox.y0) * scale) / 2 - bbox.y0 * scale,
    };
  }

  if (applied) {
    for (const pts of shaped) {
      for (const p of pts) {
        p[0] = p[0] * applied.scale + applied.ox;
        p[1] = p[1] * applied.scale + applied.oy;
      }
    }
    bbox = bboxOf(shaped.flat());
  }

  return {
    d: shaped.map((pts) => toBezierPath(pts)).join(''),
    bbox,
    contours: shaped.length,
    /**
     * Pass this back in as `transform` to place another group of blobs in the
     * same frame. Satellites are drawn as their own path so they can carry
     * their own fill - re-fitting them independently would float them off the
     * layout the main mass established.
     */
    transform: applied,
  };
}

function bboxOf(pts) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
