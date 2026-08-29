// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint drop-down of the symbol chooser. Mirrors
 * kicad/common/widgets/footprint_select_widget.cpp
 * (FOOTPRINT_SELECT_WIDGET): the default footprint entry at the top,
 * "[Default] <fp>" or "No default footprint", followed by the hosted-library
 * footprints matching the symbol's fp_filters (FOOTPRINT_FILTER results,
 * capped like upstream's m_max_items).
 *
 * The control itself is a `FOOTPRINT_CHOICE`, not a `wxChoice`
 * (`footprint_select_widget.cpp:40`):
 *
 *     m_fp_sel_ctrl = new FOOTPRINT_CHOICE( this, wxID_ANY );
 *
 * which is what gives the rows their dim library prefix. This file is only the
 * thing that fills it.
 */
import type { JSX } from 'react';
import { FootprintChoice } from './footprint_choice.js';
import type { OwnerDrawnItem } from '../ui/OwnerDrawnCombo.js';

export interface FootprintSelectWidgetProps {
  /** The symbol's default footprint LIB_ID text ('' = none). */
  defaultFootprint: string;
  /** Filter matches from the footprint list ("Lib:Name" ids). */
  items?: readonly string[];
  /** Currently selected footprint ('' = the default entry). */
  value: string;
  disabled?: boolean;
  /** EVT_FOOTPRINT_SELECTED, the user picked an entry. */
  onFootprintSelected: (footprint: string) => void;
}

/**
 * `FOOTPRINT_SELECT_WIDGET::UpdateList` (`footprint_select_widget.cpp:111-178`).
 *
 *     // Add the default footprint entry at the top
 *     wxString defaultLabel = m_default_footprint.IsEmpty()
 *                                     ? _( "No default footprint" )
 *                                     : wxS( "[" ) + _( "Default" ) + wxS( "] " ) + m_default_footprint;
 *
 *     m_fp_sel_ctrl->Append( defaultLabel, new wxStringClientData( m_default_footprint ) );
 *     ...
 *     m_fp_sel_ctrl->Append( fpName, new wxStringClientData( fpName ) );
 *
 * The default row is the one place where the label and the client data differ,
 * and `FOOTPRINT_CHOICE::OnDrawItem` is written around exactly that: it looks
 * for the client data's library fragment *inside* the label, so "[Default] "
 * stays bright and "TerminalBlock:" goes dim.
 *
 * Exported so the list can be pinned without a DOM.
 */
export function footprintChoiceItems(
  defaultFootprint: string,
  items: readonly string[],
): OwnerDrawnItem[] {
  const defaultLabel = defaultFootprint ? `[Default] ${defaultFootprint}` : 'No default footprint';

  return [
    { label: defaultLabel, value: defaultFootprint },
    // The list is appended as the filter returns it; upstream only
    // deduplicates the always-included footprints, not the default.
    ...items.map((fp) => ({ label: fp, value: fp })),
  ];
}

export function FootprintSelectWidget({
  defaultFootprint,
  items = [],
  value,
  disabled = false,
  onFootprintSelected,
}: FootprintSelectWidgetProps): JSX.Element {
  return (
    <FootprintChoice
      items={footprintChoiceItems(defaultFootprint, items)}
      value={value}
      disabled={disabled}
      ariaLabel="Footprint"
      onChange={onFootprintSelected}
    />
  );
}
