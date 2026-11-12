// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_FP_PROPERTIES_3D_MODEL_BASE` (pcbnew/dialogs/panel_fp_properties_3d_model_base.cpp): the
 * sizer tree, Add() for Add(). The members are props; the behaviour is
 * PANEL_FP_PROPERTIES_3D_MODEL's (panel_fp_properties_3d_model.tsx).
 *
 * `m_buttonConfig3DPaths` ("Configure Paths...") is absent: it opens DIALOG_CONFIGURE_PATHS over
 * the environment's path variables, and the browser has no local paths to configure.
 */
import type { JSX, ReactNode } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
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
import { BoxSizer, SizerItem, Spacer, StretchSpacer } from '@ziroeda/wx/sizer.js';
import { SplitterWindow } from '@ziroeda/wx/splitter.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_FP_PROPERTIES_3D_MODEL_BASE_PROPS {
  /** `m_splitter1->GetSashPosition()`. */
  sashPosition: number;
  onSashPosition: (aPos: number) => void;
  m_modelsGrid: ReactNode;
  onAdd3DRow: () => void;
  onAdd3DModel: () => void;
  onRemove3DModel: () => void;
  removeEnabled: boolean;
  /** `m_LowerSizer3D`'s PANEL_PREVIEW_3D_MODEL. */
  m_previewPane: ReactNode;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function PANEL_FP_PROPERTIES_3D_MODEL_BASE(
  p: PANEL_FP_PROPERTIES_3D_MODEL_BASE_PROPS,
): JSX.Element {
  return (
    // bSizerMain3D
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {/* m_splitter1: wxSP_3DSASH|wxSP_LIVE_UPDATE, SetMinimumPaneSize( 112 ), split at 112 */}
        <SplitterWindow
          split="horizontal"
          sashPosition={p.sashPosition}
          onSashPosition={p.onSashPosition}
          minimumPaneSize={112}
          window1={
            // m_upperPanel > bSizer4
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
                {p.m_modelsGrid}
              </SizerItem>
              <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={2}>
                {/* bSizer3DButtons */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={CV | wxLEFT} border={5}>
                    <StdBitmapButton
                      bitmap="small_plus"
                      title={_('Add 3D model')}
                      tooltip={null}
                      onClick={p.onAdd3DRow}
                    />
                  </SizerItem>
                  <SizerItem flag={CV | wxLEFT} border={5}>
                    <StdBitmapButton
                      bitmap="small_folder"
                      title={_('Browse for 3D model')}
                      tooltip={null}
                      onClick={p.onAdd3DModel}
                    />
                  </SizerItem>
                  <Spacer width={20} height={0} border={5} />
                  <SizerItem flag={CV} border={5}>
                    <StdBitmapButton
                      bitmap="small_trash"
                      title={_('Remove 3D model')}
                      tooltip={null}
                      disabled={!p.removeEnabled}
                      onClick={p.onRemove3DModel}
                    />
                  </SizerItem>
                  <StretchSpacer />
                </BoxSizer>
              </SizerItem>
            </BoxSizer>
          }
          window2={
            // m_lowerPanel > m_LowerSizer3D
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                {p.m_previewPane}
              </SizerItem>
            </BoxSizer>
          }
        />
      </SizerItem>
    </BoxSizer>
  );
}
