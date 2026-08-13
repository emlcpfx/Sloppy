/**
 * Everything a single post gets: the splat button, the tag picker it opens, and
 * the stub that replaces the post when it is filtered.
 *
 * Shared by every adapter. If anything in here needs to know which site it is
 * on, the SiteAdapter interface is missing a method.
 */

import { SPLAT_PATH, SPLAT_PATH_COMPACT, SPLAT_VIEWBOX } from '@sloppy/brand/path';
import { normalizeTag, tagsForSite, type SiteId, type Verdict } from '@sloppy/core';
import { clear, h, makeShadowHost, svg, type Props } from './dom.ts';
import { SHADOW_CSS } from './styles.ts';

/**
 * Below this the thin arms and the flung satellites stop resolving and the mark
 * reads as a smudge, so the chunkier cut is used instead. Same threshold the
 * icon set uses.
 */
const COMPACT_BELOW = 26;

export function splatIcon(size = 19): SVGElement {
  return svg(
    'svg',
    { viewBox: SPLAT_VIEWBOX, width: String(size), height: String(size), 'aria-hidden': 'true' },
    svg('path', { d: size < COMPACT_BELOW ? SPLAT_PATH_COMPACT : SPLAT_PATH, fill: 'currentColor' }),
  );
}

export interface PostUIHandlers {
  /** Read ids AT CLICK TIME - the node may have been recycled since injection. */
  onTag(tag: string): void | Promise<void>;
  onShow(): void | Promise<void>;
}

export interface PostUI {
  host: HTMLElement;
  render(verdict: Verdict): void;
  closePicker(): void;
  destroy(): void;
}

export function createPostUI(site: SiteId, handlers: PostUIHandlers): PostUI {
  const { host, root } = makeShadowHost(SHADOW_CSS, 'sloppy');
  const wrap = h('div', { style: { position: 'relative' } });
  root.appendChild(wrap);

  let pickerOpen = false;
  let picker: HTMLElement | null = null;

  const button = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      title: 'Tag this post',
      attrs: { 'aria-label': 'Tag this post as slop', 'aria-haspopup': 'dialog' },
      on: {
        click: (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          togglePicker();
        },
      },
    },
    splatIcon(),
  );

  function setOpen(open: boolean): void {
    pickerOpen = open;
    // Drives the light-DOM rule that keeps the button visible while open -
    // otherwise moving the pointer to the picker hides the thing you opened.
    if (open) host.setAttribute('data-open', '1');
    else host.removeAttribute('data-open');
  }

  function togglePicker(): void {
    if (pickerOpen) {
      closePicker();
      return;
    }
    picker = buildPicker(site, async (raw) => {
      closePicker();
      await handlers.onTag(raw);
    });
    wrap.appendChild(picker);
    setOpen(true);
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKeydown, true);
    picker.querySelector<HTMLElement>('.chip, input')?.focus();
  }

  function closePicker(): void {
    if (picker) picker.remove();
    picker = null;
    setOpen(false);
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKeydown, true);
  }

  /**
   * The picker lives in a closed shadow root, so a click inside it reports the
   * HOST as its target from the page's perspective. Comparing against the host
   * is therefore the correct outside-click test; comparing against the picker
   * element would close it on every click inside itself.
   */
  function onDocClick(ev: Event): void {
    const target = ev.target as Node | null;
    if (target && host.contains(target)) return;
    closePicker();
  }

  function onKeydown(ev: Event): void {
    if ((ev as KeyboardEvent).key === 'Escape') {
      ev.stopPropagation();
      closePicker();
      button.focus();
    }
  }

  function render(verdict: Verdict): void {
    clear(wrap);
    if (picker) picker = null;
    setOpen(false);

    if (verdict.action === 'collapse') {
      wrap.appendChild(buildStub(verdict.reason, handlers.onShow));
      return;
    }
    wrap.appendChild(button);
  }

  return {
    host,
    render,
    closePicker,
    destroy() {
      closePicker();
      host.remove();
    },
  };
}

// ---------------------------------------------------------------------------

function buildPicker(site: SiteId, commit: (tag: string) => void): HTMLElement {
  const chips = h('div', { class: 'chips' });

  for (const def of tagsForSite(site)) {
    chips.appendChild(
      h('button', {
        class: 'chip',
        type: 'button',
        text: def.label,
        title: def.hint,
        on: {
          click: (ev) => {
            ev.stopPropagation();
            commit(def.id);
          },
        },
      } satisfies Props),
    );
  }

  const input = h('input', {
    attrs: { type: 'text', placeholder: 'or type a tag', maxlength: '32', 'aria-label': 'Custom tag' },
  });

  const submit = () => {
    const normalized = normalizeTag(input.value);
    if (normalized) commit(normalized.tag);
  };

  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if ((ev as KeyboardEvent).key === 'Enter') submit();
  });

  return h(
    'div',
    { class: 'picker', role: 'dialog', attrs: { 'aria-label': 'Tag this post' } },
    h('h2', { text: 'Why is this slop?' }),
    chips,
    h(
      'div',
      { class: 'row' },
      input,
      h('button', { type: 'button', text: 'Tag', on: { click: (ev) => { ev.stopPropagation(); submit(); } } }),
    ),
    h('p', { class: 'hint', text: 'Tags describe how a post is written, never whether it is right.' }),
  );
}

/**
 * Collapse, don't delete. Every hide states its reason and offers a way back,
 * because a filter you cannot audit is one you stop trusting.
 */
function buildStub(reason: string, onShow: () => void | Promise<void>): HTMLElement {
  return h(
    'div',
    { class: 'stub', role: 'status' },
    h('span', { class: 'mark' }, splatIcon(16)),
    h('span', { class: 'why' }, 'filtered — ', h('b', { text: reason })),
    h('button', {
      type: 'button',
      text: 'show',
      attrs: { 'aria-label': `Show the post filtered as ${reason}` },
      on: {
        click: (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void onShow();
        },
      },
    }),
  );
}
