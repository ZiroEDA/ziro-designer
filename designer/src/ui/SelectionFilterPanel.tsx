// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SCH_SELECTION_FILTER` (`eeschema/widgets/panel_sch_selection_filter.cpp`).
 *
 * One widget, two frames — `SCH_EDIT_FRAME` and `SYMBOL_EDIT_FRAME` both build
 * the same class and it branches internally on the frame type. The layout and
 * the "All items" rule live in `selection_filter_panel.ts` so a test can run
 * them; this file is only the markup around them.
 *
 * The pane caption is `_( "Selection Filter" )` — `defaultSchSelectionFilterPaneInfo`
 * (`eeschema/sch_base_frame.cpp`), the same `EDA_PANE().Name( "SelectionFilter" )`
 * both frames add.
 */
import type { JSX } from 'react';
import type { SelectionFilterOptions } from '@ziroeda/eeschema/src/tools/sch_selection_filter.js';
import { selectionFilterAll } from '@ziroeda/eeschema/src/tools/sch_selection_filter.js';
import {
  selectionFilterGrid,
  setAllSelectionFilterCategories,
  type SelectionFilterFrame,
} from './selection_filter_panel.js';

export function SelectionFilterPanel({
  frame,
  filter,
  onChange,
}: {
  /** `EDA_BASE_FRAME::GetFrameType()`, which is what upstream branches on. */
  frame: SelectionFilterFrame;
  filter: SelectionFilterOptions;
  onChange: (next: SelectionFilterOptions) => void;
}): JSX.Element {
  const all = selectionFilterAll(filter);
  return (
    <div className="ze-panel">
      <div className="ze-panel-header">Selection Filter</div>
      <div className="ze-panel-body">
        <div className="ze-selfilter">
          {selectionFilterGrid(frame).map((row, r) =>
            row.map((cell, c) =>
              cell === null ? (
                // A hidden checkbox still holds its wxGBPosition, so the cell
                // stays empty rather than the row closing up.
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid slot
                <span key={`empty-${r}-${c}`} />
              ) : (
                <label key={cell.label} title={cell.tooltip}>
                  <input
                    type="checkbox"
                    checked={cell.key === null ? all : filter[cell.key]}
                    onChange={(e) =>
                      onChange(
                        cell.key === null
                          ? setAllSelectionFilterCategories(filter, e.target.checked)
                          : { ...filter, [cell.key]: e.target.checked },
                      )
                    }
                  />
                  {cell.label}
                </label>
              ),
            ),
          )}
        </div>
      </div>
    </div>
  );
}
