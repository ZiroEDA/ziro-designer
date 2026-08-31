// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The editor turns the selection about `modificationPoint`.
 *
 * `modification_point.test.ts` pins what that point is. This pins that Rotate
 * and Mirror actually ask for it: both take an optional centre and both fell
 * back to the bounding-box centre when none was passed, so a correct
 * `modificationPoint` that nothing calls would leave the reported bug exactly
 * where it was.
 *
 * `PcbEditor.tsx` is read as text because qa's tsc has no `--jsx`, the same way
 * `pcb_move_ghost.test.ts` reads it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const text = readFileSync(
  fileURLToPath(new URL('../../../designer/src/editors/pcb/PcbEditor.tsx', import.meta.url)),
  'utf8',
);

describe('EDIT_TOOL::Rotate and ::Mirror both take the modification point', () => {
  it('rotate passes it', () => {
    expect(text).toContain('commitBoard(rotateBoardItems(brd, items, ccw, modPoint(brd, items)));');
  });

  it('mirror passes it (edit_tool.cpp:2451 calls the same updateModificationPoint)', () => {
    expect(text).toContain(
      'commitBoard(mirrorBoardItems(brd, items, direction, modPoint(brd, items)));',
    );
  });

  it('and it comes from the ported function, snapped for the multi-item branch', () => {
    expect(text).toContain(
      "import { flipBoardItems, modificationPoint } from '@ziroeda/pcbnew/src/edit-board.js';",
    );
    expect(text).toContain('modificationPoint(brd, items, (p) =>');
  });

  it('flip is deliberately not changed', () => {
    // "Flip around the anchor for footprints, and the bounding box center for
    // board items" (edit_tool.cpp:2672): `Flip` calls updateModificationPoint
    // and then ignores its answer in the board editor, using
    // `selection.GetCenter()` instead.
    expect(text).toContain('flipBoardItems(brd, sel)');
  });
});
