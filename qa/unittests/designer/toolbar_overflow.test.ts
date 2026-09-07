// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a toolbar does when it does not fit — `ACTION_TOOLBAR`'s
 * `SetOverflowVisible( !GetToolBarFits() )` (`common/tool/action_toolbar.cpp:221-231`).
 *
 * The bug this exists for: setting Preferences > Common's toolbar icons to
 * Large made the vertical toolbars taller than the window, and every one of the
 * three things that could go wrong went wrong at once — the strip grew past its
 * pane, the last buttons ended up under the status bar, and the DOCUMENT
 * scrolled, which no KiCad frame can do.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OVERFLOW_SIZE, visibleCount } from '@ziroeda/designer/src/ui/toolbar_overflow.js';

const src = (rel: string): string =>
  readFileSync(resolve(process.cwd(), '../designer/src', rel), 'utf8');

const CSS = src('ui/shell.css');

/** A rule body by exact selector, comments stripped — a `}` inside a comment
 *  ends a naive split, and every one of these rules carries prose. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((x) => x.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

/** `ends[i]` is where entry i finishes; 30px buttons with a 1px gap. */
const bar = (n: number, pitch = 31): number[] =>
  Array.from({ length: n }, (_, i) => i * pitch + 30);

describe('the chevron size', () => {
  it("is wx's own, measured rather than chosen", () => {
    // [px] `GetElementSize( wxAUI_TBART_OVERFLOW_SIZE )` reports 16 on this
    // machine (`qa/probes/aui_overflow_probe.cpp`).
    expect(OVERFLOW_SIZE).toBe(16);
  });

  it('is the number the stylesheet reserves, along the bar in both directions', () => {
    // Along the bar's own axis, because that is the rect the art provider is
    // given: `wxRect( …, overflowSize, barHeight )`.
    expect(rule('.ze-toolbar.horizontal > .ze-tb-overflow')).toMatch(
      new RegExp(`width:\\s*${OVERFLOW_SIZE}px`),
    );
    expect(rule('.ze-toolbar.vertical > .ze-tb-overflow')).toMatch(
      new RegExp(`height:\\s*${OVERFLOW_SIZE}px`),
    );
  });
});

describe('which entries stay on the strip', () => {
  it('keeps all of them, and shows no chevron, when they fit', () => {
    // `GetToolBarFits()` true — `SetOverflowVisible( false )`.
    expect(visibleCount(bar(5), 200)).toBeNull();
    // Exactly full is still a fit: the bar is its size, not one pixel more.
    expect(visibleCount(bar(5), 154)).toBeNull();
  });

  it('reserves the chevron out of the room BEFORE deciding, as wx does', () => {
    // 5 buttons end at 154. At 150 they do not fit, so the overflow button
    // becomes visible and the layout that follows has 16px less room -- so the
    // answer is not "four", it is "however many fit in 134".
    //   134 -> ends 30, 61, 92, 123 fit; 154 does not.
    expect(visibleCount(bar(5), 150)).toBe(4);
    // One pixel short of fitting costs whatever that 16px costs, not one tool.
    expect(visibleCount(bar(5), 153)).toBe(4);
  });

  it('keeps an entry that ends exactly on the boundary', () => {
    // Six buttons end at 30, 61, 92, 123, 154, 185. At 108 the room left after
    // the chevron is 92 -- exactly where the third one finishes, and an item
    // that uses exactly the space there is has fitted. Off by one here is a
    // button that vanishes into the menu at one window height and comes back at
    // the next pixel, which reads as a flicker rather than as a bug.
    expect(visibleCount(bar(6), 108)).toBe(3);
    expect(visibleCount(bar(6), 107)).toBe(2);
  });

  it('drops as many as it has to on a very short bar', () => {
    // room 184: ends 30, 61, 92, 123, 154 fit; 185 does not.
    expect(visibleCount(bar(40), 200)).toBe(5);
    expect(visibleCount(bar(40), 60)).toBe(1); // room 44: 30 fits, 61 does not
  });

  it('shows the chevron rather than nothing when not even one fits', () => {
    // The tools have to stay REACHABLE. A negative `room` is a pane narrower
    // than the button itself, which a user can produce by dragging a sash.
    expect(visibleCount(bar(40), 20)).toBe(0);
    expect(visibleCount(bar(40), 0)).toBe(0);
  });

  it('has nothing to overflow on an empty bar', () => {
    expect(visibleCount([], 0)).toBeNull();
  });
});

describe('the frame clips, because a wxFrame clips', () => {
  it('forbids the document scrolling at the root', () => {
    // `html, body, #root { height: 100% }` alone does not stop an overflowing
    // child from scrolling the page, and nothing in KiCad scrolls the window.
    expect(rule('body')).toMatch(/overflow:\s*hidden/);
    expect(rule('html')).toMatch(/overflow:\s*hidden/);
  });

  it('lets a vertical strip shrink below its content', () => {
    // The other half, and the one that actually caused it: a flex item's
    // default `min-height: auto` is its CONTENT height, so a column of buttons
    // taller than the window refuses to shrink and pushes the frame open.
    const body = rule('.ze-toolbar');
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/overflow:\s*hidden/);
  });
});

describe('the overflowed tools are reachable', () => {
  const TB = src('ui/Toolbar.tsx');

  it('are dropped from the layout, not painted over', () => {
    // An item wx has overflowed does not take space -- which is what leaves
    // room for the chevron at the end.
    expect(TB).toMatch(/if \(shownEntries !== null && i >= shownEntries\) return null;/);
  });

  it('open as a menu built from the ITEMS, as ShowDropDown does', () => {
    // `WX_AUI_TOOLBAR_ART::ShowDropDown` takes the short help, splits the
    // accelerator off at the tab, carries the bitmap, and checks a check/radio
    // item that is on.
    expect(TB).toMatch(/overflowItems/);
    expect(TB).toContain("firstLine.split('\\t')");
    expect(TB).toMatch(/icon: b\.icon \?\? b\.id/);
    expect(TB).toMatch(/activeTool === b\.id \|\| toggled\?\.has\(b\.id\)/);
  });

  it('re-measures on a resize, which is what wxEVT_SIZE does', () => {
    expect(TB).toMatch(/new ResizeObserver\(\(\) => setShownEntries\(null\)\)/);
  });
});
