// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Schematic Setup > Violation Severity.
 *
 * `DIALOG_SCHEMATIC_SETUP` does not have a severities panel of its own: it
 * instantiates the shared `PANEL_SETUP_SEVERITIES` with
 * `ERC_ITEM::GetItemsWithSeverities()` and `ercSettings.m_ERCSeverities`
 * (dialog_schematic_setup.cpp:96-100). This is that call, and nothing else —
 * the panel itself lives in `designer/src/dialogs/panels/`.
 *
 * Upstream also passes `m_pinToPinError.get()` as the pin-map special case, so
 * that one ERC item is dropped from the list and re-added at the bottom with
 * "From Pin Conflicts Map" / "Ignore" instead of the three. We do not model
 * that row yet; `ERC_ITEMS` stops above `heading_internal` and so never
 * contains it.
 */

import { useMemo, type JSX } from 'react';
import { ERC_ITEMS, type ErcSettings, type ErcSeverityLevel } from '@ziroeda/eeschema';
import { PanelSetupSeverities as SharedPanelSetupSeverities } from '../../../../dialogs/panels/panel_setup_severities.js';
import {
  groupSeverityItems,
  type SeverityGroup,
} from '../../../../dialogs/panels/severity_items.js';

interface Props {
  settings: ErcSettings;
  onChange: (next: ErcSettings) => void;
}

/**
 * `ERC_ITEM::allItemTypes` is one flat list in which a zero-code entry is a
 * heading (`heading_connections` / `_conflicts` / `_misc`); ours carries the
 * heading on each row as `group`, so fold it back into the shape the panel
 * takes, keeping upstream's order.
 */
export function ercSeverityGroups(): SeverityGroup[] {
  return groupSeverityItems(ERC_ITEMS);
}

export function PanelSetupSeverities({ settings, onChange }: Props): JSX.Element {
  const groups = useMemo(ercSeverityGroups, []);

  return (
    <SharedPanelSetupSeverities
      groups={groups}
      severities={settings.severities}
      namePrefix="erc"
      onChange={(code, level) =>
        onChange({
          ...settings,
          severities: { ...settings.severities, [code]: level as ErcSeverityLevel },
        })
      }
    />
  );
}
