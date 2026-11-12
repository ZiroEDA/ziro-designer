// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHAPE_PROPERTIES_BASE` (pcbnew/dialogs/dialog_shape_properties_base.cpp): the sizer
 * tree, Add() for Add(). Its notebook pages are empty wxGridBagSizer( 4, 5 )s that
 * DIALOG_SHAPE_PROPERTIES fills with AddXYPointToSizer / AddFieldToSizer
 * (dialog_shape_properties.cpp:768-844); those two are drawn here from the page descriptions.
 */
import { Fragment, type JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { NetInfoList } from '@ziroeda/common/widgets/net_selector.js';
import { NetSelector } from '@ziroeda/common/widgets/net_selector.js';
import { Combo, type ComboOption } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_LEFT,
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
  FlexGridSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import type { FIELD } from './dialog_text_properties_base.js';
import type { BOUND_CONTROL, GEOM_PAGE } from './dialog_shape_properties.js';
import { _ } from '@ziroeda/wx/translation.js';

const CV = wxALIGN_CENTER_VERTICAL;

export interface DIALOG_SHAPE_PROPERTIES_BASE_PROPS {
  title: string;
  /** `m_notebookShapeDefs`: the pages the shape type keeps, or none (hidden) for a polygon. */
  pages: readonly GEOM_PAGE[];
  page: number;
  onPage: (aPage: number) => void;
  /** The bound controls the pages hold, and each one's unit text. */
  boundCtrls: readonly BOUND_CONTROL[];
  units: (aCtrl: BOUND_CONTROL) => string;
  onBoundCtrl: (aIndex: number, aText: string) => void;
  m_locked: CHECK & { shown: boolean };
  m_cbRoundRect: CHECK & { shown: boolean };
  m_cornerRadius: FIELD;
  m_thickness: FIELD;
  /** `m_lineStyleCombo`, a wxBitmapComboBox of lineTypeNames. */
  m_lineStyleCombo: {
    rows: readonly ComboOption[];
    value: string;
    onChange: (aValue: string) => void;
  };
  m_fillCtrl: CHOICE & { shown: boolean };
  m_netSelector: {
    netInfo: NetInfoList;
    netcode: number;
    enabled: boolean;
    shown: boolean;
    onChange: (aNetcode: number) => void;
  };
  m_LayerSelectionCtrl: {
    rows: readonly ComboOption[];
    value: string;
    onChange: (aLayer: string) => void;
  };
  /** enableTechLayers(): the label and Solder mask live on outer copper only. */
  techLayersEnabled: boolean;
  m_hasSolderMask: CHECK;
  m_solderMaskMargin: FIELD;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_SHAPE_PROPERTIES_BASE(p: DIALOG_SHAPE_PROPERTIES_BASE_PROPS): JSX.Element {
  // A bound control's three cells: label, wxTextCtrl, units.
  const bound = (aRow: number, aCol: number, aIndex: number) => {
    const c = p.boundCtrls[aIndex]!;
    return (
      <>
        <SizerItem pos={[aRow, aCol]} flag={wxALIGN_LEFT | CV | wxLEFT} border={aCol > 0 ? 20 : 5}>
          <StaticText label={c.label} />
        </SizerItem>
        <SizerItem pos={[aRow, aCol + 1]} flag={wxEXPAND | CV} border={5}>
          <TextCtrl
            value={c.text}
            onChange={(aText) => p.onBoundCtrl(aIndex, aText)}
            ariaLabel={c.label}
          />
        </SizerItem>
        <SizerItem pos={[aRow, aCol + 2]} flag={wxALIGN_LEFT | CV | wxRIGHT} border={5}>
          <StaticText label={p.units(c)} />
        </SizerItem>
      </>
    );
  };

  const pageContent = (aPage: GEOM_PAGE) => {
    const cols = [...new Set(aPage.items.map((i) => i.col + 1))];
    return (
      // bSizerN, the page's sizer
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
          {/* m_gbs... = wxGridBagSizer( 4, 5 ); each Add...ToSizer AddGrowableCol( col + 1 ) */}
          <GridBagSizer vgap={4} hgap={5} growableCols={cols}>
            {aPage.items.map((item) =>
              item.type === 'xy' ? (
                <Fragment key={item.ctrl}>
                  <SizerItem
                    pos={[item.row, item.col]}
                    span={[1, 3]}
                    flag={CV | wxALIGN_CENTER_HORIZONTAL | wxALL | wxEXPAND}
                  >
                    <StaticText label={item.name} />
                  </SizerItem>
                  {bound(item.row + 1, item.col, item.ctrl)}
                  {bound(item.row + 2, item.col, item.ctrl + 1)}
                </Fragment>
              ) : (
                <Fragment key={item.ctrl}>{bound(item.row, item.col, item.ctrl)}</Fragment>
              ),
            )}
          </GridBagSizer>
        </SizerItem>
      </BoxSizer>
    );
  };

  const unitField = (aRow: number, f: FIELD, aMin?: readonly [number, number]) => (
    <>
      <SizerItem pos={[aRow, 0]} flag={CV | wxLEFT} border={5}>
        <StaticText label={f.label} disabled={f.enabled === false} />
      </SizerItem>
      <SizerItem pos={[aRow, 1]} flag={wxEXPAND | CV} border={5} minSize={aMin}>
        <TextCtrl
          value={f.value}
          onChange={f.onChange}
          onBlur={f.onBlur}
          disabled={f.enabled === false}
          ariaLabel={f.label.replace(/:$/, '')}
        />
      </SizerItem>
      <SizerItem pos={[aRow, 2]} flag={CV | wxRIGHT} border={5}>
        <StaticText label={f.units} disabled={f.enabled === false} />
      </SizerItem>
    </>
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={5} shown={p.pages.length > 0}>
          <Notebook
            pages={p.pages.map((g) => ({ text: g.title, content: pageContent(g) }))}
            selection={p.page}
            onPageChanged={p.onPage}
          />
        </SizerItem>
        <SizerItem flag={wxALL} border={10} shown={p.m_locked.shown}>
          <CheckBox label={_('Locked')} check={p.m_locked} />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5} shown={p.m_cbRoundRect.shown}>
          {/* bSizerRoundRect */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALL | CV} border={5}>
              <CheckBox label={_('Rounded rectangle')} check={p.m_cbRoundRect} />
            </SizerItem>
            <Spacer width={15} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={CV | wxTOP | wxBOTTOM | wxLEFT} border={5}>
              <StaticText label={p.m_cornerRadius.label} />
            </SizerItem>
            <SizerItem flag={wxALL | CV} border={5}>
              <TextCtrl
                value={p.m_cornerRadius.value}
                onChange={p.m_cornerRadius.onChange}
                onBlur={p.m_cornerRadius.onBlur}
                ariaLabel={_('Corner radius')}
              />
            </SizerItem>
            <SizerItem flag={CV | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
              <StaticText label={p.m_cornerRadius.units} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
          {/* m_upperSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
              {/* gbSizer2 = wxGridBagSizer( 2, 5 ), SetEmptyCellSize( wxSize( -1,6 ) ) */}
              <GridBagSizer vgap={2} hgap={5} emptyCellSize={[-1, 6]} growableCols={[1]}>
                {unitField(0, p.m_thickness, [140, -1])}
                <SizerItem pos={[1, 0]} flag={CV | wxLEFT} border={5}>
                  <StaticText label={_('Line style:')} />
                </SizerItem>
                <SizerItem
                  pos={[1, 1]}
                  span={[1, 2]}
                  flag={CV | wxEXPAND | wxRIGHT}
                  border={5}
                  minSize={[210, -1]}
                >
                  <Combo
                    value={p.m_lineStyleCombo.value}
                    options={p.m_lineStyleCombo.rows}
                    onChange={p.m_lineStyleCombo.onChange}
                    ariaLabel={_('Line style')}
                  />
                </SizerItem>
                <SizerItem pos={[2, 0]} flag={wxALL | CV} border={5} shown={p.m_fillCtrl.shown}>
                  <StaticText label={_('Fill:')} />
                </SizerItem>
                <SizerItem
                  pos={[2, 1]}
                  span={[1, 2]}
                  flag={CV | wxEXPAND | wxRIGHT}
                  border={5}
                  shown={p.m_fillCtrl.shown}
                >
                  <Choice
                    choices={[
                      _('None'),
                      _('Solid'),
                      _('Hatch'),
                      _('Reverse Hatch'),
                      _('Cross-hatch'),
                    ]}
                    choice={p.m_fillCtrl}
                    ariaLabel="Fill"
                  />
                </SizerItem>
                <SizerItem pos={[4, 0]} flag={CV | wxLEFT} border={5} shown={p.m_netSelector.shown}>
                  <StaticText label={_('Net:')} disabled={!p.m_netSelector.enabled} />
                </SizerItem>
                <SizerItem
                  pos={[4, 1]}
                  span={[1, 2]}
                  flag={CV | wxEXPAND | wxRIGHT}
                  border={5}
                  shown={p.m_netSelector.shown}
                >
                  <NetSelector
                    netInfo={p.m_netSelector.netInfo}
                    netcode={p.m_netSelector.netcode}
                    disabled={!p.m_netSelector.enabled}
                    onChange={p.m_netSelector.onChange}
                  />
                </SizerItem>
                <SizerItem pos={[6, 0]} flag={CV | wxLEFT} border={5}>
                  <StaticText label={_('Layer:')} />
                </SizerItem>
                <SizerItem pos={[6, 1]} span={[1, 2]} flag={CV | wxEXPAND | wxRIGHT} border={5}>
                  <Combo
                    value={p.m_LayerSelectionCtrl.value}
                    options={p.m_LayerSelectionCtrl.rows}
                    onChange={p.m_LayerSelectionCtrl.onChange}
                    ariaLabel="Layer"
                  />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bSizer14 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALL} border={5}>
                  {/* SetFont( KIUI::GetSmallInfoFont( this ) ) */}
                  <StaticText
                    label={_('Technical Layers')}
                    font="smallInfo"
                    disabled={!p.techLayersEnabled}
                  />
                </SizerItem>
                <SizerItem proportion={1} flag={CV | wxTOP | wxRIGHT | wxLEFT} border={4}>
                  <StaticLine />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* fgSizer2 = wxFlexGridSizer( 0, 5, 0, 0 ) */}
              <FlexGridSizer cols={5} growableCols={[1, 3]}>
                <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox
                    label={_('Solder mask')}
                    check={{ ...p.m_hasSolderMask, enabled: p.techLayersEnabled }}
                  />
                </SizerItem>
                <Spacer width={10} height={0} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
                  <StaticText
                    label={p.m_solderMaskMargin.label}
                    disabled={p.m_solderMaskMargin.enabled === false}
                  />
                </SizerItem>
                <SizerItem flag={CV | wxEXPAND} border={5}>
                  <TextCtrl
                    value={p.m_solderMaskMargin.value}
                    onChange={p.m_solderMaskMargin.onChange}
                    onBlur={p.m_solderMaskMargin.onBlur}
                    disabled={p.m_solderMaskMargin.enabled === false}
                    title={p.m_solderMaskMargin.title}
                    ariaLabel={_('Expansion')}
                  />
                </SizerItem>
                <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
                  <StaticText
                    label={p.m_solderMaskMargin.units}
                    disabled={p.m_solderMaskMargin.enabled === false}
                  />
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
