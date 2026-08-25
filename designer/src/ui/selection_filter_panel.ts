// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SCH_SELECTION_FILTER`'s grid, as data.
 *
 * ONE panel serves both eeschema frames upstream — `SCH_EDIT_FRAME` builds it
 * at `sch_edit_frame.cpp` and `SYMBOL_EDIT_FRAME` at
 * `symbol_edit_frame.cpp:195`, both `new PANEL_SCH_SELECTION_FILTER( this )` —
 * and the class itself branches once, on the frame type, to lay the same
 * checkboxes out differently. So there is exactly one layout rule and it is
 * stated here once, not copied into each editor.
 *
 * ---------------------------------------------------------------------------
 * THE BASE GRID (`panel_sch_selection_filter_base.cpp:14-66`)
 * ---------------------------------------------------------------------------
 *
 * A `wxGridBagSizer`, two columns, in `wxGBPosition( row, col )` order:
 *
 * ```
 *   (0,0) All items          (0,1) Rule Areas
 *   (1,0) Symbols            (1,1) Pins
 *   (2,0) Wires              (2,1) Labels
 *   (3,0) Graphics           (3,1) Images
 *   (4,0) Text               (4,1) Other items
 *   (5,0) Locked items                            <- m_cbLockedItems->Hide()  (:28)
 * ```
 *
 * **"Locked items" is hidden in both frames.** `:28` calls `Hide()` in the
 * generated base and nothing ever calls `Show()` on it — it is reachable only
 * through the right-click "Only %s" menu. Ours rendered it as a visible row in
 * the schematic editor, which is a control KiCad does not show.
 *
 * ---------------------------------------------------------------------------
 * THE SYMBOL EDITOR OVERRIDE (`panel_sch_selection_filter.cpp:70-88`)
 * ---------------------------------------------------------------------------
 *
 * `if( m_frame->GetFrameType() == FRAME_SCH_SYMBOL_EDITOR )` parks the four
 * schematic-only boxes off the bottom of the grid and hides them —
 * Symbols → (6,0), Wires → (6,1), Labels → (7,0), Images → (7,1), plus
 * `m_cbRuleAreas->Hide()` — then pulls the four that remain up:
 *
 * ```
 *   Pins → (1,0)      Text  → (1,1)
 *   Graphics → (2,0)  Other items → (2,1)
 * ```
 *
 * leaving:
 *
 * ```
 *   (0,0) All items
 *   (1,0) Pins        (1,1) Text
 *   (2,0) Graphics    (2,1) Other items
 * ```
 *
 * Note (0,1) stays EMPTY in the symbol editor — Rule Areas is hidden in place,
 * not replaced — so "All items" sits alone on its row in both frames' rendering
 * of this table (in the schematic it shares the row with Rule Areas).
 */

import type { SelectionFilterOptions } from '@ziroeda/eeschema/src/tools/sch_selection_filter.js';

/** Which frame is asking; `EDA_BASE_FRAME::GetFrameType()`'s two values here. */
export type SelectionFilterFrame = 'FRAME_SCH' | 'FRAME_SCH_SYMBOL_EDITOR';

/** One checkbox: the `SCH_SELECTION_FILTER_OPTIONS` member it drives, and its label. */
export interface SelectionFilterCell {
  /** `null` for the "All items" master, which is not a filter member. */
  key: keyof Omit<SelectionFilterOptions, 'lockedItems'> | null;
  /** The `wxCheckBox` label, verbatim. */
  label: string;
  /** `SetToolTip`, where the base sets one. */
  tooltip?: string;
}

/** Labels and tooltips, from the `new wxCheckBox( … )` calls in the base. */
const ALL_ITEMS: SelectionFilterCell = { key: null, label: 'All items' };
const RULE_AREAS: SelectionFilterCell = { key: 'ruleAreas', label: 'Rule Areas' };
const SYMBOLS: SelectionFilterCell = { key: 'symbols', label: 'Symbols' };
const PINS: SelectionFilterCell = { key: 'pins', label: 'Pins' };
const WIRES: SelectionFilterCell = { key: 'wires', label: 'Wires' };
const LABELS: SelectionFilterCell = { key: 'labels', label: 'Labels' };
// `m_cbGraphics->SetToolTip( _( "Graphical shapes" ) )` (base :51).
const GRAPHICS: SelectionFilterCell = {
  key: 'graphics',
  label: 'Graphics',
  tooltip: 'Graphical shapes',
};
const IMAGES: SelectionFilterCell = { key: 'images', label: 'Images' };
const TEXT: SelectionFilterCell = { key: 'text', label: 'Text' };
const OTHER_ITEMS: SelectionFilterCell = { key: 'otherItems', label: 'Other items' };

/**
 * The visible cells of the grid, row by row, left column first. A `null` cell
 * is a grid position upstream leaves empty (a hidden checkbox still occupying
 * its `wxGBPosition`), so the row keeps its shape.
 */
export function selectionFilterGrid(
  frame: SelectionFilterFrame,
): readonly (readonly (SelectionFilterCell | null)[])[] {
  if (frame === 'FRAME_SCH_SYMBOL_EDITOR') {
    return [
      [ALL_ITEMS, null],
      [PINS, TEXT],
      [GRAPHICS, OTHER_ITEMS],
    ];
  }
  return [
    [ALL_ITEMS, RULE_AREAS],
    [SYMBOLS, PINS],
    [WIRES, LABELS],
    [GRAPHICS, IMAGES],
    [TEXT, OTHER_ITEMS],
  ];
}

/**
 * `SYMBOL_EDIT_FRAME::updateSelectionFilterVisbility`
 * (`symbol_edit_frame.cpp:2249-2261`):
 *
 * ```cpp
 * // Don't give the selection filter its own visibility controls; instead show it if
 * // anything else is visible
 * bool showFilter = ( treePane.IsShown() && treePane.IsDocked() )
 *                   || ( propertiesPane.IsShown() && propertiesPane.IsDocked() );
 * ```
 *
 * So the Symbol Editor's filter has NO toggle of its own — it follows the
 * Libraries tree and the Properties pane. (`SCH_EDIT_FRAME`'s version of the
 * same method ORs three panes; that one is `schSelectionFilterShown` in
 * `editors/schematic/panes.ts`.)
 */
export function symSelectionFilterShown(shown: {
  libraryTree: boolean;
  properties: boolean;
}): boolean {
  return shown.libraryTree || shown.properties;
}

/**
 * `PANEL_SCH_SELECTION_FILTER::OnFilterChanged`
 * (`panel_sch_selection_filter.cpp:139-152`): ticking "All items" sets every
 * category — `lockedItems` excluded, exactly as `SetValue` is not called on it
 * there — to the master's new state.
 */
export function setAllSelectionFilterCategories(
  opts: SelectionFilterOptions,
  value: boolean,
): SelectionFilterOptions {
  return {
    ...opts,
    symbols: value,
    text: value,
    wires: value,
    labels: value,
    pins: value,
    graphics: value,
    images: value,
    ruleAreas: value,
    otherItems: value,
  };
}
