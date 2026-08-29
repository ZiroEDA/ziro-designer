// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_PROPERTIES_PANEL — pcbnew's docked Properties pane.
 *
 * Counterpart: `pcbnew/widgets/pcb_properties_panel.cpp`, and it is the same
 * shape upstream is: a subclass of PROPERTIES_PANEL that supplies DATA and
 * nothing else. The widget — the caption, the grid, the collapsible
 * categories, the name/value split, the greyed read-only cells, the fact that
 * a value is painted text until its cell is activated — lives once, in
 * `widgets/properties_panel.tsx`, exactly as `common/widgets/
 * properties_panel.cpp` does. eeschema's subclass sits beside this one and
 * differs only in which rows it hands over.
 *
 * The rows come from `pcbPropertiesFor` in the pcbnew package, which mirrors
 * the PROPERTY_MANAGER registrations at the bottom of each board item's .cpp;
 * the caption comes from `pcbItemFriendlyName`, which mirrors
 * `EDA_ITEM::GetFriendlyName()`.
 *
 * This file replaces ~1200 lines that were written inline in `PcbEditor.tsx`:
 * a second copy of the whole widget (`PgCat` / `PgRow` / `PgRO` / `PgCheck` /
 * `PgLayer` / `PgEdit` / `PgChoice`) plus seven per-item panels. That copy had
 * drifted exactly where a second copy always does — it had no caption at all,
 * it wrote its own `.ze-pg*` chrome in `ui/shell.css` instead of the
 * measured grid metrics, its Escape key abandoned the edit without restoring
 * the cell text, and its editors did not `stopPropagation`, so typing a
 * coordinate fired the canvas hotkeys under it.
 */

import type { JSX } from 'react';
import type { Board } from '@ziroeda/pcbnew';
import type { PcbPropRow } from '@ziroeda/pcbnew/src/properties_panel.js';
import { pcbIUScale } from '@ziroeda/common';
import type { StatusUnits } from '../../ui/status_format.js';
import { PropertiesPanel } from '../../widgets/properties_panel.js';
import { distanceToString, stringToDistance } from '../../widgets/pg_properties.js';

export function PcbPropertiesPanel({
  rows,
  selectionCount,
  friendlyName,
  units,
  onCommand,
}: {
  rows: readonly PcbPropRow[];
  /** `SELECTION::Size()`; the caption counts anything but one. */
  selectionCount: number;
  /** `GetFriendlyName()` of the single selected item, when there is one. */
  friendlyName?: string;
  /** The frame's display units, `EDA_DRAW_FRAME::GetUserUnits()`. */
  units: StatusUnits;
  /** `BOARD_COMMIT::Push( "Edit Properties" )` — our command is the next board. */
  onCommand: (board: Board) => void;
}): JSX.Element {
  return (
    <PropertiesPanel<Board>
      selectionCount={selectionCount}
      friendlyName={friendlyName}
      rows={rows}
      /* The same PGPROPERTY_DISTANCE the schematic panel uses, at THIS frame's
         EDA_IU_SCALE — the one thing the two subclasses may differ about. */
      fmt={(iu) => distanceToString(iu, units, pcbIUScale)}
      parse={(text) => stringToDistance(text, units, pcbIUScale)}
      onCommand={onCommand}
    />
  );
}
