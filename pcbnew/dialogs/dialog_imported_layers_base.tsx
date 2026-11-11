// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_IMPORTED_LAYERS_BASE` (pcbnew/dialogs/dialog_imported_layers_base.cpp): the unmatched
 * imported and KiCad layer lists, the > / < / << buttons, the matched list, and Auto-Match / Keep
 * KiCad layer names beside OK. DIALOG_MAP_LAYERS is built on it (dialog_map_layers.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Button, type CHECK, CheckBox, ListCtrl, StaticText } from '@ziroeda/wx/controls.js';
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
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A wxListCtrl in report mode: its rows, which are selected, and its activation. */
export interface LIST {
  rows: readonly (readonly string[])[];
  selected: readonly number[];
  onSelect: (aRows: number[], aClicked: number) => void;
  onActivate: () => void;
}

export interface DIALOG_IMPORTED_LAYERS_BASE_PROPS {
  title: string;
  /** The class's InsertColumn( 0, … ) headers, and their SetWidth()s. */
  importedLayersHeader: string;
  kicadLayersHeader: string;
  importedWidth: number;
  kicadWidth: number;
  m_unmatched_layers_list: LIST;
  m_kicad_layers_list: LIST;
  m_matched_layers_list: LIST;
  onAddClick: () => void;
  onRemoveClick: () => void;
  onRemoveAllClick: () => void;
  onAutoMatchLayersClicked: () => void;
  m_cbKeepKiCadLayerNames: CHECK;
  onOK: () => void;
}

export function DIALOG_IMPORTED_LAYERS_BASE(p: DIALOG_IMPORTED_LAYERS_BASE_PROPS): JSX.Element {
  const list = (l: LIST, aName: string, aWidths: number[], aHeaders?: string[]) => (
    <ListCtrl
      rows={l.rows}
      columnWidths={aWidths}
      headers={aHeaders}
      selectedRows={l.selected}
      onSelectRows={l.onSelect}
      onActivate={l.onActivate}
      ariaLabel={aName}
    />
  );

  return (
    <DialogShim title={p.title} onClose={p.onOK}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
          {/* bSizerTop */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              <StaticBoxSizer label={_('Unmatched Layers')} orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* fgSizer1, growing both columns and row 1 */}
                  <FlexGridSizer cols={2} growableCols={[0, 1]} growableRows={[1]}>
                    <SizerItem flag={wxALL} border={5}>
                      <StaticText label={_('Imported Layers')} />
                    </SizerItem>
                    <SizerItem flag={wxALL} border={5}>
                      <StaticText label={_('KiCad Layers')} />
                    </SizerItem>
                    <SizerItem
                      proportion={1}
                      flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT}
                      border={5}
                      minSize={[120, -1]}
                    >
                      {/* wxLC_NO_HEADER|wxLC_REPORT */}
                      {list(p.m_unmatched_layers_list, 'Unmatched imported layers', [
                        p.importedWidth,
                      ])}
                    </SizerItem>
                    <SizerItem
                      proportion={1}
                      flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT}
                      border={5}
                      minSize={[120, -1]}
                    >
                      {/* wxLC_NO_HEADER|wxLC_REPORT|wxLC_SINGLE_SEL */}
                      {list(p.m_kicad_layers_list, 'KiCad layers', [p.kicadWidth])}
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxTOP} border={10}>
              {/* bSizer6 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALL} border={5} minSize={[36, 100]}>
                  <Button
                    label=">"
                    title={_('Add selected layers to matched layers list.')}
                    onClick={p.onAddClick}
                  />
                </SizerItem>
                <SizerItem flag={wxALL} border={5} minSize={[36, 100]}>
                  <Button
                    label="<"
                    title={_('Remove selected layers from matched layers list.')}
                    onClick={p.onRemoveClick}
                  />
                </SizerItem>
                <SizerItem flag={wxALL} border={5} minSize={[36, 50]}>
                  <Button
                    label="<<"
                    title={_('Remove all matched layers.')}
                    onClick={p.onRemoveAllClick}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={5}>
              <StaticBoxSizer label={_('Matched Layers')} orient={wxHORIZONTAL}>
                <SizerItem
                  proportion={1}
                  flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT}
                  border={5}
                  minSize={[120, -1]}
                >
                  {/* wxLC_REPORT */}
                  {list(
                    p.m_matched_layers_list,
                    'Matched layers',
                    [p.importedWidth, p.kicadWidth],
                    [p.importedLayersHeader, p.kicadLayersHeader],
                  )}
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxTOP} border={5}>
          {/* bSizerBottom */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALL} border={5}>
              <Button
                label={_('Auto-Match Layers')}
                title={_('Automatically match any unmatched layers to their KiCad equivalent.')}
                onClick={p.onAutoMatchLayersClicked}
              />
            </SizerItem>
            <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
              <CheckBox
                label={_('Keep KiCad layer names')}
                title={_(
                  'If checked, layers will keep their standard KiCad names instead of being renamed to the imported layer names.',
                )}
                check={p.m_cbKeepKiCadLayerNames}
              />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
