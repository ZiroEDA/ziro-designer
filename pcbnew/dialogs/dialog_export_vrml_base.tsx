// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_EXPORT_VRML_BASE` (dialog_export_vrml_base.cpp): the sizer tree, Add() for Add().
 * The controls' values and events are props; the behaviour is DIALOG_EXPORT_VRML's
 * (dialog_export_vrml.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { CheckBox, TextCtrl } from '@ziroeda/wx/controls.js';
import {
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
import { FilePickerCtrl } from '@ziroeda/wx/filepicker.js';
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** `m_unitsChoiceChoices`. */
export const VRML_UNITS_CHOICES = [
  _HKI('mm'),
  _HKI('meter'),
  _HKI('0.1 inch'),
  _HKI('inch'),
] as const;

export interface DIALOG_EXPORT_VRML_BASE_PROPS {
  /** `m_filePicker` ("Save VRML Board File", *.wrl). */
  m_filePicker: string;
  onFilePicker: (aPath: string) => void;
  /** The picker's chooser; greyed without one. */
  onBrowse?: () => void;
  /** `m_SubdirNameCtrl` ("shapes3D"). */
  m_SubdirNameCtrl: string;
  onSubdirName: (aValue: string) => void;
  /** `m_cbUserDefinedOrigin`. */
  m_cbUserDefinedOrigin: boolean;
  onUserDefinedOrigin: (aOn: boolean) => void;
  /** `m_VRML_Xref` / `m_VRML_Yref` (SetMaxLength( 8 )) and their units labels. */
  m_VRML_Xref: string;
  onXref: (aValue: string) => void;
  m_VRML_Yref: string;
  onYref: (aValue: string) => void;
  /** `m_xUnits` / `m_yUnits`. */
  unitsLabel: string;
  /** `m_unitsChoice`: an index into VRML_UNITS_CHOICES. */
  m_unitsChoice: number;
  onUnitsChoice: (aIndex: number) => void;
  m_cbRemoveDNP: boolean;
  onRemoveDNP: (aOn: boolean) => void;
  m_cbRemoveUnspecified: boolean;
  onRemoveUnspecified: (aOn: boolean) => void;
  m_cbCopyFiles: boolean;
  onCopyFiles: (aOn: boolean) => void;
  /** Greyed while the exporter's models-dir form is not ported. */
  copyFilesEnabled?: boolean;
  m_cbUseRelativePaths: boolean;
  onUseRelativePaths: (aOn: boolean) => void;
  /** `OnUpdateUseRelativePath`: enabled only with the copy. */
  useRelativePathsEnabled: boolean;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_EXPORT_VRML_BASE(p: DIALOG_EXPORT_VRML_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('VRML Export Options')} onClose={p.onCancel}>
      {/* bSizer1 */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* bUpperSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* m_staticText1 */}
              <span>{_('File name:')}</span>
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT | wxEXPAND} border={5} minSize={[450, -1]}>
              {/* m_filePicker */}
              <FilePickerCtrl
                value={p.m_filePicker}
                onChange={p.onFilePicker}
                message={_('Save VRML Board File')}
                onBrowse={p.onBrowse}
                ariaLabel="File name"
              />
            </SizerItem>
            <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* m_staticText3 */}
              <span>{_('Footprint 3D model path:')}</span>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              {/* m_SubdirNameCtrl */}
              <TextCtrl
                value={p.m_SubdirNameCtrl}
                onChange={p.onSubdirName}
                ariaLabel="Footprint 3D model path"
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
          {/* bSizerOptions */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxALL} border={5}>
              {/* m_cbUserDefinedOrigin */}
              <CheckBox
                label={_('User defined origin')}
                checked={p.m_cbUserDefinedOrigin}
                onChange={p.onUserDefinedOrigin}
              />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={20}>
              {/* fgSizerOptions = wxFlexGridSizer( 0, 3, 3, 0 ), AddGrowableCol( 1 ) */}
              <FlexGridSizer cols={3} vgap={3} hgap={0} growableCols={[1]}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  {/* m_xLabel */}
                  <span>{_('X:')}</span>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  {/* m_VRML_Xref */}
                  <TextCtrl
                    value={p.m_VRML_Xref}
                    onChange={(v) => p.onXref(v.slice(0, 8))}
                    disabled={!p.m_cbUserDefinedOrigin}
                    ariaLabel="X"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  {/* m_xUnits */}
                  <span>{p.unitsLabel}</span>
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  {/* m_yLabel */}
                  <span>{_('Y:')}</span>
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT | wxEXPAND} border={5}>
                  {/* m_VRML_Yref */}
                  <TextCtrl
                    value={p.m_VRML_Yref}
                    onChange={(v) => p.onYref(v.slice(0, 8))}
                    disabled={!p.m_cbUserDefinedOrigin}
                    ariaLabel="Y"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  {/* m_yUnits */}
                  <span>{p.unitsLabel}</span>
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxTOP} border={5}>
              {/* bSizer7 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
                  {/* m_unitsLabel */}
                  <span>{_('Units:')}</span>
                </SizerItem>
                <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
                  {/* m_unitsChoice */}
                  <Combo
                    value={String(p.m_unitsChoice)}
                    options={VRML_UNITS_CHOICES.map((label, i) => ({ value: String(i), label }))}
                    onChange={(v) => p.onUnitsChoice(Number(v))}
                    ariaLabel="Units"
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={5}>
          {/* bLowerSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={2} flag={wxEXPAND} border={5}>
              {/* bSizer4 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox
                    label={_("Ignore 'Do not populate' components")}
                    checked={p.m_cbRemoveDNP}
                    onChange={p.onRemoveDNP}
                  />
                </SizerItem>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox
                    label={_("Ignore 'Unspecified' components")}
                    checked={p.m_cbRemoveUnspecified}
                    onChange={p.onRemoveUnspecified}
                  />
                </SizerItem>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox
                    label={_('Copy 3D model files to 3D model path')}
                    title={
                      'If checked: copy 3D models to the destination folder\n' +
                      'If not checked: Embed 3D models in the VRML board file'
                    }
                    checked={p.m_cbCopyFiles}
                    disabled={p.copyFilesEnabled === false}
                    onChange={p.onCopyFiles}
                  />
                </SizerItem>
                <SizerItem flag={wxALL} border={5}>
                  <CheckBox
                    label={_('Use relative paths to model files in board VRML file')}
                    title={_(
                      'Use paths for model files in board VRML file relative to the VRML file',
                    )}
                    checked={p.m_cbUseRelativePaths}
                    disabled={!p.useRelativePathsEnabled}
                    onChange={p.onUseRelativePaths}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <Spacer proportion={1} flag={wxEXPAND} border={5} />
      </BoxSizer>
      {/* m_sdbSizer: wxEXPAND|wxALL 5 */}
      <StdDialogButtonSizer onCancel={p.onCancel} onOk={p.onOK} />
    </DialogShim>
  );
}
