// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDIT_FRAME::doReCreateMenuBar`
 * (`pcbnew/menubar_footprint_editor.cpp:38-258`).
 *
 * Split out of `FootprintEditor.tsx` for the reason
 * `editors/symbol/menubar.ts` was split out of `SymbolEditor.tsx`: **`qa`'s
 * tsconfig compiles `.ts` only**, so a menu built inside a `.tsx` is
 * unreachable from the test suite by construction. Whatever was missing from
 * these two bars could not have been caught, however many tests were written.
 *
 * This commit is a move and nothing else — the tree below is the tree the frame
 * built before it, row for row — so that the commit which follows shows only
 * the difference from upstream.
 *
 * The three handlers are the schematic module's: `tool(id)` arms a
 * placement/drawing tool, `action(id)` runs a one-shot command, `toggle(id)`
 * flips a CHECK setting. An id is the one `footprintToolbars.ts` already uses
 * for the same command, because `ui/hotkeys_inventory.ts` keys the Hotkey List
 * on it the way `HOTKEY_STORE` keys on `TOOL_ACTION::GetName()`.
 */

import type { Menu, MenuItem } from '../../ui/menu_types.js';
import { addClose } from '../../ui/action_menu.js';
import { browserSafeKey } from '../../ui/browser_reserved.js';
import { standardHelpMenu } from '../../ui/help_menu.js';

const SEP: MenuItem = { sep: true };

export interface FootprintMenuHandlers {
  /** A one-shot command. */
  action: (id: string) => void;
  /** Arm a placement/drawing tool. */
  tool: (id: string) => void;
  /** Flip a CHECK setting. */
  toggle: (id: string) => void;
  /** `ACTIONS::listHotKeys`, through the shared Help menu. */
  showHotkeys: () => void;
  /** `ACTIONS::about`, through the shared Help menu. */
  showAbout: () => void;
}

/** `ACTION_MENU::CHECK` state, keyed by toggle id. */
export type FootprintMenuChecks = Readonly<Record<string, boolean>>;

/**
 * The `ENABLE( … )` conditions of `FOOTPRINT_EDIT_FRAME::setupUIConditions`
 * (`pcbnew/footprint_edit_frame.cpp`) that this menu bar reads. The frame
 * evaluates them; the names are upstream's.
 */
export interface FootprintMenuConditions {
  /** `haveFootprintCond` — a footprint is loaded. */
  haveFootprint: boolean;
  /** A library is selected to create the new footprint in. */
  targetLib: boolean;
  /** Anything unsaved anywhere — ENABLE for `ACTIONS::save`. */
  modified: boolean;
  /** The target LIB_ID names a footprint (the tree row, or the open one). */
  targetFootprint: boolean;
  /** `SELECTION_CONDITIONS::NotEmpty`. */
  haveSelection: boolean;
}

/**
 * The whole bar, in `menuBar->Append` order
 * (`menubar_footprint_editor.cpp:247-254`): File, Edit, View, Place, Inspect,
 * Tools, Preferences, then `AddStandardHelpMenu`.
 */
export function footprintEditorMenus(
  h: FootprintMenuHandlers,
  checks: FootprintMenuChecks,
  conds: FootprintMenuConditions,
): Menu[] {
  const act = (
    label: string,
    icon: string,
    id: string,
    extra: Partial<MenuItem> = {},
  ): MenuItem => ({
    label,
    icon,
    action: () => h.action(id),
    ...extra,
  });
  const tool = (
    label: string,
    icon: string,
    id: string,
    extra: Partial<MenuItem> = {},
  ): MenuItem => ({
    label,
    icon,
    action: () => h.tool(id),
    ...extra,
  });
  /**
   * A CHECK row, still spelling its tick into the label.
   *
   * `MenuItem.checked` exists and `MenuBar.tsx` draws it in the icon gutter;
   * these rows prepend the glyph to the text instead, so the label jumps two
   * characters sideways as it is ticked. Left exactly as it was: this commit
   * moves code and changes nothing.
   */
  const chk = (id: string, label: string): MenuItem => ({
    label: `${checks[id] ? '✓ ' : ''}${label}`,
    action: () => h.toggle(id),
  });
  /** Not implemented yet — shown greyed, where the frame already had it. */
  const stub = (label: string, icon?: string): MenuItem =>
    icon === undefined ? { label, disabled: true } : { label, icon, disabled: true };

  return [
    {
      label: 'File',
      items: [
        act('New Library...', 'newLibrary', 'newLibrary'),
        act('Add Library...', 'addLibrary', 'addLibrary'),
        act('New Footprint...', 'newFootprint', 'newFootprint', {
          shortcut: browserSafeKey('Ctrl+N'),
          disabled: !conds.targetLib,
        }),
        SEP,
        act('Save', 'save', 'save', { shortcut: 'Ctrl+S', disabled: !conds.modified }),
        { label: 'Save All', action: () => h.action('saveAll') },
        SEP,
        act('Import Footprint...', 'importSymbol', 'importFootprint'),
        act('Export Footprint...', 'exportSymbol', 'exportFootprint', {
          disabled: !conds.targetFootprint,
        }),
        SEP,
        act('Footprint Properties...', 'footprintProperties', 'footprintProperties', {
          disabled: !conds.haveFootprint,
        }),
        SEP,
        addClose('Footprint Editor', () => h.action('close')),
      ],
    },
    {
      label: 'Edit',
      items: [
        act('Undo', 'undo', 'undo', { shortcut: 'Ctrl+Z' }),
        act('Redo', 'redo', 'redo', { shortcut: 'Ctrl+Y' }),
        SEP,
        stub('Cut', 'cut'),
        stub('Copy', 'copy'),
        stub('Paste', 'paste'),
        act('Delete', 'delete', 'doDelete', {
          shortcut: 'Delete',
          disabled: !conds.haveSelection,
        }),
        SEP,
        stub('Pad Table...', 'padTable'),
        stub('Default Pad Properties...'),
      ],
    },
    {
      label: 'View',
      items: [
        act('Zoom In', 'zoomIn', 'zoomInCenter'),
        act('Zoom Out', 'zoomOut', 'zoomOutCenter'),
        act('Zoom to Fit', 'zoomFit', 'zoomFitScreen', { shortcut: 'F' }),
        SEP,
        chk('showLibraryTree', 'Footprint Tree'),
        chk('showLayersManager', 'Appearance Manager'),
        chk('showProperties', 'Properties Manager'),
        SEP,
        chk('padDisplayMode', 'Sketch Pads'),
        stub('3D Viewer'),
      ],
    },
    {
      label: 'Place',
      items: [
        tool('Pad', 'placePad', 'placePad', { disabled: !conds.haveFootprint }),
        tool('Line', 'drawLine', 'drawLine', { disabled: !conds.haveFootprint }),
        stub('Arc', 'drawArc'),
        tool('Rectangle', 'drawRectangle', 'drawRectangle', { disabled: !conds.haveFootprint }),
        tool('Circle', 'drawCircle', 'drawCircle', { disabled: !conds.haveFootprint }),
        stub('Polygon', 'drawPolygon'),
        stub('Text', 'placeText'),
        SEP,
        stub('Set Anchor', 'setAnchor'),
        stub('Grid Origin'),
      ],
    },
    {
      label: 'Inspect',
      items: [
        stub('Measure Tool', 'measure'),
        SEP,
        stub('Footprint Checker...', 'checkFootprint'),
        SEP,
        act('Show Datasheet', 'showDatasheet', 'showDatasheet', {
          disabled: !conds.haveFootprint,
        }),
      ],
    },
    {
      label: 'Tools',
      items: [
        stub('Load Footprint from Current Board...', 'loadFpFromBoard'),
        stub('Insert Footprint into Current Board', 'saveFpToBoard'),
        SEP,
        stub('Cleanup Graphics...'),
        stub('Repair Footprint'),
      ],
    },
    {
      label: 'Preferences',
      items: [{ label: 'Preferences...', disabled: true }],
    },
    standardHelpMenu({ showHotkeys: h.showHotkeys, showAbout: h.showAbout }),
  ];
}
