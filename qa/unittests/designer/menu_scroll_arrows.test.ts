// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A menu that fits shows no scroll arrows.
 *
 * GTK grows arrows only on a menu too tall for the monitor, and shows one only
 * at an end with something still beyond it. Ours put a down arrow on a
 * three-item View > Panels flyout and, worse, hid the flyout's own rows behind
 * it. Two causes, both pinned here:
 *
 *  - `clientHeight` is 0 until the pane is laid out, so `scrollHeight - 0`
 *    read as a full menu's worth of "more below";
 *  - the arrows are rows in the same flex column as the scroll pane, so once a
 *    spurious one was mounted the NEXT open measured arrow height instead of
 *    row height and clamped the flyout to it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NO_ARROWS, submenuEnds } from '@ziroeda/designer/src/ui/menu_scroll.js';

const MENUBAR = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/MenuBar.tsx', import.meta.url)),
  'utf8',
);

describe('a submenu that fits gets no arrows', () => {
  it('shows neither on a short menu', () => {
    // Three rows of 26 in a pane 78 tall: nothing to scroll.
    expect(submenuEnds(0, 78, 78)).toEqual(NO_ARROWS);
  });

  it('shows neither before the pane has been laid out', () => {
    // The regression. clientHeight 0 must never read as "more below".
    expect(submenuEnds(0, 400, 0)).toEqual(NO_ARROWS);
    expect(submenuEnds(0, 78, 0)).toEqual(NO_ARROWS);
  });

  it('tolerates a sub-pixel rounding difference', () => {
    // A pane one pixel short of its content is not scrollable in practice.
    expect(submenuEnds(0, 79, 78)).toEqual(NO_ARROWS);
    // And still not once that pixel has been scrolled: without the `+ 1` of
    // slack this reports an up arrow for one pixel of travel. Checked from a
    // scrolled position because at rest the two readings agree, which is why a
    // top-of-pane case alone let the slack be removed unnoticed.
    expect(submenuEnds(1, 79, 78)).toEqual(NO_ARROWS);
  });
});

describe('a submenu too tall shows the arrow for the end it can still reach', () => {
  // 400 of rows in a 200 pane: 200 of travel.
  it('only down at the top', () => {
    expect(submenuEnds(0, 400, 200)).toEqual({ up: false, down: true });
  });

  it('both in the middle', () => {
    expect(submenuEnds(100, 400, 200)).toEqual({ up: true, down: true });
  });

  it('only up at the bottom', () => {
    expect(submenuEnds(200, 400, 200)).toEqual({ up: true, down: false });
  });
});

describe('the arrows do not survive a close', () => {
  it('resets the ends when the submenu closes, not just the box', () => {
    // Leaving them mounted is what made the next open measure arrow height.
    expect(MENUBAR).toMatch(
      /if \(!subOpen\) \{\s*\n\s*setBox\(null\);[\s\S]{0,400}?setEnds\(NO_ARROWS\)/,
    );
  });

  it('computes the ends in one place, not inline', () => {
    expect(MENUBAR).toContain('submenuEnds(');
    expect(MENUBAR).not.toMatch(/scrollHeight - el\.clientHeight/);
  });
});

describe('the flyout is capped by the screen, never by itself', () => {
  /**
   * The height cap used to be computed in JS as `Math.min(el.scrollHeight, …)`
   * — measuring the very element the cap is applied to. That is circular: each
   * open re-clamped from the previous clamp. Measured on a ONE-row
   * View > Panels flyout before the fix: max-height 34px, a 26px row squeezed
   * into an 8px pane, and a down arrow drawn over it.
   *
   * A menu is limited by the monitor and nothing else, so the cap is a constant
   * in the stylesheet and a short menu simply stays short.
   */
  it('does not measure the flyout to decide the flyout’s height', () => {
    // The positioning effect must carry left and top only. `el.scrollHeight`
    // still appears once — on the scroll PANE, where it is what tells the
    // arrows there is more to see — and the top-level dropdown's own
    // `tooTall` cap is a CSS constant, not a measured one.
    expect(MENUBAR).toContain('setBox({ left, top })');
    expect(MENUBAR).not.toMatch(/setBox\(\{[^}]*maxHeight/);
    expect(MENUBAR).not.toMatch(/const maxHeight =/);
    expect(MENUBAR).not.toMatch(/const h = el\.scrollHeight/);
  });

  it('caps it in CSS at the viewport instead', () => {
    const shell = readFileSync(
      fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
      'utf8',
    );
    const at = shell.indexOf('.ze-submenu {');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(shell.slice(at, shell.indexOf('}', at))).toMatch(/max-height:\s*calc\(100vh - 8px\)/);
  });
});
