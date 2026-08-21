// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The chrome tokens against the palette KiCad actually paints with.
 *
 * KiCad declares almost none of its own colours. It asks wxWidgets, which maps
 * GTK's theme onto `wxSYS_COLOUR_*` **with logic of its own** — so reading
 * GTK's named palette answers a different question than the one KiCad asks.
 * The two really do disagree: GTK's `theme_bg_color` is #2c2c2c, while
 * `wxSYS_COLOUR_3DFACE`, which is what a wxAuiToolBar draws on, is #373737 —
 * and #373737 is what a live GerbView's toolbar measures.
 *
 * So the source of truth is `qa/probes/syscolour_probe.cpp`, which builds a wx
 * app on this machine with this theme and prints the whole enum. Its output is
 * transcribed below, and each token is checked against the entry it is supposed
 * to be. That is the point: a token here is not "a dark grey somebody liked",
 * it is one named system colour, and this names which.
 *
 * These are [px] measurements of the running toolkit, so they are pinned as
 * literals here on purpose — an expectation that re-derived them by reading the
 * stylesheet would agree with itself whatever the stylesheet said.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SHELL = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);

/** `qa/probes/syscolour_probe.cpp`, Ubuntu 24.04 / Yaru-dark / Ubuntu Sans 11. */
const WX_SYS_COLOUR: Record<string, string> = {
  '3DFACE': '#373737',
  '3DSHADOW': '#181818',
  BTNSHADOW: '#181818',
  BTNTEXT: '#f7f7f7',
  MENUTEXT: '#f7f7f7',
  CAPTIONTEXT: '#f7f7f7',
  MENUBAR: '#2c2c2c',
  MENU: '#1d1d1d',
  WINDOW: '#272727',
  LISTBOX: '#272727',
  APPWORKSPACE: '#272727',
  WINDOWTEXT: '#ffffff',
  LISTBOXTEXT: '#ffffff',
  HIGHLIGHT: '#e95420',
  HIGHLIGHTTEXT: '#ffffff',
  GRAYTEXT: '#929292',
};

/** A token's declared value, from the `:root` block. */
const token = (name: string): string => {
  const m = SHELL.match(new RegExp(`\\n\\s*--${name}:\\s*([^;]+);`));
  expect(m, `--${name} is not declared`).not.toBeNull();
  return (m as RegExpMatchArray)[1]!.trim();
};

describe('the probe transcription is not empty', () => {
  it('found the stylesheet and the tokens in it', () => {
    expect(SHELL.length).toBeGreaterThan(10000);
    expect(token('chrome-bg')).toMatch(/^#/);
  });
});

describe('each chrome token is one named wx system colour', () => {
  const BOUND: [string, string][] = [
    // The menu bar and the status bar; NOT the toolbars, which are 3DFACE.
    ['chrome-bg', 'MENUBAR'],
    // wxAuiToolBar's face, and the wxAUI sash, which is why those two match.
    ['content-bg', '3DFACE'],
    // A widget's own foreground: buttons, labels, menu items, static text.
    ['chrome-fg', 'BTNTEXT'],
    // The text inside a view: an entry, a listbox, a grid cell.
    ['view-fg', 'WINDOWTEXT'],
    // Inset surfaces.
    ['chrome-bg2', 'WINDOW'],
    ['field-bg', 'WINDOW'],
    ['panel-bg', 'WINDOW'],
    // Selection is the desktop accent.
    ['chrome-active', 'HIGHLIGHT'],
    ['selection-fg', 'HIGHLIGHTTEXT'],
    ['ctl-fg-disabled', 'GRAYTEXT'],
    // A control's outline.
    ['ctl-border', 'BTNSHADOW'],
  ];

  for (const [name, colour] of BOUND) {
    it(`--${name} is wxSYS_COLOUR_${colour}`, () => {
      expect(token(name)).toBe(WX_SYS_COLOUR[colour]);
    });
  }
});

describe('hover is an overlay, not a colour', () => {
  /**
   * `wxSYS_COLOUR_MENUHILIGHT` is rgb(247, 247, 247) at alpha 38/255, and a
   * Gtk.OffscreenWindow rendering a real menu item prelit composites it to
   * rgb(74, 74, 74) on the rgb(44, 44, 44) menu bar — 44 + (247-44) * 38/255.
   *
   * The token is used on 31 hover surfaces whose backgrounds are #2c2c2c,
   * #373737 and #272727. A flat grey can match one of the three; ours was
   * #3a3a3a = 58, sixteen units too dark on the menu bar and further out on the
   * lighter toolbars.
   */
  it('carries the alpha wx reports, rather than a flat grey', () => {
    expect(token('chrome-hover')).toBe('rgb(247 247 247 / 14.9%)');
  });

  it('composites to what a live prelit menu item measures', () => {
    // The arithmetic that makes the alpha the right one, done here so the
    // number above is checkable rather than merely transcribed.
    const OVER_MENUBAR = Math.round(44 + (247 - 44) * (38 / 255));
    expect(OVER_MENUBAR).toBe(74);
    // And it is NOT what the old flat value gave.
    expect(OVER_MENUBAR).not.toBe(0x3a);
  });

  it('is not what a toolbar BUTTON uses, which is the accent', () => {
    // `BITMAP_BUTTON::OnPaint` tints every tool state with
    // `wxSYS_COLOUR_HIGHLIGHT.ChangeLightness( n )` — the accent with each
    // channel scaled — so those states have their own tokens and must not be
    // folded into the grey overlay. Named individually: a single "some accent
    // token differs" would pass with two of the three collapsed.
    for (const name of [
      'accent-fill-pressed',
      'accent-fill-checked',
      'accent-fill-hover-checked',
    ]) {
      expect(token(name), `--${name}`).not.toBe(token('chrome-hover'));
      // Each is a tint of the accent, so it is warm: red channel above blue.
      const m = token(name).match(/^#(\w{2})(\w{2})(\w{2})$/);
      expect(m, `--${name} should be a hex tint`).not.toBeNull();
      const [r, , b] = (m as RegExpMatchArray).slice(1).map((h) => Number.parseInt(h, 16));
      expect(r, `--${name} is a tint of the orange accent`).toBeGreaterThan(b as number);
    }
  });
});

describe('a selection is the desktop accent, everywhere', () => {
  /**
   * `wxSYS_COLOUR_HIGHLIGHT` is #e95420 and `_HIGHLIGHTTEXT` is #ffffff, and
   * every selected row in KiCad is those two — a wxGrid's, a wxListBox's, a
   * wxDataViewCtrl's alike, because none of them picks a colour.
   *
   * Ours painted six surfaces differently: the Symbol Fields Table grid, the
   * ERC subrow and the Search row in #e07b1a — the same shade that appears
   * nowhere in Yaru and that the checkbox accent was also drifting to — and the
   * layer-pair grid, the properties grid and CVPCB in BLUE, which is the tint
   * CLAUDE.md names as "the thing that read as not KiCad before a single widget
   * had been compared". A progress fill, an ERC gauge and a spinner arc were
   * off the same way.
   *
   * Scanned rather than listed: a list of six selectors goes stale the moment a
   * seventh panel is written, and the point is that NO rule picks its own
   * selection colour.
   */
  const RULES = SHELL.replace(/\/\*[\s\S]*?\*\//g, '').split('}');

  it('found rules to scan, so this cannot pass on an empty split', () => {
    expect(RULES.length).toBeGreaterThan(400);
  });

  it('no selected-row rule paints its own background', () => {
    const offenders = RULES.filter(
      (r) => /\.(selected|sel)\b[^{]*\{/.test(r) && /background(-color)?:\s*(#|rgba?\()/.test(r),
    ).map((r) => r.split('{')[0]!.trim().replace(/\s+/g, ' '));
    expect(
      offenders,
      'a selection is wxSYS_COLOUR_HIGHLIGHT, not a colour a panel chooses',
    ).toStrictEqual([]);
  });

  it('and the accent literal is gone from the stylesheet entirely', () => {
    // #e07b1a survived three separate passes tonight by hiding in a different
    // property each time — a checkbox accent, then six selections, then a
    // spinner arc and a tab marker. The only occurrence left is the sentence
    // recording that it was wrong.
    const code = SHELL.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain('#e07b1a');
  });
});

describe('the two foreground colours stay two', () => {
  /**
   * `--chrome-fg` was #ffffff, collapsing BTNTEXT and WINDOWTEXT into one, and
   * it showed: a histogram of the GerbView layers manager beside a live one at
   * the same size has KiCad's layer names peaking at 247 with the usual
   * antialiasing spread, and ours flat at 255 across 1,976 pixels. Those names
   * are WX_ELLIPSIZED_STATIC_TEXT — a widget label, so BTNTEXT.
   */
  it('differ, which is the whole reason there are two', () => {
    expect(token('chrome-fg')).not.toBe(token('view-fg'));
  });

  it('and an entry takes the view one, because an entry is a view', () => {
    const at = SHELL.indexOf('.ze-app select,\n.ze-app textarea {');
    expect(at).toBeGreaterThanOrEqual(0);
    const rule = SHELL.slice(at, SHELL.indexOf('}', at));
    expect(rule).toMatch(/color:\s*var\(--view-fg\)/);
  });
});
