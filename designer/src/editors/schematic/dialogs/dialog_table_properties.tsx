// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table properties, eeschema's half.
 * Counterpart: `DIALOG_TABLE_PROPERTIES`
 * (eeschema/dialogs/dialog_table_properties.cpp).
 *
 * The dialog itself is `ui/DialogTableProperties.tsx`, shared with pcbnew; what
 * is left here is the two things that are this editor's own — the schematic IU
 * scale, and the stroke colour a `SCH_TABLE` carries and a `PCB_TABLE` does not.
 *
 * The decisions live in `eeschema/src/tools/sch_table_properties.ts`: which
 * controls are live, what a switched-off line stores, how a stored style maps
 * to the combo.
 */

import type { JSX } from 'react';
import { schIUScale } from '@ziroeda/common/src/eda_units.js';
import {
  borderControlsEnabled,
  separatorControlsEnabled,
  type SchTableValues,
} from '@ziroeda/eeschema/src/tools/sch_table_properties.js';
import { ColorSwatch } from '../../../ui/ColorSwatch.js';
import { DialogTableProperties as SharedTableDialog } from '../../../ui/DialogTableProperties.js';
// A TableColor is the same [r, g, b, a] tuple an ItemColor is, so it takes
// the same conversion rather than a second copy of it.
import { color4dToItemColor, itemColorToColor4d } from './item_color.js';

interface Props {
  initial: SchTableValues;
  /** The table's own column widths in IU; the grid keeps their proportions. */
  columnWidths?: readonly number[];
  /** A new table is discarded on Cancel, not reverted. */
  isNew?: boolean;
  onOk: (v: SchTableValues) => void;
  onCancel: () => void;
}

export function DialogTableProperties({
  initial,
  columnWidths,
  isNew,
  onOk,
  onCancel,
}: Props): JSX.Element {
  return (
    <SharedTableDialog<SchTableValues>
      initial={initial}
      iuScale={schIUScale}
      {...(columnWidths ? { columnWidths } : {})}
      {...(isNew ? { isNew } : {})}
      borderEnabled={borderControlsEnabled}
      separatorEnabled={separatorControlsEnabled}
      // COLOR_SWATCH: it draws the colour and opens DIALOG_COLOR_PICKER
      // (color_swatch.cpp:301-328). It was an <input type="color">, i.e. the
      // desktop's picker as a popup anchored to the control — off-screen near
      // the window edge, and unable to carry alpha.
      renderColor={(key, enabled, v, set) => (
        <label className="row ze-tableprops-field">
          <span className="ze-tableprops-lbl">Color:</span>
          <ColorSwatch
            label="Color"
            disabled={!enabled}
            color={itemColorToColor4d(v[key])}
            onChange={(c) => set({ [key]: color4dToItemColor(c) } as Partial<SchTableValues>)}
          />
        </label>
      )}
      onOk={onOk}
      onCancel={onCancel}
    />
  );
}
