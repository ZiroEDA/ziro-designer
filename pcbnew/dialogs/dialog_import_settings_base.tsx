// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_IMPORT_SETTINGS_BASE` (pcbnew/dialogs/dialog_import_settings_base.cpp): the sizer tree,
 * Add() for Add(). The members are props; the behaviour is DIALOG_IMPORT_SETTINGS's
 * (dialog_import_settings.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Button, type CHECK, CheckBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER,
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_IMPORT_SETTINGS_BASE_PROPS {
  m_filePathCtrl: { value: string; onChange: (aText: string) => void };
  OnBrowseClicked: () => void;
  m_LayersOpt: CHECK;
  m_MaskAndPasteOpt: CHECK;
  m_ZoneHatchingOffsetsOpt: CHECK;
  m_TextAndGraphicsOpt: CHECK;
  m_FormattingOpt: CHECK;
  m_ConstraintsOpt: CHECK;
  m_TracksAndViasOpt: CHECK;
  m_TeardropsOpt: CHECK;
  m_TuningPatternsOpt: CHECK;
  m_NetclassesOpt: CHECK;
  m_ComponentClassesOpt: CHECK;
  m_TuningProfilesOpt: CHECK;
  m_CustomRulesOpt: CHECK;
  m_SeveritiesOpt: CHECK;
  /** `m_selectAllButton`'s label, sized for "Deselect All" by the constructor. */
  selectAllLabel: string;
  OnSelectAll: () => void;
  okEnabled: boolean;
  onOK: () => void;
  onCancel: () => void;
}

const BRL = wxBOTTOM | wxRIGHT | wxLEFT;

export function DIALOG_IMPORT_SETTINGS_BASE(p: DIALOG_IMPORT_SETTINGS_BASE_PROPS): JSX.Element {
  const opt = (aLabel: string, c: CHECK, aFlag = BRL): JSX.Element => (
    <SizerItem flag={aFlag} border={5}>
      <CheckBox label={aLabel} check={c} />
    </SizerItem>
  );

  return (
    <DialogShim title={_('Import Settings')} onClose={p.onCancel}>
      {/* m_MainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
          {/* bUpperSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
              <StaticText label={_('Import from:')} />
            </SizerItem>
            <SizerItem
              proportion={1}
              flag={wxEXPAND | wxTOP | wxBOTTOM}
              border={5}
              minSize={[300, -1]}
            >
              <TextCtrl
                value={p.m_filePathCtrl.value}
                onChange={p.m_filePathCtrl.onChange}
                ariaLabel="Import from"
                title={_(
                  'Target directory for plot files. Can be absolute or relative to the board file location.',
                )}
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
              {/* m_browseButton->SetBitmap( KiBitmapBundle( BITMAPS::small_folder ) ) */}
              <StdBitmapButton
                bitmap="small_folder"
                title={_('Browse')}
                tooltip={null}
                onClick={p.OnBrowseClicked}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
          {/* bMiddleSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={10}>
              {/* bLeftCol */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT} border={5}>
                  <StaticText label={_('Import:')} />
                </SizerItem>
                {opt(_('Board layers and physical stackup'), p.m_LayersOpt)}
                {opt(_('Solder mask/paste defaults'), p.m_MaskAndPasteOpt)}
                {opt(_('Zone hatched fill offsets'), p.m_ZoneHatchingOffsetsOpt)}
                {/* "Text && graphics": && is a literal & */}
                {opt(_('Text & graphics default properties'), p.m_TextAndGraphicsOpt)}
                {opt(_('Text & graphics formatting'), p.m_FormattingOpt)}
                {opt(_('Design rule constraints'), p.m_ConstraintsOpt)}
                {opt(_('Predefined track & via dimensions'), p.m_TracksAndViasOpt)}
                {opt(_('Teardrop defaults'), p.m_TeardropsOpt)}
                {opt(_('Length-tuning pattern defaults'), p.m_TuningPatternsOpt)}
                {opt(_('Net classes'), p.m_NetclassesOpt)}
                {opt(_('Component classes'), p.m_ComponentClassesOpt)}
                {opt(_('Tuning Profiles'), p.m_TuningProfilesOpt)}
                {opt(_('Custom rules'), p.m_CustomRulesOpt)}
                {opt(_('Violation severities'), p.m_SeveritiesOpt, wxRIGHT | wxLEFT)}
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* m_buttonsSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem
              flag={wxALIGN_CENTER | wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
              border={10}
            >
              <Button
                label={p.selectAllLabel}
                minSizeLabel={_('Deselect All')}
                onClick={p.OnSelectAll}
              />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              <StdDialogButtonSizer
                okLabel={_('Import Settings')}
                okDisabled={!p.okEnabled}
                onOk={p.onOK}
                onCancel={p.onCancel}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
