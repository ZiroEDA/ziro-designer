import { _HKI } from '@ziroeda/include/i18n_utility.js';
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ACTION_TOOLBAR_CONTROL`'s UI name and description, for the controls this
 * port's toolbars place.
 *
 * A `TOOLBAR_ITEM` of type CONTROL stores one string, its `m_ControlName`, and
 * everything a reader sees comes from the `ACTION_TOOLBAR_CONTROL` object of
 * that name: `GetUiName()` is the row Preferences > Toolbars lists it under and
 * the label in the toolbar tree, `GetDescription()` is its tooltip
 * (`panel_toolbar_customization.cpp:507`, `:631-636`).
 *
 * This port builds its toolbar controls as widgets the frame passes to
 * `<Toolbar>`'s `controls` prop rather than as registered factory objects, so
 * there is no `ACTION_TOOLBAR_CONTROL` here to ask. These strings are KiCad's
 * own — **data**, mirrored from the four places the objects are constructed —
 * and not names chosen here:
 *
 *   common/tool/action_toolbar.cpp:1222-1280   the shared controls
 *   pcbnew/toolbars_pcb_editor.cpp:127-138     the board's three
 *   pagelayout_editor/toolbars_pl_editor.cpp:176-183
 *   eeschema/toolbars_sch_editor.cpp:54-57
 *
 * Keyed by the id our toolbar modules use rather than by upstream's
 * `"control.GridSelector"`, because that id is what a `{ control: … }` entry
 * and the stored JSON carry. Upstream's own name is given beside each row so
 * the two can be checked against each other.
 */

export interface ToolbarControlInfo {
  /** `ACTION_TOOLBAR_CONTROL::GetName()` — upstream's `"control.*"` id. */
  name: string;
  /** `GetUiName()`. */
  uiName: string;
  /** `GetDescription()`. */
  description: string;
}

export const TOOLBAR_CONTROLS: Readonly<Record<string, ToolbarControlInfo>> = {
  // common/tool/action_toolbar.cpp:1222-1280
  gridSelect: {
    name: 'control.GridSelector',
    uiName: _HKI('Grid selector'),
    description: _HKI('Grid Selection box'),
  },
  zoomSelect: {
    name: 'control.ZoomSelector',
    uiName: _HKI('Zoom selector'),
    description: _HKI('Zoom Selection box'),
  },
  layerSelector: {
    name: 'control.LayerSelector',
    uiName: _HKI('Layer selector'),
    description: _HKI('Control to select the layer'),
  },
  overrideLocks: {
    name: 'control.OverrideLocks',
    uiName: _HKI('Override locks'),
    description: _HKI('Allow moving of locked items with the mouse'),
  },
  // action_toolbar.cpp:1262-1272. The Symbol Editor's top bar appends both
  // (`toolbars_symbol_editor.cpp:146-147`), and without them the Toolbars page
  // printed the raw id `bodyStyleSelector` as its own label — `GetUiName()`
  // falling back to the key is exactly what an untranscribed control looks
  // like, and it looks like a bug because it is one.
  unitSelector: {
    name: 'control.UnitSelector',
    uiName: _HKI('Symbol unit selector'),
    description: _HKI('Displays the current unit'),
  },
  bodyStyleSelector: {
    name: 'control.BodyStyleSelector',
    uiName: _HKI('Symbol body style selector'),
    description: _HKI('Displays the current body style'),
  },
  // pcbnew/toolbars_pcb_editor.cpp:127-138
  trackWidth: {
    name: 'control.PCBTrackWidth',
    uiName: _HKI('Track width selector'),
    description: _HKI('Control to select the track width'),
  },
  viaDiameter: {
    name: 'control.PCBViaDia',
    uiName: _HKI('Via diameter selector'),
    description: _HKI('Control to select the via diameter'),
  },
  currentVariant: {
    name: 'control.PCBCurrentVariant',
    uiName: _HKI('Current variant'),
    description: _HKI('Control to select the current variant'),
  },
  // pagelayout_editor/toolbars_pl_editor.cpp:176-183
  originSelector: {
    name: 'control.OriginSelector',
    uiName: _HKI('Origin selector'),
    description: _HKI('Select the origin of the status bar coordinates'),
  },
  pageSelect: {
    name: 'control.PageSelect',
    uiName: _HKI('Page selector'),
    description: _HKI('Select the page to simulate item displays'),
  },
};

/** `GetUiName()`, falling back to the raw id for a control not yet transcribed. */
export function toolbarControlUiName(id: string): string {
  return TOOLBAR_CONTROLS[id]?.uiName ?? id;
}

/** `GetDescription()`, empty for a control not yet transcribed. */
export function toolbarControlDescription(id: string): string {
  return TOOLBAR_CONTROLS[id]?.description ?? '';
}
