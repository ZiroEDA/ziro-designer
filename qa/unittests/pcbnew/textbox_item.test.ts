// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text boxes as real board items: selectable, movable, deletable.
 * Counterparts: `PCB_TEXTBOX::HitTest`, `PCB_SELECTION_TOOL::Selectable`,
 * `EDIT_TOOL::Move` / `Remove`.
 *
 * Three behaviours here differ from the dimension work and are the reason this
 * is not a copy of it:
 *
 * - **A text box is solid to the mouse.** `PCB_TEXTBOX::HitTest` inflates the
 *   bounding box and asks whether it *contains* the point — it never tests the
 *   border outline. Clicking the middle of an empty box selects it. A dimension
 *   is the opposite: its middle is genuinely empty.
 * - **It follows the *text* selection filter, not the graphics one.**
 *   `PCB_TEXTBOX_T` sits beside `PCB_TEXT_T` in upstream's switch and returns
 *   `includePcbTexts`, even though the item is a shape.
 * - **A rotated box is a polygon**, so moving it has to shift `(pts …)` rather
 *   than corners. A mover that only handled corners would leave every rotated
 *   box behind, and only on save.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  allBoardItemIds,
  boardHitCandidates,
  boardItemBBox,
  boardItemsInBox,
  deleteBoardItems,
  groupBoardItems,
  hitTestBoard,
  isBoardItemLocked,
  moveBoardItems,
} from '@ziroeda/pcbnew/src/edit-board.js';
import { itemAnchorPoint } from '@ziroeda/pcbnew/src/move_exact.js';
import {
  DEFAULT_SELECTION_FILTER,
  itemPassesFilter,
} from '@ziroeda/pcbnew/src/filter_selection.js';
import { textBoxCorners } from '@ziroeda/pcbnew/src/textbox_geometry.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const TB = 'textbox:0';

const BOX = (layer = 'F.SilkS', extra = ''): string => `(gr_text_box "boxed"
    ${extra}
    (start 50 50) (end 60 56)
    (margins 1 1 1 1)
    (layer "${layer}")
    (uuid "11111111-0000-0000-0000-000000000005")
    (effects (font (size 1 1) (thickness 0.15)))
    (border yes)
    (stroke (width 0.12) (type solid))
    (knockout no))`;

/** Synthetic: no rotated gr_text_box exists in the reference tree. */
const ROTATED = `(gr_text_box "Turned"
    (pts (xy 10 10) (xy 30 12) (xy 28 20) (xy 8 18))
    (margins 1 1 1 1)
    (angle 12.5)
    (layer "Cmts.User")
    (uuid "aaaaaaaa-0000-0000-0000-000000000001")
    (effects (font (size 1 1) (thickness 0.15)))
    (border no)
    (stroke (width 0.1) (type solid))
    (knockout no))`;

const read = (...extra: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`),
  );

describe('the corners a box resolves to', () => {
  it('are the four of a rectangle', () => {
    expect(textBoxCorners(read(BOX()).textBoxes[0]!)).toEqual([
      { x: MM(50), y: MM(50) },
      { x: MM(60), y: MM(50) },
      { x: MM(60), y: MM(56) },
      { x: MM(50), y: MM(56) },
    ]);
  });

  it("are the polygon's own points when it is rotated", () => {
    expect(textBoxCorners(read(ROTATED).textBoxes[0]!)).toHaveLength(4);
  });
});

describe('text boxes among the board item ids', () => {
  it('are enumerated', () => {
    expect(allBoardItemIds(read(BOX()))).toContain(TB);
  });

  it('are not enumerated when there are none', () => {
    expect(allBoardItemIds(read()).some((id) => id.startsWith('textbox:'))).toBe(false);
  });
});

describe('the bounding box', () => {
  it('covers the rectangle, half the border stroke included', () => {
    // Exact, not >=: the stroke is drawn centred on the outline, so the ink
    // reaches half a width past each corner. A loose bound would pass whether
    // or not that was accounted for.
    const b = boardItemBBox(read(BOX()), TB)!;

    expect(b.minX).toBe(MM(50) - MM(0.12) / 2);
    expect(b.maxX).toBe(MM(60) + MM(0.12) / 2);
    expect(b.minY).toBe(MM(50) - MM(0.12) / 2);
    expect(b.maxY).toBe(MM(56) + MM(0.12) / 2);
  });

  it("covers a rotated box's full polygon", () => {
    const b = boardItemBBox(read(ROTATED), 'textbox:0')!;

    expect(b.minX).toBeLessThanOrEqual(MM(8));
    expect(b.maxX).toBeGreaterThanOrEqual(MM(30));
  });

  it('is nothing for an index that does not exist', () => {
    expect(boardItemBBox(read(BOX()), 'textbox:7')).toBeNull();
  });
});

describe('clicking a text box', () => {
  it('hits the border', () => {
    expect(hitTestBoard(read(BOX()), { x: MM(50), y: MM(53) }, MM(0.2))).toBe(TB);
  });

  it('hits the middle, because a box is solid', () => {
    // The behaviour that separates this from a dimension. If the interior were
    // treated as empty, a box with no text would be almost unselectable.
    expect(hitTestBoard(read(BOX()), { x: MM(55), y: MM(53) }, 0)).toBe(TB);
  });

  it('hits the middle even with the border switched off', () => {
    const noBorder = BOX().replace('(border yes)', '(border no)');

    expect(hitTestBoard(read(noBorder), { x: MM(55), y: MM(53) }, 0)).toBe(TB);
  });

  it('misses a point outside it', () => {
    expect(hitTestBoard(read(BOX()), { x: MM(80), y: MM(53) }, MM(0.2))).toBeNull();
  });

  it('is offered alongside a graphic crossing it, ranked by area', () => {
    // The box is an area item, so a thin line over it is the smaller target and
    // comes first.
    const b = read(
      BOX(),
      `(gr_line (start 52 53) (end 58 53) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))`,
    );
    const ids = boardHitCandidates(b, { x: MM(55), y: MM(53) }, MM(0.3));

    expect(ids[0]).toBe('shape:0');
  });
});

describe('box selection', () => {
  it('takes a box the rectangle crosses', () => {
    expect(boardItemsInBox(read(BOX()), MM(49), MM(49), MM(52), MM(52), false)).toContain(TB);
  });

  it('leaves it out of a contained box that does not hold all of it', () => {
    expect(boardItemsInBox(read(BOX()), MM(49), MM(49), MM(52), MM(52), true)).not.toContain(TB);
  });

  it('takes it when the whole thing is inside', () => {
    expect(boardItemsInBox(read(BOX()), MM(40), MM(40), MM(70), MM(70), true)).toContain(TB);
  });
});

describe('moving a text box', () => {
  it("shifts a rectangle's corners", () => {
    const b = moveBoardItems(read(BOX()), new Set([TB]), { x: MM(5), y: MM(-3) });

    expect(b.textBoxes[0]!.start).toEqual({ x: MM(55), y: MM(47) });
    expect(b.textBoxes[0]!.end).toEqual({ x: MM(65), y: MM(53) });
  });

  it("shifts a rotated box's points", () => {
    // The case a corners-only mover would silently skip.
    const b = moveBoardItems(read(ROTATED), new Set([TB]), { x: MM(5), y: 0 });

    expect(b.textBoxes[0]!.pts![0]).toEqual({ x: MM(15), y: MM(10) });
  });

  it('survives a save and reload, for both forms', () => {
    for (const src of [BOX(), ROTATED]) {
      const moved = moveBoardItems(read(src), new Set([TB]), { x: MM(5), y: 0 });
      const back = readBoard(parse(serializeBoard(moved)));
      const t = back.textBoxes[0]!;

      if (t.start) expect(t.start.x).toBe(MM(55));
      else expect(t.pts![0]!.x).toBe(MM(15));
    }
  });

  it('leaves an unselected box alone', () => {
    const b = moveBoardItems(read(BOX()), new Set(['shape:0']), { x: MM(5), y: 0 });

    expect(b.textBoxes[0]!.start).toEqual({ x: MM(50), y: MM(50) });
  });
});

describe('deleting a text box', () => {
  it('removes it from the model and the file', () => {
    const out = serializeBoard(deleteBoardItems(read(BOX()), new Set([TB])));

    expect(readBoard(parse(out)).textBoxes).toHaveLength(0);
    expect(out).not.toContain('gr_text_box');
  });

  it('keeps the others', () => {
    const left = deleteBoardItems(read(BOX(), ROTATED), new Set([TB])).textBoxes;

    expect(left).toHaveLength(1);
    expect(left[0]!.text).toBe('Turned');
  });
});

describe('the selection filter', () => {
  const filter = (over: Partial<typeof DEFAULT_SELECTION_FILTER> = {}) => ({
    ...DEFAULT_SELECTION_FILTER,
    ...over,
  });

  it('follows the text checkbox, not the graphics one', () => {
    // PCB_TEXTBOX_T returns includePcbTexts upstream, beside PCB_TEXT_T.
    const b = read(BOX());

    expect(itemPassesFilter(b, TB, filter({ text: true }))).toBe(true);
    expect(itemPassesFilter(b, TB, filter({ text: false }))).toBe(false);
  });

  it('ignores the layer-based graphics split a dimension uses', () => {
    // On Edge.Cuts a graphic follows boardOutline; a text box still follows text.
    const b = read(BOX('Edge.Cuts'));

    expect(itemPassesFilter(b, TB, filter({ text: true, boardOutline: false }))).toBe(true);
    expect(itemPassesFilter(b, TB, filter({ text: false, boardOutline: true }))).toBe(false);
  });

  it('drops a stale id', () => {
    expect(itemPassesFilter(read(BOX()), 'textbox:9', filter())).toBe(false);
  });
});

describe('locking and grouping', () => {
  it('reads the locked flag', () => {
    expect(isBoardItemLocked(read(BOX('F.SilkS', '(locked yes)')), TB)).toBe(true);
    expect(isBoardItemLocked(read(BOX()), TB)).toBe(false);
  });

  it('can join a group, which means its uuid resolves', () => {
    const { board, id } = groupBoardItems(read(BOX()), new Set([TB]), 'g');

    expect(id).not.toBeNull();
    expect(board.groups[0]!.members).toEqual(['11111111-0000-0000-0000-000000000005']);
  });
});

describe('the rotation anchor', () => {
  it('is the first corner of a rectangle', () => {
    expect(itemAnchorPoint(read(BOX()), TB)).toEqual({ x: MM(50), y: MM(50) });
  });

  it('is the first polygon point of a rotated box', () => {
    expect(itemAnchorPoint(read(ROTATED), TB)).toEqual({ x: MM(10), y: MM(10) });
  });
});
