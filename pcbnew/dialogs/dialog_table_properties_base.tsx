// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLE_PROPERTIES_BASE` (pcbnew/dialogs/dialog_table_properties_base.cpp), the board's
 * table dialog - not eeschema's, which has colour swatches and no layer. The sizer tree, Add()
 * for Add(); the cell grid and the Syntax help link are the derived constructor's
 * `m_gridSizer->Add`s, handed in as `m_grid`. Values and events are props; the behaviour is
 * DIALOG_TABLE_PROPERTIES's (dialog_table_properties.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Combo, type ComboOption } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  HyperlinkCtrl,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
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
import type { wxGrid } from '@ziroeda/wx/grid.js';
import { type GRID_COLUMN_VIEW, WxGridView } from '@ziroeda/wx/grid_ui.js';
import {
  BoxSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER: its entry text, enable and units label. */
export interface UNIT {
  value: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
  units: string;
}

export interface DIALOG_TABLE_PROPERTIES_BASE_PROPS {
  /** `m_grid`, the derived constructor's WX_GRID over the table's cells. */
  m_grid: wxGrid;
  gridTricks: { GetCellTooltip(aRow: number, aCol: number): string };
  /** `sizeGridToTable`'s column sizes. */
  gridColumns: readonly GRID_COLUMN_VIEW[];
  /** GRID_CELL_COLOR_RENDERER on a covered cell; null draws the text. */
  renderCell: (aRow: number, aCol: number, aValue: string) => JSX.Element | null;
  /** `m_syntaxHelp`'s wxEVT_HYPERLINK. */
  onSyntaxHelp: () => void;
  /** `m_LayerSelectionCtrl`, a PCB_LAYER_BOX_SELECTOR: its rows and the selected layer id. */
  layerRows: readonly ComboOption[];
  layer: string;
  onLayerChange: (aLayer: string) => void;
  m_cbLocked: CHECK;
  /** `m_cbLocked->Show( false )` in the footprint editor. */
  lockedShown: boolean;
  m_borderCheckbox: CHECK;
  m_headerBorder: CHECK;
  m_borderWidth: UNIT;
  /** `m_borderStyleCombo`, a wxBitmapComboBox of lineTypeNames. */
  m_borderStyleCombo: CHOICE;
  m_rowSeparators: CHECK;
  m_colSeparators: CHECK;
  m_separatorsWidth: UNIT;
  m_separatorsStyleCombo: CHOICE;
  /** The style rows: `Append( lineStyleDesc.name, KiBitmap( lineStyleDesc.bitmap ) )`. */
  styleRows: readonly ComboOption[];
  onOK: () => void;
  onCancel: () => void;
}

/** A Width: row's control and units (bSizer7 / bSizer71). */
function WidthRow({ unit, ariaLabel }: { unit: UNIT; ariaLabel: string }): JSX.Element {
  return (
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem flag={wxEXPAND} border={5}>
        <TextCtrl
          value={unit.value}
          onChange={unit.onChange}
          disabled={unit.enabled === false}
          ariaLabel={ariaLabel}
        />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={3}>
        <StaticText label={unit.units} disabled={unit.enabled === false} />
      </SizerItem>
    </BoxSizer>
  );
}

function StyleCombo({
  rows,
  choice,
  ariaLabel,
}: {
  rows: readonly ComboOption[];
  choice: CHOICE;
  ariaLabel: string;
}): JSX.Element {
  return (
    <Combo
      value={String(choice.value)}
      options={rows}
      onChange={(v) => choice.onChange(Number(v))}
      disabled={choice.enabled === false}
      ariaLabel={ariaLabel}
    />
  );
}

export function DIALOG_TABLE_PROPERTIES_BASE(p: DIALOG_TABLE_PROPERTIES_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Table Properties')} onClose={p.onCancel}>
      {/* bMainSizer; m_infoBar is hidden until something shows a message, so it takes no room. */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={10}>
          {/* bColumns */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem
              proportion={1}
              flag={wxEXPAND | wxTOP | wxRIGHT}
              border={5}
              minSize={[600, 400]}
            >
              {/* m_gridSizer->SetMinSize( wxSize( 600,400 ) ) */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxBOTTOM} border={3}>
                  <StaticText label={_('Cell contents:')} />
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  <WxGridView
                    grid={p.m_grid}
                    tricks={p.gridTricks}
                    columns={p.gridColumns}
                    colLabels={false}
                    renderCell={p.renderCell}
                    ariaLabel={_('Cell contents')}
                  />
                </SizerItem>
                <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT | wxLEFT} border={3}>
                  <HyperlinkCtrl
                    label={_('Syntax help')}
                    title={_('Show syntax help window')}
                    onClick={p.onSyntaxHelp}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <Spacer width={15} height={0} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxEXPAND | wxALL} border={10}>
              {/* bPropertiesSizer = wxGridBagSizer( 3, 3 ), AddGrowableCol( 1 ) */}
              <GridBagSizer vgap={3} hgap={3} growableCols={[1]}>
                <SizerItem pos={[0, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={_('Layer:')} />
                </SizerItem>
                <SizerItem
                  pos={[0, 1]}
                  span={[1, 2]}
                  flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                  border={5}
                  minSize={[175, -1]}
                >
                  <Combo
                    value={p.layer}
                    options={p.layerRows}
                    onChange={p.onLayerChange}
                    ariaLabel="Layer"
                  />
                </SizerItem>
                <SizerItem
                  pos={[1, 0]}
                  span={[1, 3]}
                  flag={wxBOTTOM}
                  border={20}
                  shown={p.lockedShown}
                >
                  <CheckBox label={_('Locked')} check={p.m_cbLocked} />
                </SizerItem>
                <SizerItem pos={[2, 0]} span={[1, 2]} flag={wxBOTTOM} border={2}>
                  <CheckBox label={_('External border')} check={p.m_borderCheckbox} />
                </SizerItem>
                <SizerItem pos={[2, 2]} flag={wxLEFT} border={20}>
                  <CheckBox label={_('Header border')} check={p.m_headerBorder} />
                </SizerItem>
                <SizerItem pos={[4, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={_('Width:')} disabled={p.m_borderWidth.enabled === false} />
                </SizerItem>
                <SizerItem pos={[4, 1]} span={[1, 2]} flag={wxEXPAND} border={5}>
                  <WidthRow unit={p.m_borderWidth} ariaLabel={_('Border width')} />
                </SizerItem>
                <SizerItem pos={[5, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText
                    label={_('Style:')}
                    disabled={p.m_borderStyleCombo.enabled === false}
                  />
                </SizerItem>
                <SizerItem
                  pos={[5, 1]}
                  span={[1, 2]}
                  flag={wxEXPAND}
                  border={5}
                  minSize={[200, -1]}
                >
                  <StyleCombo
                    rows={p.styleRows}
                    choice={p.m_borderStyleCombo}
                    ariaLabel={_('Border style')}
                  />
                </SizerItem>
                <Spacer pos={[6, 0]} width={0} height={15} flag={wxEXPAND} border={5} />
                <SizerItem
                  pos={[7, 0]}
                  span={[1, 2]}
                  flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
                  border={15}
                >
                  <CheckBox label={_('Row lines')} check={p.m_rowSeparators} />
                </SizerItem>
                <SizerItem
                  pos={[7, 2]}
                  flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                  border={20}
                >
                  <CheckBox label={_('Column lines')} check={p.m_colSeparators} />
                </SizerItem>
                <SizerItem pos={[9, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText
                    label={_('Width:')}
                    disabled={p.m_separatorsWidth.enabled === false}
                  />
                </SizerItem>
                <SizerItem pos={[9, 1]} span={[1, 2]} flag={wxEXPAND} border={5}>
                  <WidthRow unit={p.m_separatorsWidth} ariaLabel={_('Separators width')} />
                </SizerItem>
                <SizerItem pos={[10, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText
                    label={_('Style:')}
                    disabled={p.m_separatorsStyleCombo.enabled === false}
                  />
                </SizerItem>
                <SizerItem
                  pos={[10, 1]}
                  span={[1, 2]}
                  flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                  border={5}
                  minSize={[200, -1]}
                >
                  <StyleCombo
                    rows={p.styleRows}
                    choice={p.m_separatorsStyleCombo}
                    ariaLabel={_('Separators style')}
                  />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bButtons */}
          <BoxSizer orient={wxHORIZONTAL}>
            <Spacer proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              <StdDialogButtonSizer onCancel={p.onCancel} onOk={p.onOK} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
