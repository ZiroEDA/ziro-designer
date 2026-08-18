// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_SEVERITIES` — `common/dialogs/panel_setup_severities.cpp`.
 *
 * KiCad has exactly one of these, in `common/`, and both Setup dialogs
 * instantiate it with a different rule table: Schematic Setup passes
 * `ERC_ITEM::GetItemsWithSeverities()` (dialog_schematic_setup.cpp:98) and
 * Board Setup passes `DRC_ITEM::GetItemsWithSeverities()`
 * (dialog_board_setup.cpp:243). We had two copies, and they had drifted into
 * two visibly different pages; this is the one, taking the table as a prop.
 *
 * The layout is the C++ one, not either of ours:
 *
 *  - a two-column grid, `wxFlexGridSizer( 0, 2, 0, 5 )` with `SetVGap( 5 )`
 *    (:58-60) — not a row of flex boxes;
 *  - **bold** headings, `heading->SetFont( headingFont.Bold() )` (:75), with
 *    4 px of padding all round (:83). There is no rule, no grey, no border
 *    anywhere in the panel;
 *  - a 5 px blank row before every heading *except the first* (:77-81);
 *  - each rule label indented 15 px, `wxLEFT, 15` (:87), and ending in a colon,
 *    `msg + wxT( ":" )` (:86);
 *  - the three radio buttons 30 px apart, `wxRIGHT, 30` (:104);
 *  - **no title inside the panel.** "Violation Severity" is the treebook page
 *    label (dialog_schematic_setup.cpp:100, dialog_board_setup.cpp:246), which
 *    `PagedDialog` already draws in the tree;
 *  - the whole thing scrolls vertically, `wxVSCROLL` + `SetScrollRate( 0, 5 )`
 *    (:48-52), inside 5 px of padding (:150).
 *
 * A rule whose severity is not in the map gets *no* button checked, because
 * `std::map::operator[]` default-constructs `RPT_SEVERITY_UNDEFINED` and
 * `TransferDataToWindow`'s switch falls through `default: break` (:224-232).
 * The board copy used to fall back to Error, which quietly invented a value.
 */

import type { JSX } from 'react';

import type { SetupSeverity, SeverityGroup } from './severity_items.js';

export type { SetupSeverity, SeverityGroup, SeverityItem } from './severity_items.js';
export { groupSeverityItems } from './severity_items.js';

interface Props {
  /** The rule table — ERC_ITEMS or DRC_CATEGORIES. */
  groups: readonly SeverityGroup[];
  /** Error code -> severity; a missing code leaves the row unset, as upstream. */
  severities: Readonly<Record<string, SetupSeverity | undefined>>;
  onChange: (code: string, level: SetupSeverity) => void;
  /**
   * Prefix for the radio groups' `name`. Two panels alive in one document
   * would otherwise share a group per code; upstream gets this for free from
   * `baseID + errorCode * 10 + i` (:97).
   */
  namePrefix: string;
}

/** `wxString severities[] = { _( "Error" ), _( "Warning" ), _( "Ignore" ) }` (:44). */
const LEVELS: { id: SetupSeverity; label: string }[] = [
  { id: 'error', label: 'Error' },
  { id: 'warning', label: 'Warning' },
  { id: 'ignore', label: 'Ignore' },
];

export function PanelSetupSeverities({
  groups,
  severities,
  onChange,
  namePrefix,
}: Props): JSX.Element {
  return (
    <div style={{ padding: 5, overflowY: 'auto', fontSize: 12.5 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'max-content max-content',
          alignItems: 'center',
          rowGap: 5,
          columnGap: 5,
        }}
      >
        {groups.map((group, g) => (
          <div key={group.heading} style={{ display: 'contents' }}>
            {/* `if( !firstLine ) { AddSpacer( 5 ); AddSpacer( 5 ); }` (:77-81). */}
            {g > 0 && <div style={{ gridColumn: '1 / 3', height: 5 }} />}
            <div style={{ gridColumn: '1 / 3', fontWeight: 700, padding: 4 }}>{group.heading}</div>
            {group.items.map((it) => (
              <div key={it.code} style={{ display: 'contents' }}>
                <span style={{ paddingLeft: 15 }}>{it.title}:</span>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {LEVELS.map((lv) => (
                    <label
                      key={lv.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        marginRight: 30,
                      }}
                    >
                      <input
                        type="radio"
                        name={`${namePrefix}-${it.code}`}
                        checked={severities[it.code] === lv.id}
                        onChange={() => onChange(it.code, lv.id)}
                      />
                      {lv.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
