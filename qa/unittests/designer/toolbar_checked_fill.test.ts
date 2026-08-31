// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a CHECKED tool looks like, and the fact that one wx rule paints it
 * everywhere.
 *
 * `BITMAP_BUTTON::OnPaint` fills the button with
 * `wxSYS_COLOUR_HIGHLIGHT.ChangeLightness( 40 )` — every channel of the accent
 * scaled to 40% — and outlines it 1px in the highlight colour itself. So a
 * checked tool is a DARK fill with a thin bright edge, not a solid block of
 * accent.
 *
 * Measured against a real Schematic Editor with the selection tool checked:
 * fill rgb(93,33,12). Ours painted rgb(233,84,32), the accent at full strength,
 * which is what made our toolbars read differently at a glance.
 *
 * The same rectangle, from the same wx code, appears in three places here: the
 * toolbars, the project manager's launcher hover, and the manager toolbar. It
 * had been written as a literal three times (twice as `#5d220d`, once as
 * `#5d210c` — already drifting). It is one token now.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);
/** Comments stripped: prose about a value must not read as the value. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * A rule body by exact selector, which may be one of several on the rule.
 *
 * `.ze-tbtn.active` shares its declaration with `.ze-lp-iconbtn.checked` — the
 * launcher's icon buttons are BITMAP_BUTTONs too, so upstream paints them from
 * the same `ChangeLightness` and one rule is the right shape here. Matching
 * `"\n" + selector + " {"` found only a rule that stands alone, so sharing it
 * read as deleting it.
 */
const rule = (selector: string): string => {
  for (const m of CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  expect.fail(`shell.css has no ${selector} rule`);
};

describe('a checked tool is ChangeLightness(40), not the raw accent', () => {
  it('derives the token from the accent, at 40% per channel', () => {
    // #e95420 -> each channel x 0.4 -> (93,33,12) = #5d220d.
    const m = /--accent-fill-checked:\s*(#[0-9a-f]{6})/i.exec(CODE);
    expect(m, 'no --accent-fill-checked token').not.toBeNull();
    const hex = (m?.[1] ?? '').slice(1);
    const got = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const accent = [0xe9, 0x54, 0x20];
    got.forEach((v, i) => {
      // Within one level of 40% — wx rounds per channel.
      expect(Math.abs(v - Math.round((accent[i] ?? 0) * 0.4))).toBeLessThanOrEqual(1);
    });
  });

  it('fills a checked toolbar button with it, outlined in the accent', () => {
    const body = rule('.ze-tbtn.active');
    expect(body).toMatch(/background:\s*var\(--accent-fill-checked\)/);
    expect(body).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--chrome-active\)/);
    // The bug: a solid block of accent.
    expect(body).not.toMatch(/background:\s*var\(--chrome-active\)/);
  });

  it('is the SAME value the launcher hover and the manager bar use', () => {
    // One wx rule, so one token — these had been three literals, one of which
    // (#5d210c) had already drifted from the other two.
    const uses = [...CODE.matchAll(/var\(--accent-fill-checked\)/g)].length;
    expect(uses, 'every consumer should read the token').toBeGreaterThanOrEqual(3);
    // The literals must survive only as the token's own definition — one
    // occurrence each at most, and none in a rule body. (Comments are already
    // stripped from CODE; this comment names them, which is why the check
    // counts rather than forbids.)
    const decl = CODE.slice(CODE.indexOf(':root'), CODE.indexOf('}', CODE.indexOf(':root')));
    const body = CODE.replace(decl, '');
    expect(body, 'a literal fill survived outside the token').not.toMatch(/#5d2[12]0[cd]/i);
  });
});

/**
 * The whole `BITMAP_BUTTON::OnPaint` state machine, not just the checked arm.
 *
 * bitmap_button.cpp:270-310, dark mode:
 *
 *     pressed          ChangeLightness( 20 )
 *     hover            ChangeLightness( 40 )
 *     hover + checked  ChangeLightness( 50 )   "Checked items need a lighter
 *                                               hover rectangle"
 *     checked          ChangeLightness( 40 )
 *
 * every one of them outlined 1px in the highlight itself. Two consequences that
 * are easy to get backwards: hover and checked share a fill, and a CHECKED tool
 * goes LIGHTER under the pointer, not darker.
 *
 * Ours painted hover as a flat grey `--chrome-hover` with a grey border, which
 * is why the toolbars did not light up the way KiCad's do.
 */
describe('every tool state is the accent at its own lightness', () => {
  const lightness = (name: string): number[] => {
    const m = new RegExp(`${name}:\\s*#([0-9a-f]{6})`, 'i').exec(CODE);
    expect(m, `no ${name} token`).not.toBeNull();
    const hex = m?.[1] ?? '';
    return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  };
  const accent = [0xe9, 0x54, 0x20];
  const expectLightness = (name: string, pct: number): void => {
    lightness(name).forEach((v, i) => {
      expect(
        Math.abs(v - Math.round((accent[i] ?? 0) * (pct / 100))),
        `${name} should be ChangeLightness(${pct})`,
      ).toBeLessThanOrEqual(1);
    });
  };

  it('has a token per level, derived from the accent', () => {
    expectLightness('--accent-fill-pressed', 20);
    expectLightness('--accent-fill-checked', 40);
    expectLightness('--accent-fill-hover-checked', 50);
  });

  it('hovers a tool with the same fill as checked, outlined in the accent', () => {
    const body = rule('.ze-tbtn:not(.disabled):not(:disabled):hover');
    expect(body).toMatch(/background:\s*var\(--accent-fill-checked\)/);
    expect(body).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--chrome-active\)/);
    // The bug: a flat grey.
    expect(body).not.toMatch(/--chrome-hover/);
  });

  it('lightens a CHECKED tool on hover rather than darkening it', () => {
    const body = rule('.ze-tbtn.active:not(.disabled):not(:disabled):hover');
    expect(body).toMatch(/background:\s*var\(--accent-fill-hover-checked\)/);
    // 50 is lighter than 40 — the direction is the whole point of that arm.
    const checked = lightness('--accent-fill-checked');
    const hovered = lightness('--accent-fill-hover-checked');
    hovered.forEach((v, i) => expect(v).toBeGreaterThan(checked[i] ?? 0));
  });

  it('presses darker than either', () => {
    expect(rule('.ze-tbtn:not(.disabled):not(:disabled):active')).toMatch(
      /background:\s*var\(--accent-fill-pressed\)/,
    );
    const pressed = lightness('--accent-fill-pressed');
    const checked = lightness('--accent-fill-checked');
    pressed.forEach((v, i) => expect(v).toBeLessThan(checked[i] ?? 0));
  });
});

/**
 * Toolbar geometry is DERIVED from one setting, as KiCad's is.
 *
 * `appearance.toolbar_icon_size` (common_settings.cpp:115-116) defaults to 24
 * and is the only number stored. `ACTION_TOOLBAR::AddAction`
 * (action_toolbar.cpp:141) then computes
 *
 *     paddingDip = ( ToDIP( m_buttonSize.GetWidth() ) - iconSize ) / 2
 *
 * so the padding is not a value — it is the half-difference between the button
 * and the icon. Change the icon size in Preferences and the whole toolbar
 * follows, which is why KiCad's stays coherent at any size.
 *
 * Ours had six literals: 22px icons in 26px buttons in one rule, 28px buttons
 * in two others. Nothing moved together, and none of the numbers were KiCad's.
 * [px] measured on a hovered "Switch to PCB Editor": KiCad is a 30px button
 * around a 24px icon (3px each side); ours was 24px around 22px (1px).
 */
describe('toolbar metrics come from the icon-size setting', () => {
  const token = (name: string): string => {
    const m = new RegExp(`${name}:\\s*([^;]+);`).exec(CODE);
    expect(m, `no ${name} token`).not.toBeNull();
    return (m?.[1] ?? '').trim();
  };

  it('stores the icon size KiCad defaults to', () => {
    expect(token('--toolbar-icon-size')).toBe('24px');
  });

  it('pads by the half-difference KiCad measures, not an arbitrary 1px', () => {
    // paddingDip = ( button - icon ) / 2, and [px] a real hovered toolbar
    // button is 30 around a 24 icon, so 3. Ours was 1, which is what made our
    // highlight hug the icon. Pinned as a VALUE as well as a relationship: with
    // only the relationship, 1px still satisfies calc() and the box comes out
    // 26 instead of 30.
    expect(token('--toolbar-button-pad')).toBe('3px');
  });

  it('computes the button from the icon plus twice the padding', () => {
    // The RELATIONSHIP is the point. A literal that happens to equal 30px would
    // pass a value check and still break the moment the icon size changed.
    expect(token('--toolbar-button-size')).toMatch(
      /calc\(\s*var\(--toolbar-icon-size\)\s*\+\s*2\s*\*\s*var\(--toolbar-button-pad\)\s*\)/,
    );
  });

  it('sizes the button and its icon from the tokens, never a literal', () => {
    const btn = rule('.ze-tbtn');
    expect(btn).toMatch(/width:\s*var\(--toolbar-button-size\)/);
    expect(btn).toMatch(/height:\s*var\(--toolbar-button-size\)/);
    const img = rule('.ze-tbtn img');
    expect(img).toMatch(/width:\s*var\(--toolbar-icon-size\)/);
    expect(img).toMatch(/height:\s*var\(--toolbar-icon-size\)/);
  });

  it('has no second opinion about button size anywhere', () => {
    // The vertical toolbar and the palette each used to declare their own 28px.
    const sized = [...CODE.matchAll(/\.ze-tbtn[^{}]*\{([^}]*)\}/g)].map((m) => m[1] ?? '');
    for (const body of sized) {
      expect(body, 'a toolbar rule set a literal size').not.toMatch(/(width|height):\s*\d+px/);
    }
  });
});
