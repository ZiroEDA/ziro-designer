// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_VIEW (sch_view.cpp): what DisplaySheet and DisplaySymbol put in the view, the drawing
 * sheet's title-block metadata, and the child repaint in Update.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import { GAL_LAYER_ID, SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { VIEW_UPDATE_FLAGS, VIEW_VISIBILITY_FLAGS } from '@ziroeda/common/view/view_item.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import type { SCH_ITEM } from '@ziroeda/eeschema/sch_item.js';
import { SCH_TABLE } from '@ziroeda/eeschema/sch_table.js';
import { SCH_TABLECELL } from '@ziroeda/eeschema/sch_tablecell.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_LAYER_ORDER, SCH_VIEW, type SCH_VIEW_FRAME } from '@ziroeda/eeschema/sch_view.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function openFrame(): SCH_EDIT_FRAME {
  const frame = new SCH_EDIT_FRAME({
    crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
    saveProject: () => true,
  });
  frame.OpenProjectFiles([`/complex_hierarchy/${SHEETS[0]}`], 0, (p) => {
    const n = SHEETS.find((s) => p === `/complex_hierarchy/${s}`);
    return n ? readFileSync(join(ORACLE, n), 'utf8') : null;
  });
  return frame;
}

/** Upstream's VIEW always has a GAL (Clear and SetScale reach it); this one draws nothing. */
class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

function newView(aFrame: SCH_VIEW_FRAME | null): SCH_VIEW {
  const view = new SCH_VIEW(aFrame);
  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  gal.ResizeScreen(1000, 1000);
  view.SetGAL(gal);
  return view;
}

const isHidden = (item: { viewPrivData(): unknown }) =>
  ((item.viewPrivData() as { m_flags: number }).m_flags & VIEW_VISIBILITY_FLAGS.HIDDEN) !== 0;

/** The title-block fields DisplaySheet fills (protected on DS_PROXY_VIEW_ITEM). */
const sheetMeta = (ds: DS_PROXY_VIEW_ITEM) => {
  const d = ds as unknown as Record<string, unknown>;
  return {
    pageNumber: d.m_pageNumber,
    sheetCount: d.m_sheetCount,
    fileName: d.m_fileName,
    sheetName: d.m_sheetName,
    sheetPath: d.m_sheetPath,
    isFirstPage: d.m_isFirstPage,
  };
};

const inView = (item: { viewPrivData(): unknown }) => item.viewPrivData() !== null;

/** What the view holds (VIEW::Clear empties this but leaves each item's view data). */
const held = (view: SCH_VIEW) =>
  new Set((view as unknown as { m_allItems: unknown[] }).m_allItems.filter((i) => i !== null));

/** A frame that is not the schematic editor (the symbol editor, a viewer, a preview). */
const otherFrame = (log: string[] = []): SCH_VIEW_FRAME => ({
  IsType: (t) => t === FRAME_T.FRAME_SCH_SYMBOL_EDITOR,
  GetToolManager: () =>
    ({ ResetTools: (r: RESET_REASON) => log.push(`reset ${r}`) }) as unknown as TOOL_MANAGER,
  RefreshZoomDependentItems: () => log.push('zoom'),
});

describe('SCH_VIEW', () => {
  it('stacks the layers in sch_view.h order, overlays first and the drawing sheet last', () => {
    expect(SCH_LAYER_ORDER).toHaveLength(39);
    expect(new Set(SCH_LAYER_ORDER).size).toBe(39);
    // sch_view.h:46-85, by position
    expect(SCH_LAYER_ORDER[0]).toBe(GAL_LAYER_ID.LAYER_GP_OVERLAY);
    expect(SCH_LAYER_ORDER[1]).toBe(GAL_LAYER_ID.LAYER_SELECT_OVERLAY);
    expect(SCH_LAYER_ORDER.indexOf(SCH_LAYER_ID.LAYER_JUNCTION)).toBe(17);
    expect(SCH_LAYER_ORDER.indexOf(SCH_LAYER_ID.LAYER_WIRE)).toBe(28);
    expect(SCH_LAYER_ORDER.indexOf(GAL_LAYER_ID.LAYER_DRAW_BITMAPS)).toBe(33);
    expect(SCH_LAYER_ORDER[38]).toBe(GAL_LAYER_ID.LAYER_DRAWINGSHEET);
  });

  it('shows every item of the screen, then the drawing sheet, then a fresh preview', () => {
    const frame = openFrame();
    const screen = frame.GetScreen()!;
    const view = newView(frame);
    view.DisplaySheet(screen);

    const items = [...screen.Items()];
    expect(items.length).toBeGreaterThan(10);
    expect(items.every(inView)).toBe(true);
    expect(inView(view.GetDrawingSheet()!)).toBe(true);
  });

  it("titles the root page from the editor's current sheet", () => {
    const frame = openFrame();
    const view = newView(frame);
    view.DisplaySheet(frame.GetScreen()!);

    expect(sheetMeta(view.GetDrawingSheet()!)).toEqual({
      pageNumber: '1',
      sheetCount: frame.GetScreen()!.GetPageCount(),
      fileName: frame.GetScreen()!.GetFileName(),
      // No top_level_sheets in this .kicad_pro: PROJECT_FILE::LoadFromFile migrates it to one
      // named after the project (project_file.cpp:696), and files-io.cpp:327 names the root so.
      sheetName: 'complex_hierarchy',
      sheetPath: '/',
      isFirstPage: true,
    });
  });

  it('titles a sub-sheet with its name and path', () => {
    const frame = openFrame();
    const sub = frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!;
    frame.Schematic().SetCurrentSheet(sub);
    const view = newView(frame);
    view.DisplaySheet(sub.LastScreen()!);

    const meta = sheetMeta(view.GetDrawingSheet()!);
    expect(meta.sheetName).toBe(sub.Last()!.GetName());
    expect(meta.sheetPath).toBe(`/${sub.Last()!.GetName()}/`);
    expect(meta.isFirstPage).toBe(false);
    expect(meta.pageNumber).toBe(sub.LastScreen()!.GetPageNumber());
  });

  it("stops before the drawing sheet when the screen is not the editor's current one", () => {
    const frame = openFrame();
    const sub = frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!;
    const view = newView(frame);
    view.DisplaySheet(sub.LastScreen()!); // current sheet is still the root

    expect(view.GetDrawingSheet()).not.toBe(null);
    expect(inView(view.GetDrawingSheet()!)).toBe(false);
  });

  it('outside the schematic editor, titles from the screen alone and resets the tools', () => {
    const frame = openFrame();
    const log: string[] = [];
    const view = newView(otherFrame(log));
    log.length = 0; // VIEW::SetGAL re-applies the scale
    view.DisplaySheet(frame.GetScreen()!);

    const meta = sheetMeta(view.GetDrawingSheet()!);
    expect([meta.sheetName, meta.sheetPath]).toEqual(['', '']);
    expect(meta.isFirstPage).toBe(frame.GetScreen()!.GetVirtualPageNumber() === 1);
    expect(inView(view.GetDrawingSheet()!)).toBe(true);
    expect(log).toEqual([`reset ${RESET_REASON.REDRAW}`]);
  });

  it("repaints a symbol's children with it", () => {
    const frame = openFrame();
    const view = newView(frame);
    view.DisplaySheet(frame.GetScreen()!);
    const symbol = frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)[0] as SCH_SYMBOL;
    const children: SCH_ITEM[] = [];
    symbol.RunOnChildren((c) => children.push(c), 0);
    expect(children.length).toBeGreaterThan(0);

    // A child added to the view on its own, as SCH_SYMBOL's draw does not.
    for (const c of children) view.Add(c);
    for (const c of children) c.viewPrivData()!.clearUpdateFlags();

    view.Update(symbol, VIEW_UPDATE_FLAGS.COLOR);
    for (const c of children)
      expect(c.viewPrivData()!.requiredUpdate()).toBe(VIEW_UPDATE_FLAGS.COLOR);
  });

  it('repaints a whole table for one of its cells', () => {
    const view = newView(null);
    const table = new SCH_TABLE();
    table.SetColCount(1);
    const cell = new SCH_TABLECELL();
    table.AddCell(cell);
    view.Add(table);
    view.Add(cell);
    table.viewPrivData()!.clearUpdateFlags();
    cell.viewPrivData()!.clearUpdateFlags();

    view.Update(cell, VIEW_UPDATE_FLAGS.COLOR);
    // SCH_VIEW::Update hands the parent table to VIEW::Update with ALL, then the cell itself.
    expect(table.viewPrivData()!.requiredUpdate()).toBe(VIEW_UPDATE_FLAGS.ALL);
    expect(cell.viewPrivData()!.requiredUpdate()).toBe(VIEW_UPDATE_FLAGS.COLOR);
  });

  it("shows a derived symbol with its own fields and its root symbol's graphics", () => {
    const parent = new LIB_SYMBOL('parent');
    parent.AddDrawItem(new SCH_SHAPE(SHAPE_T.RECTANGLE));
    const child = new LIB_SYMBOL('child', parent);

    const view = newView(null);
    view.DisplaySymbol(child);

    const shown = (s: LIB_SYMBOL) => [...s.GetDrawItems()].filter(inView);
    expect(shown(child).map((i) => i.Type())).toEqual(
      [...child.GetDrawItems()]
        .filter((i) => i.Type() === KICAD_T.SCH_FIELD_T)
        .map((i) => i.Type()),
    );
    expect(shown(child).length).toBeGreaterThan(0);
    expect(shown(parent).map((i) => i.Type())).toEqual([KICAD_T.SCH_SHAPE_T]);
  });

  it('shows a plain symbol whole, and nothing for no symbol', () => {
    const symbol = new LIB_SYMBOL('plain');
    symbol.AddDrawItem(new SCH_SHAPE(SHAPE_T.CIRCLE));
    const view = newView(null);
    view.DisplaySymbol(symbol);
    expect([...symbol.GetDrawItems()].every(inView)).toBe(true);

    expect([...symbol.GetDrawItems()].every((i) => held(view).has(i))).toBe(true);

    view.DisplaySymbol(null);
    expect([...symbol.GetDrawItems()].some((i) => held(view).has(i))).toBe(false);
  });

  it('unhides everything on ClearHiddenFlags', () => {
    const frame = openFrame();
    const view = newView(frame);
    view.DisplaySheet(frame.GetScreen()!);
    const items = [...frame.GetScreen()!.Items()];
    for (const item of items) view.Hide(item);
    expect(items.every(isHidden)).toBe(true);

    view.ClearHiddenFlags();
    expect(items.some(isHidden)).toBe(false);
  });

  it('asks the frame to repaint zoom-dependent items on a zoom', () => {
    const log: string[] = [];
    const view = newView(otherFrame(log));
    log.length = 0; // VIEW::SetGAL re-applies the scale
    view.SetScale(2);
    expect(log).toEqual(['zoom']);
    expect(view.GetScale()).toBe(2);
  });
});
