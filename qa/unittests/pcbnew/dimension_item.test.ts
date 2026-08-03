// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dimensions as real board items: selectable, movable, deletable.
 * Counterparts: `PCB_SELECTION_TOOL::Selectable`, `EDIT_TOOL::Move` /
 * `Remove`, `PCB_DIMENSION_BASE::GetPosition` and `HitTest`.
 *
 * #299 put dimensions in the model and #302 derived the lines they draw as;
 * neither made one *clickable*. This is the cascade that follows from adding
 * `'dimension'` to `BoardItemKind`.
 *
 * Two behaviours are worth stating because a bounding-box implementation would
 * pass a naive test and fail these: a click in the empty space between the
 * feature line and the crossbar must **miss**, and a move has to shift the text
 * as well as the two feature points — patching only `(pts …)` leaves the label
 * behind on save, which no in-memory assertion would catch.
 *
 * The `(dimension …)` fixture is copied verbatim from `demos/cm5_minima`.
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
import { dimensionSegments } from '@ziroeda/pcbnew/src/dimension_geometry.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

/** Verbatim from demos/cm5_minima: horizontal, crossbar 12.85 mm off. */
const ORTHO = (layer = 'Dwgs.User'): string => `(dimension
    (type orthogonal)
    (layer "${layer}")
    (uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")
    (pts (xy 100 60) (xy 130 60))
    (height 12.85)
    (orientation 0)
    (format (prefix "") (suffix "") (units 3) (units_format 0) (precision 4))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (arrow_direction outward) (extension_height 0.58642) (extension_offset 0.5))
    (gr_text "30" (at 115 75 0) (layer "${layer}")
      (uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const boardText = (...extra: string[]): string => `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`;

const read = (...extra: string[]): Board => readBoard(parse(boardText(...extra)));
const DIM = 'dimension:0';

/** Where the crossbar actually ended up, so hit tests aim at real geometry. */
const crossbarY = (b: Board): number => dimensionSegments(b.dimensions[0]!)[2]!.a.y;

describe('dimensions among the board item ids', () => {
  it('are enumerated', () => {
    expect(allBoardItemIds(read(ORTHO()))).toContain(DIM);
  });

  it('are not enumerated when the board has none', () => {
    expect(allBoardItemIds(read()).some((id) => id.startsWith('dimension:'))).toBe(false);
  });
});

describe('the bounding box', () => {
  it('covers the drawn lines', () => {
    const b = read(ORTHO());
    const box = boardItemBBox(b, DIM)!;

    expect(box.minX).toBeLessThanOrEqual(MM(100));
    expect(box.maxX).toBeGreaterThanOrEqual(MM(130));
  });

  it('is nothing for an index that does not exist', () => {
    expect(boardItemBBox(read(ORTHO()), 'dimension:7')).toBeNull();
  });
});

describe('clicking a dimension', () => {
  it('hits the crossbar', () => {
    const b = read(ORTHO());

    expect(hitTestBoard(b, { x: MM(115), y: crossbarY(b) }, MM(0.2))).toBe(DIM);
  });

  it('hits an extension line', () => {
    const b = read(ORTHO());

    expect(hitTestBoard(b, { x: MM(100), y: MM(60) + crossbarY(b) - MM(60) }, MM(0.5))).toBe(DIM);
  });

  it('misses the empty space between the feature line and the crossbar', () => {
    // The case that separates real geometry from a bounding-box test: the
    // middle of a dimension is empty, and clicking there must select nothing.
    const b = read(ORTHO());
    const mid = (MM(60) + crossbarY(b)) / 2;

    expect(hitTestBoard(b, { x: MM(115), y: mid }, MM(0.2))).toBeNull();
  });

  it('wins outright over a much thicker track crossing it', () => {
    // A dimension is scored like any linear item, by width squared, so
    // GuessSelectionCandidates' 1.5x area-jump rule applies to it: a 0.25 mm
    // track is 6x the coverage of a 0.1 mm dimension and is rejected outright
    // rather than offered alongside it.
    // The track has to lie on the *crossbar* (y = 60 + 12.85) — at y = 60 the
    // dimension draws nothing, that being the feature line it measures from.
    const b = read(
      ORTHO(),
      `(segment (start 110 72.85) (end 120 72.85) (width 0.25) (layer "F.Cu") (net 0))`,
    );

    expect(boardHitCandidates(b, { x: MM(115), y: MM(72.85) }, MM(0.3))).toEqual([DIM]);
  });

  it('is offered alongside a track of its own weight', () => {
    // Same width, so no area jump and both survive for the disambiguation menu.
    const b = read(
      ORTHO(),
      `(segment (start 110 72.85) (end 120 72.85) (width 0.1) (layer "F.Cu") (net 0))`,
    );
    const ids = boardHitCandidates(b, { x: MM(115), y: MM(72.85) }, MM(0.3));

    expect(ids).toContain(DIM);
    expect(ids).toContain('track:0');
  });
});

describe('box selection', () => {
  it('takes a dimension the box crosses', () => {
    const b = read(ORTHO());
    const ids = boardItemsInBox(b, MM(99), MM(59), MM(105), MM(61), false);

    expect(ids).toContain(DIM);
  });

  it('leaves it out of a fully-contained box that does not hold all of it', () => {
    const b = read(ORTHO());
    const ids = boardItemsInBox(b, MM(99), MM(59), MM(105), MM(61), true);

    expect(ids).not.toContain(DIM);
  });

  it('takes it when the box holds the whole thing', () => {
    const b = read(ORTHO());
    const ids = boardItemsInBox(b, MM(80), MM(40), MM(150), MM(90), true);

    expect(ids).toContain(DIM);
  });
});

describe('moving a dimension', () => {
  const moved = (): Board => moveBoardItems(read(ORTHO()), new Set([DIM]), { x: MM(5), y: MM(-3) });

  it('shifts both feature points', () => {
    const d = moved().dimensions[0]!;

    expect(d.start).toEqual({ x: MM(105), y: MM(57) });
    expect(d.end).toEqual({ x: MM(135), y: MM(57) });
  });

  it('shifts the text with them', () => {
    // A dimension that moved without its label would look right on screen for
    // exactly as long as nobody re-read the file.
    expect(moved().dimensions[0]!.text!.at).toEqual({ x: MM(120), y: MM(72) });
  });

  it('survives a save and reload', () => {
    const back = readBoard(parse(serializeBoard(moved())));
    const d = back.dimensions[0]!;

    expect(d.start).toEqual({ x: MM(105), y: MM(57) });
    expect(d.end).toEqual({ x: MM(135), y: MM(57) });
    expect(d.text!.at).toEqual({ x: MM(120), y: MM(72) });
  });

  it('keeps everything else in the source node', () => {
    // Patch-in-place: the style and format blocks are untouched by a move.
    const out = serializeBoard(moved());

    expect(out).toContain('(height 12.85)');
    expect(out).toContain('(extension_height 0.58642)');
    expect(out).toContain('(arrow_direction outward)');
  });

  it('leaves an unselected dimension alone', () => {
    const b = moveBoardItems(read(ORTHO()), new Set(['track:0']), { x: MM(5), y: 0 });

    expect(b.dimensions[0]!.start).toEqual({ x: MM(100), y: MM(60) });
  });
});

describe('deleting a dimension', () => {
  it('removes it', () => {
    expect(deleteBoardItems(read(ORTHO()), new Set([DIM])).dimensions).toHaveLength(0);
  });

  it('removes it from the file too', () => {
    const out = serializeBoard(deleteBoardItems(read(ORTHO()), new Set([DIM])));

    expect(out).not.toContain('(dimension');
  });

  it('keeps the others', () => {
    const b = read(ORTHO(), ORTHO('F.SilkS'));
    const left = deleteBoardItems(b, new Set(['dimension:0'])).dimensions;

    expect(left).toHaveLength(1);
    expect(left[0]!.layer).toBe('F.SilkS');
  });
});

describe('the anchor a rotation turns about', () => {
  it('is the first feature point', () => {
    // PCB_DIMENSION_BASE::GetPosition() is GetStart() — not the centre of the
    // drawn lines, and not the text.
    expect(itemAnchorPoint(read(ORTHO()), DIM)).toEqual({ x: MM(100), y: MM(60) });
  });
});

describe('the selection filter', () => {
  const filter = (over: Partial<typeof DEFAULT_SELECTION_FILTER> = {}) => ({
    ...DEFAULT_SELECTION_FILTER,
    ...over,
  });

  it('follows the tech-layers box off a non-outline layer', () => {
    const b = read(ORTHO('Dwgs.User'));

    expect(itemPassesFilter(b, DIM, filter({ techLayers: true }))).toBe(true);
    expect(itemPassesFilter(b, DIM, filter({ techLayers: false }))).toBe(false);
  });

  it('follows the board-outline box on Edge.Cuts', () => {
    const b = read(ORTHO('Edge.Cuts'));

    expect(itemPassesFilter(b, DIM, filter({ boardOutline: true }))).toBe(true);
    expect(itemPassesFilter(b, DIM, filter({ boardOutline: false }))).toBe(false);
  });

  it('ignores the text box, even though a dimension carries text', () => {
    // Upstream has no dimension checkbox; both its graphics and dimensions
    // cases route through the outline/tech split, so `text` is irrelevant here.
    const b = read(ORTHO('Dwgs.User'));

    expect(itemPassesFilter(b, DIM, filter({ text: false, techLayers: true }))).toBe(true);
  });

  it('drops a stale id rather than keeping it', () => {
    expect(itemPassesFilter(read(ORTHO()), 'dimension:9', filter())).toBe(false);
  });
});

describe('locking', () => {
  it('reads the locked flag', () => {
    const locked = ORTHO().replace('(type orthogonal)', '(type orthogonal) (locked yes)');

    expect(isBoardItemLocked(read(locked), DIM)).toBe(true);
  });

  it('is unlocked by default', () => {
    expect(isBoardItemLocked(read(ORTHO()), DIM)).toBe(false);
  });
});

describe('grouping', () => {
  it('can hold a dimension, which means its uuid resolves', () => {
    // groupBoardItems stores members by uuid, so a kind whose uuid lookup was
    // missed would silently produce an empty group.
    const { board, id } = groupBoardItems(read(ORTHO()), new Set([DIM]), 'g');

    expect(id).not.toBeNull();
    expect(board.groups[0]!.members).toEqual(['5db1e4c4-a4eb-4089-b0a3-868253fe7188']);
  });
});
