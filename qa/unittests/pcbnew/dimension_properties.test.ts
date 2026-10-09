// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading and writing a dimension's properties.
 * Counterparts: `DIALOG_DIMENSION_PROPERTIES::TransferDataToWindow` and
 * `updateDimensionFromDialog`.
 *
 * The two things that would silently corrupt a file rather than look wrong on
 * screen, and are therefore what these tests are for:
 *
 * - **Override text is a mode, not a string.** In the file the presence of
 *   `(override_value …)` *is* the enable flag, so an override set to `""` must
 *   still be written or the dimension reverts to its measured value on reload.
 * - **Kind gates which fields exist.** Extension overshoot is aligned only, the
 *   text frame leader only, and a centre dimension has no format block. Writing
 *   one to the wrong kind makes a file KiCad reads back differently from what
 *   was saved.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { PCB_DIMENSION_BASE } from '@ziroeda/pcbnew/pcb_dimension.js';
import {
  DIALOG_DIMENSION_PROPERTIES,
  type DimensionValues,
} from '@ziroeda/pcbnew/dialogs/dialog_dimension_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

/** Verbatim from demos/cm5_minima. */
const ORTHO = `(dimension
    (type orthogonal)
    (layer "Dwgs.User")
    (uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")
    (pts (xy 113.6 58.975) (xy 113.35 28.975))
    (height 12.85)
    (orientation 1)
    (format (prefix "") (suffix "") (units 3) (units_format 0) (precision 4)
      (suppress_zeroes yes))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (arrow_direction outward) (extension_height 0.58642) (extension_offset 0.5)
      (keep_text_aligned yes))
    (gr_text "30" (at 125.3 43.975 90) (layer "Dwgs.User")
      (uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const LEADER = `(dimension
    (type leader)
    (layer "Cmts.User")
    (uuid "bd892614-315c-4158-b663-af4718d7e6a1")
    (pts (xy 152.94971 67.310695) (xy 156.29971 63.960695))
    (format (prefix "") (suffix "") (units 0) (units_format 0) (precision 4)
      (override_value "0.3mm Thickness"))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (text_frame 0) (extension_offset 0.5))
    (gr_text "0.3mm Thickness" (at 168.99971 63.960695 0) (layer "Cmts.User")
      (uuid "bd892614-315c-4158-b663-af4718d7e6a1")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const CENTER = `(dimension
    (type center)
    (layer "F.SilkS")
    (uuid "6c3890f3-95ec-403d-a195-7e14eaa0059b")
    (pts (xy 106.5 90.75) (xy 106.5 87.25))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (extension_offset 0.5) (keep_text_aligned yes)))`;

const read = (...extra: string[]): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (5 "F.SilkS" user "F.Silkscreen")
    (17 "Dwgs.User" user "User.Drawings") (19 "Cmts.User" user "User.Comments"))
  (net 0 "")
  ${extra.join('\n  ')}
)`);

/** `TransferDataToWindow` on the board's one dimension. */
const window = (text: string): DimensionValues => {
  const board = read(text);
  const dim = board.Drawings()[0] as PCB_DIMENSION_BASE;
  return new DIALOG_DIMENSION_PROPERTIES(new TEST_PCB_FRAME(board), dim).TransferDataToWindow();
};

describe('reading the values (TransferDataToWindow)', () => {
  it('reads the format block', () => {
    const v = window(ORTHO);

    expect(v.units).toBe(3);
    expect(v.unitsFormat).toBe(0);
    expect(v.precision).toBe(4);
    expect(v.suppressZeroes).toBe(true);
  });

  it('reads the style block', () => {
    const v = window(ORTHO);

    expect(v.lineThickness).toBe(MM(0.1));
    expect(v.arrowLength).toBe(MM(1.27));
    expect(v.arrowDirection).toBe('outward');
    expect(v.extensionOvershoot).toBe(MM(0.58642));
    expect(v.keepTextAligned).toBe(true);
  });

  it('reads the text', () => {
    const v = window(ORTHO);

    expect(v.textHeight).toBe(MM(1));
    expect(v.textThickness).toBe(MM(0.15));
    expect(v.textOrientation).toBe(90);
  });

  it('distinguishes no override from an empty one', () => {
    expect(window(ORTHO).overrideValue).toBeUndefined();
    expect(window(LEADER).overrideValue).toBe('0.3mm Thickness');
  });

  it('reads a centre dimension as its constructor leaves it', () => {
    // No format block in the file: PCB_DIM_CENTER's constructor
    // (pcb_dimension.cpp:1718-1723) turns the override ON with no text, and
    // the text keeps EDA_TEXT's DEFAULT_SIZE_TEXT, 50 mil (eda_text.cpp:105).
    const v = window(CENTER);

    expect(v.prefix).toBe('');
    expect(v.overrideValue).toBe('');
    expect(v.textHeight).toBe(MM(1.27));
  });
});
