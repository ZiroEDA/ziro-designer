// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZOOM_CORRECTION_RULER::OnPaint` (`common/widgets/zoom_correction_ctrl.cpp:47-134`),
 * which is the Scaling group's whole point: the user holds a real ruler against
 * it, so every number on it has to be where a millimetre actually falls.
 *
 * None of this was pinned. The port drew a "0" upstream never draws, labelled
 * from the left edge of each tick instead of centring on it, had no minimum
 * label spacing and no `pxPerMinorTick < 3` fallback, and asked for a fixed
 * 300 px of width where `rulerSizer->Add( m_ruler, 1, wxEXPAND )` gives it the
 * whole group.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE_SCREEN_DPI, rulerTicks } from '@ziroeda/designer/src/widgets/zoom_correction_ctrl.js';

const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
const CTRL = readFileSync(
  resolve(process.cwd(), '../designer/src/widgets/zoom_correction_ctrl.tsx'),
  'utf8',
);

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

/** `pxPerUnit = dpi / unitsPerInch * value` (`:74`) — one millimetre, at 1:1. */
const MM = BASE_SCREEN_DPI / 25.4;

describe('the ruler measures what it says it measures', () => {
  it('puts a minor tick every millimetre at a correction of 1.0', () => {
    const ticks = rulerTicks(400, 1.0, 'mm');
    expect(ticks[1]!.x).toBeCloseTo(MM, 6);
    expect(ticks[2]!.x).toBeCloseTo(2 * MM, 6);
  });

  it('makes every tenth tick a major one', () => {
    // 400 px at 91 dpi is 111.6 mm, so the majors are the whole centimetres
    // inside it — written out rather than computed, so an off-by-one in the
    // loop cannot agree with itself.
    const ticks = rulerTicks(400, 1.0, 'mm');
    expect(ticks.filter((t) => t.major).map((t) => Math.round(t.x / MM))).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110,
    ]);
  });

  it('scales with the correction factor, which is the point of the control', () => {
    // Twice the PPI, half the pixels per millimetre... no: twice as many.
    const ticks = rulerTicks(400, 2.0, 'mm');
    expect(ticks[1]!.x).toBeCloseTo(2 * MM, 6);
  });

  it('reads cm and inch off the same arithmetic', () => {
    // `unitsPerInch` is 2.54 for cm and 1.0 for inch (`:68-71`).
    expect(rulerTicks(4000, 1.0, 'cm')[1]!.x).toBeCloseTo(BASE_SCREEN_DPI / 2.54, 6);
    expect(rulerTicks(4000, 1.0, 'inch')[1]!.x).toBeCloseTo(BASE_SCREEN_DPI, 6);
  });
});

describe('the labels are the ones KiCad draws', () => {
  const labels = (w: number, f = 1.0): string[] =>
    rulerTicks(w, f, 'mm')
      .filter((t) => t.label !== undefined)
      .map((t) => t.label as string);

  it('never labels the zero tick', () => {
    // `if( labelNum > 0 && … )` (`:120`). Ours drew a 0 at the left edge, which
    // KiCad's ruler does not have — and which is why ours read 0..80 against
    // the 10..70 on the same width.
    expect(labels(400)).not.toContain('0');
    expect(labels(400)[0]).toBe('10');
  });

  it('drops the last label rather than crowding the right edge', () => {
    // `x < size.x - 10` (`:120`): a tick 5 px from the end keeps its tick and
    // loses its number.
    const w = 30 * MM + 5;
    const ticks = rulerTicks(w, 1.0, 'mm');
    const last = ticks.filter((t) => t.major).at(-1);
    expect(last).toBeDefined();
    expect(last?.x).toBeGreaterThan(w - 10);
    expect(last?.label).toBeUndefined();
  });

  it('drops a label that would collide with the one before it', () => {
    // `( x - lastLabelX ) >= minLabelSpacing` (`:120`), the extent of "000_".
    // At a tenth scale the major ticks are ~3.6 px apart, so only every
    // eighth of them can carry a number.
    const dense = rulerTicks(400, 0.1, 'mm', 28).filter((t) => t.label !== undefined);
    for (let i = 1; i < dense.length; i++) {
      expect(dense[i]!.x - dense[i - 1]!.x).toBeGreaterThanOrEqual(28);
    }
    expect(dense.length).toBeGreaterThan(0);
  });

  it('halves its resolution rather than drawing mush', () => {
    // `if( pxPerMinorTick < 3 ) { pxPerMinorTick *= 2; majorTickEvery /= 2; }`
    // (`:104-109`). At factor 0.5 a millimetre is 1.79 px, so ticks land every
    // 3.58 and a major every five of them — the same 10 mm apart as before.
    const ticks = rulerTicks(400, 0.5, 'mm');
    expect(ticks[1]!.x).toBeCloseTo(2 * 0.5 * MM, 6);
    const majors = ticks.filter((t) => t.major);
    expect(majors[1]!.x).toBeCloseTo(10 * 0.5 * MM, 6);
  });
});

/**
 * `rulerSizer` is a HORIZONTAL box sizer: the ruler at proportion 1, the units
 * choice beside it (`:161-176`). Ours had no rule for either sizer, so the
 * choice stacked under the ruler and the ruler took a width it named itself.
 */
describe('the Scaling group is laid out by its two sizers', () => {
  it('puts the units choice beside the ruler, not under it', () => {
    expect(rule('.ze-zoomcorrection-ruler')).toMatch(/display:\s*flex/);
    expect(rule('.ze-zoomcorrection-ruler')).not.toMatch(/flex-direction:\s*column/);
  });

  it('gives the ruler the slack, as `Add( m_ruler, 1, wxEXPAND )` does', () => {
    expect(rule('.ze-zoomcorrection-ruler > svg')).toMatch(/flex:\s*1/);
    // ...and the width is measured, not declared.
    expect(CTRL).toContain('ResizeObserver');
    expect(CTRL).not.toMatch(/width\s*=\s*300/);
  });

  it('keeps 200 px as a MINIMUM and never reports its grown width as its size', () => {
    // `FromDIP( wxSize( 200, 30 ) )` is the ruler panel's min size; proportion
    // 1 is what makes it larger. Writing the measured width back onto the
    // <svg> makes that width the element's own layout size, so the dialog
    // grows to fit it and then hands the ruler more room -- the loop that took
    // this page to the 1500 px cap with a 190 mm ruler on it.
    expect(rule('.ze-zoomcorrection-ruler > svg')).toMatch(/min-width:\s*200px/);
    expect(CTRL).toContain('width="100%"');
    expect(CTRL).not.toMatch(/<svg[^>]*width=\{width\}/);
  });

  it('draws Display PPI as the wxSpinCtrl it is', () => {
    // `m_spinner = new wxSpinCtrl( … )` (`:150`) — the shared widget, which
    // draws GTK's two stepper buttons; a bare number input draws none.
    expect(CTRL).toContain('<SpinCtrl');
    expect(CTRL).not.toContain('type="number"');
  });

  it('greys the whole panel when the group is dead', () => {
    expect(CTRL).toContain('ze-disabled');
    expect(rule('.ze-zoomcorrection.ze-disabled')).toContain('--ctl-fg-disabled');
  });
});
