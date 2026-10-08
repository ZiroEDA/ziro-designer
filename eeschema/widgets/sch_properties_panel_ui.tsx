// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_PROPERTIES_PANEL — eeschema's docked Properties pane.
 *
 * Counterpart: `eeschema/widgets/sch_properties_panel.cpp`, and it is the same
 * shape upstream is: a subclass of PROPERTIES_PANEL that supplies DATA and
 * nothing else. The widget itself — the caption, the grid, the collapsible
 * categories, the name/value split, the greyed read-only cells, the fact that
 * a value is text until its cell is activated — lives once, in
 * `widgets/properties_panel.tsx`, exactly as `common/widgets/
 * properties_panel.cpp` does; pcbnew's subclass differs from this one only in
 * which rows it hands over.
 *
 * The rows themselves come from `schPropertiesFor` in the eeschema package,
 * which mirrors the PROPERTY_MANAGER registrations at the bottom of each
 * item's .cpp; the caption comes from `schItemFriendlyName`, which mirrors
 * `EDA_ITEM::GetFriendlyName()`.
 *
 * This file used to BE the widget: it drew its own bold group labels, boxed
 * every value in an input or a select, and had no caption at all — so eeschema
 * read as a form where KiCad reads as a grid, and the panel never said what
 * kind of thing was selected.
 */

import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import type { EditCommand } from '../tools/command.js';
import { type PropRow, SCH_PROPERTIES_PANEL } from './sch_properties_panel.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import { schIUScale } from '@ziroeda/common';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { PropertiesPanel } from '@ziroeda/common/widgets/properties_panel_ui.js';
import { PGPROPERTY_DISTANCE, type PG_FRAME } from '@ziroeda/common/properties/pg_properties.js';
import { PG_UNIT_EDITOR } from '@ziroeda/common/properties/pg_editors.js';

export function SchPropertiesPanel({
  rows,
  selectionCount,
  friendlyName,
  units,
  onCommand,
  onBrowseFootprint,
}: {
  rows: PropRow[];
  /** `SELECTION::Size()`; the caption counts anything but one. */
  selectionCount: number;
  /** `GetFriendlyName()` of the single selected item, when there is one. */
  friendlyName?: string;
  /** The frame's display units, `EDA_DRAW_FRAME::GetUserUnits()`. */
  units: StatusUnits;
  onCommand: (cmd: EditCommand) => void;
  /**
   * `SCH_PROPERTIES_PANEL::createPGProperty` gives the Footprint field
   * PG_FPID_EDITOR, whose button opens FRAME_FOOTPRINT_CHOOSER
   * (pg_editors.cpp:556-586). The frame is the EDITOR's to open, so the host
   * supplies it rather than the grid knowing about footprints.
   */
  onBrowseFootprint?: (current: string, commit: (picked: string) => void) => void;
}): JSX.Element {
  // The frame a property asks: its user units and its EDA_IU_SCALE.
  const frame: PG_FRAME = { units, iuScale: schIUScale };

  return (
    <PropertiesPanel<EditCommand>
      selectionCount={selectionCount}
      friendlyName={friendlyName}
      rows={rows}
      /* A distance cell goes through PGPROPERTY_DISTANCE, and the scale it
         formats at is the FRAME's: `m_parentFrame->StringFromValue`
         (pg_properties.cpp:357). Binding it here rather than taking a
         formatter from the caller is what upstream's per-frame property does,
         and it is why eeschema cannot again be handed the message panel's
         `MessageTextFromValue` by mistake. */
      fmt={(iu) => new PGPROPERTY_DISTANCE(frame).DistanceToString(iu)}
      parse={(text) => PG_UNIT_EDITOR.GetValueFromControl(text, false, frame) ?? null}
      onCommand={onCommand}
      onBrowse={onBrowseFootprint}
    />
  );
}

/**
 * The live panel: SCH_PROPERTIES_PANEL over the frame's
 * selection tool, each edit one SCH_COMMIT. The frame is handed the panel the way
 * `EDA_DRAW_FRAME::m_propertiesPanel` holds it, so PROPERTIES_TOOL's selection and undo events
 * (`UpdateProperties`) re-read the grid; an edit re-reads it through `AfterCommit`.
 */
export function LiveSchPropertiesPanel({
  frame,
  units,
}: {
  frame: SCH_BASE_FRAME;
  units: StatusUnits;
}): JSX.Element {
  const panelRef = useRef<{ frame: SCH_BASE_FRAME; panel: SCH_PROPERTIES_PANEL } | null>(null);

  if (panelRef.current?.frame !== frame)
    panelRef.current = { frame, panel: new SCH_PROPERTIES_PANEL(frame) };

  const panel = panelRef.current.panel;
  // A new grid after UpdateData / AfterCommit: the model holds it, React only re-reads it.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    frame.SetPropertiesPanel({
      IsShownOnScreen: () => true,
      UpdateData: () => {
        panel.UpdateData();
        setVersion((v) => v + 1);
      },
    });
    panel.UpdateData();
    setVersion((v) => v + 1);

    return () => frame.SetPropertiesPanel(null);
  }, [frame, panel]);

  const pgFrame: PG_FRAME = useMemo(
    () => ({ units, iuScale: schIUScale, originTransforms: frame.GetOriginTransforms() }),
    [units, frame],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the trigger; the grid lives in the panel.
  const rows = useMemo(() => panel.GridRows(pgFrame), [panel, pgFrame, version]);

  return (
    <PropertiesPanel<() => void>
      selectionCount={panel.getSelection().length}
      friendlyName={
        panel.getSelection().length === 1 ? panel.getSelection()[0]!.GetFriendlyName() : undefined
      }
      rows={rows}
      fmt={(iu) => new PGPROPERTY_DISTANCE(pgFrame).DistanceToString(iu)}
      parse={(text) => PG_UNIT_EDITOR.GetValueFromControl(text, false, pgFrame) ?? null}
      onCommand={(edit) => {
        void Promise.resolve(edit()).then(() => setVersion((v) => v + 1));
      }}
    />
  );
}
