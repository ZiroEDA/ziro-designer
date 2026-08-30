// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every COLOR4D property the schematic property manager registers, rendered.
 *
 * The wire family each register one and we rendered none of them:
 *
 *   SCH_LINE_DESC        Start X, Start Y, End X, End Y, Length, Line Style,
 *                        Wire Style, Line Width, **Color**   (sch_line.cpp)
 *   SCH_JUNCTION_DESC    Diameter, **Color**              (sch_junction.cpp)
 *   SCH_BUS_ENTRY_DESC   Wire Style, Line Width, **Color** (sch_bus_entry.cpp)
 *
 * A wxPropertyGrid draws a group in registration order and shows exactly what
 * the property manager registered, so these lists are read off the DESC blocks
 * rather than off our own output.
 *
 * `PGPROPERTY_COLOR4D` renders a COLOR4D as a swatch, and COLOR4D::UNSPECIFIED
 * - alpha 0 - is "no colour of its own, use the theme's". So an unset colour
 * must read as the empty string and clearing one must write `undefined` back
 * into the model, not black: a stored `[0,0,0,1]` would pin every wire to black
 * on a light theme.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { schPropertiesFor } from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById, refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

const rowsFor = (d: Schematic, id: string) => schPropertiesFor(d, LIB, itemRefById(d, id)!);

const wire = (stroke: string): Schematic =>
  sheet(`(wire (pts (xy 10 10) (xy 20 10)) ${stroke} (uuid "w-1"))`);

const wireId = (d: Schematic): string => refId('line', d.lines[0]!.uuid, 0);
const junctionId = (d: Schematic): string => refId('junction', d.junctions[0]!.uuid, 0);

describe('SCH_LINE registers a Color, and a wire has one', () => {
  it('offers what SCH_LINE_DESC registers, in that order', () => {
    const d = wire('(stroke (width 0) (type default))');
    expect(rowsFor(d, wireId(d)).map((r) => r.name)).toEqual([
      'Start X',
      'Start Y',
      'End X',
      'End Y',
      'Length',
      // A wire takes Wire Style; a graphic line takes Line Style. One or the
      // other is available, never both (isWireOrBus / isGraphicLine).
      'Wire Style',
      'Line Width',
      'Color',
    ]);
  });

  it('reads an unset colour as empty rather than as black', () => {
    const d = wire('(stroke (width 0) (type default))');
    expect(rowsFor(d, wireId(d)).find((r) => r.name === 'Color')!.value).toBe('');
  });

  it('reads a stored colour back as css', () => {
    const d = wire('(stroke (width 0) (type default) (color 255 0 0 1))');
    // `rgb8ToCss`, which is what the swatch is handed everywhere in the app.
    expect(rowsFor(d, wireId(d)).find((r) => r.name === 'Color')!.value).toBe('rgb(255, 0, 0)');
  });

  it('writes a picked colour into the stroke', () => {
    const d = wire('(stroke (width 0) (type default))');
    const after = rowsFor(d, wireId(d)).find((r) => r.name === 'Color')!.set!('#3366cc')!.apply(d);
    expect(after.lines[0]!.stroke?.color?.slice(0, 3)).toEqual([0x33, 0x66, 0xcc]);
  });

  it('clears to UNSPECIFIED rather than to black', () => {
    const d = wire('(stroke (width 0) (type default) (color 255 0 0 1))');
    const after = rowsFor(d, wireId(d)).find((r) => r.name === 'Color')!.set!('')!.apply(d);
    expect(after.lines[0]!.stroke?.color).toBeUndefined();
  });

  it('leaves the width and style alone when only the colour changes', () => {
    const d = wire('(stroke (width 1.27) (type dash) (color 255 0 0 1))');
    const after = rowsFor(d, wireId(d)).find((r) => r.name === 'Color')!.set!('#00ff00')!.apply(d);
    expect(after.lines[0]!.stroke?.width).toBe(d.lines[0]!.stroke?.width);
    expect(after.lines[0]!.stroke?.type).toBe('dash');
  });
});

describe('SCH_JUNCTION registers two properties, and we render both', () => {
  const doc = (): Schematic => sheet(`(junction (at 10 10) (diameter 0) (uuid "j-1"))`);

  it('offers Diameter and Color, and nothing else', () => {
    // SCH_JUNCTION_DESC registers exactly two properties. The Position X/Y we
    // used to prepend were ours - a capture of a selected Text in 10.0.5 shows
    // no position rows either, and SCH_BITMAP is the one schematic item that
    // registers its own.
    const d = doc();
    expect(rowsFor(d, junctionId(d)).map((r) => r.name)).toEqual(['Diameter', 'Color']);
  });

  it('writes a picked colour onto the junction', () => {
    const d = doc();
    const after = rowsFor(d, junctionId(d)).find((r) => r.name === 'Color')!.set!('#ff8800')!.apply(
      d,
    );
    expect(after.junctions[0]!.color?.slice(0, 3)).toEqual([0xff, 0x88, 0x00]);
    // The other registered property is untouched.
    expect(after.junctions[0]!.diameter).toBe(d.junctions[0]!.diameter);
  });

  it('clears to UNSPECIFIED', () => {
    const d = sheet(`(junction (at 10 10) (diameter 0) (color 255 0 0 1) (uuid "j-1"))`);
    const after = rowsFor(d, junctionId(d)).find((r) => r.name === 'Color')!.set!('')!.apply(d);
    expect(after.junctions[0]!.color).toBeUndefined();
  });
});
