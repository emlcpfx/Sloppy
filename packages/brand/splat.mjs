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
 * One thrown arm: a chain of circles from the core out to a droplet head.
 *
 * `taper` shrinks each link, and the final link gets `tipScale` back so the arm
 * ends in a head rather than a point - the single detail that reads as liquid
 * rather than as a star.
 */
function arm(cx, cy, angleDeg, length, baseR, opts = {}) {
  const { links = 4, taper = 0.78, tipScale = 1.5, curve = 0, start = 0.3 } = opts;
  const blobs = [];
  for (let i = 1; i <= links; i++) {
    const t = i / links;
    // Curve bends the arm as it travels, so nothing looks compass-drawn.
    const a = rad(angleDeg + curve * t * t);
    const d = length * (start + (1 - start) * t);
    const isTip = i === links;
    const r = baseR * taper ** i * (isTip ? tipScale : 1);
    blobs.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r });
  }
  return blobs;
}

/**
 * The mark, in a 0..100 box.
 *
 * Asymmetric on purpose: one dominant throw up-right with a heavy head, a long
 * low-left counterweight, and the rest short. Even spacing reads as a snowflake.
 */
export function splatBlobs(seed = 20260808) {
  const r = rng(seed);
  const jitter = (amt) => (r() - 0.5) * 2 * amt;

  const cx = 49;
  const cy = 52;

  /** Core mass: one round blob is a dot, three offset lobes is a splat. */
  const blobs = [
    { x: cx, y: cy, r: 10 },
    { x: cx + Math.cos(rad(-40)) * 7, y: cy + Math.sin(rad(-40)) * 7, r: 8.5 },
    { x: cx + Math.cos(rad(150)) * 8, y: cy + Math.sin(rad(150)) * 8, r: 8 },
  ];

  /**
   * Deliberately uneven: two long throws, three mid, two stubs. Seven arms of
   * equal length is a snowflake, and the eye reads the regularity instantly.
   */
  // angle, length, base radius, options
  const arms = [
    [-78, 47, 8.6, { links: 4, tipScale: 1.7, curve: 12 }],   // dominant throw, up
    [-24, 30, 7.0, { links: 3, tipScale: 1.4, curve: -14 }],  // mid, upper right
    [34, 21, 6.2, { links: 3, tipScale: 1.3, curve: 12 }],    // stub, lower right
    [88, 39, 7.4, { links: 4, tipScale: 1.45, curve: -10 }],  // mid, straight down
    [143, 26, 6.4, { links: 3, tipScale: 1.45, curve: 14 }],  // stub, lower left
    [179, 45, 8.2, { links: 4, tipScale: 1.6, curve: -11 }],  // long, left
    [-136, 33, 6.8, { links: 3, tipScale: 1.5, curve: 10 }],  // mid, upper left
  ];

  for (const [angle, length, baseR, opts] of arms) {
    blobs.push(...arm(cx, cy, angle + jitter(3), length * (1 + jitter(0.05)), baseR, opts));
  }

  return blobs;
}

/**
 * The small-size cut.
 *
 * At 16px the full mark loses its arms entirely - a 1px-wide tendril simply is
 * not there after rasterisation, and what survives is an anonymous green dot.
 * So the toolbar icon gets its own geometry: shorter, fatter arms, no far
 * satellites, and a heavier core. Same character, drawn for the size it will
 * actually be seen at, which is what an icon designer would do by hand anyway.
 */
export function splatBlobsCompact(seed = 20260808) {
  const r = rng(seed);
  const jitter = (amt) => (r() - 0.5) * 2 * amt;
  const cx = 50;
  const cy = 51;

  // Smaller core than you would expect, and FATTER arms - the arms are what
  // disappear first at 16px, so they get the mass the core gives up.
  const blobs = [
    { x: cx, y: cy, r: 9 },
    { x: cx + Math.cos(rad(-40)) * 7, y: cy + Math.sin(rad(-40)) * 7, r: 8 },
    { x: cx + Math.cos(rad(150)) * 8, y: cy + Math.sin(rad(150)) * 8, r: 7.4 },
  ];

  const arms = [
    [-78, 44.0, 9.5, { links: 3, taper: 0.84, tipScale: 1.55, curve: 10 }],
    [-18, 33.0, 8.1, { links: 3, taper: 0.84, tipScale: 1.4, curve: -12 }],
    [42, 27.5, 7.6, { links: 2, taper: 0.84, tipScale: 1.35, curve: 10 }],
    [94, 38.5, 8.5, { links: 3, taper: 0.84, tipScale: 1.4, curve: -8 }],
    [176, 41.8, 9.0, { links: 3, taper: 0.84, tipScale: 1.5, curve: -10 }],
    [-138, 30.8, 7.6, { links: 2, taper: 0.84, tipScale: 1.4, curve: 8 }],
  ];

  for (const [angle, length, baseR, opts] of arms) {
    blobs.push(...arm(cx, cy, angle + jitter(2), length, baseR, opts));
  }
  return blobs;
}

/**
 * Detached droplets. Separate contours by construction - they sit outside every
 * influence radius, so the field is exactly zero between them and the core.
 */
export function splatSatellites(seed = 20260808) {
  const r = rng(seed ^ 0x5eed);
  const j = (a) => (r() - 0.5) * 2 * a;
  return [
    { x: 12.5 + j(1), y: 17.5 + j(1), r: 5.4 },   // flung up-left
    { x: 20.0 + j(1), y: 8.0 + j(1), r: 2.6 },    // its trailing speck
    { x: 88.0 + j(1), y: 84.5 + j(1), r: 4.6 },   // opposite corner, balance
    { x: 78.5 + j(1), y: 15.0 + j(1), r: 3.0 },
  ];
}

/** Compact-support field: sums to >= ISO inside the shape, exactly 0 far away. */
export function makeField(blobs) {
  const w = weightFor(K);
  const prepared = blobs.map((b) => ({ ...b, R2: (b.r * K) ** 2 }));
  return (x, y) => {
    let sum = 0;
    for (const b of prepared) {
      const dx = x - b.x;
      const dy = y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= b.R2) continue;
      const t = 1 - d2 / b.R2;
      sum += w * t * t * t;
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
    const R = b.r * K;
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
