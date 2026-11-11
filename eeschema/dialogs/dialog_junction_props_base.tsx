// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_JUNCTION_PROPS_BASE` (eeschema/dialogs/dialog_junction_props_base.cpp): the sizer tree,
 * Add() for Add(). The behaviour is DIALOG_JUNCTION_PROPS's (dialog_junction_props.tsx).
 */
import type { JSX, RefObject } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { Panel, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_JUNCTION_PROPS_BASE_PROPS {
  m_textCtrlDiameter: string;
  onDiameter: (aText: string) => void;
  /** `SetInitialFocus( m_textCtrlDiameter )`. */
  diameterRef?: RefObject<HTMLInputElement>;
  /** `m_staticTextDiameterUnits`: the UNIT_BINDER's units. */
  units: string;
  m_colorSwatch: Color4d;
  /** `SetSwatchBackground( canvas )`. */
  swatchBackground: Color4d;
  onColor: (aColor: Color4d) => void;
  /** wxID_APPLY, relabelled "Default": `resetDefaults`. */
  onApply: () => void;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_JUNCTION_PROPS_BASE(p: DIALOG_JUNCTION_PROPS_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Junction Properties')} onClose={p.onCancel} initialFocus={p.diameterRef}>
      {/* bSizer2 */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={10}>
          {/* fgSizer2 = wxFlexGridSizer( 0, 3, 5, 0 ), AddGrowableCol( 1 ) */}
          <FlexGridSizer cols={3} vgap={5} hgap={0} growableCols={[1]}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
              <StaticText label={_('Diameter:')} />
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              <TextCtrl
                value={p.m_textCtrlDiameter}
                onChange={p.onDiameter}
                inputRef={p.diameterRef}
                ariaLabel={_('Diameter')}
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
              <StaticText label={p.units} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
              <StaticText label={_('Color:')} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
              {/* m_panel1, wxBORDER_SIMPLE */}
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
            <StretchSpacer />
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={10}>
          {/* bMargins; m_helpLabel1/2 SetFont( GetInfoFont( this ).Italic() ) */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
              <StaticText
                label={_("Set diameter to 0 to use schematic's junction dot size.")}
                wrap={333}
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
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
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
