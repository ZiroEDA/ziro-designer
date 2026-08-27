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

import type { JSX } from 'react';
import type { EditCommand, PropRow } from '@ziroeda/eeschema';
import { PropertiesPanel } from '../../../widgets/properties_panel.js';

export function SchPropertiesPanel({
  rows,
  selectionCount,
  friendlyName,
  fmt,
  parse,
  onCommand,
}: {
  rows: PropRow[];
  /** `SELECTION::Size()`; the caption counts anything but one. */
  selectionCount: number;
  /** `GetFriendlyName()` of the single selected item, when there is one. */
  friendlyName?: string;
  fmt: (iu: number) => string;
  parse: (text: string) => number | null;
  onCommand: (cmd: EditCommand) => void;
}): JSX.Element {
  return (
    <PropertiesPanel<EditCommand>
      selectionCount={selectionCount}
      friendlyName={friendlyName}
      rows={rows}
      fmt={fmt}
      parse={parse}
      onCommand={onCommand}
    />
  );
}
