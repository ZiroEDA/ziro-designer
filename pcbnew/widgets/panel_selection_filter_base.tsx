// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SELECTION_FILTER_BASE` (pcbnew/widgets/panel_selection_filter_base.cpp): the selection
 * filter's checkboxes in a two-column wxGridBagSizer, Add() for Add(). The behaviour is
 * PANEL_SELECTION_FILTER's (panel_selection_filter.tsx).
 */
import type { JSX } from 'react';
import { type CHECK, CheckBox } from '@ziroeda/wx/controls.js';
import { wxBOTTOM, wxLEFT, wxRIGHT, wxTOP } from '@ziroeda/wx/defs.js';
import { GridBagSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A filter checkbox and its right click. */
export type FILTER_CHECK = CHECK & { onRightClick?: (aX: number, aY: number) => void };

export interface PANEL_SELECTION_FILTER_BASE_PROPS {
  m_cbAllItems: FILTER_CHECK;
  m_cbLockedItems: FILTER_CHECK;
  m_cbFootprints: FILTER_CHECK;
  m_cbText: FILTER_CHECK;
  m_cbTracks: FILTER_CHECK;
  m_cbVias: FILTER_CHECK;
  m_cbPads: FILTER_CHECK;
  m_cbGraphics: FILTER_CHECK;
  m_cbZones: FILTER_CHECK;
  m_cbKeepouts: FILTER_CHECK;
  m_cbDimensions: FILTER_CHECK;
  m_cbPoints: FILTER_CHECK;
  m_cbOtherItems: FILTER_CHECK;
}

export function PANEL_SELECTION_FILTER_BASE(p: PANEL_SELECTION_FILTER_BASE_PROPS): JSX.Element {
  const cb = (
    aRow: number,
    aCol: number,
    aLabel: string,
    c: FILTER_CHECK,
    aFlag = wxLEFT | wxRIGHT,
    aTip?: string,
  ) => (
    <SizerItem pos={[aRow, aCol]} flag={aFlag} border={5}>
      <CheckBox label={aLabel} title={aTip} check={c} onContextMenu={c.onRightClick} />
    </SizerItem>
  );

  return (
    // gbSizer1 = wxGridBagSizer( 0, 0 )
    <GridBagSizer>
      {cb(0, 0, _('All items'), p.m_cbAllItems, wxLEFT | wxTOP)}
      {cb(
        0,
        1,
        _('Locked items'),
        p.m_cbLockedItems,
        wxLEFT | wxRIGHT | wxTOP,
        _('Allow selection of locked items'),
      )}
      {cb(1, 0, _('Footprints'), p.m_cbFootprints)}
      {cb(1, 1, _('Text'), p.m_cbText)}
      {cb(2, 0, _('Tracks'), p.m_cbTracks)}
      {cb(2, 1, _('Vias'), p.m_cbVias)}
      {cb(3, 0, _('Pads'), p.m_cbPads)}
      {cb(3, 1, _('Graphics'), p.m_cbGraphics)}
      {cb(4, 0, _('Zones'), p.m_cbZones)}
      {cb(4, 1, _('Rule Areas'), p.m_cbKeepouts)}
      {cb(5, 0, _('Dimensions'), p.m_cbDimensions)}
      {cb(6, 0, _('Points'), p.m_cbPoints, wxBOTTOM | wxLEFT | wxRIGHT)}
      {cb(5, 1, _('Other items'), p.m_cbOtherItems)}
    </GridBagSizer>
  );
}
