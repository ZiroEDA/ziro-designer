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

import { type JSX, useMemo, useRef } from 'react';
import type { Board } from '@ziroeda/pcbnew';
import type { PcbPropRow } from '@ziroeda/pcbnew/properties_panel.js';
import { pcbIUScale } from '@ziroeda/common';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import type { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import { boardItemOfViewId } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/board_view.js';
import { PCB_PROPERTIES_PANEL } from '@ziroeda/pcbnew/widgets/pcb_properties_panel.js';
import { PropertiesPanel } from '../../widgets/properties_panel.js';
import { PGPROPERTY_DISTANCE, type PG_FRAME } from '@ziroeda/common/properties/pg_properties.js';
import { PG_UNIT_EDITOR } from '@ziroeda/common/properties/pg_editors.js';

/**
 * The live panel (#636 stage 6): `PCB_PROPERTIES_PANEL` over the frame's
 * BOARD, each edit one BOARD_COMMIT. The selection is still the editor's view
 * ids until PCB_SELECTION_TOOL holds the items (stage 3), so it is resolved to
 * the BOARD_ITEMs here; `board` is the view the ids index, and a new one is
 * what re-reads the grid after a commit (`AfterCommit` / `UpdateData`).
 */
interface LiveProps {
  frame: PCB_BASE_EDIT_FRAME | null;
  board: Board | null;
  selection: ReadonlySet<string>;
  units: StatusUnits;
}

/** The old view-row form, until PcbEditor's call site moves to {@link LiveProps}. */
interface ViewRowProps {
  rows: readonly PcbPropRow[];
  /** `SELECTION::Size()`; the caption counts anything but one. */
  selectionCount: number;
  /** `GetFriendlyName()` of the single selected item, when there is one. */
  friendlyName?: string;
  /** The frame's display units, `EDA_DRAW_FRAME::GetUserUnits()`. */
  units: StatusUnits;
  /** `BOARD_COMMIT::Push( "Edit Properties" )` — our command is the next board. */
  onCommand: (board: Board) => void;
}

export function PcbPropertiesPanel(props: LiveProps | ViewRowProps): JSX.Element {
  return 'frame' in props ? <LivePcbPropertiesPanel {...props} /> : <ViewRowPanel {...props} />;
}

function LivePcbPropertiesPanel({ frame, board, selection, units }: LiveProps): JSX.Element {
  const panelRef = useRef<{ frame: PCB_BASE_EDIT_FRAME; panel: PCB_PROPERTIES_PANEL } | null>(null);

  if (frame && panelRef.current?.frame !== frame)
    panelRef.current = { frame, panel: new PCB_PROPERTIES_PANEL(frame) };

  const pgFrame: PG_FRAME = useMemo(
    () => ({ units, iuScale: pcbIUScale, originTransforms: frame?.GetOriginTransforms() }),
    [units, frame],
  );

  const items = useMemo<EDA_ITEM[]>(() => {
    if (!board) return [];
    const out: EDA_ITEM[] = [];
    for (const id of selection) {
      const item = boardItemOfViewId(board, id);
      if (item) out.push(item);
    }
    return out;
  }, [board, selection]);

  const panel = panelRef.current?.panel ?? null;

  // PCB_PROPERTIES_PANEL::UpdateData, on every selection or board change.
  const rows = useMemo(() => {
    if (!panel) return [];
    panel.SetSelectionProvider(() => items);
    panel.UpdateData();
    return panel.GridRows(pgFrame);
  }, [panel, items, pgFrame]);

  return (
    <PropertiesPanel<() => void>
      selectionCount={panel ? panel.getSelection().length : 0}
      friendlyName={items.length === 1 ? items[0]!.GetFriendlyName() : undefined}
      rows={rows}
      fmt={(iu) => new PGPROPERTY_DISTANCE(pgFrame).DistanceToString(iu)}
      parse={(text) => PG_UNIT_EDITOR.GetValueFromControl(text, false, pgFrame) ?? null}
      onCommand={(edit) => edit()}
    />
  );
}

function ViewRowPanel({
  rows,
  selectionCount,
  friendlyName,
  units,
  onCommand,
}: ViewRowProps): JSX.Element {
  // The frame a property asks: its user units and its EDA_IU_SCALE.
  const frame: PG_FRAME = { units, iuScale: pcbIUScale };

  return (
    <PropertiesPanel<Board>
      selectionCount={selectionCount}
      friendlyName={friendlyName}
      rows={rows}
      /* The same PGPROPERTY_DISTANCE the schematic panel uses, at THIS frame's
         EDA_IU_SCALE — the one thing the two subclasses may differ about. */
      fmt={(iu) => new PGPROPERTY_DISTANCE(frame).DistanceToString(iu)}
      parse={(text) => PG_UNIT_EDITOR.GetValueFromControl(text, false, frame) ?? null}
      onCommand={onCommand}
    />
  );
}
