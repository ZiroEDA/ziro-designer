// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Violation Severity.
 *
 * `DIALOG_BOARD_SETUP` does not have a severities panel of its own: it
 * instantiates the shared `PANEL_SETUP_SEVERITIES` with
 * `DRC_ITEM::GetItemsWithSeverities()` and
 * `board->GetDesignSettings().m_DRCSeverities` (dialog_board_setup.cpp:240-246).
 * This is that call, and nothing else — the panel itself lives in
 * `designer/src/dialogs/panels/`.
 *
 * `DRC_CATEGORIES` is the rule table (drc_item.cpp: Electrical / Design for
 * Manufacturing / Schematic Parity / Signal Integrity / Readability /
 * Miscellaneous), and the data model stays in `board_settings.ts` on KiCad's
 * data/UI split.
 */

import type { JSX } from 'react';

import type { DrcSeverities, DrcSeverity } from '../../board_settings.js';
import { DRC_CATEGORIES } from '../../board_settings.js';
import { PanelSetupSeverities } from '../../../../dialogs/panels/panel_setup_severities.js';

// Re-exported so panel users keep importing from the panel module.
export {
  DRC_CATEGORIES,
  defaultDrcSeverities,
  type DrcSeverities,
  type DrcSeverity,
} from '../../board_settings.js';

interface Props {
  value: DrcSeverities;
  onChange: (next: DrcSeverities) => void;
}

export function PanelPcbSeverities({ value, onChange }: Props): JSX.Element {
  return (
    <PanelSetupSeverities
      groups={DRC_CATEGORIES}
      severities={value}
      namePrefix="drc"
      onChange={(code, level) => onChange({ ...value, [code]: level as DrcSeverity })}
    />
  );
}
