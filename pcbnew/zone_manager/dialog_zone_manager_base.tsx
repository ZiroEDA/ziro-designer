// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ZONE_MANAGER_BASE` (pcbnew/zone_manager/dialog_zone_manager_base.cpp): the sizer tree,
 * Add() for Add(). The overview, the properties panel and the preview notebook the derived class
 * Add()s to m_sizerProperties / m_sizerPreview are handed in; the behaviour is
 * DIALOG_ZONE_MANAGER's (dialog_zone_manager.tsx).
 */
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import {
  Button,
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  StaticLine,
  StaticText,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { WxSearchCtrl } from '@ziroeda/wx/wx_search_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

export interface DIALOG_ZONE_MANAGER_BASE_PROPS {
  m_filterCtrl: { value: string; onChange: (aText: string) => void; onCancel: () => void };
  m_checkName: CHECK;
  m_checkNet: CHECK;
  m_layerFilter: CHOICE & { choices: readonly string[] };
  m_viewZonesOverview: ReactNode;
  moveEnabled: boolean;
  onMoveTop: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveBottom: () => void;
  onAutoAssign: () => void;
  /** m_sizerProperties' PANEL_ZONE_PROPERTIES. */
  m_sizerProperties: ReactNode;
  /** m_sizerPreview's ZONE_PREVIEW_NOTEBOOK. */
  m_sizerPreview: ReactNode;
  m_checkRepour: CHECK;
  onUpdateDisplayedZones: () => void;
  /** `OnDialogCharHook`. */
  onCharHook: (aEvent: KeyboardEvent<HTMLDivElement>) => void;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;
const PRIORITY_TIP = _HKI(
  'Top zone has the highest priority. When a zone is inside another zone, if its priority is higher, its outlines are removed from the other zone.',
);

export function DIALOG_ZONE_MANAGER_BASE(p: DIALOG_ZONE_MANAGER_BASE_PROPS): JSX.Element {
  const move = (aBitmap: string, aTitle: string, aClick: () => void) => (
    <SizerItem flag={CV | wxRIGHT} border={5}>
      <StdBitmapButton
        bitmap={aBitmap}
        title={aTitle}
        tooltip={PRIORITY_TIP}
        disabled={!p.moveEnabled}
        onClick={aClick}
      />
    </SizerItem>
  );

  return (
    <DialogShim title={_('Zone Manager')} onClose={p.onCancel} onCharHook={p.onCharHook}>
      {/* m_MainBoxSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* m_sizerTop */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* m_listPanel > listPanelSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                  {/* m_leftColumn */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
                      {/* searchSizer */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem proportion={1} flag={CV} border={1}>
                          <WxSearchCtrl
                            value={p.m_filterCtrl.value}
                            onChange={p.m_filterCtrl.onChange}
                            onCancel={p.m_filterCtrl.onCancel}
                            ariaLabel={_('Filter')}
                          />
                        </SizerItem>
                        <Spacer width={10} height={0} flag={wxEXPAND} border={5} />
                        <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
                          <CheckBox label={_('Name')} check={p.m_checkName} />
                        </SizerItem>
                        <SizerItem flag={CV} border={5}>
                          <CheckBox label={_('Net')} check={p.m_checkNet} />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
                      {/* layerFilterSizer */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={CV | wxRIGHT} border={5}>
                          <StaticText label={_('Layer:')} />
                        </SizerItem>
                        <SizerItem proportion={1} flag={CV}>
                          <Choice
                            choices={p.m_layerFilter.choices}
                            choice={p.m_layerFilter}
                            ariaLabel="Layer"
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {p.m_viewZonesOverview}
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
                      {/* m_sizerZoneOP */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        {move('small_top', 'Move to top', p.onMoveTop)}
                        {move('small_up', _('Move up'), p.onMoveUp)}
                        {move('small_down', _('Move down'), p.onMoveDown)}
                        {move('small_bottom', 'Move to bottom', p.onMoveBottom)}
                        <Spacer width={10} height={0} flag={wxEXPAND} border={5} />
                        <SizerItem flag={CV | wxRIGHT} border={5}>
                          <StdBitmapButton
                            bitmap="small_sort_desc"
                            title="Auto-assign priorities"
                            tooltip={_(
                              'Automatically assign zone priorities based on connectivity analysis of overlapping regions.',
                            )}
                            disabled={!p.moveEnabled}
                            onClick={p.onAutoAssign}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={2} flag={wxEXPAND} border={5}>
              {/* m_zonePanel > zonePanelSizer > m_rightColumn */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* m_sizerProperties: Add( m_panelZoneProperties, 1, wxEXPAND, 5 ) */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {p.m_sizerProperties}
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* m_sizerPreview: Add( m_zonePreviewNotebook, 1, wxBOTTOM | wxLEFT | wxRIGHT | wxEXPAND, 5 ) */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem
                      proportion={1}
                      flag={wxBOTTOM | wxLEFT | wxRIGHT | wxEXPAND}
                      border={5}
                    >
                      {p.m_sizerPreview}
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          <StaticLine />
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
          {/* m_sizerBottom */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV | wxLEFT} border={5}>
              <CheckBox
                label={_('Refill zones')}
                check={p.m_checkRepour}
                title={_('Refill zones after changes made on board')}
              />
            </SizerItem>
            <Spacer width={100} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={CV | wxRIGHT} border={5}>
              <Button
                label={_('Update Displayed Zones')}
                title={_(
                  'Update filled areas shown in dialog, according to the new current settings',
                )}
                onClick={p.onUpdateDisplayedZones}
              />
            </SizerItem>
            <SizerItem flag={CV} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
