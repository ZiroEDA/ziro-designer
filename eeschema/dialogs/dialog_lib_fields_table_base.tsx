// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LIB_FIELDS_TABLE_BASE` (eeschema/dialogs/dialog_lib_fields_table_base.cpp): the sizer
 * tree, Add() for Add() - m_splitterMainWindow with the view-controls grid and its field buttons
 * on the left; the filter, scope, grouping and refresh row, the fields grid, and the sidebar
 * button with OK / Apply / Cancel on the right. The behaviour is DIALOG_LIB_FIELDS_TABLE's.
 */
import type { CSSProperties, JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { type CHECK, CheckBox, type CHOICE, Choice, StaticLine } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, SizerItem, Spacer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { SplitterWindow } from '@ziroeda/wx/splitter.js';
import { WxSearchCtrl } from '@ziroeda/wx/wx_search_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** m_choiceScope's strings. */
export const LIB_FIELDS_SCOPE_CHOICES = [_HKI('Whole Library'), _HKI('Related Symbols Only')];

export interface DIALOG_LIB_FIELDS_TABLE_BASE_PROPS {
  title: string;
  /** The window's size (SetSize in the derived constructor). */
  dialogSize: CSSProperties;

  /** m_splitterMainWindow's sash, and Unsplit( m_leftPanel ) for a collapsed sidebar. */
  sashPosition: number;
  onSashPosition: (aPos: number) => void;
  sidebarCollapsed: boolean;

  m_viewControlsGrid: ReactNode;
  onAddField: () => void;
  onRenameField: () => void;
  onRemoveField: () => void;

  m_filter: { value: string; onChange: (aText: string) => void };
  m_choiceScope: CHOICE;
  m_groupSymbolsBox: CHECK;
  onRegroupSymbols: () => void;

  m_grid: ReactNode;

  onSidebarToggle: () => void;
  onOK: () => void;
  onApply: () => void;
  onCancel: () => void;
}

export function DIALOG_LIB_FIELDS_TABLE_BASE(p: DIALOG_LIB_FIELDS_TABLE_BASE_PROPS): JSX.Element {
  const leftPanel = (
    // bLeftSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5} minSize={[-1, 250]}>
        {/* [data] m_viewControlsGrid->SetMinSize( wxSize( -1,250 ) ) */}
        {p.m_viewControlsGrid}
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
        {/* bFieldsButtons */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
            <StdBitmapButton bitmap="small_plus" title="" onClick={p.onAddField} />
          </SizerItem>
          <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
            <StdBitmapButton bitmap="small_edit" title="" onClick={p.onRenameField} />
          </SizerItem>
          <Spacer width={15} height={0} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
            <StdBitmapButton bitmap="small_trash" title="" onClick={p.onRemoveField} />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const rightPanel = (
    // bRightSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND | wxALL} border={5}>
        {/* bControls */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem
            proportion={1}
            flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
            border={5}
            minSize={[140, -1]}
          >
            {/* [data] m_filter->SetMinSize( wxSize( 140,-1 ) ); SetDescriptiveText( "Filter" ) */}
            <WxSearchCtrl
              value={p.m_filter.value}
              onChange={p.m_filter.onChange}
              descriptiveText={_('Filter')}
            />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxALL} border={3}>
            <StaticLine vertical />
          </SizerItem>
          <SizerItem flag={wxALL} border={5}>
            <Choice
              ariaLabel={_('Scope')}
              choices={LIB_FIELDS_SCOPE_CHOICES}
              choice={p.m_choiceScope}
            />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxALL} border={5}>
            <StaticLine vertical />
          </SizerItem>
          <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
            <CheckBox
              label={_('Group symbols')}
              title={_('Group symbols together based on common properties')}
              check={p.m_groupSymbolsBox}
            />
          </SizerItem>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
            <StdBitmapButton bitmap="small_refresh" title="" onClick={p.onRegroupSymbols} />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem
        proportion={1}
        flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
        border={10}
        minSize={[400, 200]}
      >
        {/* [data] m_grid->SetMinSize( wxSize( 400,200 ) ) */}
        {p.m_grid}
      </SizerItem>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bButtonsSizer */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={10}>
            {/* setSideBarButtonLook() */}
            <StdBitmapButton
              bitmap={p.sidebarCollapsed ? 'right' : 'left'}
              title={p.sidebarCollapsed ? _('Expand left panel') : _('Collapse left panel')}
              onClick={p.onSidebarToggle}
            />
          </SizerItem>
          <Spacer proportion={9} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
            {/* m_sdbSizer: OK, Apply, Cancel */}
            <StdDialogButtonSizer onOk={p.onOK} onApply={p.onApply} onCancel={p.onCancel} />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel} style={p.dialogSize}>
      {/* bMainSizer > bEditSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* wxSP_3DSASH|wxSP_LIVE_UPDATE, SetMinimumPaneSize( 200 ) */}
          <SplitterWindow
            split="vertical"
            sashPosition={p.sashPosition}
            onSashPosition={p.onSashPosition}
            minimumPaneSize={200}
            unsplit={p.sidebarCollapsed}
            window1={leftPanel}
            window2={rightPanel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
