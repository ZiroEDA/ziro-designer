// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SELECTION_FILTER` — `pcbnew/widgets/panel_selection_filter.cpp` and
 * its wxFormBuilder base `panel_selection_filter_base.cpp`.
 *
 * **One widget, two frames**, the same way APPEARANCE_CONTROLS is. Both
 * `PCB_EDIT_FRAME` (`pcb_edit_frame.cpp:359`) and `FOOTPRINT_EDIT_FRAME`
 * (`footprint_edit_frame.cpp:177, :249`) construct it and dock it under the
 * LayersManager in the same AUI layer, with `dock_proportion = 0` so it does
 * not grow. Unlike APPEARANCE_CONTROLS it takes no `aFpEditor` flag at all:
 * the two frames get the identical twelve checkboxes. The footprint editor had
 * none of it.
 */
import type { JSX } from 'react';
import { ContextMenu } from '../ui/MenuBar.js';

/** One category checkbox. */
export interface SelectionFilterItem {
  /** Our name for the `PCB_SELECTION_FILTER_OPTIONS` field. */
  key: string;
  label: string;
  tooltip?: string;
}

/**
 * The eleven category boxes, in the order the wxGridBagSizer reads them
 * row-major (`panel_selection_filter_base.cpp:21-71`): (0,1) Locked items,
 * (1,0) Footprints, (1,1) Text, (2,0) Tracks, (2,1) Vias, (3,0) Pads, (3,1)
 * Graphics, (4,0) Zones, (4,1) Rule Areas, (5,0) Dimensions, (5,1) Other
 * items, (6,0) Points.
 *
 * [data] KiCad hardcodes both the labels and the grid positions. "All items"
 * at (0,0) is not in this list because it is not a category — it is the
 * meta-control, and it is drawn separately below.
 */
export const SELECTION_FILTER_ITEMS: readonly SelectionFilterItem[] = [
  { key: 'lockedItems', label: 'Locked items', tooltip: 'Allow selection of locked items' },
  { key: 'footprints', label: 'Footprints' },
  { key: 'text', label: 'Text' },
  { key: 'tracks', label: 'Tracks' },
  { key: 'vias', label: 'Vias' },
  { key: 'pads', label: 'Pads' },
  { key: 'graphics', label: 'Graphics' },
  { key: 'zones', label: 'Zones' },
  { key: 'keepouts', label: 'Rule Areas' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'otherItems', label: 'Other items' },
  { key: 'points', label: 'Points' },
];

/**
 * The categories `All()` is computed over — everything except Locked items,
 * "which is special" (`board_project_settings.h:70-86`).
 *
 * This is the whole reason "All items" can be ticked while "Locked items" is
 * not, which is the state a stock KiCad opens in.
 */
export const SELECTION_FILTER_ALL_KEYS: readonly string[] = SELECTION_FILTER_ITEMS.filter(
  (i) => i.key !== 'lockedItems',
).map((i) => i.key);

/**
 * The set the panel opens with.
 *
 * [data] `lockedItems` is `false` and every other category `true`, in BOTH
 * frames: `common/project/project_local_settings.cpp:160-172` for pcbnew and
 * `pcbnew/footprint_editor_settings.cpp:365-377` for the footprint editor.
 * (The struct's own constructor seeds `lockedItems = true`, but neither
 * settings file ever uses that value.) `points` is absent from pcbnew's list,
 * so it falls through to the constructor's `true`.
 */
export const DEFAULT_SELECTION_FILTER_OPTIONS: ReadonlySet<string> = new Set(
  SELECTION_FILTER_ALL_KEYS,
);

/** `PCB_SELECTION_FILTER_OPTIONS::All()`. */
export function selectionFilterAll(aFilter: ReadonlySet<string>): boolean {
  return SELECTION_FILTER_ALL_KEYS.every((k) => aFilter.has(k));
}

/**
 * `PANEL_SELECTION_FILTER::OnFilterChanged` for the "All items" box
 * (`panel_selection_filter.cpp:121-146`).
 *
 * It drives the eleven categories to the box's new state and **leaves Locked
 * items alone** — the eleven `SetValue( newState )` calls do not include
 * `m_cbLockedItems`. Ours drove all twelve, so ticking "All items" also
 * enabled selecting locked items.
 */
export function toggleSelectionFilterAll(aFilter: ReadonlySet<string>): Set<string> {
  const next = new Set(aFilter);
  const on = !selectionFilterAll(aFilter);
  for (const k of SELECTION_FILTER_ALL_KEYS) {
    if (on) next.add(k);
    else next.delete(k);
  }
  return next;
}

export interface SelectionFilterPanelProps {
  /** `m_tool->GetFilter()` — the frame owns the options, the panel shows them. */
  filter: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** `onRightClick`, which pops a single "Only <label>" entry. */
  onContextMenu?: (x: number, y: number, item: SelectionFilterItem) => void;
}

export function SelectionFilterPanel({
  filter,
  onChange,
  onContextMenu,
}: SelectionFilterPanelProps): JSX.Element {
  return (
    // PANEL_SELECTION_FILTER_BASE's wxGridBagSizer: "All items" at (0,0), then
    // the categories two per row in upstream order.
    <div className="ze-selfilter">
      <label>
        <input
          type="checkbox"
          checked={selectionFilterAll(filter)}
          onChange={() => onChange(toggleSelectionFilterAll(filter))}
        />
        All items
      </label>
      {SELECTION_FILTER_ITEMS.map((item) => (
        <label
          key={item.key}
          title={item.tooltip}
          onContextMenu={(e) => {
            if (!onContextMenu) return;
            e.preventDefault();
            onContextMenu(e.clientX, e.clientY, item);
          }}
        >
          <input
            type="checkbox"
            checked={filter.has(item.key)}
            onChange={() => {
              const next = new Set(filter);
              if (next.has(item.key)) next.delete(item.key);
              else next.add(item.key);
              onChange(next);
            }}
          />
          {item.label}
        </label>
      ))}
    </div>
  );
}

/**
 * `PANEL_SELECTION_FILTER::onRightClick` (`panel_selection_filter.cpp:167-190`).
 *
 * An ordinary `wxMenu` with a single item, `wxString::Format( _( "Only %s" ),
 * cb->GetLabel().Lower() )`, whose handler unchecks every other category. Both
 * frames get it, so it is drawn here rather than hand-rolled at each call site
 * — pcbnew's copy was a bespoke `<div>` with its own border, radius, shadow and
 * `#26262b` fill, none of which a wxMenu has.
 */
export function SelectionFilterOnlyMenu({
  at,
  onOnly,
  onClose,
}: {
  at: { x: number; y: number; item: SelectionFilterItem };
  onOnly: (key: string) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <ContextMenu
      x={at.x}
      y={at.y}
      onClose={onClose}
      items={[
        {
          label: `Only ${at.item.label.toLowerCase()}`,
          action: () => onOnly(at.item.key),
        },
      ]}
    />
  );
}
