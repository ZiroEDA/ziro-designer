// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Double-clicking the page frame or the title block opens Page Settings.
 *
 * `EDIT_TOOL::Properties` (pcbnew/tools/edit_tool.cpp:2153-2161):
 *
 *     else if( selection.Size() == 0 && getView()->IsLayerVisible( LAYER_DRAWINGSHEET ) )
 *     {
 *         DS_PROXY_VIEW_ITEM* ds = editFrame->GetCanvas()->GetDrawingSheet();
 *         VECTOR2D cursorPos = getViewControls()->GetCursorPosition( false );
 *
 *         if( ds && ds->HitTestDrawingSheetItems( getView(), cursorPos ) )
 *             m_toolMgr->PostAction( ACTIONS::pageSettings );
 *
 * eeschema has the same branch (sch_edit_tool.cpp:2580) and ours already had
 * the schematic half, so the board was the odd one out.
 *
 * The trap this file exists for is the unit boundary. `layoutDrawingSheet` is
 * shared with eeschema and answers in **schematic** internal units (1e4/mm);
 * the board canvas is in board units (1e6/mm). The painter has always scaled
 * the context by that factor. A hit test that forgot to would be a hundred
 * times off — and would still "work" in the corner of the page nearest the
 * origin, which is exactly the sort of bug that ships.
 */
import { describe, expect, it } from 'vitest';
import {
  boardDrawingSheetItems,
  DS_IU_TO_PCB,
  hitTestBoardDrawingSheet,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

const MM = 1e6;
/** An A4 board, the size KiCad gives a new one. */
const info = { paper: 'A4', titleBlock: { title: 'demo' }, fileName: 'demo.kicad_pcb' };
/** `aView->ToWorld( 5.0 )` at a zoom that fits an A4 page in ~1500 px. */
const SLOP = (5 * (297 * MM)) / 1500;

describe('hitTestBoardDrawingSheet', () => {
  it('builds the sheet the painter draws, in schematic units', () => {
    const items = boardDrawingSheetItems(info);
    expect(items.length).toBeGreaterThan(0);
    // 1e6/mm over 1e4/mm. If this is ever 1 the two halves have silently agreed
    // on the wrong thing together.
    expect(DS_IU_TO_PCB).toBe(100);
  });

  it('hits the page frame', () => {
    // KiCad's default sheet insets its frame 10 mm from the paper edge, so the
    // A4 border runs down x = 10 mm and along y = 10 mm.
    expect(hitTestBoardDrawingSheet(info, undefined, { x: 10 * MM, y: 100 * MM }, SLOP)).toBe(true);
    expect(hitTestBoardDrawingSheet(info, undefined, { x: 100 * MM, y: 10 * MM }, SLOP)).toBe(true);
  });

  it('hits the title block', () => {
    // The title block sits in the bottom-right corner of an A4 page
    // (297 x 210 mm), a little inside the frame.
    expect(hitTestBoardDrawingSheet(info, undefined, { x: 260 * MM, y: 194 * MM }, SLOP)).toBe(
      true,
    );
  });

  it('misses the empty middle of the page, so a plain double-click does nothing', () => {
    // The whole point of hit-testing the *items* rather than the page: blank
    // paper inside the frame is not the drawing sheet.
    expect(hitTestBoardDrawingSheet(info, undefined, { x: 120 * MM, y: 90 * MM }, SLOP)).toBe(
      false,
    );
  });

  it('misses well outside the paper', () => {
    expect(hitTestBoardDrawingSheet(info, undefined, { x: -50 * MM, y: -50 * MM }, SLOP)).toBe(
      false,
    );
  });

  it('takes its point in board units, not the engine’s', () => {
    // The frame at x = 10 mm is 10e6 in board units and 10e4 in schematic ones.
    // Passing the schematic number would land 9.9 mm from the paper corner,
    // where there is nothing — this is the assertion the unit bug fails.
    expect(hitTestBoardDrawingSheet(info, undefined, { x: 10 * MM, y: 100 * MM }, SLOP)).toBe(true);
    expect(hitTestBoardDrawingSheet(info, undefined, { x: 10 * 1e4, y: 100 * 1e4 }, SLOP)).toBe(
      false,
    );
  });
});
