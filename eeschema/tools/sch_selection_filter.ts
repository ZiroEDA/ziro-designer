// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Selection filter, ported from KiCad's `SCH_SELECTION_FILTER_OPTIONS`
 * (include/project/sch_project_settings.h) and `SCH_SELECTION_TOOL::
 * itemPassesFilter` (eeschema/tools/sch_selection_tool.cpp).
 *
 * The filter is how KiCad enforces item locking: a locked item fails the
 * filter unless `lockedItems` is enabled, so locked symbols cannot be
 * selected, and therefore cannot be moved, dragged or deleted, until the
 * user turns "Locked items" on in the Selection Filter panel. Each item-type
 * category gates its kinds the same way.
 */

/** Mirrors SCH_SELECTION_FILTER_OPTIONS. `lockedItems` is special (excluded
 *  from All()); the rest are per-category toggles. */
export interface SelectionFilterOptions {
  lockedItems: boolean;
  symbols: boolean;
  text: boolean;
  wires: boolean;
  labels: boolean;
  pins: boolean;
  graphics: boolean;
  images: boolean;
  ruleAreas: boolean;
  otherItems: boolean;
}

/** SetDefaults(): everything selectable except locked items. */
export function defaultSelectionFilter(): SelectionFilterOptions {
  return {
    lockedItems: false,
    symbols: true,
    text: true,
    wires: true,
    labels: true,
    pins: true,
    graphics: true,
    images: true,
    ruleAreas: true,
    otherItems: true,
  };
}

/** Any(), true if at least one category (not lockedItems) is enabled. */
export function selectionFilterAny(o: SelectionFilterOptions): boolean {
  return (
    o.symbols ||
    o.text ||
    o.wires ||
    o.labels ||
    o.pins ||
    o.graphics ||
    o.images ||
    o.ruleAreas ||
    o.otherItems
  );
}

/** All(), true if every category (not lockedItems) is enabled. */
export function selectionFilterAll(o: SelectionFilterOptions): boolean {
  return (
    o.symbols &&
    o.text &&
    o.wires &&
    o.labels &&
    o.pins &&
    o.graphics &&
    o.images &&
    o.ruleAreas &&
    o.otherItems
  );
}
