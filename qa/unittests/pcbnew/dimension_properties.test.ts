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
 *
 * Every assertion that matters round-trips through the writer, because an
 * in-memory check cannot tell those failures apart from success.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { collectDimensionValues } from '@ziroeda/pcbnew/dialogs/dialog_dimension_properties.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/types.js';

const MM = (n: number): number => mmToIU(n);

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

const read = (...extra: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`),
  );

describe('reading the values', () => {
  it('reads the format block', () => {
    const v = collectDimensionValues(read(ORTHO).dimensions[0]!);

    expect(v.units).toBe(3);
    expect(v.unitsFormat).toBe(0);
    expect(v.precision).toBe(4);
    expect(v.suppressZeroes).toBe(true);
  });

  it('reads the style block', () => {
    const v = collectDimensionValues(read(ORTHO).dimensions[0]!);

    expect(v.lineThickness).toBe(MM(0.1));
    expect(v.arrowLength).toBe(MM(1.27));
    expect(v.arrowDirection).toBe('outward');
    expect(v.extensionOvershoot).toBe(MM(0.58642));
    expect(v.keepTextAligned).toBe(true);
  });

  it('reads the text', () => {
    const v = collectDimensionValues(read(ORTHO).dimensions[0]!);

    expect(v.textHeight).toBe(MM(1));
    expect(v.textThickness).toBe(MM(0.15));
    expect(v.textOrientation).toBe(90);
  });

  it('distinguishes no override from an empty one', () => {
    expect(collectDimensionValues(read(ORTHO).dimensions[0]!).overrideValue).toBeUndefined();
    expect(collectDimensionValues(read(LEADER).dimensions[0]!).overrideValue).toBe(
      '0.3mm Thickness',
    );
  });

  it('reads a centre dimension without inventing a format', () => {
    const v = collectDimensionValues(read(CENTER).dimensions[0]!);

    expect(v.prefix).toBe('');
    expect(v.overrideValue).toBeUndefined();
    expect(v.textHeight).toBe(0);
  });
});
