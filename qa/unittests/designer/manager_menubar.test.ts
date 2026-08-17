// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * KICAD_MANAGER_FRAME's menu bar (kicad/menubar.cpp), where it differs from
 * ours in ways a screenshot does not show.
 */
import { describe, expect, it } from 'vitest';
import { buildManagerMenus } from '@ziroeda/designer/src/home/menubar.js';
import type { MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

const noop = (): void => undefined;
const handlers = {
  newProject: noop,
  openProject: noop,
  selectProjectFiles: noop,
  openRecent: noop,
  clearRecent: noop,
  closeProject: noop,
  saveAs: noop,
  archiveProject: noop,
  unarchiveProject: noop,
  refresh: noop,
  openTextViewer: noop,
  editSchematic: noop,
  editSymbols: noop,
  editPcb: noop,
  editFootprints: noop,
  openImageConverter: noop,
  openGerberViewer: noop,
  openCalculator: noop,
  openDrawingSheetEditor: noop,
  openPreferences: noop,
  showAbout: noop,
  showHotkeys: noop,
  openDemo: noop,
  hasProject: true,
  hasTextFileSelected: true,
  recent: [],
  demos: [],
};

const editItems = (): MenuItem[] =>
  buildManagerMenus(handlers).find((m) => m.label === 'Edit')?.items ?? [];

describe('the Edit menu', () => {
  it('is Cut, Copy and Paste, in that order', () => {
    //   editMenu->Add( ACTIONS::cut );
    //   editMenu->Add( ACTIONS::copy );
    //   editMenu->Add( ACTIONS::paste );
    // and nothing else - Edit Advanced Config is behind KICAD_EDIT_ADVANCED_CFG,
    // a developer environment variable, so a stock KiCad shows three rows.
    expect(editItems().map((i) => i.label)).toEqual(['Cut', 'Copy', 'Paste']);
  });

  it('greys out all three, as SetConditions( ..., ENABLE( ShowNever ) ) does', () => {
    // kicad_manager_frame.cpp disables the three outright:
    //   #define ENABLE( x ) ACTION_CONDITIONS().Enable( x )
    //   manager->SetConditions( ACTIONS::cut, ENABLE( SELECTION_CONDITIONS::ShowNever ) );
    // and ShowNever is `return false`, so the condition never holds. The
    // project manager has no selection to cut and nowhere to paste to.
    for (const item of editItems()) {
      expect(item.disabled, `${item.label} is clickable`).toBe(true);
    }
  });

  it('gives none of them an action, so none can be invoked', () => {
    // These ran document.execCommand('cut' | 'copy' | 'paste'), which made
    // three rows look like commands the project manager offers. It was also
    // dead: no browser has permitted execCommand('paste') from page script for
    // years, and by the time a menu click lands the field that held the
    // selection has lost it.
    for (const item of editItems()) {
      expect(item.action, `${item.label} still has a handler`).toBeUndefined();
    }
  });

  it('keeps their accelerators, which is the whole reason they are there', () => {
    // ACTIONS::cut carries .DefaultHotkey( MD_CTRL + 'X' ) and .UIId( wxID_CUT ),
    // and upstream's comment says the entries exist "so that cut/copy/paste
    // work in things like search boxes in file open dialogs" - wxWidgets routes
    // the standard id to whichever text control has focus. A disabled menu row
    // still shows its key, and dropping the keys would leave three rows with no
    // reason to exist at all.
    expect(editItems().map((i) => i.shortcut)).toEqual(['Ctrl+X', 'Ctrl+C', 'Ctrl+V']);
  });
});

const viewItems = (): MenuItem[] =>
  buildManagerMenus(handlers).find((m) => m.label === 'View')?.items ?? [];
const toolsItems = (): MenuItem[] =>
  buildManagerMenus(handlers).find((m) => m.label === 'Tools')?.items ?? [];

/** A menu as the reader sees it: labels, with a separator shown as a rule. */
const shape = (items: readonly MenuItem[]): string[] =>
  items.map((i) => (i.sep ? '---' : (i.label ?? '?')));

describe('the View menu', () => {
  it('rules off Refresh from the group that leaves the app', () => {
    //   viewMenu->Add( panelsMenu );
    //   viewMenu->AppendSeparator();
    //   viewMenu->Add( ACTIONS::zoomRedraw );
    //   viewMenu->AppendSeparator();
    //   viewMenu->Add( KICAD_MANAGER_ACTIONS::openTextEditor );
    // Both separators are in the source. A comment here used to claim the
    // second one was not, and the menu was built to match the comment.
    expect(shape(viewItems())).toEqual(['Panels', '---', 'Refresh', '---', 'Open Text Viewer']);
  });

  it('gives Refresh F5, which is its default off macOS', () => {
    //   #if defined( __WXMAC__ ) .DefaultHotkey( MD_CTRL + 'R' )
    //   #else                    .DefaultHotkey( WXK_F5 )
    expect(viewItems().find((i) => i.label === 'Refresh')?.shortcut).toBe('F5');
  });

  it('has a Panels submenu holding Local History', () => {
    //   panelsMenu->Add( KICAD_MANAGER_ACTIONS::showLocalHistory, ACTION_MENU::CHECK );
    const panels = viewItems().find((i) => i.label === 'Panels');
    expect(panels?.submenu?.map((i) => i.label)).toEqual(['Local History']);
  });
});

describe('the Tools menu', () => {
  it('is the four editors, a rule, then the four standalone tools', () => {
    //   editSchematic, editSymbols, editPCB, editFootprints
    //   AppendSeparator
    //   viewGerbers, convertImage, showCalculator, editDrawingSheet
    expect(shape(toolsItems())).toEqual([
      'Schematic Editor',
      'Symbol Editor',
      'PCB Editor',
      'Footprint Editor',
      '---',
      'Gerber Viewer',
      'Image Converter',
      'Calculator Tools',
      'Drawing Sheet Editor',
    ]);
  });

  it('does not end on a separator', () => {
    // Edit Local File was the last row and took its rule with it; a rule below
    // the last item is a group boundary with nothing on the far side.
    expect(toolsItems()[toolsItems().length - 1]?.sep).toBeFalsy();
  });

  it('leaves no disabled row behind', () => {
    // Every remaining entry opens something that exists.
    for (const i of toolsItems()) {
      if (i.sep) continue;
      expect(i.action, `${i.label} has no handler`).toBeDefined();
    }
  });
});
