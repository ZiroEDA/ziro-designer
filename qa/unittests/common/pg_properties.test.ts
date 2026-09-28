// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/properties/`: the cell types, editors and renderer the Properties
 * panel shares. Expectations are read off pg_properties.cpp / pg_editors.cpp /
 * pg_cell_renderer.cpp; each says where. The distance cells' unit formatting
 * is `pg_distance_units.test.ts`.
 */

import { schIUScale } from '@ziroeda/common';
import { PG_CELL_RENDERER } from '@ziroeda/common/properties/pg_cell_renderer.js';
import {
  PG_CHECKBOX_EDITOR,
  PG_COLOR_EDITOR,
  PG_UNIT_EDITOR,
} from '@ziroeda/common/properties/pg_editors.js';
import {
  PGPROPERTY_ANGLE,
  PGPROPERTY_DISTANCE,
  PGPROPERTY_RATIO,
  PGPROPERTY_STRING,
} from '@ziroeda/common/properties/pg_properties.js';
import { describe, expect, it } from 'vitest';

const frame = { units: 'mils' as const, iuScale: schIUScale };

describe('PGPROPERTY_ANGLE / RATIO: "%g"', () => {
  it('prints six significant digits and the degree sign, not four decimals', () => {
    // wxString::Format( "%g°", value / m_scale ).
    const angle = new PGPROPERTY_ANGLE();
    expect(angle.ValueToString(90)).toBe('90°');
    expect(angle.ValueToString(123.45678)).toBe('123.457°');
    expect(angle.ValueToString(null)).toBe('');
  });

  it('divides by the decidegree scale', () => {
    const angle = new PGPROPERTY_ANGLE();
    angle.SetScale(10.0);
    expect(angle.ValueToString(900)).toBe('90°');
    expect(angle.StringToValue('45.5')).toBe(455);
    expect(angle.StringToValue('abc')).toBeNull();
  });

  it('a ratio is a bare %g, empty for an empty optional', () => {
    expect(new PGPROPERTY_RATIO().ValueToString(0.5)).toBe('0.5');
    expect(new PGPROPERTY_RATIO().ValueToString(null)).toBe('');
  });
});

describe('PGPROPERTY_DISTANCE and PG_UNIT_EDITOR over std::optional<int>', () => {
  it('an empty optional reads blank, not "0 mils"', () => {
    expect(new PGPROPERTY_DISTANCE(frame).DistanceToString(null)).toBe('');
    expect(new PGPROPERTY_DISTANCE(frame).DistanceToString(0)).toBe('0 mils');
  });

  it('clearing an optional cell commits "no value"; a plain one refuses it', () => {
    expect(PG_UNIT_EDITOR.GetValueFromControl('  ', true, frame)).toBeNull();
    expect(PG_UNIT_EDITOR.GetValueFromControl('  ', false, frame)).toBeUndefined();
  });

  it('the mixed-values placeholder is not a value', () => {
    expect(PG_UNIT_EDITOR.GetValueFromControl('<...>', true, frame)).toBeUndefined();
  });

  it('names one editor per frame', () => {
    expect(PG_UNIT_EDITOR.BuildEditorName('SchematicFrame')).toBe('KiCadUnitEditorSchematicFrame');
    expect(PG_UNIT_EDITOR.BuildEditorName(null)).toBe('KiCadUnitEditorNoFrame');
  });
});

describe('the other editors and the renderer', () => {
  it('PGPROPERTY_STRING shows the string unescaped', () => {
    expect(new PGPROPERTY_STRING().ValueToString('R{slash}1')).toBe('R/1');
  });

  it('PG_CHECKBOX_EDITOR sets an unspecified checkbox', () => {
    expect(PG_CHECKBOX_EDITOR.ToggledValue(null)).toBe(true);
    expect(PG_CHECKBOX_EDITOR.ToggledValue(true)).toBe(false);
  });

  it('PG_COLOR_EDITOR reads no colour as COLOR4D::UNSPECIFIED', () => {
    expect(PG_COLOR_EDITOR.colorFromVariant('')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('PG_CELL_RENDERER: a colour is a swatch; read-only greys only when not selected', () => {
    expect(PG_CELL_RENDERER.RenderValue(true, true, false)).toBe('swatch');
    expect(PG_CELL_RENDERER.RenderValue(false, true, false)).toBe('disabled');
    expect(PG_CELL_RENDERER.RenderValue(false, true, true)).toBe('default');
    expect(PG_CELL_RENDERER.RenderValue(false, false, false)).toBe('default');
  });
});
