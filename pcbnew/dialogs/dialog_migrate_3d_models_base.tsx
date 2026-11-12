// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_MIGRATE_3D_MODELS_BASE` (pcbnew/dialogs/dialog_migrate_3d_models_base.cpp): the
 * missing references on the left, the candidates and a preview in an inner splitter on the
 * right, and Replace Models / Keep Existing under them.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Button, ListCtrl, Panel, StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALL,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { SplitterWindow } from '@ziroeda/wx/splitter.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_MIGRATE_3D_MODELS_BASE_PROPS {
  m_missingList: {
    rows: readonly string[];
    selection: number;
    bold: readonly number[];
    onSelect: (aRow: number) => void;
  };
  m_candidatesList: {
    rows: readonly string[];
    selection: number;
    onSelect: (aRow: number) => void;
  };
  OnAddSearchDirectoryClick: () => void;
  OnOpenExternalFileClick: () => void;
  /** The EDA_3D_CANVAS the class adds to m_previewPanel's sizer. */
  m_previewPane: ReactNode;
  m_mainSashPosition: number;
  onMainSash: (aPos: number) => void;
  m_innerSashPosition: number;
  onInnerSash: (aPos: number) => void;
  OnReplaceClick: () => void;
  OnKeepClick: () => void;
}

/** The single column the class appends; wxLC_NO_HEADER. Its width is the list's. */
const COLUMN = [800];

export function DIALOG_MIGRATE_3D_MODELS_BASE(p: DIALOG_MIGRATE_3D_MODELS_BASE_PROPS): JSX.Element {
  return (
    // wxDEFAULT_DIALOG_STYLE|wxRESIZE_BORDER, wxSize( 900,600 )
    <DialogShim
      title={_('Migrate 3D Models')}
      resizable
      style={{ width: 900, height: 600 }} // [data] the base constructor's wxSize( 900,600 )
      onClose={p.OnKeepClick}
    >
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL} border={8}>
          <StaticText
            label={_(
              'This board references 3D models that are no longer present on your system.\nSelect replacements below, or keep the existing references.',
            )}
          />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={4}>
          <SplitterWindow
            split="vertical"
            sashPosition={p.m_mainSashPosition}
            onSashPosition={p.onMainSash}
            minimumPaneSize={120}
            window1={
              <Panel>
                {/* bSizerMissing */}
                <BoxSizer orient={wxVERTICAL}>
                  <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={4}>
                    <StaticText label={_('Missing 3D model references:')} />
                  </SizerItem>
                  <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={4}>
                    <ListCtrl
                      ariaLabel={_('Missing 3D model references')}
                      rows={p.m_missingList.rows.map((r) => [r])}
                      columnWidths={COLUMN}
                      selection={p.m_missingList.selection}
                      onSelect={p.m_missingList.onSelect}
                      boldRows={p.m_missingList.bold}
                    />
                  </SizerItem>
                </BoxSizer>
              </Panel>
            }
            window2={
              <SplitterWindow
                split="vertical"
                sashPosition={p.m_innerSashPosition}
                onSashPosition={p.onInnerSash}
                minimumPaneSize={120}
                window1={
                  <Panel>
                    {/* bSizerCandidates */}
                    <BoxSizer orient={wxVERTICAL}>
                      <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={4}>
                        <StaticText label={_('Potential replacements:')} />
                      </SizerItem>
                      <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={4}>
                        <ListCtrl
                          ariaLabel={_('Potential replacements')}
                          rows={p.m_candidatesList.rows.map((r) => [r])}
                          columnWidths={COLUMN}
                          selection={p.m_candidatesList.selection}
                          onSelect={p.m_candidatesList.onSelect}
                        />
                      </SizerItem>
                      <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={2}>
                        {/* bSizerCandidateButtons */}
                        <BoxSizer orient={wxHORIZONTAL}>
                          <SizerItem proportion={1} flag={wxALL} border={2}>
                            <Button
                              label={_('Add Search Directory...')}
                              onClick={p.OnAddSearchDirectoryClick}
                            />
                          </SizerItem>
                          <SizerItem proportion={1} flag={wxALL} border={2}>
                            <Button
                              label={_('Open External File...')}
                              onClick={p.OnOpenExternalFileClick}
                            />
                          </SizerItem>
                        </BoxSizer>
                      </SizerItem>
                    </BoxSizer>
                  </Panel>
                }
                window2={
                  <Panel>
                    {/* bSizerPreview */}
                    <BoxSizer orient={wxVERTICAL}>
                      <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={4}>
                        <StaticText label={_('Preview:')} />
                      </SizerItem>
                      <SizerItem proportion={1} flag={wxEXPAND} border={0}>
                        {p.m_previewPane}
                      </SizerItem>
                    </BoxSizer>
                  </Panel>
                }
              />
            }
          />
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={0}>
          {/* bSizerBottom */}
          <BoxSizer orient={wxHORIZONTAL}>
            <Spacer proportion={1} flag={wxEXPAND} />
            <SizerItem flag={wxALL} border={6}>
              <Button label={_('Replace Models')} onClick={p.OnReplaceClick} />
            </SizerItem>
            <SizerItem flag={wxALL} border={6}>
              <Button label={_('Keep Existing')} onClick={p.OnKeepClick} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
