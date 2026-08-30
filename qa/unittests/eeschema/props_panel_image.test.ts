// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The properties panel's image rows. Counterpart: SCH_BITMAP's PROPERTY_MANAGER
 * registrations, whose one editable property beyond position is the scale.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { schPropertiesFor } from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById, refId, sheetPinId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();
const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

const doc = (scale = 1): Schematic =>
  sheet(`(image (at 60 60) (scale ${scale}) (uuid "im-1") (data "iVBORw0KGgo="))`);

const rows = (d: Schematic) => schPropertiesFor(d, LIB, itemRefById(d, refId('image', 'im-1', 0))!);

describe('an image has properties rows at all', () => {
  it('used to be empty — schPropertiesFor had no image arm', () => {
    expect(rows(doc()).length).toBeGreaterThan(0);
  });

  it('offers position and scale', () => {
    // SCH_BITMAP_DESC (sch_bitmap.cpp): Position X/Y ungrouped, then five rows
    // in `_( "Image Properties" )`. Read off the DESC block, not off our output.
    expect(rows(doc()).map((r) => r.name)).toEqual([
      'Position X',
      'Position Y',
      'Scale',
      'Transform Offset X',
      'Transform Offset Y',
      'Width',
      'Height',
    ]);
  });
});

describe('the scale row', () => {
  const scaleRow = (d: Schematic) => rows(d).find((r) => r.name === 'Scale')!;

  it('reads the model', () => {
    expect(scaleRow(doc(2.5)).value).toBe(2.5);
  });

  it('writes a new scale as an undoable command', () => {
    const d = doc(1);
    const cmd = scaleRow(d).set!(3)!;
    expect(cmd).not.toBeNull();
    const after = cmd.apply(d);
    expect(after.images[0]!.scale).toBe(3);
    // And it undoes exactly.
    expect(cmd.invert(d).apply(after).images[0]!.scale).toBe(1);
  });

  it('refuses a zero or negative scale', () => {
    // Either would collapse or invert the image; PANEL_IMAGE_EDITOR clamps
    // rather than accepting it, and a null return leaves the value untouched.
    const d = doc(1);
    expect(scaleRow(d).set!(0)).toBeNull();
    expect(scaleRow(d).set!(-2)).toBeNull();
  });

  it('refuses a value that is not a number', () => {
    expect(scaleRow(doc()).set!('banana')).toBeNull();
  });
});

describe('the position rows move the image', () => {
  it('sets an absolute X by moving the difference', () => {
    const d = doc();
    const row = rows(d).find((r) => r.name === 'Position X')!;
    const after = row.set!(mmToIU(100))!.apply(d);
    expect(after.images[0]!.at.x).toBe(mmToIU(100));
    expect(after.images[0]!.at.y).toBe(d.images[0]!.at.y);
  });
});

describe('a graphic shape has properties too', () => {
  const shapeDoc = (body: string): Schematic => sheet(body);
  const gRows = (d: Schematic) =>
    schPropertiesFor(d, LIB, itemRefById(d, refId('graphic', undefined, 0))!);

  const RECT = `(rectangle (start 10 10) (end 20 20)
     (stroke (width 0) (type solid)) (fill (type none)) (uuid "r-1"))`;
  const CIRCLE = `(circle (center 10 10) (radius 5)
     (stroke (width 0) (type solid)) (fill (type none)) (uuid "c-1"))`;

  it('offers every EDA_SHAPE property a rectangle has', () => {
    /**
     * `EDA_SHAPE` registers seventeen properties under `_HKI( "Shape
     * Properties" )` (common/eda_shape.cpp:2884-2960), and three availability
     * functions decide which a given shape shows:
     *
     *     Start/End X,Y       isNotPolygonOrCircle
     *     Center X,Y, Radius  isCircle
     *     W, H, Corner Radius isRectangle
     *
     * so a rectangle shows these thirteen, in this order. We used to offer
     * three — Line Width, Line Style and a "Filled" checkbox — under the
     * default group, so a rectangle said nothing about where it was or how big.
     */
    expect(gRows(shapeDoc(RECT)).map((r) => r.name)).toEqual([
      'Shape',
      'Start X',
      'Start Y',
      'End X',
      'End Y',
      'Width',
      'Height',
      'Corner Radius',
      'Line Width',
      'Line Style',
      'Line Color',
      'Fill',
      'Fill Color',
    ]);
  });

  it('under the group EDA_SHAPE names, not the default one', () => {
    for (const r of gRows(shapeDoc(RECT))) expect(r.group).toBe('Shape Properties');
  });

  it('and a Fill CHOICE, since Filled is library-only', () => {
    // `SCH_SHAPE` overrides `_HKI( "Filled" )` to `isSchematicItem`
    // (sch_shape.cpp:604-610) — it is available on a LIBRARY shape. A schematic
    // shape gets the FILL_T enum instead, which is why this is a choice.
    const row = gRows(shapeDoc(RECT)).find((r) => r.name === 'Fill')!;
    expect(row.kind).toBe('choice');
    expect(row.choices).toEqual(['None', 'Solid', 'Hatch', 'Reverse Hatch', 'Cross-hatch']);
    expect(gRows(shapeDoc(RECT)).some((r) => r.name === 'Filled')).toBe(false);
  });

  it('a circle gets Center X, Center Y and Radius instead of Start/End', () => {
    // `SetAvailableFunc( isCircle )` on those three, and
    // `isNotPolygonOrCircle` on Start/End.
    const names = gRows(shapeDoc(CIRCLE)).map((r) => r.name);
    expect(names).toContain('Center X');
    expect(names).toContain('Center Y');
    expect(names).toContain('Radius');
    expect(names).not.toContain('Start X');
    expect(names).not.toContain('Width');
  });

  it('drops the Default style choice a wire keeps', () => {
    // LINE_STYLES = WIRE_STYLES.slice(1): graphic lines have no Default.
    const row = gRows(shapeDoc(RECT)).find((r) => r.name === 'Line Style')!;
    expect(row.choices).not.toContain('Default');
    expect(row.value).toBe('Solid');
  });

  it('toggles the fill through replaceGraphic', () => {
    const d = shapeDoc(RECT);
    const row = gRows(d).find((r) => r.name === 'Fill')!;
    expect(row.value).toBe('None');
    // A choice takes its LABEL, not a boolean: `_HKI( "Fill" )` is the FILL_T
    // enum, and "Solid" is FILLED_WITH_COLOR, whose token is `color`.
    const after = row.set!('Solid')!.apply(d);
    const g = after.graphics[0]!;
    if (g.kind !== 'rectangle') throw new Error('expected a rectangle');
    expect(g.fill?.type).toBe('color');
  });

  it('refuses a non-positive radius', () => {
    const d = shapeDoc(CIRCLE);
    expect(gRows(d).find((r) => r.name === 'Radius')!.set!(0)).toBeNull();
  });

  it('a graphic text gets position rows, not shape rows', () => {
    // It is a text item and carries neither a stroke nor a fill.
    const d = shapeDoc(`(text "note" (at 10 10 0) (effects (font (size 1.27 1.27))) (uuid "t-1"))`);
    const ref = itemRefById(d, refId('graphic', undefined, 0));
    // Free text may land in labels rather than graphics depending on the
    // reader; only assert when it is actually a graphic.
    if (ref) expect(gRows(d).every((r) => r.name.startsWith('Position'))).toBe(true);
  });
});

describe('a table has properties too', () => {
  const TABLE = `(table (column_count 2)
     (border (external yes) (header yes) (stroke (width 0) (type solid)))
     (separators (rows yes) (cols no) (stroke (width 0) (type solid)))
     (column_widths 10 10) (row_heights 5)
     (cells
       (table_cell "a" (exclude_from_sim no) (at 0 0 0) (size 10 5)
         (margins 0.9525 0.9525 0.9525 0.9525) (span 1 1)
         (effects (font (size 1.27 1.27))) (uuid "c-a"))
       (table_cell "b" (exclude_from_sim no) (at 10 0 0) (size 10 5)
         (margins 0.9525 0.9525 0.9525 0.9525) (span 1 1)
         (effects (font (size 1.27 1.27))) (uuid "c-b")))
     (uuid "tb-1"))`;
  const doc = () => sheet(TABLE);
  const tRows = (d: Schematic) =>
    schPropertiesFor(d, LIB, itemRefById(d, refId('table', 'tb-1', 0))!);

  it('is no longer an empty grid', () => {
    const d = doc();
    expect(d.tables).toHaveLength(1);
    // Guard the fixture itself: this used to say (text_box …) inside (cells …)
    // where the token is (table_cell …), so the table parsed with no cells at
    // all and the assertions below were about something that was not a table.
    expect(d.tables[0]!.cells.map((c) => c.text)).toEqual(['a', 'b']);
    expect(tRows(d).length).toBeGreaterThan(0);
  });

  /**
   * The twelve properties SCH_TABLE_DESC registers (sch_table.cpp), in
   * registration order, which is the order a wxPropertyGrid draws a group in.
   * Read off the DESC block, not off our own output.
   */
  it('offers exactly what SCH_TABLE_DESC registers, in that order', () => {
    expect(tRows(doc()).map((r) => r.name)).toEqual([
      'Start X',
      'Start Y',
      'External Border',
      'Header Border',
      'Border Width',
      'Border Style',
      'Border Color',
      'Row Separators',
      'Cell Separators',
      'Separators Width',
      'Separators Style',
      'Separators Color',
    ]);
  });

  it('offers no row for the column or row COUNT', () => {
    // `Columns` and `Rows` were ours, not KiCad's - SCH_TABLE_DESC registers
    // neither, and a wxPropertyGrid shows what the property manager registered
    // and nothing else. The counts are changed by SCH_EDIT_TABLE_TOOL.
    const names = tRows(doc()).map((r) => r.name);
    expect(names).not.toContain('Columns');
    expect(names).not.toContain('Rows');
  });

  /** `_HKI( "Cell Separators" )` - upstream's name for the column separators. */
  it('names the column separators the way upstream does', () => {
    const names = tRows(doc()).map((r) => r.name);
    expect(names).toContain('Cell Separators');
    expect(names).not.toContain('Column Separators');
  });

  it('writes a border toggle through replaceTable', () => {
    const d = doc();
    const row = tRows(d).find((r) => r.name === 'Row Separators')!;
    expect(row.value).toBe(true);
    const after = row.set!(false)!.apply(d);
    expect(after.tables[0]!.separatorRows).toBe(false);
    // And the neighbouring flag is untouched.
    expect(after.tables[0]!.borderExternal).toBe(true);
  });
});

describe('a sheet pin has properties', () => {
  const SHEET = `(sheet (at 10 10) (size 20 20) (uuid "sh-1")
     (property "Sheetname" "sub" (at 10 9 0) (effects (font (size 1.27 1.27))))
     (property "Sheetfile" "sub.kicad_sch" (at 10 31 0) (effects (font (size 1.27 1.27))))
     (pin "A" input (at 10 14 180) (effects (font (size 1.27 1.27)))))`;
  const doc = () => sheet(SHEET);
  const pinId = (d: Schematic) => sheetPinId(refId('sheet', d.sheets[0]!.uuid, 0), 0);
  const pRows = (d: Schematic) => schPropertiesFor(d, LIB, itemRefById(d, pinId(d))!);

  it("offers a hierarchical label's set, which is what it inherits", () => {
    // SCH_SHEET_PIN inherits SCH_HIERLABEL -> SCH_LABEL_BASE -> SCH_TEXT ->
    // EDA_TEXT and registers nothing of its own. `Name` was never a registered
    // property: EDA_TEXT's `Text` is the row that edits a sheet pin's name.
    expect(pRows(doc()).map((r) => r.name)).toEqual([
      'Shape',
      'Text',
      'Font',
      'Auto Thickness',
      'Italic',
      'Bold',
      'Horizontal Justification',
      'Vertical Justification',
      'Color',
      'Hyperlink',
      'Text Size',
    ]);
  });

  it('omits position, which is constrained to the sheet border', () => {
    // ConstrainOnEdge keeps a pin on its sheet's edge; a free X/Y setter would
    // let the grid put it somewhere the drag tool never could.
    expect(pRows(doc()).some((r) => r.name.startsWith('Position'))).toBe(false);
  });

  it('renames through the parent sheet', () => {
    const d = doc();
    const after = pRows(d).find((r) => r.name === 'Text')!.set!('CLK')!.apply(d);
    expect(after.sheets[0]!.pins[0]!.name).toBe('CLK');
  });

  it('refuses an empty name', () => {
    // An unnamed sheet pin has no hierarchical label to match.
    expect(pRows(doc()).find((r) => r.name === 'Text')!.set!('   ')).toBeNull();
  });

  it('changes the shape through the token list', () => {
    const d = doc();
    const row = pRows(d).find((r) => r.name === 'Shape')!;
    expect(row.value).toBe('Input');
    expect(row.set!('Tri-state')!.apply(d).sheets[0]!.pins[0]!.shape).toBe('tri_state');
  });

  it('leaves the sheet’s other pins alone', () => {
    const d = sheet(`(sheet (at 10 10) (size 20 20) (uuid "sh-1")
       (property "Sheetname" "sub" (at 10 9 0) (effects (font (size 1.27 1.27))))
       (property "Sheetfile" "sub.kicad_sch" (at 10 31 0) (effects (font (size 1.27 1.27))))
       (pin "A" input (at 10 14 180) (effects (font (size 1.27 1.27))))
       (pin "B" output (at 10 18 180) (effects (font (size 1.27 1.27)))))`);
    const after = schPropertiesFor(d, LIB, itemRefById(d, pinId(d))!).find(
      (r) => r.name === 'Text',
    )!.set!('CLK')!.apply(d);
    expect(after.sheets[0]!.pins[1]!.name).toBe('B');
    expect(after.sheets[0]!.pins[1]!.shape).toBe('output');
  });
});
