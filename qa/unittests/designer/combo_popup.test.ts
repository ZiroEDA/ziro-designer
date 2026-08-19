// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The shared `Combo` — our `wxChoice` — and where it opens its list.
 *
 * A native `<select>` is drawn by the operating system, so its list cannot be
 * themed and it always drops *below* the closed box. GTK's `wxChoice` opens the
 * list **over** the box with the selected row covering it. Measured side by side
 * against a real `bitmap2component` at the same combo:
 *
 *                       KiCad            a native <select>
 *   popup background    rgb(29,29,29)    rgb(44,44,44)
 *   highlighted row     rgb(62,62,62)    rgb(153,200,255)   <- Chrome's own blue
 *   popup border        rgb(75,75,75)    (none)
 *   list position       over the box     below the box
 *
 * So the widget draws its own list. This pins the placement rule and the
 * palette; the palette assertions read the stylesheet because there is no DOM
 * here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PAD_Y, ROW_H, popupTop } from '@ziroeda/designer/src/ui/combo_popup.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CSS = read('../../../designer/src/ui/shell.css');
const TSX = read('../../../designer/src/ui/Combo.tsx');

/** The body of one CSS rule, comments stripped so they cannot read as code. */
function rule(selector: string): string {
  // `[^{}]*` so a selector that appears in a comma-separated group still matches.
  const body = new RegExp(`${selector.replace(/[.\\]/g, '\\$&')}[^{}]*\\{([^}]*)\\}`).exec(
    CSS.replace(/\/\*[\s\S]*?\*\//g, ''),
  );
  expect(body, `shell.css has no ${selector} rule`).not.toBeNull();
  return body?.[1] ?? '';
}

describe('Combo: the list opens over the box, as wxChoice does', () => {
  const VIEWPORT = 800;

  it('puts the selected row exactly on top of the closed box', () => {
    // Row 0 selected: the popup's first row must land on the button, so only
    // the 4px of padding sits above it.
    expect(popupTop(400, 0, 5, VIEWPORT)).toBe(400 - PAD_Y);
    // Row 2 selected: two rows' worth of list hangs above the button.
    expect(popupTop(400, 2, 5, VIEWPORT)).toBe(400 - PAD_Y - 2 * ROW_H);
  });

  it('never merely drops the list below the box', () => {
    // The bug being fixed. A native select would return buttonTop + boxHeight;
    // for any selection past the first, ours is strictly above the box.
    for (let index = 1; index < 5; index++) {
      expect(popupTop(400, index, 5, VIEWPORT)).toBeLessThan(400);
    }
  });

  it('slides back on screen at the top rather than opening off it', () => {
    // A low selection index near the top of the window would want a negative
    // top; it is clamped to the 4px margin.
    expect(popupTop(10, 4, 6, VIEWPORT)).toBe(4);
  });

  it('slides back on screen at the bottom rather than being cut off', () => {
    // Opened near the bottom with row 0 selected, the whole list must still fit.
    const count = 8;
    const height = count * ROW_H + PAD_Y * 2;
    expect(popupTop(790, 0, count, VIEWPORT)).toBe(VIEWPORT - 4 - height);
  });

  it('leaves a short list where it wants to be, untouched by either clamp', () => {
    expect(popupTop(300, 1, 3, VIEWPORT)).toBe(300 - PAD_Y - ROW_H);
  });
});

describe('Combo: KiCad’s palette, not Chrome’s', () => {
  it('paints the popup KiCad’s #1d1d1d on a #4b4b4b border', () => {
    const body = rule('.ze-combo-popup');
    expect(body).toMatch(/background:\s*#1d1d1d/);
    expect(body).toMatch(/#4b4b4b/);
  });

  it('highlights the hovered row grey, never Chrome’s blue', () => {
    expect(rule('.ze-combo-item:hover')).toMatch(/background:\s*#3e3e3e/);
    // rgb(153,200,255) is the native highlight; it must not be reproduced.
    expect(CSS).not.toContain('#99c8ff');
  });

  it('reuses the app’s own chevron rather than a second arrow glyph', () => {
    // Same `.twisty.expandable` the menus and the tree pane draw.
    expect(TSX).toContain('twisty expandable');
  });
});

describe('Combo: it behaves like a wxChoice, not a menu', () => {
  it('answers the arrow keys without opening the list', () => {
    // wxChoice steps the selection in place; only Enter/Space pops it up.
    expect(TSX).toMatch(/ArrowDown[\s\S]{0,80}step\(1\)/);
    expect(TSX).toMatch(/ArrowUp[\s\S]{0,80}step\(-1\)/);
    expect(TSX).toMatch(/'Enter' \|\| e\.key === ' '[\s\S]{0,60}setOpen\(true\)/);
  });

  it('takes Escape for itself so the frame behind does not also act', () => {
    expect(TSX).toMatch(/Escape[\s\S]{0,200}stopPropagation\(\)/);
  });

  it('is a listbox to a screen reader', () => {
    expect(TSX).toContain('role="listbox"');
    expect(TSX).toContain('role="option"');
    expect(TSX).toContain('aria-haspopup="listbox"');
  });
});

describe('Combo: no orange border on a clicked drop-down', () => {
  /**
   * Yaru gives `entry` and `spinbutton` a focus border and a `button` none:
   *
   *   spinbutton:focus:not(.vertical), entry:focus {
   *     box-shadow: inset 0 0 0 1px rgba(239, 134, 97, 0.7);
   *     border-color: rgba(239, 134, 97, 0.7); }
   *   button { … outline-color: rgba(239, 134, 97, 0.7); … }   <- no :focus rule
   *
   * A combo box is `combobox > box > button.combo`, i.e. a button, so clicking
   * one shows no orange. GTK3's `outline` is the dashed keyboard-navigation
   * rectangle, whose exact web equivalent is `:focus-visible`.
   */
  it('leaves a clicked combo’s border alone', () => {
    expect(rule('.ze-combo:focus')).toMatch(/border-color:\s*var\(--ctl-border\)/);
  });

  it('shows the keyboard rectangle only on :focus-visible, and dashed', () => {
    const body = rule('.ze-combo:focus-visible');
    expect(body).toMatch(/outline:\s*1px dashed/);
  });

  it('never paints the flat accent on a focused control', () => {
    // The bug: `border-color: var(--chrome-active-border)` (#e95420) fired for
    // every input, select and textarea, at full saturation.
    expect(CSS).not.toMatch(/select:focus\s*\{[^}]*--chrome-active-border/);
    expect(rule('.ze-combo:focus')).not.toContain('chrome-active');
  });

  it('gives a text field KiCad’s 70%-alpha orange, not the flat one', () => {
    expect(CSS).toMatch(/--field-focus-border:\s*rgb\(239 134 97 \/ 70%\)/);
  });
});

describe('Combo: interiors follow GTK, where a button and an entry differ', () => {
  /**
   * They are not meant to match. Yaru declares
   *   button { background-image: image(#373737) }   <- a combo is a button
   *   entry  { … }                                  <- samples to #282828
   * so a KiCad row shows a lighter drop-down beside a darker number field. What
   * was wrong before is that our drop-down took neither: a native <select> fell
   * through to the generic `--chrome-bg2` (#262626), so the two boxes differed
   * by an amount KiCad never shows.
   */
  it('paints the combo the button face and the field the entry interior', () => {
    expect(rule('.ze-combo')).toMatch(/background:\s*var\(--ctl-face\)/);
    expect(CSS).toMatch(/--ctl-face:\s*#373737/);
    expect(CSS).toMatch(/--field-bg:\s*#282828/);
  });

  it('no longer lets a drop-down fall through to --chrome-bg2', () => {
    expect(rule('.ze-combo')).not.toContain('chrome-bg2');
  });
});
