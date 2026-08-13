import { SPLAT_COLORS } from '@sloppy/brand/path';

/**
 * Light-DOM CSS. The only styling that escapes the shadow root, because it is
 * the only styling that has to reach the site's own elements.
 *
 * The collapse works by attribute, not by removing nodes: a collapsed post
 * keeps every child it had and simply stops drawing them. React can re-render
 * the post underneath us all it likes - the attribute is re-applied by the
 * observer and nothing of the site's was ever destroyed to begin with.
 */
export const PAGE_CSS = `
[data-sloppy-post] {
  position: relative;
}

[data-sloppy-host] {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 40;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

/* Hover reveals it; focus-within reveals it for anyone not using a mouse. */
[data-sloppy-post]:hover > [data-sloppy-host],
[data-sloppy-post]:focus-within > [data-sloppy-host],
[data-sloppy-host][data-open="1"] {
  opacity: 1;
  pointer-events: auto;
}

[data-sloppy-post][data-sloppy-collapsed="1"] > *:not([data-sloppy-host]) {
  display: none !important;
}

[data-sloppy-post][data-sloppy-collapsed="1"] > [data-sloppy-host] {
  position: static;
  opacity: 1;
  pointer-events: auto;
}

@media (prefers-reduced-motion: reduce) {
  [data-sloppy-host] { transition: none; }
}
`;

/**
 * Shadow-DOM CSS. Isolated in both directions - their stylesheet churn cannot
 * reach our button, and our styles cannot leak into their feed.
 */
export const SHADOW_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

* { box-sizing: border-box; }

.btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.06);
  color: ${SPLAT_COLORS.flat};
  cursor: pointer;
  transition: transform 110ms ease, box-shadow 110ms ease;
}

.btn:hover { transform: scale(1.09); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.26); }
.btn:active { transform: scale(0.96); }
.btn:focus-visible { outline: 2px solid ${SPLAT_COLORS.mid}; outline-offset: 2px; }
.btn svg { width: 19px; height: 19px; display: block; }

/* ---- tag picker ---- */

.picker {
  position: absolute;
  top: 36px;
  right: 0;
  width: 268px;
  padding: 12px;
  border-radius: 12px;
  background: #fff;
  color: #16181d;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.07);
  font-size: 13px;
  line-height: 1.35;
  z-index: 2;
}

.picker h2 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #6b7280;
}

.chips { display: flex; flex-wrap: wrap; gap: 6px; }

.chip {
  padding: 5px 9px;
  border: 1px solid #d8dce2;
  border-radius: 999px;
  background: #f7f8fa;
  color: #1f2328;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.chip:hover { border-color: ${SPLAT_COLORS.mid}; background: #f0faec; }
.chip:focus-visible { outline: 2px solid ${SPLAT_COLORS.mid}; outline-offset: 1px; }

.row { display: flex; gap: 6px; margin-top: 10px; }

.row input {
  flex: 1;
  min-width: 0;
  padding: 6px 9px;
  border: 1px solid #d8dce2;
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  color: #1f2328;
  background: #fff;
}

.row input:focus { outline: 2px solid ${SPLAT_COLORS.mid}; outline-offset: -1px; border-color: transparent; }

.row button {
  padding: 6px 11px;
  border: 0;
  border-radius: 8px;
  background: ${SPLAT_COLORS.flat};
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.hint { margin: 9px 0 0; font-size: 11px; color: #6b7280; }

.immune-copy {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: #1f2328;
}

/* ---- collapse stub ---- */

.stub {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f4f6f8;
  border: 1px solid #e2e6ea;
  color: #4b5563;
  font-size: 13px;
}

.stub .mark { flex: none; width: 16px; height: 16px; color: ${SPLAT_COLORS.flat}; }
.stub .mark svg { width: 100%; height: 100%; display: block; }
.stub .why { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stub .why b { font-weight: 600; color: #1f2328; }

.stub button {
  flex: none;
  padding: 4px 10px;
  border: 1px solid #d8dce2;
  border-radius: 999px;
  background: #fff;
  color: #1f2328;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.stub button:hover { border-color: ${SPLAT_COLORS.mid}; color: ${SPLAT_COLORS.deep}; }
.stub button:focus-visible { outline: 2px solid ${SPLAT_COLORS.mid}; outline-offset: 1px; }

@media (prefers-color-scheme: dark) {
  .btn { background: rgba(32, 35, 40, 0.94); box-shadow: 0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08); }
  .picker { background: #1b1e24; color: #e6e8ea; box-shadow: 0 8px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.09); }
  .picker h2 { color: #9aa3ad; }
  .chip { background: #24282f; border-color: #343a43; color: #e6e8ea; }
  .chip:hover { background: #26332a; }
  .row input { background: #24282f; border-color: #343a43; color: #e6e8ea; }
  .hint { color: #9aa3ad; }
  .immune-copy { color: #e6e8ea; }
  .stub { background: #1b1e24; border-color: #2b3038; color: #9aa3ad; }
  .stub .why b { color: #e6e8ea; }
  .stub button { background: #24282f; border-color: #343a43; color: #e6e8ea; }
}

@media (prefers-reduced-motion: reduce) {
  .btn { transition: none; }
}
`;
