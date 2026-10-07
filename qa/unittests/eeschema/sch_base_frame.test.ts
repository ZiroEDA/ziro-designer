// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `SCH_BASE_FRAME` (eeschema/sch_base_frame.cpp): `SchGetLibSymbol`, the colour
 * theme `GetColorSettings` picks, `GetLibraryItemsForListDialog`, and the item
 * bookkeeping (`AddToScreen` / `RemoveFromScreen` / `UpdateItem`) with and
 * without a view, on both frames that now extend it.
 */
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EDA_DRAW_PANEL_GAL } from '@ziroeda/common/draw_panel_gal.js';
import { EDA_DRAW_FRAME } from '@ziroeda/common/eda_draw_frame.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import {
  GetLibraryItemsForListDialog,
  PINNING_SYMBOL,
  SCH_BASE_FRAME,
  SchColorThemeName,
  SchGetLibSymbol,
} from '@ziroeda/eeschema/sch_base_frame.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SHEET_PIN } from '@ziroeda/eeschema/sch_sheet_pin.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { SYMBOL_EDIT_FRAME } from '@ziroeda/eeschema/symbol_editor/symbol_edit_frame.js';

// SCH_EDIT_FRAME asks Prj() in its constructor, as KiCad's does: KiCad always has a PGM_BASE.
beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

describe('SchGetLibSymbol', () => {
  const lib = (map: Record<string, string>) => ({
    LoadSymbol: async (id: string) => map[id] ?? null,
  });
  const cache = (map: Record<string, string>, isCache = true) => ({
    IsCache: () => isCache,
    FindSymbol: (name: string) => map[name] ?? null,
  });

  it('answers from the library first', async () => {
    expect(
      await SchGetLibSymbol('Device:R', lib({ 'Device:R': 'lib' }), cache({ Device_R: 'c' })),
    ).toBe('lib');
  });

  it('falls back to the cache library under <nickname>_<item>', async () => {
    expect(await SchGetLibSymbol('Device:R', lib({}), cache({ Device_R: 'cached' }))).toBe(
      'cached',
    );
    expect(await SchGetLibSymbol('Device:R', lib({}), null)).toBeNull();
  });

  it('refuses a cache that is not one, and a missing manager', async () => {
    expect(await SchGetLibSymbol('Device:R', lib({}), cache({ Device_R: 'c' }, false))).toBeNull();
    expect(await SchGetLibSymbol('Device:R', null)).toBeNull();
  });

  it('reports an IO_ERROR with the item and library named', async () => {
    const shown: string[] = [];
    const failing = {
      LoadSymbol: async (): Promise<string | null> => {
        throw new Error('bad file');
      },
    };
    expect(
      await SchGetLibSymbol('Device:R', failing, null, (msg, what) => shown.push(`${msg}|${what}`)),
    ).toBeNull();
    expect(shown).toEqual(["Error loading symbol R from library 'Device'.|bad file"]);
  });
});

describe('the colour theme GetColorSettings loads', () => {
  const own = { use_eeschema_color_settings: false, appearance: { color_theme: 'mine' } };
  const shared = { use_eeschema_color_settings: true, appearance: { color_theme: 'mine' } };

  it("is eeschema's, except in a Symbol Editor set to its own", () => {
    expect(SchColorThemeName(FRAME_T.FRAME_SCH, 'ee', own)).toBe('ee');
    expect(SchColorThemeName(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, 'ee', shared)).toBe('ee');
    expect(SchColorThemeName(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, 'ee', own)).toBe('mine');
    // The viewer and chooser do not take the symbol editor's own theme here.
    expect(SchColorThemeName(FRAME_T.FRAME_SCH_VIEWER, 'ee', own)).toBe('ee');
  });
});

describe('GetLibraryItemsForListDialog', () => {
  it('pinned first with the pinning symbol, each group in StrNumCmp order', () => {
    const { headers, items } = GetLibraryItemsForListDialog(
      [
        { nickname: 'Lib10', description: 'ten' },
        { nickname: 'Zed', description: 'z' },
        { nickname: 'Lib2', description: 'two' },
        { nickname: 'Alpha', description: 'a' },
      ],
      ['Zed', 'Alpha'],
    );
    expect(headers).toEqual(['Library', 'Description']);
    expect(items).toEqual([
      [`${PINNING_SYMBOL}Alpha`, 'a'],
      [`${PINNING_SYMBOL}Zed`, 'z'],
      ['Lib2', 'two'],
      ['Lib10', 'ten'],
    ]);
  });
});

const hooks: SCH_EDIT_FRAME_HOOKS = {
  crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
  highlightNet: () => {},
  syncSelection: () => {},
  assignFootprints: () => {},
  saveProject: () => true,
  getNetlist: () => null,
};

function setup() {
  const project = new PROJECT();
  project.setProjectFile(new PROJECT_FILE('t.kicad_pro'));
  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();
  const sheet = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(sheet);
  const frame = new SCH_EDIT_FRAME(hooks);
  frame.SetSchematic(schematic);
  return { frame, screen: sheet.LastScreen()! };
}

/** A canvas whose view records what the frame asks of it. */
function recordingCanvas(): { canvas: EDA_DRAW_PANEL_GAL; calls: string[] } {
  const calls: string[] = [];
  const name = (i: unknown): string => (i as { Type(): number }).Type().toString();
  const view = {
    Add: (i: unknown) => calls.push(`add ${name(i)}`),
    Remove: (i: unknown) => calls.push(`remove ${name(i)}`),
    Update: (i: unknown, f: number = VIEW_UPDATE_FLAGS.ALL) => calls.push(`update ${name(i)} ${f}`),
    UpdateAllItems: (f: number) => calls.push(`all ${f}`),
  };
  const canvas = { GetView: () => view, ForceRefresh: () => calls.push('refresh') };
  return { canvas: canvas as unknown as EDA_DRAW_PANEL_GAL, calls };
}

const wire = (): SCH_LINE => {
  const w = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
  w.SetEndPoint({ x: 1000, y: 0 });
  return w;
};

describe('the item bookkeeping', () => {
  it('both editors are SCH_BASE_FRAMEs and draw frames', () => {
    const { frame } = setup();
    const sym = new SYMBOL_EDIT_FRAME({ libEdit: () => {} });
    for (const f of [frame, sym]) {
      expect(f).toBeInstanceOf(SCH_BASE_FRAME);
      expect(f).toBeInstanceOf(EDA_DRAW_FRAME);
    }
    expect(frame.GetName()).toBe('SchematicFrame');
    expect(sym.GetName()).toBe('LibeditFrame');
    expect(frame.GetGridOrigin()).toEqual({ x: 0, y: 0 });
  });

  it('AddToScreen appends to the screen, and to the view only for the current screen', () => {
    const { frame, screen } = setup();
    const { canvas, calls } = recordingCanvas();
    frame.SetCanvas(canvas);
    const w = wire();
    frame.AddToScreen(w);
    expect([...screen.Items()]).toContain(w);
    // Add, then UpdateItem( aItem, true ): isAddOrDelete skips the item's own update.
    expect(calls).toEqual([`add ${w.Type()}`]);
  });

  it('RemoveFromScreen takes it out of the view first, then the screen', () => {
    const { frame, screen } = setup();
    const w = wire();
    frame.AddToScreen(w);
    const { canvas, calls } = recordingCanvas();
    frame.SetCanvas(canvas);
    frame.RemoveFromScreen(w);
    expect([...screen.Items()]).not.toContain(w);
    expect(calls).toEqual([`remove ${w.Type()}`]);
  });

  it('with no canvas the model half runs alone', () => {
    const { frame, screen } = setup();
    const w = wire();
    frame.AddToScreen(w);
    frame.UpdateItem(w, false, true);
    expect([...screen.Items()]).toContain(w);
  });

  it('UpdateItem repaints a sheet pin through its sheet, and a child through its parent', () => {
    const { frame } = setup();
    const { canvas, calls } = recordingCanvas();
    frame.SetCanvas(canvas);
    const sheet = new SCH_SHEET(null, { x: 0, y: 0 }, { x: 1000, y: 1000 });
    const pin = new SCH_SHEET_PIN(sheet, { x: 0, y: 500 }, 'P');
    frame.UpdateItem(pin);
    expect(calls).toEqual([`update ${sheet.Type()} ${VIEW_UPDATE_FLAGS.ALL}`]);
    calls.length = 0;
    const field = sheet.GetFields()[0]!;
    frame.UpdateItem(field);
    expect(calls).toEqual([
      `update ${field.Type()} ${VIEW_UPDATE_FLAGS.ALL}`,
      `update ${sheet.Type()} ${VIEW_UPDATE_FLAGS.REPAINT}`,
    ]);
  });

  it('HardRedraw and SyncView update every item', () => {
    const { frame } = setup();
    const { canvas, calls } = recordingCanvas();
    frame.SetCanvas(canvas);
    // SCH_BASE_FRAME's own (sch_base_frame.cpp:304); SCH_EDIT_FRAME overrides it (:1105).
    SCH_BASE_FRAME.prototype.HardRedraw.call(frame);
    frame.SyncView();
    expect(calls).toEqual([
      `all ${VIEW_UPDATE_FLAGS.ALL}`,
      'refresh',
      `all ${VIEW_UPDATE_FLAGS.ALL}`,
    ]);
  });

  it('the page size is in schematic IU', () => {
    const { frame } = setup();
    const page = frame.GetPageSettings();
    expect(frame.GetPageSizeIU()).toEqual(page.GetSizeIU(schIUScale.IU_PER_MILS));
    expect(frame.GetPageSizeIU().x).toBeGreaterThan(0);
  });
});
