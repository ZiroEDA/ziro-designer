// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dropping a selection into a sheet.
 *
 * `SCH_MOVE_TOOL::findTargetSheet` answers one question every frame of a move —
 * "if this ended now, which sheet would it go into?" — and the answer is what
 * turns the cursor to PLACE and brightens the sheet. It says no far more often
 * than it says yes, and every no is deliberate: a sheet pin in the selection, a
 * connection point that has landed on the sheet's pins, graphics without Ctrl,
 * a field, the sheet being dragged itself.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  findTargetSheet,
  sheetBodyBBox,
  sheetDropOffset,
  SHEET_DROP_STEP_IU,
} from '@ziroeda/eeschema/src/tools/sch_sheet_drop.js';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';

const MM = 10000;
/** DEFAULT_LINE_WIDTH_MILS 6, in IU. */
const PEN = 0.1524 * MM;

const LIB_R = `(symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 -3.81 90) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "2" (effects (font (size 1.27 1.27))))))) `;

const sheet = (body: string): string =>
  `(kicad_sch (version 20250114) (generator "eeschema")\n  (lib_symbols ${LIB_R})\n${body}\n  (sheet_instances (path "/" (page "1"))))\n`;

/** A sheet box at (x, y), w x h mm, with the pins listed. */
const box = (
  uuid: string,
  x: number,
  y: number,
  w: number,
  h: number,
  pins: readonly { name: string; x: number; y: number }[] = [],
): string =>
  `  (sheet (at ${x} ${y}) (size ${w} ${h}) (uuid "${uuid}")
    (property "Sheetname" "${uuid}" (at ${x} ${y - 1} 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "${uuid}.kicad_sch" (at ${x} ${y + h + 1} 0) (effects (font (size 1.27 1.27))))
${pins.map((p) => `    (pin "${p.name}" input (at ${p.x} ${p.y} 0) (effects (font (size 1.27 1.27))) (uuid "${uuid}-${p.name}"))`).join('\n')})`;

const sym = (uuid: string, x: number, y: number): string =>
  `  (symbol (lib_id "Device:R") (at ${x} ${y} 0) (unit 1) (uuid "${uuid}")
    (property "Reference" "R1" (at ${x} ${y - 5} 0) (effects (font (size 1.27 1.27)))))`;

const wire = (uuid: string, x1: number, y1: number, x2: number, y2: number): string =>
  `  (wire (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (stroke (width 0) (type default)) (uuid "${uuid}"))`;

const graphic = (x1: number, y1: number, x2: number, y2: number): string =>
  `  (polyline (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (stroke (width 0) (type default)) (uuid "gfx"))`;

const doc = (body: string) => readSchematic(parse(sheet(body)));
const libOf = (d: ReturnType<typeof doc>): Map<string, LibSymbol> =>
  new Map(d.libSymbols.map((l) => [l.libId, l]));

const OPTS = { defaultLineWidthIU: PEN, ctrlDown: false };

/**
 * `SCH_SHEET::GetBodyBoundingBox` (`sch_sheet.cpp:822-840`): position and size,
 * inflated by half the border pen — and NOT the Sheetname/Sheetfile fields,
 * which sit outside the rectangle and are what `GetBoundingBox` adds.
 */
describe('the box a sheet is dropped into', () => {
  it('is the rectangle inflated by half its pen', () => {
    const d = doc(box('s1', 100, 100, 30, 20));
    const b = sheetBodyBBox(d.sheets[0]!, PEN);
    expect(b).toEqual({
      minX: 100 * MM - Math.floor(PEN / 2),
      minY: 100 * MM - Math.floor(PEN / 2),
      maxX: 130 * MM + Math.floor(PEN / 2),
      maxY: 120 * MM + Math.floor(PEN / 2),
    });
  });

  it('takes the sheet’s own border width over the default', () => {
    const d = doc(
      `  (sheet (at 100 100) (size 30 20) (uuid "s1") (stroke (width 2) (type solid))
    (property "Sheetname" "s" (at 100 99 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "s.kicad_sch" (at 100 121 0) (effects (font (size 1.27 1.27)))))`,
    );
    expect(sheetBodyBBox(d.sheets[0]!, PEN).minX).toBe(100 * MM - Math.floor((2 * MM) / 2));
  });
});

describe('the sheet a move is armed to drop into', () => {
  const d = doc([sym('r1', 40, 40), box('s1', 100, 100, 30, 20)].join('\n'));
  const lib = libOf(d);

  it('is the one under the cursor', () => {
    expect(findTargetSheet(d, lib, new Set(['r1']), { x: 110 * MM, y: 110 * MM }, OPTS)).toBe('s1');
  });

  it('is none when the cursor is outside every sheet and so is the selection', () => {
    expect(findTargetSheet(d, lib, new Set(['r1']), { x: 40 * MM, y: 40 * MM }, OPTS)).toBeNull();
  });

  it('is none for an empty selection — there is nothing to drop', () => {
    expect(findTargetSheet(d, lib, new Set(), { x: 110 * MM, y: 110 * MM }, OPTS)).toBeNull();
  });

  /**
   * "Never target a selected sheet" (`sch_move_tool.cpp:1433-1434`) — a sheet
   * being dragged cannot be dropped into itself, and the cursor is inside it
   * for the whole drag.
   */
  it('is never a sheet that is itself being moved', () => {
    expect(
      findTargetSheet(d, lib, new Set(['r1', 's1']), { x: 110 * MM, y: 110 * MM }, OPTS),
    ).toBeNull();
  });

  /**
   * The fallback (`:1436-1470`): the cursor can be well outside the sheet — you
   * grabbed the symbol by a corner — while the symbol itself is over it. The
   * selection's own box, or just its centre, is what decides then.
   */
  it('is the sheet holding the selection when the cursor is not over one', () => {
    const moved = doc([wire('w1', 105, 105, 115, 112), box('s1', 100, 100, 30, 20)].join('\n'));
    expect(
      findTargetSheet(moved, libOf(moved), new Set(['w1']), { x: 40 * MM, y: 40 * MM }, OPTS),
    ).toBe('s1');
  });

  /**
   * The two arms of `body.Contains( selBBox ) || body.Contains( selCenter )`
   * are not the same test, and only the second one can decide anything on its
   * own: a box the sheet CONTAINS necessarily has its centre inside it too, so
   * the first arm is redundant — upstream's, not ours. This is the case the
   * second arm exists for.
   */
  it('is the sheet when only the selection’s CENTRE is inside it', () => {
    // 95..125 mm against a sheet spanning 100..130: half out, centre at 110 in.
    const half = doc([wire('w1', 95, 105, 125, 112), box('s1', 100, 100, 30, 20)].join('\n'));
    expect(
      findTargetSheet(half, libOf(half), new Set(['w1']), { x: 40 * MM, y: 40 * MM }, OPTS),
    ).toBe('s1');
  });

  it('is none when the selection’s extent reaches outside every sheet', () => {
    // `body.Contains( selBBox ) || body.Contains( selCenter )` — this one is
    // half in and half out, and its centre is out.
    const half = doc([wire('w1', 60, 105, 105, 112), box('s1', 100, 100, 30, 20)].join('\n'));
    expect(
      findTargetSheet(half, libOf(half), new Set(['w1']), { x: 40 * MM, y: 40 * MM }, OPTS),
    ).toBeNull();
  });

  /**
   * "Don't drop into a sheet if any connection point of the selection lands on
   * a sheet pin" (`:1472-1495`) — that is a wire being connected to the sheet,
   * not a symbol being put inside it.
   */
  it('is none when the selection has landed on one of the sheet’s pins', () => {
    const pinned = doc(
      [
        wire('w1', 90, 105, 100, 105),
        box('s1', 100, 100, 30, 20, [{ name: 'A', x: 100, y: 105 }]),
      ].join('\n'),
    );
    expect(
      findTargetSheet(pinned, libOf(pinned), new Set(['w1']), { x: 110 * MM, y: 110 * MM }, OPTS),
    ).toBeNull();
  });

  it('is the sheet again once the wire is off the pin', () => {
    const clear = doc(
      [
        wire('w1', 90, 106, 100, 106),
        box('s1', 100, 100, 30, 20, [{ name: 'A', x: 100, y: 105 }]),
      ].join('\n'),
    );
    expect(
      findTargetSheet(clear, libOf(clear), new Set(['w1']), { x: 110 * MM, y: 110 * MM }, OPTS),
    ).toBe('s1');
  });

  /**
   * `dropAllowedBySelection = !aHasSheetPins` (`:1499`): a sheet pin belongs to
   * a sheet on THIS screen, so a selection carrying one has nowhere to go.
   */
  it('is none when a sheet pin is in the selection', () => {
    const withPin = doc(
      [
        sym('r1', 40, 40),
        box('s2', 40, 60, 20, 10, [{ name: 'A', x: 40, y: 65 }]),
        box('s1', 100, 100, 30, 20),
      ].join('\n'),
    );
    expect(
      findTargetSheet(
        withPin,
        libOf(withPin),
        new Set(['r1', 's2:sheetpin0']),
        { x: 110 * MM, y: 110 * MM },
        OPTS,
      ),
    ).toBeNull();
  });

  /**
   * `dropAllowedByModifiers = !aIsGraphicsOnly || aCtrlDown` (`:1500`): a drawn
   * line crossing a sheet must not vanish into it, so graphics alone need Ctrl.
   */
  it('is none for a graphics-only selection until Ctrl is held', () => {
    const g = doc([graphic(40, 40, 50, 50), box('s1', 100, 100, 30, 20)].join('\n'));
    const at = { x: 110 * MM, y: 110 * MM };
    expect(findTargetSheet(g, libOf(g), new Set(['gfx']), at, OPTS)).toBeNull();
    expect(findTargetSheet(g, libOf(g), new Set(['gfx']), at, { ...OPTS, ctrlDown: true })).toBe(
      's1',
    );
  });

  /**
   * `else if( schItem->Type() != SCH_SHEET_T )` (`:1133`): a sheet counts as
   * neither a graphic nor a non-graphic, so dragging a sheet along with a drawn
   * line leaves the selection "graphics only" and it still needs Ctrl.
   */
  it('stays graphics-only when a sheet is dragged along with the graphics', () => {
    const g = doc(
      [graphic(40, 40, 50, 50), box('s2', 40, 60, 20, 10), box('s1', 100, 100, 30, 20)].join('\n'),
    );
    const at = { x: 110 * MM, y: 110 * MM };
    expect(findTargetSheet(g, libOf(g), new Set(['gfx', 's2']), at, OPTS)).toBeNull();
    expect(
      findTargetSheet(g, libOf(g), new Set(['gfx', 's2']), at, { ...OPTS, ctrlDown: true }),
    ).toBe('s1');
  });

  it('is the sheet without Ctrl as soon as one non-graphic joins the selection', () => {
    const g = doc(
      [graphic(40, 40, 50, 50), wire('w1', 40, 60, 50, 60), box('s1', 100, 100, 30, 20)].join('\n'),
    );
    expect(
      findTargetSheet(g, libOf(g), new Set(['gfx', 'w1']), { x: 110 * MM, y: 110 * MM }, OPTS),
    ).toBe('s1');
  });

  /**
   * "Fields are children of their parent item and must not be dropped into a
   * sheet" (`:1423-1428`) — and one is enough to refuse the whole drop, not
   * just that field.
   */
  it('is none when a field is in the selection, whatever else is', () => {
    expect(
      findTargetSheet(d, lib, new Set(['r1', 'r1:field0']), { x: 110 * MM, y: 110 * MM }, OPTS),
    ).toBeNull();
  });

  /** `candidate->IsTopLevelSheet()` (`:1458`), on the fallback path only. */
  it('skips a top-level sheet when falling back to the selection’s extent', () => {
    const moved = doc([wire('w1', 105, 105, 115, 112), box('s1', 100, 100, 30, 20)].join('\n'));
    expect(
      findTargetSheet(
        moved,
        libOf(moved),
        new Set(['w1']),
        { x: 40 * MM, y: 40 * MM },
        {
          ...OPTS,
          topLevelSheetIds: new Set(['s1']),
        },
      ),
    ).toBeNull();
  });
});

/**
 * `moveSelectionToSheet`'s placement (`:1963-1989`). The offset takes the
 * selection to the destination's origin first, then steps out diagonally by 50
 * mils until nothing on that sheet is in the way.
 */
describe('where the dropped items land', () => {
  const selBox = { minX: 100 * MM, minY: 200 * MM, maxX: 110 * MM, maxY: 205 * MM };

  it('is the origin of an empty sheet', () => {
    expect(sheetDropOffset(selBox, [])).toEqual({ x: -100 * MM, y: -200 * MM });
  });

  it('is still the origin when what is there does not reach it', () => {
    expect(
      sheetDropOffset(selBox, [{ minX: 50 * MM, minY: 50 * MM, maxX: 60 * MM, maxY: 60 * MM }]),
    ).toEqual({ x: -100 * MM, y: -200 * MM });
  });

  it('steps diagonally, by 50 mils, until it is clear', () => {
    // One item covering the origin corner: 0..12 mm in x, which two 50-mil
    // (12.7 mm... no, 1.27 mm) steps do not clear, but ten do.
    const blocker = { minX: 0, minY: 0, maxX: 12 * MM, maxY: 2 * MM };
    const offset = sheetDropOffset(selBox, [blocker]);
    const steps = (offset.x + 100 * MM) / SHEET_DROP_STEP_IU;
    expect(Number.isInteger(steps)).toBe(true);
    expect(steps).toBeGreaterThan(0);
    // The moved box must genuinely clear the blocker, which is the property the
    // loop exists for — not merely "the offset changed".
    expect(selBox.minY + offset.y).toBeGreaterThan(blocker.maxY);
    // ...and it must be the FIRST step that does, not a later one.
    const before = { x: offset.x - SHEET_DROP_STEP_IU, y: offset.y - SHEET_DROP_STEP_IU };
    expect(selBox.minY + before.y).toBeLessThanOrEqual(blocker.maxY);
  });

  it('moves both axes by the same step, so the run is diagonal', () => {
    const offset = sheetDropOffset(selBox, [{ minX: 0, minY: 0, maxX: 12 * MM, maxY: 2 * MM }]);
    expect(offset.x + 100 * MM).toBe(offset.y + 200 * MM);
  });

  it('is 50 mils, which is 12700 IU', () => {
    expect(SHEET_DROP_STEP_IU).toBe(12700);
  });
});
