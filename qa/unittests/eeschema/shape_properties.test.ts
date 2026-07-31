// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A shape's border and fill, what DIALOG_SHAPE_PROPERTIES edits.
 *
 * The one non-obvious encoding is the border: KiCad stores a width of -1 for
 * "no border at all", which is a different thing from 0 meaning "use the
 * schematic's default line width". The dialog shows that as a checkbox.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic, replaceGraphic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const read = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20250114) (generator "x") (lib_symbols) ${body})`));

/** The first graphic, narrowed past `text`, the one kind with no border or fill. */
function shapeOf(doc: ReturnType<typeof readSchematic>) {
  const g = doc.graphics[0]!;
  if (g.kind === 'text') throw new Error('expected a shape, got text');
  return g;
}

const RECT = (extra: string) => `(rectangle (start 10 10) (end 30 20) ${extra} (uuid "r1"))`;

describe('shape border and fill', () => {
  it('reads a stroke and a fill', () => {
    const g = shapeOf(
      read(
        RECT(
          '(stroke (width 0.254) (type dash) (color 1 2 3 1)) (fill (type color) (color 9 8 7 1))',
        ),
      ),
    );
    expect(g.stroke).toEqual({ width: mmToIU(0.254), type: 'dash', color: [1, 2, 3, 1] });
    expect(g.fill).toEqual({ type: 'color', color: [9, 8, 7, 1] });
  });

  it('round-trips a changed border width, style and colour', () => {
    const doc = read(RECT('(stroke (width 0.1) (type solid)) (fill (type none))'));
    const g = shapeOf(doc);
    const next = replaceGraphic(0, {
      ...g,
      stroke: { width: mmToIU(0.5), type: 'dash_dot', color: [4, 5, 6, 1] },
    }).apply(doc);
    const back = shapeOf(readSchematic(parse(serializeSchematic(next))));
    expect(back.stroke).toEqual({ width: mmToIU(0.5), type: 'dash_dot', color: [4, 5, 6, 1] });
  });

  it('round-trips every fill mode', () => {
    // UI_FILL_MODE's five entries, as SetFillModeProp maps them.
    for (const type of ['none', 'color', 'hatch', 'reverse_hatch', 'cross_hatch']) {
      const doc = read(RECT('(stroke (width 0) (type solid)) (fill (type none))'));
      const next = replaceGraphic(0, { ...shapeOf(doc), fill: { type } }).apply(doc);
      const back = shapeOf(readSchematic(parse(serializeSchematic(next))));
      expect(back.fill?.type, `fill mode ${type}`).toBe(type);
    }
  });

  it('keeps a negative border width, which is "no border" and not "default"', () => {
    // A width of 0 means "use the schematic default"; -1 means draw nothing.
    // Collapsing the two would quietly give every borderless shape a border.
    const doc = read(RECT('(stroke (width 0) (type solid)) (fill (type none))'));
    const none = replaceGraphic(0, {
      ...shapeOf(doc),
      stroke: { width: -1, type: 'solid' },
    }).apply(doc);
    const back = shapeOf(readSchematic(parse(serializeSchematic(none))));
    expect(back.stroke?.width).toBe(-1);

    const dflt = replaceGraphic(0, {
      ...shapeOf(doc),
      stroke: { width: 0, type: 'solid' },
    }).apply(doc);
    expect(shapeOf(readSchematic(parse(serializeSchematic(dflt)))).stroke?.width).toBe(0);
  });

  it('leaves an unedited shape byte-for-byte', () => {
    const text = `(kicad_sch (version 20250114) (generator "x") (lib_symbols) ${RECT(
      '(stroke (width 0.254) (type dash)) (fill (type none))',
    )})`;
    const once = serializeSchematic(readSchematic(parse(text)));
    expect(serializeSchematic(readSchematic(parse(once)))).toBe(once);
  });
});
