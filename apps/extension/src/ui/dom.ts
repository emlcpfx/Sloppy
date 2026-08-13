/**
 * DOM construction, without ever touching innerHTML.
 *
 * LinkedIn enforces Trusted Types. Content scripts run in an isolated world and
 * are currently exempt, but building on that exemption means one policy change
 * breaks the extension for everybody at once - and the exemption is not
 * something we control or get told about. `createElement` + `textContent` costs
 * nothing and cannot be revoked.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  title?: string;
  type?: string;
  role?: string;
  tabIndex?: number;
  text?: string;
  style?: Partial<CSSStyleDeclaration>;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: Event) => void>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, props);
  append(el, children);
  return el;
}

export function svg(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  append(el, children);
  return el;
}

function apply(el: HTMLElement, props: Props): void {
  if (props.class) el.className = props.class;
  if (props.title) el.title = props.title;
  if (props.role) el.setAttribute('role', props.role);
  if (props.tabIndex !== undefined) el.tabIndex = props.tabIndex;
  if (props.type && el instanceof HTMLButtonElement) el.type = props.type as 'button';
  if (props.text !== undefined) el.textContent = props.text;
  if (props.style) Object.assign(el.style, props.style);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.on) {
    for (const [name, fn] of Object.entries(props.on)) {
      if (fn) el.addEventListener(name, fn as EventListener);
    }
  }
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * A closed shadow root on a host element WE created.
 *
 * Never attach a shadow root to the post element itself: a shadow root replaces
 * that element's rendering, so the post's own content would stop being drawn.
 * The host is always a fresh div we own.
 *
 * Closed rather than open so LinkedIn's stylesheet churn cannot reach in and our
 * markup cannot be walked from the page - the reference we keep is the only way
 * in.
 */
export function makeShadowHost(styles: string, hostClass: string): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  host.setAttribute('data-sloppy-host', '1');
  host.className = hostClass;
  const root = host.attachShadow({ mode: 'closed' });
  adoptStyles(root, styles);
  return { host, root };
}

/**
 * Constructable stylesheets where available, a <style> element otherwise.
 *
 * The fallback matters: adoptedStyleSheets is the modern path, but a <style>
 * with textContent is Trusted-Types-safe too, so there is no reason to require
 * the modern one.
 */
export function adoptStyles(root: ShadowRoot, css: string): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    return;
  } catch {
    // Fall through.
  }
  const style = document.createElement('style');
  style.textContent = css;
  root.appendChild(style);
}

/**
 * One page-level stylesheet, injected once.
 *
 * This one CANNOT live in the shadow root, because it styles light DOM: the
 * post element carries the collapsed state, and hiding a post means hiding the
 * site's own children. Everything else we draw stays inside the shadow.
 */
let pageStylesInjected = false;
export function injectPageStyles(css: string): void {
  if (pageStylesInjected) return;
  const style = document.createElement('style');
  style.setAttribute('data-sloppy', 'page');
  style.textContent = css;
  (document.head ?? document.documentElement).appendChild(style);
  pageStylesInjected = true;
}
