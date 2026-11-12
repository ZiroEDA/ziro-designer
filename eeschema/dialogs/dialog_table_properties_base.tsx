// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLE_PROPERTIES_BASE` (eeschema/dialogs/dialog_table_properties_base.cpp): the sizer
 * tree, Add() for Add(). `m_gridSizer` holds only its label in the base; DIALOG_TABLE_PROPERTIES
 * adds the WX_GRID (`m_gridSizer->Add( m_grid, 1, wxEXPAND, 5 )`), so the derived dialog passes
 * it in. The two style combos are wxBitmapComboBoxes filled from `lineTypeNames`.
 */
import type { JSX, ReactNode } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Panel,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
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
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** A width entry with its UNIT_BINDER's label and units, enabled as one. */
export interface WIDTH_FIELD {
  text: string;
  onChange: (aText: string) => void;
  units: string;
  enabled: boolean;
}

/** A COLOR_SWATCH member: its colour, the canvas behind it, its enable. */
export interface SWATCH {
  color: Color4d;
  background?: Color4d;
  enabled: boolean;
  onChange: (aColor: Color4d) => void;
}

export interface DIALOG_TABLE_PROPERTIES_BASE_PROPS {
  /** `m_infoBar->ShowMessage( … )`; hidden when null. */
  m_infoBar: string | null;
  /** What the derived dialog adds to `m_gridSizer`. */
  m_grid: ReactNode;
  m_borderCheckbox: CHECK;
  m_headerBorder: CHECK;
  m_borderWidth: WIDTH_FIELD;
  m_borderColorSwatch: SWATCH;
  m_borderStyleCombo: CHOICE;
  m_rowSeparators: CHECK;
  m_colSeparators: CHECK;
  m_separatorsWidth: WIDTH_FIELD;
  m_separatorsColorSwatch: SWATCH;
  m_separatorsStyleCombo: CHOICE;
  onOK: () => void;
  onCancel: () => void;
}

const STYLE_OPTIONS = LINE_STYLE_NAMES.map((s, i) => ({
  value: String(i),
  label: s.label,
  ...(s.bitmap ? { bitmap: bitmapUrl(s.bitmap) } : {}),
}));

/** bSizer7 / bSizer71: the width entry, its units, "Color:", a 5 px spacer, the swatch panel. */
function WidthAndColor({
  label,
  width,
  swatch,
}: {
  label: string;
  width: WIDTH_FIELD;
  swatch: SWATCH;
}): JSX.Element {
  return (
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem flag={wxEXPAND} border={5}>
        <TextCtrl
          value={width.text}
          onChange={width.onChange}
          disabled={!width.enabled}
          ariaLabel={label}
        />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={3}>
        <StaticText label={width.units} disabled={!width.enabled} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={15}>
        <StaticText label={_('Color:')} disabled={!swatch.enabled} />
      </SizerItem>
      <Spacer width={5} height={0} border={5} />
      <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
        {/* m_panelBorderColor, wxBORDER_SIMPLE, holding the COLOR_SWATCH */}
        <Panel border="simple">
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALIGN_CENTER_HORIZONTAL} border={5}>
              <ColorSwatch
                label={wxFormat(_('%s color'), label)}
                color={swatch.color}
                background={swatch.background}
                disabled={!swatch.enabled}
                onChange={swatch.onChange}
              />
            </SizerItem>
          </BoxSizer>
        </Panel>
      </SizerItem>
    </BoxSizer>
  );
}

function StyleCombo({ label, c }: { label: string; c: CHOICE }): JSX.Element {
  return (
    <Combo
      ariaLabel={label}
      value={String(c.value)}
      options={STYLE_OPTIONS}
      disabled={c.enabled === false}
      onChange={(v) => c.onChange(Number(v))}
    />
  );
}

export function DIALOG_TABLE_PROPERTIES_BASE(p: DIALOG_TABLE_PROPERTIES_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Table Properties')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxBOTTOM} border={5} shown={p.m_infoBar !== null}>
          {/* m_infoBar */}
          <Infobar message={p.m_infoBar ?? ''} />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={10}>
          {/* bColumns */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem
              proportion={1}
              flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT}
              border={5}
              minSize={[600, 400]}
            >
              {/* m_gridSizer, SetMinSize( wxSize( 600,400 ) ) */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxBOTTOM} border={3}>
                  {/* cellContentsLabel */}
                  <StaticText label={_('Cell contents:')} />
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {p.m_grid}
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <Spacer width={10} height={0} flag={wxEXPAND} border={15} />
            <SizerItem flag={wxEXPAND | wxTOP} border={5}>
              {/* bPropertiesMargins */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
                  {/* bPropertiesSizer = wxGridBagSizer( 3, 3 ), SetEmptyCellSize( 0, 2 ),
                      AddGrowableCol( 1 ) */}
                  <GridBagSizer vgap={3} hgap={3} emptyCellSize={[0, 2]} growableCols={[1]}>
                    <SizerItem pos={[0, 0]} span={[1, 2]} flag={wxBOTTOM} border={2}>
                      <CheckBox label={_('External border')} check={p.m_borderCheckbox} />
                    </SizerItem>
                    <SizerItem pos={[0, 2]} span={[1, 1]} flag={wxLEFT} border={20}>
                      <CheckBox label={_('Header border')} check={p.m_headerBorder} />
                    </SizerItem>
                    <SizerItem pos={[2, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Width:')} disabled={!p.m_borderWidth.enabled} />
                    </SizerItem>
                    <SizerItem pos={[2, 1]} span={[1, 2]} flag={wxEXPAND} border={5}>
                      <WidthAndColor
                        label={_('Border width')}
                        width={p.m_borderWidth}
                        swatch={p.m_borderColorSwatch}
                      />
                    </SizerItem>
                    <SizerItem pos={[3, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText
                        label={_('Style:')}
                        disabled={p.m_borderStyleCombo.enabled === false}
                      />
                    </SizerItem>
                    <SizerItem
                      pos={[3, 1]}
                      span={[1, 2]}
                      flag={wxEXPAND}
                      border={5}
                      minSize={[200, -1]}
                    >
                      <StyleCombo label={_('Border style')} c={p.m_borderStyleCombo} />
                    </SizerItem>
                    <Spacer
                      pos={[4, 0]}
                      span={[1, 1]}
                      width={0}
                      height={20}
                      flag={wxEXPAND}
                      border={5}
                    />
                    <SizerItem
                      pos={[5, 0]}
                      span={[1, 2]}
                      flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
                      border={15}
                    >
                      <CheckBox label={_('Row lines')} check={p.m_rowSeparators} />
                    </SizerItem>
                    <SizerItem
                      pos={[5, 2]}
                      span={[1, 1]}
                      flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                      border={20}
                    >
                      <CheckBox label={_('Column lines')} check={p.m_colSeparators} />
                    </SizerItem>
                    <SizerItem pos={[7, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Width:')} disabled={!p.m_separatorsWidth.enabled} />
                    </SizerItem>
                    <SizerItem pos={[7, 1]} span={[1, 2]} flag={wxEXPAND} border={5}>
                      <WidthAndColor
                        label={_('Separators width')}
                        width={p.m_separatorsWidth}
                        swatch={p.m_separatorsColorSwatch}
                      />
                    </SizerItem>
                    <SizerItem pos={[8, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText
                        label={_('Style:')}
                        disabled={p.m_separatorsStyleCombo.enabled === false}
                      />
                    </SizerItem>
                    <SizerItem
                      pos={[8, 1]}
                      span={[1, 2]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                      border={5}
                      minSize={[200, -1]}
                    >
                      <StyleCombo label={_('Separators style')} c={p.m_separatorsStyleCombo} />
                    </SizerItem>
                  </GridBagSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bButtons */}
          <BoxSizer orient={wxHORIZONTAL}>
            <StretchSpacer />
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              {/* m_sdbSizer1: OK, Cancel */}
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
