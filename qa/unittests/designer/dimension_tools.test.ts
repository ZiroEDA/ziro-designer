// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The five dimension drawing tools, and Board Setup's dimension block.
 * Counterparts: the five `Go( &DRAWING_TOOL::DrawDimension, … )` registrations,
 * and `PANEL_SETUP_TEXT_AND_GRAPHICS`' dimension choices.
 *
 * The mapping is the whole point. Board Setup stores what its dropdowns show —
 * "Automatic", "1234 (mm)", "0.0000" — while the engine and the file format use
 * the numeric `DIM_*` enums. An off-by-one there writes the wrong precision or
 * the wrong units into every dimension the user places, and nothing complains.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { DEFAULT_DIMENSION_DEFAULTS, startDimension } from '@ziroeda/pcbnew';
import {
  DIMENSION_TOOLS,
  dimensionDefaultsFrom,
  dimensionToolKind,
  isDimensionTool,
} from '@ziroeda/designer/src/editors/pcb/dimension_tools.js';

const MM = (n: number): number => mmToIU(n);

/** `defaultTextGraphics().dimensions`, the shape the panel stores. */
const SETUP = {
  units: 'Automatic',
  format: '1234',
  precision: '0.0000',
  suppressTrailingZeroes: true,
  textPosition: 'Outside',
  keepTextAligned: true,
  arrowLengthMM: 1.27,
  extLineOffsetMM: 0.5,
};
const from = (over: Partial<typeof SETUP> = {}) =>
  dimensionDefaultsFrom({ ...SETUP, ...over }, 'Dwgs.User', MM(0.2), MM(1), MM(0.15));

describe('which tool places which kind', () => {
  it('maps all five', () => {
    expect(dimensionToolKind('drawAlignedDimension')).toBe('aligned');
    expect(dimensionToolKind('drawOrthogonalDimension')).toBe('orthogonal');
    expect(dimensionToolKind('drawCenterDimension')).toBe('center');
    expect(dimensionToolKind('drawRadialDimension')).toBe('radial');
    expect(dimensionToolKind('drawLeader')).toBe('leader');
  });

  it('covers every kind exactly once', () => {
    // A duplicate would make one kind unreachable from the toolbar.
    const kinds = Object.values(DIMENSION_TOOLS);

    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(kinds)).toEqual(
      new Set(['aligned', 'orthogonal', 'center', 'radial', 'leader']),
    );
  });

  it('is null for a tool that is not a dimension', () => {
    expect(dimensionToolKind('drawLine')).toBeNull();
    expect(dimensionToolKind('selectSetRect')).toBeNull();
    expect(isDimensionTool('drawZone')).toBe(false);
  });

  it('every id it names actually starts a dimension', () => {
    // Ties the table to the engine: a typo'd kind would throw or produce
    // nothing here rather than being caught at run time by a user.
    for (const [id, kind] of Object.entries(DIMENSION_TOOLS)) {
      const d = startDimension(kind, { x: 0, y: 0 }).dimension;
      expect(d.kind, id).toBe(kind);
    }
  });
});

describe('Board Setup units mode', () => {
  it('maps each dropdown entry to its enum value', () => {
    expect(from({ units: 'Inches' }).unitsMode).toBe(0);
    expect(from({ units: 'Mils' }).unitsMode).toBe(1);
    expect(from({ units: 'Millimeters' }).unitsMode).toBe(2);
    expect(from({ units: 'Automatic' }).unitsMode).toBe(3);
  });

  it('falls back to the default rather than to inches on an unknown string', () => {
    // 0 is a real value here, so a silent 0 would look like a deliberate
    // "Inches" instead of a broken setting.
    expect(from({ units: 'Furlongs' }).unitsMode).toBe(DEFAULT_DIMENSION_DEFAULTS.unitsMode);
  });
});

describe('Board Setup units format', () => {
  it('maps each dropdown entry', () => {
    expect(from({ format: '1234' }).unitsFormat).toBe(0);
    expect(from({ format: '1234 mm' }).unitsFormat).toBe(1);
    expect(from({ format: '1234 (mm)' }).unitsFormat).toBe(2);
  });

  it('falls back on an unknown string', () => {
    expect(from({ format: 'nonsense' }).unitsFormat).toBe(DEFAULT_DIMENSION_DEFAULTS.unitsFormat);
  });
});

describe('Board Setup precision', () => {
  it('is the number of decimal places, as an index', () => {
    expect(from({ precision: '0' }).precision).toBe(0);
    expect(from({ precision: '0.00' }).precision).toBe(2);
    expect(from({ precision: '0.0000' }).precision).toBe(4);
    expect(from({ precision: '0.00000' }).precision).toBe(5);
  });

  it('falls back on an unknown string', () => {
    expect(from({ precision: '0.0000000' }).precision).toBe(DEFAULT_DIMENSION_DEFAULTS.precision);
  });
});

describe('Board Setup text position', () => {
  it('maps the two entries the panel offers', () => {
    expect(from({ textPosition: 'Outside' }).textPositionMode).toBe(0);
    expect(from({ textPosition: 'Inline' }).textPositionMode).toBe(1);
  });

  it('falls back on anything else', () => {
    // MANUAL (2) exists in the enum but is not a dropdown choice — it comes
    // from dragging the text — so it must not be reachable by string.
    expect(from({ textPosition: 'Manual' }).textPositionMode).toBe(
      DEFAULT_DIMENSION_DEFAULTS.textPositionMode,
    );
  });
});

describe('the measurements it carries across', () => {
  it('converts the arrow length and extension offset to IU', () => {
    const d = from({ arrowLengthMM: 2, extLineOffsetMM: 0.75 });

    expect(d.arrowLength).toBe(MM(2));
    expect(d.extensionOffset).toBe(MM(0.75));
  });

  it('passes the booleans straight through', () => {
    expect(from({ suppressTrailingZeroes: false }).suppressZeroes).toBe(false);
    expect(from({ keepTextAligned: false }).keepTextAligned).toBe(false);
  });

  it('keeps a zero extension offset, which is a real setting', () => {
    // Unlike the others this one must NOT fall back: 0 means the extension line
    // touches the feature point, which is a legitimate choice.
    expect(from({ extLineOffsetMM: 0 }).extensionOffset).toBe(0);
  });

  it('takes the layer and line width from the caller, not from Board Setup', () => {
    // The dimension goes on the active layer at that layer class's width.
    const d = dimensionDefaultsFrom(SETUP, 'F.SilkS', MM(0.12), {
      textWidth: MM(1.4),
      textHeight: MM(1.5),
      textThickness: MM(0.2),
      italic: true,
    });

    expect(d.layer).toBe('F.SilkS');
    expect(d.lineThickness).toBe(MM(0.12));
    expect(d.textThickness).toBe(MM(0.2));
  });

  it('carries both text axes, because SetTextSize takes a VECTOR2I', () => {
    // `dimension->SetTextSize( boardSettings.GetTextSize( layer ) )` sets width
    // and height together, so a condensed layer class must stay condensed.
    const d = dimensionDefaultsFrom(SETUP, 'F.SilkS', MM(0.12), {
      textWidth: MM(1.4),
      textHeight: MM(1.5),
      textThickness: MM(0.2),
      italic: true,
    });

    expect(d.textWidth).toBe(MM(1.4));
    expect(d.textHeight).toBe(MM(1.5));
  });

  it('carries the layer class italic flag', () => {
    // `dimension->SetItalic( boardSettings.GetTextItalic( layer ) )`.
    const base = { textWidth: MM(1), textHeight: MM(1), textThickness: MM(0.15) };
    expect(
      dimensionDefaultsFrom(SETUP, 'F.SilkS', MM(0.12), { ...base, italic: true }).textItalic,
    ).toBe(true);
    expect(
      dimensionDefaultsFrom(SETUP, 'F.SilkS', MM(0.12), { ...base, italic: false }).textItalic,
    ).toBe(false);
    // and it reaches the placed item's text child.
    const d = startDimension(
      'aligned',
      { x: 0, y: 0 },
      {
        ...DEFAULT_DIMENSION_DEFAULTS,
        textItalic: true,
      },
    ).dimension;
    expect(d.text!.italic).toBe(true);
  });

  it('falls back to the engine default for a zero line width', () => {
    const d = dimensionDefaultsFrom(SETUP, 'F.SilkS', 0, {
      textWidth: 0,
      textHeight: 0,
      textThickness: 0,
      italic: false,
    });

    expect(d.lineThickness).toBe(DEFAULT_DIMENSION_DEFAULTS.lineThickness);
    expect(d.textHeight).toBe(DEFAULT_DIMENSION_DEFAULTS.textHeight);
    expect(d.textWidth).toBe(DEFAULT_DIMENSION_DEFAULTS.textWidth);
  });
});

describe('the defaults reach a placed dimension', () => {
  it('so a Board Setup change shows up in the next one drawn', () => {
    const defaults = from({ units: 'Millimeters', precision: '0.00', format: '1234 mm' });
    const d = startDimension('aligned', { x: 0, y: 0 }, defaults).dimension;

    expect(d.format!.units).toBe(2);
    expect(d.format!.precision).toBe(2);
    expect(d.format!.unitsFormat).toBe(1);
  });

  it('but a leader still ignores them', () => {
    // setMeasurementAttributes is not applied to a leader; Board Setup must not
    // sneak in through this path either.
    const defaults = from({ units: 'Millimeters', format: '1234 mm' });
    const d = startDimension('leader', { x: 0, y: 0 }, defaults).dimension;

    expect(d.format!.units).toBe(0);
    expect(d.format!.unitsFormat).toBe(0);
  });
});
