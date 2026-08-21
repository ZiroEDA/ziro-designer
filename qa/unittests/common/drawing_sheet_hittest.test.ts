// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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
  drawItemBBox,
} from '@ziroeda/common/src/drawing_sheet/index.js';
import type { WksBitmap, WksSheet } from '@ziroeda/common/src/drawing_sheet/index.js';
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

/**
 * A bitmap's picking box, against `DS_DRAW_ITEM_BITMAP::HitTest`
 * (ds_draw_item.cpp:505-511) — `GetBoundingBox().Inflate( aAccuracy )` over
 * `BITMAP_BASE::GetSize()`, which is `pixels * m_pixelSizeIu * m_scale`
 * (bitmap_base.cpp:416-427).
 *
 * The scale factor is the half that was missing. These numbers are not read back
 * out of the geometry code: a 300 ppi image 300 px square is exactly one inch,
 * 25.4 mm, at scale 1, so at scale 2 it is 50.8 mm and its edge is 25.4 mm from
 * the anchor. Every bound below is that arithmetic, done here.
 */
const bitmapSheet = (scale: number): WksSheet => ({
  ...defaultDrawingSheet(),
  items: [
    {
      type: 'bitmap',
      name: '',
      option: 'normal',
      repeat: 1,
      incrx: 0,
      incry: 0,
      incrlabel: 1,
      comment: '',
      // 100 mm in from the top-left margin corner, which is 10 mm in from the
      // paper, so the image is centred at (110, 110) mm on the page.
      pos: { x: 100, y: 100, corner: 'ltcorner' },
      scale,
      pngB64: 'iVBORw0KGgoAAAANSUhEUg==',
      ppi: 300,
      pxW: 300,
      pxH: 300,
    } satisfies WksBitmap,
  ],
});

const bitmapDraws = (scale: number) => layoutDrawingSheet(bitmapSheet(scale), A4, CTX);
/** Just the bitmap, so the sheet's own border and title block cannot answer for it. */
const onlyBitmap = (scale: number) => bitmapDraws(scale).filter((d) => d.kind === 'bitmap');

describe('bitmap picking honours the scale factor', () => {
  it('boxes a 300 px 300 ppi image as one inch at scale 1', () => {
    const [d] = onlyBitmap(1);
    expect(d).toBeDefined();
    const b = drawItemBBox(d!);
    // 25.4 mm wide and tall, centred on (110, 110) mm.
    expect(b.maxX - b.minX).toBeCloseTo(mmToIU(25.4), 0);
    expect(b.maxY - b.minY).toBeCloseTo(mmToIU(25.4), 0);
  });

  it('doubles that box at scale 2', () => {
    const [d] = onlyBitmap(2);
    const b = drawItemBBox(d!);
    expect(b.maxX - b.minX).toBeCloseTo(mmToIU(50.8), 0);
    expect(b.maxY - b.minY).toBeCloseTo(mmToIU(50.8), 0);
  });

  it('hits a point that only a scaled image reaches', () => {
    // 20 mm right of the anchor: outside the 12.7 mm half-width at scale 1,
    // inside the 25.4 mm half-width at scale 2. Dropping the `* scale` makes
    // the second of these false, which is the bug.
    const p = at(110 + 20, 110);
    expect(hitTestDrawingSheet(onlyBitmap(1), p, 0)).toBe(false);
    expect(hitTestDrawingSheet(onlyBitmap(2), p, 0)).toBe(true);
  });

  it('still misses a point beyond even the scaled image', () => {
    // 30 mm out is past the 25.4 mm half-width at scale 2 as well, so a box
    // that grew without bound would be caught here.
    const p = at(110 + 30, 110);
    expect(hitTestDrawingSheet(onlyBitmap(2), p, 0)).toBe(false);
  });

  it('shrinks the box at a scale below one', () => {
    // 10 mm out is inside the 12.7 mm half-width at scale 1 but outside the
    // 6.35 mm one at scale 0.5, so the scale has to divide as well as multiply.
    const p = at(110 + 10, 110);
    expect(hitTestDrawingSheet(onlyBitmap(1), p, 0)).toBe(true);
    expect(hitTestDrawingSheet(onlyBitmap(0.5), p, 0)).toBe(false);
  });
});
