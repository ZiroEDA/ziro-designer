// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SYMBOL_FIELDS_TABLE_BASE` (eeschema/dialogs/dialog_symbol_fields_table_base.cpp): the
 * sizer tree, Add() for Add() - m_splitterMainWindow with the left panel (m_splitter_left: the
 * view-controls grid, its buttons and the view presets over the variants panel) and the right
 * panel (the Edit / Export notebook over the button row). The behaviour is
 * DIALOG_SYMBOL_FIELDS_TABLE's.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import {
  Button,
  type CHECK,
  CheckBox,
  type CHOICE,
  Choice,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_BOTTOM,
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
import { Notebook } from '@ziroeda/wx/notebook_ui.js';
import {
  BoxSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { SplitterWindow } from '@ziroeda/wx/splitter.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A wxTextCtrl's text and its handler. */
export interface ENTRY {
  value: string;
  onChange: (aText: string) => void;
}

/** A preset wxChoice: the shown names (with the "(unsaved)" / save / delete rows) and the pick. */
export interface PRESET_CHOICE {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (aValue: string) => void;
}

export interface DIALOG_SYMBOL_FIELDS_TABLE_BASE_PROPS {
  /** The size the dialog's constructor states with `SetSize` (dialog_symbol_fields_table.cpp:316). */
  dialogSize: { width: number; height: number };
  /** m_splitterMainWindow: the sash, and Unsplit( m_leftPanel ) when the sidebar is collapsed. */
  sashPosition: number;
  onSashPosition: (aPos: number) => void;
  sidebarCollapsed: boolean;
  /** m_splitter_left: the view controls over the variants panel. */
  variantSashPosition: number;
  onVariantSashPosition: (aPos: number) => void;
  m_viewControlsGrid: ReactNode;
  onAddField: () => void;
  onRenameField: () => void;
  onRemoveField: () => void;
  m_cbBomPresets: PRESET_CHOICE;
  /** The notebook: 0 Edit, 1 Export. */
  page: number;
  onPageChanged: (aPage: number) => void;
  m_filter: ENTRY;
  scopeChoices: readonly string[];
  m_scope: CHOICE;
  m_groupSymbolsBox: CHECK;
  onRegroupSymbols: () => void;
  onMenu: () => void;
  /** The popup m_bMenu opens, while it is open. */
  menu: ReactNode;
  m_grid: ReactNode;
  m_textFieldDelimiter: ENTRY;
  m_textStringDelimiter: ENTRY;
  m_textRefDelimiter: ENTRY;
  m_textRefRangeDelimiter: ENTRY;
  m_checkKeepTabs: CHECK;
  m_checkKeepLineBreaks: CHECK;
  m_cbBomFmtPresets: PRESET_CHOICE;
  m_outputFileName: ENTRY & { hint: string };
  /** Absent: no browse button (see the window's saveFileDialog). */
  onBrowse?: () => void;
  onRefreshPreview: () => void;
  m_textOutput: string;
  onSidebarToggle: () => void;
  /** The status text DIALOG_SYMBOL_FIELDS_TABLE writes after an export or a save. */
  status: string;
  onExport: () => void;
  onApply: () => void;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_SYMBOL_FIELDS_TABLE_BASE(
  p: DIALOG_SYMBOL_FIELDS_TABLE_BASE_PROPS,
): JSX.Element {
  const entry = (e: ENTRY, aLabel: string, aTitle?: string) => (
    <TextCtrl value={e.value} onChange={e.onChange} ariaLabel={aLabel} title={aTitle} />
  );
  const noop = (): void => {};

  const viewControlsPanel = (
    // bViewControlsSizer > bMargins
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem proportion={1} flag={wxEXPAND} border={5} minSize={[-1, 250]}>
            {p.m_viewControlsGrid}
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP} border={5}>
            {/* bFieldsButtons */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                <StdBitmapButton
                  bitmap="small_plus"
                  title={_('Add a new field')}
                  onClick={p.onAddField}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                <StdBitmapButton
                  bitmap="small_edit"
                  title={_('Rename selected field')}
                  onClick={p.onRenameField}
                />
              </SizerItem>
              <Spacer width={15} height={0} flag={wxEXPAND} border={5} />
              <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                <StdBitmapButton
                  bitmap="small_trash"
                  title={_('Remove selected field')}
                  onClick={p.onRemoveField}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
            {/* bPresets */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                <StaticLine />
              </SizerItem>
              <SizerItem flag={wxLEFT} border={5}>
                <StaticText label={_('View presets:')} />
              </SizerItem>
              <Spacer width={0} height={2} border={5} />
              <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                <Combo
                  ariaLabel="View presets"
                  value={p.m_cbBomPresets.value}
                  options={p.m_cbBomPresets.options}
                  onChange={p.m_cbBomPresets.onChange}
                />
              </SizerItem>
              <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const variantsPanel = (
    // bVariantsSizer > bMargins2. Greyed: schematic variants are not modelled yet.
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM} border={3}>
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxTOP | wxBOTTOM | wxLEFT} border={2}>
            <StaticText label={_('Schematic variants:')} disabled />
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={2}>
            {/* m_variantListBox: wxListBox, empty */}
            <div
              className="ze-gridlist"
              role="listbox"
              aria-label="Schematic variants"
              aria-disabled="true"
            />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP | wxLEFT} border={2}>
            {/* bSizer14 */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <StdBitmapButton
                  bitmap="small_plus"
                  title="Add variant"
                  tooltip={null}
                  disabled
                  onClick={noop}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM} border={5}>
                <StdBitmapButton
                  bitmap="small_edit"
                  title="Rename variant"
                  tooltip={null}
                  disabled
                  onClick={noop}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                <StdBitmapButton
                  bitmap="copy"
                  title="Copy variant"
                  tooltip={null}
                  disabled
                  onClick={noop}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                <StdBitmapButton
                  bitmap="text"
                  title="Edit variant description"
                  tooltip={null}
                  disabled
                  onClick={noop}
                />
              </SizerItem>
              <Spacer width={20} height={0} border={5} />
              <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                <StdBitmapButton
                  bitmap="small_trash"
                  title="Delete variant"
                  tooltip={null}
                  disabled
                  onClick={noop}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const editPage = (
    // bEditSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND | wxLEFT | wxTOP} border={5}>
        {/* bControls */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem
            proportion={1}
            flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
            border={5}
            minSize={[240, -1]}
          >
            {/* m_filter: wxSearchCtrl */}
            <TextCtrl
              value={p.m_filter.value}
              onChange={p.m_filter.onChange}
              hint={_('Filter')}
              ariaLabel={_('Filter')}
            />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxALL} border={3}>
            <StaticLine vertical />
          </SizerItem>
          <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
            <Choice ariaLabel={_('Scope')} choices={p.scopeChoices} choice={p.m_scope} />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxALL} border={5}>
            <StaticLine vertical />
          </SizerItem>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={8}>
            <CheckBox
              label={_('Group symbols')}
              title={_('Group symbols together based on common properties')}
              check={p.m_groupSymbolsBox}
            />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT} border={3}>
            <StaticLine vertical />
          </SizerItem>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
            <StdBitmapButton
              bitmap="small_refresh"
              title="Regroup symbols"
              onClick={p.onRegroupSymbols}
            />
          </SizerItem>
          <SizerItem flag={wxRIGHT | wxALIGN_CENTER_VERTICAL} border={5}>
            <StdBitmapButton bitmap="config" title="Options" onClick={p.onMenu} />
            {p.menu}
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem
        proportion={1}
        flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP}
        border={5}
        minSize={[400, 200]}
      >
        {p.m_grid}
      </SizerItem>
    </BoxSizer>
  );

  const exportPage = (
    // gbExport = wxGridBagSizer( 0, 5 ), AddGrowableCol( 1 ), AddGrowableRow( 3 )
    <GridBagSizer vgap={0} hgap={5} growableCols={[1]} growableRows={[3]}>
      <SizerItem pos={[0, 0]} span={[3, 1]} flag={wxEXPAND | wxALL} border={5}>
        {/* gbExportOptions = wxGridBagSizer( 4, 5 ) */}
        <GridBagSizer vgap={4} hgap={5}>
          <SizerItem pos={[0, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
            <StaticText label={_('Field delimiter:')} />
          </SizerItem>
          <SizerItem
            pos={[0, 1]}
            span={[1, 1]}
            flag={wxALIGN_CENTER_VERTICAL}
            border={5}
            minSize={[60, -1]}
          >
            {entry(p.m_textFieldDelimiter, 'Field delimiter')}
          </SizerItem>
          <SizerItem pos={[1, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
            <StaticText label={_('String delimiter:')} />
          </SizerItem>
          <SizerItem
            pos={[1, 1]}
            span={[1, 1]}
            flag={wxALIGN_CENTER_VERTICAL}
            border={5}
            minSize={[60, -1]}
          >
            {entry(p.m_textStringDelimiter, 'String delimiter')}
          </SizerItem>
          <SizerItem pos={[2, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
            <StaticText label={_('Reference delimiter:')} />
          </SizerItem>
          <SizerItem
            pos={[2, 1]}
            span={[1, 1]}
            flag={wxALIGN_CENTER_VERTICAL}
            border={5}
            minSize={[60, -1]}
          >
            {entry(p.m_textRefDelimiter, 'Reference delimiter')}
          </SizerItem>
          <SizerItem pos={[3, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
            <StaticText label={_('Range delimiter:')} />
          </SizerItem>
          <SizerItem
            pos={[3, 1]}
            span={[1, 1]}
            flag={wxALIGN_CENTER_VERTICAL}
            border={5}
            minSize={[60, -1]}
          >
            {entry(
              p.m_textRefRangeDelimiter,
              'Range delimiter',
              _('Leave blank to disable ranges.'),
            )}
          </SizerItem>
          <SizerItem pos={[4, 0]} span={[1, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
            <CheckBox label={_('Keep tabs')} check={p.m_checkKeepTabs} />
          </SizerItem>
          <SizerItem pos={[5, 0]} span={[1, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
            <CheckBox label={_('Keep line breaks')} check={p.m_checkKeepLineBreaks} />
          </SizerItem>
          <SizerItem pos={[7, 0]} span={[1, 2]} flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
            <StaticLine />
          </SizerItem>
          <SizerItem pos={[8, 0]} span={[1, 2]} flag={0} border={5}>
            <StaticText label={_('Format presets:')} />
          </SizerItem>
          <SizerItem pos={[9, 0]} span={[1, 2]} flag={wxEXPAND} border={5}>
            <Combo
              ariaLabel="Format presets"
              value={p.m_cbBomFmtPresets.value}
              options={p.m_cbBomFmtPresets.options}
              onChange={p.m_cbBomFmtPresets.onChange}
            />
          </SizerItem>
        </GridBagSizer>
      </SizerItem>
      <SizerItem pos={[0, 1]} span={[1, 1]} flag={wxEXPAND | wxBOTTOM} border={10}>
        {/* bOutputDirectory */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM | wxLEFT} border={5}>
            <StaticText label={_('Output file:')} />
          </SizerItem>
          <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
            <TextCtrl
              value={p.m_outputFileName.value}
              onChange={p.m_outputFileName.onChange}
              hint={p.m_outputFileName.hint}
              ariaLabel={_('Output file')}
            />
          </SizerItem>
          <SizerItem
            flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM | wxRIGHT}
            border={5}
            shown={p.onBrowse !== undefined}
          >
            <StdBitmapButton
              bitmap="small_folder"
              title={_('Browse')}
              tooltip={null}
              onClick={() => p.onBrowse?.()}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem pos={[1, 1]} span={[1, 1]} flag={wxEXPAND | wxTOP | wxBOTTOM} border={3}>
        {/* bPreview */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxALIGN_BOTTOM | wxTOP | wxRIGHT | wxLEFT} border={5}>
            <StaticText label={_('Preview:')} />
          </SizerItem>
          <StretchSpacer />
          <SizerItem flag={wxTOP | wxRIGHT} border={5}>
            <StdBitmapButton
              bitmap="small_refresh"
              title="Refresh preview"
              onClick={p.onRefreshPreview}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem
        pos={[2, 1]}
        span={[2, 1]}
        flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
        border={5}
      >
        {/* m_textOutput: wxTE_MULTILINE|wxTE_READONLY, teletype font */}
        <TextCtrl
          multiLine
          readOnly
          value={p.m_textOutput}
          className="ze-mono"
          ariaLabel={_('Preview')}
        />
      </SizerItem>
    </GridBagSizer>
  );

  const rightPanel = (
    // bRightSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
        {/* bMargins1 > m_nbPages */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
            <Notebook
              selection={p.page}
              onPageChanged={p.onPageChanged}
              pages={[
                { text: _('Edit'), content: editPage },
                { text: _('Export'), content: exportPage },
              ]}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bButtonsSizer */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={10}>
            <StdBitmapButton
              bitmap={p.sidebarCollapsed ? 'right' : 'left'}
              title={p.sidebarCollapsed ? _('Expand left panel') : _('Collapse left panel')}
              onClick={p.onSidebarToggle}
            />
          </SizerItem>
          <SizerItem proportion={9} flag={wxEXPAND} border={5}>
            <StaticText label={p.status} />
          </SizerItem>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={10}>
            <Button label={_('Export')} onClick={p.onExport} />
          </SizerItem>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={10}>
            <Button label={_('Apply, Save Schematic & Continue')} onClick={p.onApply} />
          </SizerItem>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
            <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    // wxDEFAULT_DIALOG_STYLE|wxMAXIMIZE_BOX|wxRESIZE_BORDER: resizable.
    <DialogShim title={_('Symbol Fields Table')} onClose={p.onCancel} style={p.dialogSize}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          <SplitterWindow
            split="vertical"
            sashPosition={p.sashPosition}
            onSashPosition={p.onSashPosition}
            minimumPaneSize={120}
            unsplit={p.sidebarCollapsed}
            window1={
              // m_leftPanel > bLeftSizer > m_splitter_left
              <SplitterWindow
                split="horizontal"
                sashPosition={p.variantSashPosition}
                onSashPosition={p.onVariantSashPosition}
                minimumPaneSize={80}
                window1={viewControlsPanel}
                window2={variantsPanel}
              />
            }
            window2={rightPanel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
