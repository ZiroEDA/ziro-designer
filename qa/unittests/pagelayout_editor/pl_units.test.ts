// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The small units of pagelayout_editor/, against their C++:
 *
 *   PL_ACTIONS (tools/pl_actions.cpp:39-129)  names, hotkey, parameter, flags.
 *   PL_EDITOR_SETTINGS (pl_editor_settings.cpp:32-59)  the seven PARAMs and
 *       their defaults; the frame's LoadSettings reads them.
 *   PL_SELECTION::GetTopLeftItem (tools/pl_selection.cpp:28-58)  leftmost,
 *       then topmost among equals.
 *   IFACE::SaveFileAs (pl_editor.cpp:164-193)  moves the file under the new
 *       project directory and renames one named after the project, exactly.
 *   doReCreateMenuBar (menubar.cpp:41-163)  the menus in order, and each
 *       row's enable condition from setupUIConditions.
 */
import { describe, expect, it } from 'vitest';
import { DS_ITEM_TYPE } from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DRAW_ITEM_LINE } from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import type { Menu, MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import { type TOOL_ACTION, TOOLBAR_STATE } from '@ziroeda/common/tool/tool_action.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  doReCreateMenuBar,
  type PlEditorMenuHandlers,
} from '@ziroeda/pagelayout_editor/menubar.js';
import { SaveFileAs } from '@ziroeda/pagelayout_editor/pl_editor.js';
import { PL_EDITOR_SETTINGS } from '@ziroeda/pagelayout_editor/pl_editor_settings.js';
import { PL_ACTIONS } from '@ziroeda/pagelayout_editor/tools/pl_actions.js';
import { PL_SELECTION } from '@ziroeda/pagelayout_editor/tools/pl_selection.js';

describe('PL_ACTIONS', () => {
  it('names the actions as the C++ does', () => {
    expect(PL_ACTIONS.drawLine.GetName()).toBe('plEditor.InteractiveDrawing.drawLine');
    expect(PL_ACTIONS.placeImage.GetName()).toBe('plEditor.InteractiveDrawing.placeImage');
    expect(PL_ACTIONS.move.GetName()).toBe('plEditor.InteractiveMove.move');
    // The name keeps upstream's old "Worksheet" spelling.
    expect(PL_ACTIONS.appendImportedDrawingSheet.GetName()).toBe(
      'plEditor.InteractiveEdit.appendWorksheet',
    );
    expect(PL_ACTIONS.layoutEditMode.GetName()).toBe('plEditor.EditorControl.LayoutEditMode');
  });

  it('gives Move the M hotkey and nothing else a hotkey', () => {
    expect(PL_ACTIONS.move.GetDefaultHotKey()).toBe('M'.charCodeAt(0));
    expect(PL_ACTIONS.drawLine.GetDefaultHotKey()).toBe(0);
    expect(PL_ACTIONS.showInspector.GetDefaultHotKey()).toBe(0);
  });

  it('carries the drawing sheet item type each drawing action makes', () => {
    expect(PL_ACTIONS.drawLine.MakeEvent().Parameter<DS_ITEM_TYPE>()).toBe(DS_ITEM_TYPE.DS_SEGMENT);
    expect(PL_ACTIONS.drawRectangle.MakeEvent().Parameter<DS_ITEM_TYPE>()).toBe(
      DS_ITEM_TYPE.DS_RECT,
    );
    expect(PL_ACTIONS.placeText.MakeEvent().Parameter<DS_ITEM_TYPE>()).toBe(DS_ITEM_TYPE.DS_TEXT);
    expect(PL_ACTIONS.placeImage.MakeEvent().Parameter<DS_ITEM_TYPE>()).toBe(
      DS_ITEM_TYPE.DS_BITMAP,
    );
  });

  it('makes the drawing tools and the two display modes toggles', () => {
    expect(PL_ACTIONS.drawLine.CheckToolbarState(TOOLBAR_STATE.TOGGLE)).toBe(true);
    expect(PL_ACTIONS.layoutNormalMode.CheckToolbarState(TOOLBAR_STATE.TOGGLE)).toBe(true);
    expect(PL_ACTIONS.showInspector.CheckToolbarState(TOOLBAR_STATE.TOGGLE)).toBe(false);
    expect(PL_ACTIONS.previewSettings.GetFriendlyName()).toBe('Page Preview Settings...');
  });
});

describe('PL_EDITOR_SETTINGS', () => {
  it('defaults each PARAM as pl_editor_settings.cpp does', () => {
    const cfg = new PL_EDITOR_SETTINGS();
    expect(cfg.ToJson()).toEqual({
      properties_frame_width: 150,
      corner_origin: 0,
      black_background: false,
      last_paper_size: 'A3',
      last_custom_width: 17000,
      last_custom_height: 11000,
      last_was_portrait: false,
    });
    expect(cfg.GetFilename()).toBe('pl_editor');
  });

  it('reads a stored value and keeps the default for an absent one', () => {
    const cfg = new PL_EDITOR_SETTINGS().FromJson({ corner_origin: 3, last_paper_size: 'A4' });
    expect(cfg.m_CornerOrigin).toBe(3);
    expect(cfg.m_LastPaperSize).toBe('A4');
    expect(cfg.m_PropertiesFrameWidth).toBe(150);
  });
});

describe('PL_SELECTION::GetTopLeftItem', () => {
  const line = (x: number, y: number) =>
    new DS_DRAW_ITEM_LINE(null, 0, { x, y }, { x: x + 10, y: y + 10 }, 0);

  it('takes the leftmost item, and the topmost of two that start as far left', () => {
    const sel = new PL_SELECTION();
    const a = line(50, 0);
    const b = line(10, 80);
    const c = line(10, 20);
    sel.Add(a);
    sel.Add(b);
    sel.Add(c);
    expect(sel.GetTopLeftItem()).toBe(c);
  });
});

describe('IFACE::SaveFileAs', () => {
  it('moves the sheet under the new project and renames the project-named one', () => {
    expect(SaveFileAs('/p/old', 'old', '/p/new', 'new', '/p/old/old.kicad_wks')).toBe(
      '/p/new/new.kicad_wks',
    );
    expect(SaveFileAs('/p/old', 'old', '/p/new', 'new', '/p/old/sheets/frame.kicad_wks')).toBe(
      '/p/new/sheets/frame.kicad_wks',
    );
  });

  it('matches the project name exactly, case included', () => {
    expect(SaveFileAs('/p/old', 'old', '/p/new', 'new', '/p/old/OLD.kicad_wks')).toBe(
      '/p/new/OLD.kicad_wks',
    );
  });

  it('keeps a sheet outside the project in its directory, still renamed', () => {
    expect(SaveFileAs('/p/old', 'old', '/p/new', 'new', '/lib/old.kicad_wks')).toBe(
      '/lib/new.kicad_wks',
    );
  });
});

describe('doReCreateMenuBar', () => {
  /** The actions the rows ran on the frame's tool manager, in order. */
  let ran: TOOL_ACTION[] = [];

  it('runs Preferences... and the Help rows on the tool manager, for COMMON_CONTROL', () => {
    ran = [];
    const menus = doReCreateMenuBar(handlers());
    menus.find((m) => m.label === 'Preferences')!.items[0]!.action!();
    for (const item of menus.find((m) => m.label === 'Help')!.items) item.action?.();
    expect(ran).toEqual([
      ACTIONS.openPreferences,
      ACTIONS.help,
      ACTIONS.gettingStarted,
      ACTIONS.listHotKeys,
      ACTIONS.getInvolved,
      ACTIONS.reportBug,
      ACTIONS.about,
    ]);
  });

  const handlers = (over: Partial<PlEditorMenuHandlers> = {}): PlEditorMenuHandlers => {
    const noop = () => {};
    return {
      doNew: noop,
      open: noop,
      openRecent: { label: 'Open Recent', items: [] },
      save: noop,
      saveAs: noop,
      print: noop,
      close: noop,
      undo: noop,
      redo: noop,
      cut: noop,
      copy: noop,
      paste: noop,
      doDelete: noop,
      undoEnabled: false,
      redoEnabled: false,
      selectionNotEmpty: false,
      pasteEnabled: true,
      zoomInCenter: noop,
      zoomOutCenter: noop,
      zoomFitScreen: noop,
      zoomTool: noop,
      zoomRedraw: noop,
      previewSettings: noop,
      drawLine: noop,
      drawRectangle: noop,
      placeText: noop,
      placeImage: noop,
      appendImportedDrawingSheet: noop,
      gridResetOrigin: noop,
      showInspector: noop,
      toolManager: { RunAction: (a: TOOL_ACTION) => ran.push(a) },
      language: 'Default',
      onSelectLanguage: noop,
      ...over,
    };
  };

  const rows = (m: Menu): (string | true)[] =>
    m.items.map((i: MenuItem) => (i.sep ? true : (i.label ?? '')));

  it('has the seven menus in menubar.cpp:151-158 order', () => {
    expect(doReCreateMenuBar(handlers()).map((m) => m.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Place',
      'Inspect',
      'Preferences',
      'Help',
    ]);
  });

  it('lays out Edit and Place as upstream does', () => {
    const [, edit, , place] = doReCreateMenuBar(handlers());
    expect(rows(edit!)).toEqual(['Undo', 'Redo', true, 'Cut', 'Copy', 'Paste', 'Delete']);
    expect(rows(place!)).toEqual([
      'Draw Lines',
      'Draw Rectangles',
      'Draw Text',
      'Place Bitmaps',
      true,
      'Append Existing Drawing Sheet...',
      true,
      'Reset Grid Origin',
    ]);
  });

  it('greys Undo, Redo, Cut, Copy and Delete by their conditions, and Paste by its own', () => {
    const disabled = (h: PlEditorMenuHandlers): string[] =>
      doReCreateMenuBar(h)[1]!
        .items.filter((i) => i.disabled)
        .map((i) => i.label ?? '');

    expect(disabled(handlers())).toEqual(['Undo', 'Redo', 'Cut', 'Copy', 'Delete']);
    expect(
      disabled(
        handlers({
          undoEnabled: true,
          redoEnabled: true,
          selectionNotEmpty: true,
          pasteEnabled: false,
        }),
      ),
    ).toEqual(['Paste']);
  });
});
