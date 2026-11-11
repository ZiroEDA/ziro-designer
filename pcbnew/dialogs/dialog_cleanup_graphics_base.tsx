// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_CLEANUP_GRAPHICS_BASE` (pcbnew/dialogs/dialog_cleanup_graphics_base.cpp): the sizer tree,
 * Add() for Add(). The members are props; the behaviour is DIALOG_CLEANUP_GRAPHICS's
 * (dialog_cleanup_graphics.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { RC_TREE_MODEL, RC_TREE_NODE, RC_TREE_VIEW_STATE } from '@ziroeda/common/rc_item.js';
import { RcTreeView } from '@ziroeda/common/widgets/rc_tree_view.js';
import { type CHECK, CheckBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_CLEANUP_GRAPHICS_BASE_PROPS {
  m_createRectanglesOpt: CHECK;
  m_deleteRedundantOpt: CHECK;
  m_mergePadsOpt: CHECK;
  /** `m_mergePadsOpt->Show()` and `m_nettieHint->Show()`: the footprint editor's. */
  mergePadsShown: boolean;
  m_fixBoardOutlines: CHECK;
  /** `m_fixBoardOutlines->Show()` and `m_toleranceSizer->Show()`: the board editor's. */
  boardOutlinesShown: boolean;
  /** `m_tolerance`, a UNIT_BINDER over m_toleranceCtrl. */
  m_tolerance: {
    label: string;
    value: string;
    units: string;
    onChange: (aText: string) => void;
    onBlur: () => void;
  };
  m_changesTreeModel: RC_TREE_MODEL;
  m_changesView: RC_TREE_VIEW_STATE;
  OnSelectItem: (aNode: RC_TREE_NODE) => void;
  okLabel: string;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_CLEANUP_GRAPHICS_BASE(p: DIALOG_CLEANUP_GRAPHICS_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Cleanup Graphics')} onClose={p.onCancel}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          {/* bSizerUpper */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxALL} border={5}>
              <CheckBox label={_('Merge lines into rectangles')} check={p.m_createRectanglesOpt} />
            </SizerItem>
            <SizerItem flag={wxALL} border={5}>
              <CheckBox label={_('Delete redundant graphics')} check={p.m_deleteRedundantOpt} />
            </SizerItem>
            <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5} shown={p.mergePadsShown}>
              <CheckBox
                label={_('Merge overlapping graphics into pads')}
                check={p.m_mergePadsOpt}
              />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={3} shown={p.mergePadsShown}>
              {/* bSizerMargins */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxLEFT} border={25}>
                  {/* SetFont( KIUI::GetInfoFont( aParent ).Italic() ) */}
                  <StaticText
                    label={_(
                      '(Pads which appear in a Net Tie pad group will not be considered for merging.)',
                    )}
                    font="info"
                    italic
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxALL} border={5} shown={p.boardOutlinesShown}>
              <CheckBox
                label={_('Fix discontinuities in board outlines')}
                check={p.m_fixBoardOutlines}
              />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5} shown={p.boardOutlinesShown}>
              {/* m_toleranceSizer */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={25}>
                  <StaticText label={p.m_tolerance.label} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <TextCtrl
                    value={p.m_tolerance.value}
                    onChange={p.m_tolerance.onChange}
                    onBlur={p.m_tolerance.onBlur}
                    ariaLabel="Tolerance"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  <StaticText label={p.m_tolerance.units} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem
          proportion={1}
          flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT}
          border={5}
          minSize={[660, 250]}
        >
          {/* bLowerSizer, SetMinSize( wxSize( 660,250 ) ) */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={_('Changes to be applied:')} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              <RcTreeView
                model={p.m_changesTreeModel}
                view={p.m_changesView}
                onSelect={p.OnSelectItem}
                testId="cleanupgfx-changes"
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={5}>
          <StdDialogButtonSizer okLabel={p.okLabel} onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
