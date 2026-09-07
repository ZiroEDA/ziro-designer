// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_FP_EDITOR_GRAPHICS_DEFAULTS::TransferDataFromWindow`
 * (`pcbnew/dialogs/panel_fp_editor_graphics_defaults.cpp:176-282`), the half of
 * the page that is arithmetic rather than DOM.
 *
 * It is pinned here and not only through the rendered page because the shape of
 * it is easy to get wrong in a way a screenshot cannot show: the two `badParam`
 * flags are INDEPENDENT, a bad size REFUSES while a bad thickness CLAMPS, and
 * `min( w, h ) / 4` is integer division on internal units.
 */
import { describe, expect, it } from 'vitest';
import {
  MAXIMUM_LINE_WIDTH_MM,
  MINIMUM_LINE_WIDTH_MM,
  TEXT_MAX_SIZE_MM,
  TEXT_MIN_SIZE_MM,
  checkFpGraphicsRow,
} from '@ziroeda/designer/src/editors/footprint/graphics_defaults.js';
import { stringFromValue } from '@ziroeda/designer/src/ui/unit_binder.js';
import { pcbIUScale } from '@ziroeda/common';

/** `m_unitProvider->StringFromValue( v, true )` for a millimetre frame. */
const describeMM = (mm: number): string => stringFromValue(mm, 'mm', true, pcbIUScale);

/** The Silk Layers row as `FOOTPRINT_EDITOR_SETTINGS`' defaults leave it. */
const SILK = {
  line_width: 0.1,
  text_size_h: 1.0,
  text_size_v: 1.0,
  text_thickness: 0.1,
  text_italic: false,
};

const check = (over: Partial<typeof SILK> = {}, hasText = true) =>
  checkFpGraphicsRow('Silk Layers', { ...SILK, ...over }, hasText, describeMM);

describe('the limits are KiCad’s own', () => {
  it('mirrors board_design_settings.h and eda_text.h', () => {
    expect(MINIMUM_LINE_WIDTH_MM).toBe(0.005);
    expect(MAXIMUM_LINE_WIDTH_MM).toBe(100.0);
    expect(TEXT_MIN_SIZE_MM).toBe(0.001);
    expect(TEXT_MAX_SIZE_MM).toBe(250.0);
  });
});

describe('a clean row', () => {
  it('stores every field and raises nothing', () => {
    expect(check()).toEqual({ store: SILK, error: null });
  });

  it('accepts the limits themselves — the comparison is < and >, not <= and >=', () => {
    expect(check({ line_width: MINIMUM_LINE_WIDTH_MM }).error).toBeNull();
    // 100 mm of line under a 1 mm text would trip the thickness clamp, so the
    // maximum is checked on the row that has no text columns.
    expect(check({ line_width: MAXIMUM_LINE_WIDTH_MM }, false).error).toBeNull();
  });
});

describe('an out-of-range line width is refused, not clamped', () => {
  it('leaves line_width unstored and quotes both limits in the frame’s unit', () => {
    const r = check({ line_width: 0.004 });
    expect(r.store.line_width).toBeUndefined();
    expect(r.error).toBe(
      'Silk Layers: Incorrect line width.\nIt must be between 0.005 mm and 100 mm',
    );
  });

  it('still stores the text half of the row — the two badParam flags are separate', () => {
    const r = check({ line_width: 500 });
    expect(r.store.line_width).toBeUndefined();
    expect(r.store.text_size_h).toBe(1.0);
    expect(r.store.text_thickness).toBe(0.1);
  });
});

describe('an out-of-range text size is refused and short-circuits the thickness check', () => {
  it('stores neither size nor thickness, and reports only the size', () => {
    // A 300 mm text with a 0.1 mm stroke would also be "too small" for
    // `min(w,h)/4`, and upstream's `if( !badParam && … )` never asks.
    const r = check({ text_size_h: 300 });
    expect(r.store.text_size_h).toBeUndefined();
    expect(r.store.text_size_v).toBeUndefined();
    expect(r.store.text_thickness).toBeUndefined();
    expect(r.error).toBe(
      'Silk Layers: Text size is incorrect.\nSize must be between 0.001 mm and 250 mm',
    );
  });

  it('still stores the line width, and italic, which sits outside both guards', () => {
    const r = check({ text_size_v: 0, text_italic: true });
    expect(r.store.line_width).toBeCloseTo(0.1, 9);
    expect(r.store.text_italic).toBe(true);
  });
});

describe('text thickness is CLAMPED to a quarter of the smaller text dimension', () => {
  it('truncates a stroke thicker than size/4 and says what it became', () => {
    // 1 mm text → 0.25 mm ceiling.
    const r = check({ text_thickness: 0.4 });
    expect(r.store.text_thickness).toBeCloseTo(0.25, 9);
    expect(r.error).toBe(
      'Silk Layers: Text thickness is too large.\nIt will be truncated to 0.25 mm',
    );
  });

  it('takes the SMALLER of width and height, not the one being edited', () => {
    // 2 mm wide but 0.4 mm tall: the ceiling is 0.4/4, not 2/4.
    const r = check({ text_size_h: 2, text_size_v: 0.4, text_thickness: 0.3 });
    expect(r.store.text_thickness).toBeCloseTo(0.1, 9);
  });

  it('floors a stroke below MINIMUM_LINE_WIDTH_MM', () => {
    const r = check({ text_thickness: 0.001 });
    expect(r.store.text_thickness).toBeCloseTo(MINIMUM_LINE_WIDTH_MM, 9);
    expect(r.error).toBe(
      'Silk Layers: Text thickness is too small.\nIt will be truncated to 0.005 mm',
    );
  });

  it('divides in integer IU, as GetUnitValue’s int does', () => {
    // 0.001001 mm is 1001 IU; `1001 / 4` on an int is 250, i.e. 0.00025 mm —
    // not the 0.00025025 mm real division gives. Both numbers print, so a
    // millimetre implementation of this line would be visible here.
    const r = check({ text_size_h: 0.001001, text_size_v: 0.001001, text_thickness: 0.001 });
    expect(r.error).toContain('It will be truncated to 0.00025 mm');
    // …and then the MIN floor beats the ceiling it was just given, which is
    // the order `std::min` then `std::max` puts them in (`:263-264`).
    expect(r.store.text_thickness).toBeCloseTo(MINIMUM_LINE_WIDTH_MM, 9);
  });
});

describe('Edge Cuts and Courtyards leave after the line width', () => {
  it('stores no text field at all — not even italic', () => {
    const r = check({ text_thickness: 99 }, false);
    expect(r.store).toEqual({ line_width: 0.1 });
    expect(r.error).toBeNull();
  });
});

describe('two failures in one row are joined the way errorsMsg joins them', () => {
  it('separates the messages with a blank line', () => {
    const r = check({ line_width: 0, text_size_h: 1e6 });
    expect(r.error?.split('\n\n')).toHaveLength(2);
    expect(r.error).toContain('Incorrect line width');
    expect(r.error).toContain('Text size is incorrect');
  });
});

describe('the limits are quoted in the frame’s unit, not in millimetres', () => {
  it('reads a mils frame’s error in mils', () => {
    const r = checkFpGraphicsRow('Fab Layers', { ...SILK, line_width: 0.004 }, true, (mm) =>
      stringFromValue(mm, 'mils', true, pcbIUScale),
    );
    expect(r.error).toBe(
      'Fab Layers: Incorrect line width.\nIt must be between 0.19685 mils and 3937.00787 mils',
    );
  });
});
