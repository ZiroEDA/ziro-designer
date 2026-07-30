/**
 * Hit-testing the drawing sheet, against
 * `DS_PROXY_VIEW_ITEM::HitTestDrawingSheetItems` (ds_proxy_view_item.cpp).
 *
 * This is what decides whether a Properties action over blank canvas opens Page
 * Settings. `SCH_EDIT_TOOL::Properties` only reaches for it when the selection
 * is empty, and only if the cursor lands on an actual drawing-sheet *item*:
 *
 *     if( ds && ds->HitTestDrawingSheetItems( getView(), cursorPos ) )
 *         m_toolMgr->PostAction( ACTIONS::pageSettings );
 *
 * The distinction that matters is item-versus-page: clicking the empty paper
 * inside the frame must hit nothing, or every double-click on blank canvas
 * would pop the page dialog.
 */
import { describe, it, expect } from 'vitest';
import {
  defaultDrawingSheet,
  layoutDrawingSheet,
  hitTestDrawingSheet,
} from '@ziroeda/common/src/drawing_sheet/index.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const A4 = { widthMM: 297, heightMM: 210 };
const CTX = {
  pageNumber: 1,
  sheetCount: 1,
  title: 'A Title',
  rev: '1',
  date: '2026-01-01',
  company: 'ZiroEDA',
  comments: ['', '', '', ''],
  paper: 'A4',
  fileName: 'sheet.kicad_sch',
  sheetPath: '/',
  appVersion: 'ZiroEDA',
};

const draws = layoutDrawingSheet(defaultDrawingSheet(), A4, CTX);
/** Five pixels at a typical zoom, in IU. */
const SLOP = mmToIU(0.5);
const at = (xmm: number, ymm: number) => ({ x: mmToIU(xmm), y: mmToIU(ymm) });

describe('hitTestDrawingSheet', () => {
  it('lays out something to test against', () => {
    expect(draws.length).toBeGreaterThan(0);
  });

  it('hits the page border', () => {
    // The default sheet's frame sits 10 mm in from the paper edge.
    expect(hitTestDrawingSheet(draws, at(10, 105), SLOP)).toBe(true);
    expect(hitTestDrawingSheet(draws, at(287, 105), SLOP)).toBe(true);
    expect(hitTestDrawingSheet(draws, at(148, 10), SLOP)).toBe(true);
    expect(hitTestDrawingSheet(draws, at(148, 200), SLOP)).toBe(true);
  });

  it('hits the title block rules and text', () => {
    // Its horizontal rules...
    expect(hitTestDrawingSheet(draws, at(230, 191.5), SLOP)).toBe(true);
    expect(hitTestDrawingSheet(draws, at(230, 187.5), SLOP)).toBe(true);
    // ...and the resolved text in it.
    expect(hitTestDrawingSheet(draws, at(263, 193.1), SLOP)).toBe(true);
  });

  it('misses a blank cell inside the title block', () => {
    // DS_DRAW_ITEM_RECT::HitTest tests the four edges, not the area, so the
    // gaps between the rules are not part of the sheet either.
    expect(hitTestDrawingSheet(draws, at(230, 189.5), SLOP)).toBe(false);
  });

  it('misses the empty middle of the page', () => {
    // The whole point: blank paper inside the frame is not the drawing sheet,
    // so a double-click there must not open Page Settings.
    expect(hitTestDrawingSheet(draws, at(148, 105), SLOP)).toBe(false);
    expect(hitTestDrawingSheet(draws, at(100, 60), SLOP)).toBe(false);
    expect(hitTestDrawingSheet(draws, at(60, 140), SLOP)).toBe(false);
  });

  it('misses well outside the paper', () => {
    expect(hitTestDrawingSheet(draws, at(-50, -50), SLOP)).toBe(false);
    expect(hitTestDrawingSheet(draws, at(400, 300), SLOP)).toBe(false);
  });

  it('respects the accuracy it is given', () => {
    // A point just off the border: outside a tight tolerance, inside a loose one.
    const justOff = at(10 + 1.5, 105);
    expect(hitTestDrawingSheet(draws, justOff, mmToIU(0.1))).toBe(false);
    expect(hitTestDrawingSheet(draws, justOff, mmToIU(3))).toBe(true);
  });
});
