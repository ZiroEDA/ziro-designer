// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LINE_PROPERTIES_BASE` (eeschema/dialogs/dialog_line_properties_base.cpp): the sizer
 * tree, Add() for Add(). `m_typeCombo` is empty in the base; the derived dialog appends its rows.
 * The behaviour is DIALOG_LINE_PROPERTIES's (dialog_line_properties.tsx).
 */
import type { JSX, RefObject } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { type CHOICE, Panel, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, GridBagSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A wxBitmapComboBox row: `Append( name, bitmap )`. */
export interface BITMAP_COMBO_ITEM {
  label: string;
  bitmap?: string;
}

export interface DIALOG_LINE_PROPERTIES_BASE_PROPS {
  m_lineWidth: string;
  onLineWidth: (aText: string) => void;
  lineWidthRef?: RefObject<HTMLInputElement>;
  /** `m_staticWidthUnits`: the UNIT_BINDER's units. */
  units: string;
  m_colorSwatch: Color4d;
  swatchBackground: Color4d;
  onColor: (aColor: Color4d) => void;
  typeComboItems: readonly BITMAP_COMBO_ITEM[];
  m_typeCombo: CHOICE;
  onApply: () => void;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_LINE_PROPERTIES_BASE(p: DIALOG_LINE_PROPERTIES_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Line Properties')} onClose={p.onCancel} initialFocus={p.lineWidthRef}>
      {/* mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={10}>
          {/* gbSizer1 = wxGridBagSizer( 3, 0 ), AddGrowableCol( 1 ) */}
          <GridBagSizer vgap={3} hgap={0} growableCols={[1]}>
            <SizerItem
              pos={[0, 0]}
              span={[1, 1]}
              flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
              border={5}
            >
              <StaticText label={_('Width:')} />
            </SizerItem>
            <SizerItem
              pos={[0, 1]}
              span={[1, 1]}
              flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
              border={5}
              minSize={[146, -1]}
            >
              <TextCtrl
                value={p.m_lineWidth}
                onChange={p.onLineWidth}
                inputRef={p.lineWidthRef}
                ariaLabel="Width"
              />
            </SizerItem>
            <SizerItem
              pos={[0, 2]}
              span={[1, 1]}
              flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
              border={3}
              minSize={[40, -1]}
            >
              <StaticText label={p.units} />
            </SizerItem>
            <SizerItem
              pos={[0, 3]}
              span={[1, 1]}
              flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
              border={15}
            >
              <StaticText label={_('Color:')} />
            </SizerItem>
            <SizerItem
              pos={[0, 4]}
              span={[1, 1]}
              flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
              border={5}
            >
              {/* m_panelColor, wxBORDER_SIMPLE */}
              <Panel border="simple">
                <BoxSizer orient={wxVERTICAL}>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALIGN_CENTER_HORIZONTAL} border={5}>
                    <ColorSwatch
                      label="Color"
                      color={p.m_colorSwatch}
                      background={p.swatchBackground}
                      onChange={p.onColor}
                    />
                  </SizerItem>
                </BoxSizer>
              </Panel>
            </SizerItem>
            <SizerItem
              pos={[1, 0]}
              span={[1, 1]}
              flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
              border={5}
            >
              <StaticText label={_('Style:')} />
            </SizerItem>
            <SizerItem
              pos={[1, 1]}
              span={[1, 4]}
              flag={wxEXPAND | wxALIGN_CENTER_VERTICAL}
              border={5}
              minSize={[240, -1]}
            >
              <Combo
                ariaLabel={_('Style')}
                value={String(p.m_typeCombo.value)}
                options={p.typeComboItems.map((it, i) => ({
                  value: String(i),
                  label: it.label,
                  ...(it.bitmap ? { bitmap: it.bitmap } : {}),
                }))}
                onChange={(val) => p.m_typeCombo.onChange(Number(val))}
              />
            </SizerItem>
          </GridBagSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={10}>
          {/* bMargins; m_helpLabel1/2 SetFont( GetInfoFont( this ).Italic() ) */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT} border={5}>
              <StaticText
                label={_("Set width to 0 to use schematic's default line width.")}
                font="info"
                italic
              />
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
              <StaticText
                label={_('Clear color to use Schematic Editor colors.')}
                font="info"
                italic
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* m_sdbSizer: OK, Apply ("Default"), Cancel */}
          <StdDialogButtonSizer
            onOk={p.onOK}
            onApply={p.onApply}
            applyLabel={_('Default')}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
