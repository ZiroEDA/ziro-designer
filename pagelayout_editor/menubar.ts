// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PL_EDITOR_FRAME::doReCreateMenuBar` (`pagelayout_editor/menubar.cpp:41-163`):
 * File / Edit / View / Place / Inspect / Preferences / Help.
 *
 * A data module the window renders, as `gerbview/menubar.ts` is: each row
 * says what it runs through a handler, and the enable conditions
 * `setupUIConditions` gives (`pl_editor_frame.cpp:305-368`) arrive as the
 * handlers' state. The Help menu and the language list are the shared
 * `AddStandardHelpMenu` / `AddMenuLanguageList` (`common/eda_base_frame_*`),
 * and Close / Quit `ACTION_MENU::AddClose` / `AddQuit`.
 */
import { browserSafeKey } from '@ziroeda/common/browser_reserved.js';
import {
  type HelpMenuHandlers,
  standardHelpMenu,
} from '@ziroeda/common/eda_base_frame_help_menu.js';
import { setLanguageMenuItem } from '@ziroeda/common/eda_base_frame_language_menu.js';
import { addClose, addQuit } from '@ziroeda/common/tool/action_menu.js';
import type { Menu, MenuItem } from '@ziroeda/common/tool/action_menu_types.js';

export interface PlEditorMenuHandlers extends HelpMenuHandlers {
  // File
  doNew: () => void;
  open: () => void;
  /** The "Open Recent" submenu, `FILE_HISTORY::UseMenu`'s. */
  openRecent: MenuItem;
  save: () => void;
  saveAs: () => void;
  print: () => void;
  /** `AddClose` / `AddQuit`'s target. */
  close: () => void;

  // Edit
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  doDelete: () => void;
  /** `ENABLE( cond.UndoAvailable() )`. */
  undoEnabled: boolean;
  /** `ENABLE( cond.RedoAvailable() )`. */
  redoEnabled: boolean;
  /** `ENABLE( SELECTION_CONDITIONS::NotEmpty )`: cut, copy and delete. */
  selectionNotEmpty: boolean;
  /** `ENABLE( SELECTION_CONDITIONS::Idle && cond.NoActiveTool() )`. */
  pasteEnabled: boolean;

  // View
  zoomInCenter: () => void;
  zoomOutCenter: () => void;
  zoomFitScreen: () => void;
  zoomTool: () => void;
  zoomRedraw: () => void;
  previewSettings: () => void;

  // Place
  drawLine: () => void;
  drawRectangle: () => void;
  placeText: () => void;
  placeImage: () => void;
  appendImportedDrawingSheet: () => void;
  gridResetOrigin: () => void;

  // Inspect
  showInspector: () => void;

  // Preferences
  openPreferences: () => void;
  language: string;
  onSelectLanguage: (label: string) => void;
}

/** `doReCreateMenuBar()`'s menu bar. */
export function doReCreateMenuBar(h: PlEditorMenuHandlers): Menu[] {
  return [
    {
      label: 'File',
      items: [
        {
          label: 'New...',
          icon: 'new',
          action: h.doNew,
          shortcut: browserSafeKey('Ctrl+N'),
        },
        { label: 'Open...', icon: 'open', action: h.open, shortcut: 'Ctrl+O' },
        h.openRecent,
        { sep: true },
        { label: 'Save', icon: 'save', action: h.save, shortcut: 'Ctrl+S' },
        { label: 'Save As...', icon: 'saveAs', action: h.saveAs, shortcut: 'Shift+Ctrl+S' },
        { sep: true },
        { label: 'Print...', icon: 'print', action: h.print, shortcut: 'Ctrl+P' },
        { sep: true },
        addClose('Drawing Sheet Editor', h.close),
        addQuit('Drawing Sheet Editor', h.close),
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          label: 'Undo',
          icon: 'undo',
          action: h.undo,
          shortcut: 'Ctrl+Z',
          disabled: !h.undoEnabled,
        },
        {
          label: 'Redo',
          icon: 'redo',
          action: h.redo,
          shortcut: 'Ctrl+Y',
          disabled: !h.redoEnabled,
        },
        { sep: true },
        {
          label: 'Cut',
          icon: 'cut',
          action: h.cut,
          shortcut: 'Ctrl+X',
          disabled: !h.selectionNotEmpty,
        },
        {
          label: 'Copy',
          icon: 'copy',
          action: h.copy,
          shortcut: 'Ctrl+C',
          disabled: !h.selectionNotEmpty,
        },
        {
          // Ctrl+V is performed by the browser's own paste, which is the only
          // reliable read of the system clipboard - see `nativeShortcut`. The
          // action is what the *row* does when it is clicked.
          label: 'Paste',
          icon: 'paste',
          action: h.paste,
          shortcut: 'Ctrl+V',
          nativeShortcut: true,
          disabled: !h.pasteEnabled,
        },
        {
          label: 'Delete',
          icon: 'dsDelete',
          action: h.doDelete,
          shortcut: 'Delete',
          disabled: !h.selectionNotEmpty,
        },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', icon: 'zoomIn', action: h.zoomInCenter },
        { label: 'Zoom Out', icon: 'zoomOut', action: h.zoomOutCenter },
        { label: 'Zoom to Fit', icon: 'zoomFit', action: h.zoomFitScreen, shortcut: 'Home' },
        {
          label: 'Zoom to Selection Area',
          icon: 'zoomTool',
          action: h.zoomTool,
          shortcut: 'Ctrl+F5',
        },
        { label: 'Refresh', icon: 'zoomRedraw', action: h.zoomRedraw, shortcut: 'F5' },
        { sep: true },
        { label: 'Page Preview Settings...', icon: 'previewSettings', action: h.previewSettings },
      ],
    },
    {
      label: 'Place',
      items: [
        { label: 'Draw Lines', icon: 'dsAddLine', action: h.drawLine },
        { label: 'Draw Rectangles', icon: 'dsAddRect', action: h.drawRectangle },
        { label: 'Draw Text', icon: 'dsAddText', action: h.placeText },
        { label: 'Place Bitmaps', icon: 'dsAddBitmap', action: h.placeImage },
        { sep: true },
        {
          label: 'Append Existing Drawing Sheet...',
          icon: 'appendSheet',
          action: h.appendImportedDrawingSheet,
        },
        { sep: true },
        { label: 'Reset Grid Origin', action: h.gridResetOrigin },
      ],
    },
    {
      label: 'Inspect',
      items: [{ label: 'Show Design Inspector', icon: 'inspect', action: h.showInspector }],
    },
    {
      label: 'Preferences',
      // menubar.cpp:142-149 — openPreferences then AddMenuLanguageList, and
      // unlike bitmap2cmp and cvpcb pl_editor puts no separator between them.
      items: [
        { label: 'Preferences...', action: h.openPreferences, shortcut: 'Ctrl+,' },
        setLanguageMenuItem({ current: h.language, onSelect: h.onSelectLanguage }),
      ],
    },
    // "Syntax Help" is not a Help-menu entry upstream: pl_editor puts it in
    // the properties panel as a hyperlink (properties_frame_base.cpp,
    // m_syntaxHelpLink), which is where ours lives too.
    standardHelpMenu(h),
  ];
}
