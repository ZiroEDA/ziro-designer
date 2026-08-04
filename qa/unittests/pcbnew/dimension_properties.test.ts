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
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  applyDimensionValues,
  collectDimensionValues,
  dimensionAt,
  type DimensionValues,
} from '@ziroeda/pcbnew/src/dimension_properties.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

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
  (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`),
  );

/** Apply a change and read the file back, which is where the failures show. */
const roundTrip = (src: string, over: Partial<DimensionValues>): Board => {
  const b = read(src);
  const v = { ...collectDimensionValues(b.dimensions[0]!), ...over };
  return readBoard(parse(serializeBoard(applyDimensionValues(b, 0, v))));
};

describe('finding the selected dimension', () => {
  it('takes a single selected one', () => {
    expect(dimensionAt(read(ORTHO), ['dimension:0'])).toBe(0);
  });

  it('takes nothing from a multiple selection', () => {
    expect(dimensionAt(read(ORTHO, LEADER), ['dimension:0', 'dimension:1'])).toBeNull();
  });

  it('takes nothing from another kind of item', () => {
    expect(dimensionAt(read(ORTHO), ['track:0'])).toBeNull();
  });

  it('takes nothing for an index that is not there', () => {
    expect(dimensionAt(read(ORTHO), ['dimension:5'])).toBeNull();
  });
});

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

describe('applying a change', () => {
  it('leaves the board alone when nothing moved', () => {
    const b = read(ORTHO);
    const v = collectDimensionValues(b.dimensions[0]!);

    expect(applyDimensionValues(b, 0, v)).toBe(b);
  });

  it('does nothing for an index that is not there', () => {
    const b = read(ORTHO);

    expect(applyDimensionValues(b, 9, collectDimensionValues(b.dimensions[0]!))).toBe(b);
  });

  it('writes the format block through to the file', () => {
    const back = roundTrip(ORTHO, { units: 2, unitsFormat: 2, precision: 2, prefix: 'W ' });
    const f = back.dimensions[0]!.format!;

    expect(f.units).toBe(2);
    expect(f.unitsFormat).toBe(2);
    expect(f.precision).toBe(2);
    expect(f.prefix).toBe('W ');
  });

  it('writes the style block through to the file', () => {
    const back = roundTrip(ORTHO, {
      lineThickness: MM(0.25),
      arrowLength: MM(2),
      extensionOffset: MM(0.8),
      extensionOvershoot: MM(1),
      arrowDirection: 'inward',
      keepTextAligned: false,
    });
    const s = back.dimensions[0]!.style;

    expect(s.thickness).toBe(MM(0.25));
    expect(s.arrowLength).toBe(MM(2));
    expect(s.extensionOffset).toBe(MM(0.8));
    expect(s.extensionHeight).toBe(MM(1));
    expect(s.arrowDirection).toBe('inward');
    expect(s.keepTextAligned).toBeFalsy();
  });

  it('writes the text properties through to the file', () => {
    const back = roundTrip(ORTHO, {
      textHeight: MM(2),
      textWidth: MM(2),
      textThickness: MM(0.3),
      textOrientation: 45,
      bold: true,
      italic: true,
    });
    const t = back.dimensions[0]!.text!;

    expect(t.size.y).toBe(MM(2));
    expect(t.thickness).toBe(MM(0.3));
    expect(t.angle).toBe(45);
    expect(t.bold).toBe(true);
    expect(t.italic).toBe(true);
  });

  it('moves the text onto the dimension layer with it', () => {
    const back = roundTrip(ORTHO, { layer: 'F.SilkS' });

    expect(back.dimensions[0]!.layer).toBe('F.SilkS');
    expect(back.dimensions[0]!.text!.layer).toBe('F.SilkS');
  });

  it('keeps the parts of the source it does not own', () => {
    const out = serializeBoard(
      applyDimensionValues(read(ORTHO), 0, {
        ...collectDimensionValues(read(ORTHO).dimensions[0]!),
        lineThickness: MM(0.3),
      }),
    );

    // The feature points, height and orientation are the geometry's, not the
    // dialog's, and must survive an edit untouched.
    expect(out).toContain('(height 12.85)');
    expect(out).toContain('(orientation 1)');
    expect(out).toContain('(xy 113.6 58.975)');
    expect(out).toContain('(uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")');
  });
});

describe('override text, which is a mode rather than a string', () => {
  it('writes an empty override, and it survives the reload', () => {
    // The failure this catches: an empty override dropped as "nothing", so the
    // dimension goes back to showing its measurement.
    const back = roundTrip(ORTHO, { overrideValue: '' });

    expect(back.dimensions[0]!.format!.overrideValue).toBe('');
  });

  it('writes a real override', () => {
    const back = roundTrip(ORTHO, { overrideValue: '30 typ.' });

    expect(back.dimensions[0]!.format!.overrideValue).toBe('30 typ.');
  });

  it('removes the override when it is cleared to undefined', () => {
    const back = roundTrip(LEADER, { overrideValue: undefined });

    expect(back.dimensions[0]!.format!.overrideValue).toBeUndefined();
  });
});

describe('the fields each kind is allowed', () => {
  it('does not give a leader an extension overshoot', () => {
    // dynamic_cast<PCB_DIM_ALIGNED*> fails for a leader, so upstream never
    // writes one; a file that had it would read back differently.
    const out = serializeBoard(
      applyDimensionValues(read(LEADER), 0, {
        ...collectDimensionValues(read(LEADER).dimensions[0]!),
        extensionOvershoot: MM(5),
      }),
    );

    expect(out).not.toContain('(extension_height');
  });

  it('does not give an orthogonal one a text frame', () => {
    const out = serializeBoard(
      applyDimensionValues(read(ORTHO), 0, {
        ...collectDimensionValues(read(ORTHO).dimensions[0]!),
        textFrame: 2,
      }),
    );

    expect(out).not.toContain('(text_frame');
  });

  it('keeps a leader text frame that is set', () => {
    const back = roundTrip(LEADER, { textFrame: 2 });

    expect(back.dimensions[0]!.style.textFrame).toBe(2);
  });

  it('never gives a centre dimension a format in the model either', () => {
    // Not just absent from the file — absent from the item. The file is safe by
    // accident (a centre dimension's source has no `(format …)` child to patch),
    // so a model-level format would stay invisible until the item was rebuilt
    // from scratch and then appear out of nowhere.
    const b = read(CENTER);
    const next = applyDimensionValues(b, 0, {
      ...collectDimensionValues(b.dimensions[0]!),
      prefix: 'nope',
      lineThickness: MM(0.4),
    });

    expect(next.dimensions[0]!.format).toBeUndefined();
  });

  it('never gives a centre dimension a format block', () => {
    const out = serializeBoard(
      applyDimensionValues(read(CENTER), 0, {
        ...collectDimensionValues(read(CENTER).dimensions[0]!),
        prefix: 'nope',
        overrideValue: 'nope',
      }),
    );

    expect(out).not.toContain('(format');
    expect(out).not.toContain('nope');
  });

  it('still lets a centre dimension change its style and layer', () => {
    const back = roundTrip(CENTER, { lineThickness: MM(0.4), layer: 'F.Cu' });

    expect(back.dimensions[0]!.style.thickness).toBe(MM(0.4));
    expect(back.dimensions[0]!.layer).toBe('F.Cu');
  });
});

describe('the manual text position', () => {
  it('is written only in manual mode', () => {
    const back = roundTrip(ORTHO, { textPositionMode: 2, textX: MM(50), textY: MM(60) });

    expect(back.dimensions[0]!.style.textPositionMode).toBe(2);
    expect(back.dimensions[0]!.text!.at).toEqual({ x: MM(50), y: MM(60) });
  });

  it('is ignored in the automatic modes', () => {
    // The geometry places the text there; writing a stale coordinate back would
    // fight the layout on the next redraw.
    const back = roundTrip(ORTHO, { textPositionMode: 0, textX: MM(50), textY: MM(60) });

    expect(back.dimensions[0]!.text!.at).toEqual({ x: MM(125.3), y: MM(43.975) });
  });
});

describe('locking', () => {
  it('writes and clears the locked flag', () => {
    expect(roundTrip(ORTHO, { locked: true }).dimensions[0]!.locked).toBe(true);

    const lockedSrc = ORTHO.replace('(type orthogonal)', '(type orthogonal) (locked yes)');
    expect(roundTrip(lockedSrc, { locked: false }).dimensions[0]!.locked).toBeFalsy();
  });
});
