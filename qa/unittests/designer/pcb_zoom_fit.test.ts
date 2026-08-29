// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Zoom to Fit in pcbnew has something to measure even on an empty board.
 *
 * `PCB_BASE_FRAME::GetBoardBoundingBox` substitutes the PAGE when the board's
 * own bounding box comes back 0 x 0 (`pcbnew/pcb_base_frame.cpp:598-614`), so
 * pressing Home on a board with no footprint, no track and no outline frames
 * the sheet. Ours returned early on the null scene box and did nothing at all.
 *
 * The page numbers here are derived from the C++ and NOT from our own output:
 * `PAGE_INFO::standardPageSizes` stores MILS (`common/page_info.cpp:46-68`) and
 * `GetSizeIU` multiplies by `pcbIUScale.IU_PER_MILS` = 25400 nm/mil, so A4 is
 * 11693 x 8268 mils = 297002200 x 210007200 IU — 297.0022 mm, not 297.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  pcbPageBox,
  pcbPageSizeIU,
  pcbZoomFitBox,
  type ExtentsBox,
} from '@ziroeda/designer/src/editors/pcb/document_extents.js';

/** A4 landscape, as `PAGE_INFO` stores it: mils, then x 25400 nm per mil. */
const A4_W = 11693 * 25400;
const A4_H = 8268 * 25400;
/** A3 landscape, the same way. */
const A3_W = 16535 * 25400;
const A3_H = 11693 * 25400;

const sheetShown = { drawingSheetVisible: true, includeSheet: true };

describe('PCB_BASE_FRAME::GetPageSizeIU', () => {
  it('reads the shared mils table rather than round millimetres', () => {
    expect(pcbPageSizeIU('A4')).toStrictEqual({ x: A4_W, y: A4_H });
    expect(pcbPageSizeIU('A3')).toStrictEqual({ x: A3_W, y: A3_H });
    // 297.0022 mm, which a table written as `A4: [297, 210]` cannot produce.
    expect(A4_W).toBe(297002200);
    expect(A4_H).toBe(210007200);
  });

  it('applies the `portrait` word of the (paper …) token', () => {
    expect(pcbPageSizeIU('A4 portrait')).toStrictEqual({ x: A4_H, y: A4_W });
  });

  it('takes a User page from its own two edges', () => {
    // `(paper "User" 431.8 279.4)` — the writers put millimetres here.
    expect(pcbPageSizeIU('User 431.8 279.4')).toStrictEqual({ x: 431800000, y: 279400000 });
  });
});

describe('PCB_BASE_FRAME::GetBoardBoundingBox page fallback', () => {
  it('puts the page at the origin while the border and title block are drawn', () => {
    // `area.SetOrigin( 0, 0 ); area.SetEnd( pageSize.x, pageSize.y );`
    expect(pcbPageBox('A4', true)).toStrictEqual({
      minX: 0,
      minY: 0,
      maxX: A4_W,
      maxY: A4_H,
    });
  });

  it('centres the page on the origin when they are not', () => {
    // `area.SetOrigin( -pageSize.x / 2, -pageSize.y / 2 );`
    expect(pcbPageBox('A4', false)).toStrictEqual({
      minX: -A4_W / 2,
      minY: -A4_H / 2,
      maxX: A4_W / 2,
      maxY: A4_H / 2,
    });
  });
});

describe('pcbZoomFitBox', () => {
  it('frames the sheet on a board with nothing in it', () => {
    // The bug: `scene.bbox` is null (renderBoard.ts:1489) and Home did nothing.
    expect(pcbZoomFitBox(null, { paper: 'A4', ...sheetShown })).toStrictEqual({
      minX: 0,
      minY: 0,
      maxX: A4_W,
      maxY: A4_H,
    });
  });

  it('frames the sheet for Zoom to All Objects on an empty board too', () => {
    // GetBoardBoundingBox's fallback is inside the frame call both fit types
    // go through, so Ctrl+Home lands on the page as well.
    expect(
      pcbZoomFitBox(null, { paper: 'A4', drawingSheetVisible: true, includeSheet: false }),
    ).toStrictEqual({ minX: 0, minY: 0, maxX: A4_W, maxY: A4_H });
  });

  it('still frames the sheet with the sheet hidden, centred on the origin', () => {
    expect(
      pcbZoomFitBox(null, { paper: 'A4', drawingSheetVisible: false, includeSheet: true }),
    ).toStrictEqual({ minX: -A4_W / 2, minY: -A4_H / 2, maxX: A4_W / 2, maxY: A4_H / 2 });
  });

  it('treats a board with no (paper …) token as A4', () => {
    // `BOARD::BOARD() : … m_paper( PAGE_SIZE_TYPE::A4 )` (board.cpp:98).
    expect(pcbZoomFitBox(null, { paper: undefined, ...sheetShown })).toStrictEqual(
      pcbZoomFitBox(null, { paper: 'A4', ...sheetShown }),
    );
  });

  it('honours the page orientation on an empty board', () => {
    expect(pcbZoomFitBox(null, { paper: 'A4 portrait', ...sheetShown })).toStrictEqual({
      minX: 0,
      minY: 0,
      maxX: A4_H,
      maxY: A4_W,
    });
  });

  it('replaces a flat box, which doZoomFit rejects with || and the frame with &&', () => {
    // One horizontal segment on an otherwise empty board: width > 0, height 0.
    // `if( bBox.GetWidth() == 0 || bBox.GetHeight() == 0 ) bBox = defaultBox;`
    const flat: ExtentsBox = {
      minX: 10_000_000,
      minY: 5_000_000,
      maxX: 40_000_000,
      maxY: 5_000_000,
    };
    expect(
      pcbZoomFitBox(flat, { paper: 'A4', drawingSheetVisible: true, includeSheet: false }),
    ).toStrictEqual({ minX: 0, minY: 0, maxX: A4_W, maxY: A4_H });
  });

  it('leaves a real box alone for Zoom to All Objects', () => {
    const items: ExtentsBox = {
      minX: 10_000_000,
      minY: 20_000_000,
      maxX: 40_000_000,
      maxY: 50_000_000,
    };
    expect(
      pcbZoomFitBox(items, { paper: 'A4', drawingSheetVisible: true, includeSheet: false }),
    ).toStrictEqual(items);
  });

  it('does not reach for the page while the sheet is hidden and there are items', () => {
    const items: ExtentsBox = {
      minX: 10_000_000,
      minY: 20_000_000,
      maxX: 40_000_000,
      maxY: 50_000_000,
    };
    expect(
      pcbZoomFitBox(items, { paper: 'A4', drawingSheetVisible: false, includeSheet: true }),
    ).toStrictEqual(items);
  });

  it('unions the items with the sheet for Zoom to Fit', () => {
    const items: ExtentsBox = {
      minX: -5_000_000,
      minY: 20_000_000,
      maxX: 40_000_000,
      maxY: 500_000_000,
    };
    expect(pcbZoomFitBox(items, { paper: 'A4', ...sheetShown })).toStrictEqual({
      minX: -5_000_000,
      minY: 0,
      maxX: A4_W,
      maxY: 500_000_000,
    });
  });
});

describe('the PCB frame asks for that box', () => {
  // qa's tsconfig cannot compile .tsx, so the wiring is read as text the way
  // view_controls_coverage.test.ts reads it.
  const src = readFileSync(
    fileURLToPath(new URL('../../../designer/src/editors/pcb/PcbEditor.tsx', import.meta.url)),
    'utf8',
  );

  it('routes Zoom to Fit through pcbZoomFitBox', () => {
    expect(src).toContain("from './document_extents.js'");
    expect(src).toContain('pcbZoomFitBox(');
  });

  it('no longer gives up when the scene has no bounding box', () => {
    expect(src).not.toContain('if (!scene?.bbox) return;');
  });

  it('keeps no page-size table of its own', () => {
    // The literal `A4: [297, 210]` this file carried is PAGE_INFO's data, and
    // PAGE_INFO is `common/src/page_info.ts` here.
    expect(src).not.toMatch(/A4:\s*\[\s*297\s*,\s*210\s*\]/);
  });
});
