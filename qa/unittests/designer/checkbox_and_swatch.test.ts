// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Two decorations the browser drew for us that KiCad does not have.
 *
 * Both were found beside a real GerbView and both are SHARED widgets, so both
 * were wrong in every launcher at once:
 *
 *   - the visibility check box. `accent-color` gets the FILL right — a live
 *     GerbView's boxes and ours both measure rgb(233,84,32) — but the tick is
 *     not ours to ask for. The browser picks its own contrast colour for the
 *     mark, and for this accent Chrome chooses BLACK where GTK strokes it
 *     white. So the box is drawn rather than accented.
 *   - the colour swatch. `COLOR_SWATCH::RenderToDC` opens with
 *     `SetPen( *wxTRANSPARENT_PEN )` (`common/widgets/color_swatch.cpp:72`) and
 *     paints a flat rectangle. Ours is a `<button>`, and a bare button takes
 *     the user agent's 2px OUTSET border — the white-and-grey bevel around
 *     every swatch.
 *
 * The numbers come from `qa/probes/checkbox_probe.cpp`, which renders the
 * control through `wxRendererNative::DrawCheckBox` — the same GTK draw
 * `LAYER_WIDGET`'s wxCheckBox gets (`gerbview/widgets/layer_widget.cpp:347`).
 * Corroborated against Akshay's capture of a real GerbView, where the tick
 * peaks at rgb(255,252,252) and the box fills rgb(233,84,32).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHELL = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);
const CSS_CODE = SHELL.replace(/\/\*[\s\S]*?\*\//g, '');

const token = (name: string): string => {
  const m = CSS_CODE.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  expect(m, `no token ${name}`).not.toBeNull();
  return m![1]!.trim();
};

const rule = (selector: string): Record<string, string> => {
  const at = CSS_CODE.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = CSS_CODE.slice(at + selector.length + 4, CSS_CODE.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    out[decl.slice(0, i).trim()] = decl
      .slice(i + 1)
      .trim()
      .replace(/\s+/g, ' ');
  }
  return out;
};

describe('the check box is drawn, not accented', () => {
  const base = rule('.ze-app input[type="checkbox"]');
  const checked = rule('.ze-app input[type="checkbox"]:checked');

  it('takes the user agent out of it', () => {
    // With accent-color left in place the browser keeps choosing the tick
    // colour, which is the whole defect.
    expect(base.appearance).toBe('none');
    expect(base['accent-color']).toBeUndefined();
  });

  it('fills checked with the desktop accent, rgb(233,84,32)', () => {
    expect(checked['background-color']).toBe('var(--chrome-active)');
    expect(token('--chrome-active')).toBe('#e95420');
  });

  it('strokes the tick WHITE, which is the bug Akshay saw', () => {
    // The probe measures the stroke at rgb(255,252,252) — white within
    // antialiasing — and wxSYS_COLOUR_HIGHLIGHTTEXT is #ffffff.
    expect(checked['background-image']).toContain("stroke='%23ffffff'");
  });

  it('keeps that stroke tied to --check-mark, which CSS cannot do for it', () => {
    // --check-mark already held this before the fix — Yaru's
    // $selected_fg_color. A url() cannot interpolate a custom property, so the
    // literal is checked against the token here instead.
    expect(token('--check-mark')).toBe('#ffffff');
    expect(checked['background-image']).toContain(
      `stroke='%23${token('--check-mark').replace('#', '')}'`,
    );
  });

  it('unchecked is the face and ring tokens that already existed', () => {
    // Both predate this fix and both were right: --check-face is Yaru's
    // `background-image: image(#393939)` and the probe reads the same
    // rgb(57,57,57) back off the rendered control. Nothing new was invented
    // here — the rule simply was not using them.
    expect(token('--check-face')).toBe('#393939');
    expect(token('--check-border')).toBe('#191919');
    expect(base.background).toBe('var(--check-face)');
    expect(base.border).toBe('1px solid var(--check-border)');
  });

  it("is 16 square with Yaru's 3px radius", () => {
    // [css] check { border-radius: 3px } — the one control that is not
    // --ctl-radius. The probe's corner cuts three pixels, which is that radius
    // plus antialiasing, so the declared value stands.
    expect(token('--check-size')).toBe('16px');
    expect(token('--check-radius')).toBe('3px');
    expect(base.width).toBe('var(--check-size)');
    expect(base['border-radius']).toBe('var(--check-radius)');
  });
});

describe('the colour swatch has no border', () => {
  it('states none, because a bare <button> takes the UA bevel', () => {
    // wxTRANSPARENT_PEN, color_swatch.cpp:72. Stating nothing is not enough
    // here — the user agent supplies a border unless something removes it,
    // which is the same failure mode as the notebook tabs rendering in Arial.
    expect(rule('.ze-layer-swatch').border).toBe('none');
    expect(rule('.ze-layer-swatch').padding).toBe('0');
  });
});
