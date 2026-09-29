// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/toolbars_symbol_viewer.cpp`: `SYMBOL_VIEWER_TOOLBAR_SETTINGS::
 * DefaultToolbarConfig` (`TOOLBAR_LOC::TOP_MAIN`) and
 * `SYMBOL_VIEWER_FRAME::doReCreateMenuBar` — upstream keeps both in the same
 * file, so this does too, split out of `symbol_viewer_frame_ui.tsx` (the
 * window) the way `symbol_viewer_frame.ts` (the logic) is.
 */
import type { ToolEntry } from '@ziroeda/common/tool/action_toolbar.js';
import type { Menu } from '@ziroeda/common/tool/action_menu_types.js';
import { addClose } from '@ziroeda/common/tool/action_menu.js';
import { letterSubReference } from './fieldbox.js';

/** BODY_STYLE::BASE / DEMORGAN (symbol_edit_frame.h DEMORGAN_STD / DEMORGAN_ALT). */
export const DEMORGAN_STD = 'Standard';
export const DEMORGAN_ALT = 'Alternate';

/** SYMBOL_VIEWER_TOOLBAR_SETTINGS::DefaultToolbarConfig( TOOLBAR_LOC::TOP_MAIN ). */
export const TOP_TOOLBAR: ToolEntry[] = [
  { id: 'previousSymbol', icon: 'previousSymbol', title: 'Display previous symbol' },
  { id: 'nextSymbol', icon: 'nextSymbol', title: 'Display next symbol' },
  'sep',
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Refresh' },
  { id: 'zoomInCenter', icon: 'zoomIn', title: 'Zoom In' },
  { id: 'zoomOutCenter', icon: 'zoomOut', title: 'Zoom Out' },
  { id: 'zoomFitScreen', icon: 'zoomFit', title: 'Zoom to Fit' },
  'sep',
  {
    id: 'showElectricalTypes',
    icon: 'showElectricalTypes',
    title: 'Show Pin Electrical Types',
    toggle: true,
  },
  { id: 'showPinNumbers', icon: 'showPinNumbers', title: 'Show Pin Numbers', toggle: true },
  'sep',
  { control: 'bodyStyleSelector' },
  'sep',
  { control: 'unitSelector' },
  'sep',
  { id: 'showDatasheet', icon: 'showDatasheet', title: 'Show Datasheet' },
  'sep',
  { id: 'addSymbolToSchematic', icon: 'addSymbolToSchematic', title: 'Add Symbol to Schematic' },
];

/** LIB_SYMBOL::GetUnitDisplayName( aUnit, true ), no per-unit names in the file format yet. */
export const unitDisplayName = (unit: number): string => `Unit ${letterSubReference(unit)}`;

/**
 * `SYMBOL_VIEWER_FRAME::doReCreateMenuBar`, transcribed. The frame had no
 * menu bar here at all, so the one row upstream's File menu carries -
 * `fileMenu->AddClose( _( "Symbol Viewer" ) )` - was missing along with the
 * whole View menu.
 *
 * Not `AddStandardHelpMenu`, which upstream appends third: its About row
 * opens a dialog that is still hand-rolled once per frame here, and adding a
 * ninth copy of it to reach one menu row is the duplication this repo is
 * trying to remove. Recorded rather than quietly dropped.
 */
export function buildSymbolViewerMenus(opts: {
  onClose: () => void;
  onAction: (id: string) => void;
  showElectricalTypes: boolean;
  showPinNumbers: boolean;
}): Menu[] {
  const { onClose, onAction, showElectricalTypes, showPinNumbers } = opts;
  return [
    { label: 'File', items: [addClose('Symbol Viewer', onClose)] },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', icon: 'zoomIn', action: () => onAction('zoomInCenter') },
        { label: 'Zoom Out', icon: 'zoomOut', action: () => onAction('zoomOutCenter') },
        {
          label: 'Zoom to Fit',
          icon: 'zoomFit',
          shortcut: 'Home',
          action: () => onAction('zoomFitScreen'),
        },
        {
          label: 'Refresh',
          icon: 'zoomRedraw',
          shortcut: 'F5',
          action: () => onAction('zoomRedraw'),
        },
        { sep: true },
        {
          label: 'Show Pin Electrical Types',
          checked: showElectricalTypes,
          action: () => onAction('showElectricalTypes'),
        },
        {
          label: 'Show Pin Numbers',
          checked: showPinNumbers,
          action: () => onAction('showPinNumbers'),
        },
      ],
    },
  ];
}
