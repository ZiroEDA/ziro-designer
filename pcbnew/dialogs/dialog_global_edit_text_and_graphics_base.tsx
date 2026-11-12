// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE`
 * (pcbnew/dialogs/dialog_global_edit_text_and_graphics_base.cpp): the sizer tree, Add() for Add().
 * The members are props; the behaviour is DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS's
 * (dialog_global_edit_text_and_graphics.tsx).
 *
 * Not yet: `m_grid->Enable( false )` greying the layer defaults while specified values are chosen;
 * the shared grid view has no disabled state.
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { BitmapButton } from '@ziroeda/common/widgets/bitmap_button.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { Combo, type ComboOption } from '@ziroeda/wx/combobox.js';
import { type CHECK, CheckBox, RadioButton, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { type CHECK3, TriStateCheck } from '@ziroeda/wx/wx_checkbox.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER over a wxTextCtrl: its text, unit text and Enable(). */
export interface UNIT_FIELD {
  label: string;
  value: string;
  units: string;
  enabled: boolean;
  onChange: (aText: string) => void;
}

/** A PCB_LAYER_BOX_SELECTOR: its rows, the one shown, and Enable(). */
export interface LAYER_BOX {
  rows: readonly ComboOption[];
  value: string;
  enabled?: boolean;
  onChange: (aLayer: string) => void;
}

export interface DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE_PROPS {
  m_references: CHECK;
  m_boardGraphics: CHECK;
  m_values: CHECK;
  m_boardText: CHECK;
  m_otherFootprintFields: CHECK;
  m_boardDimensions: CHECK;
  m_footprintGraphics: { label: string; check: CHECK };
  m_footprintTexts: { label: string; check: CHECK };
  m_footprintDimensions: { label: string; check: CHECK };
  /** The PCB column and the parent filters are hidden in the footprint editor. */
  boardItemsShown: boolean;
  m_layerFilterOpt: CHECK;
  m_layerFilter: LAYER_BOX;
  m_referenceFilterOpt: CHECK;
  m_referenceFilter: { value: string; onChange: (aText: string) => void };
  m_footprintFilterOpt: CHECK;
  m_footprintFilter: { value: string; onChange: (aText: string) => void };
  m_selectedItemsFilter: CHECK;
  m_setToSpecifiedValues: { value: boolean; onSelect: (aSpecified: boolean) => void };
  m_LayerCtrl: LAYER_BOX;
  m_visible: CHECK3;
  m_lineWidth: UNIT_FIELD;
  /** `m_fontCtrl`, a FONT_CHOICE: the face, '' for the KiCad font. */
  m_fontCtrl: { face: string; enabled: boolean; onChange: (aFace: string) => void };
  m_bold: CHECK3;
  m_textWidth: UNIT_FIELD;
  m_italic: CHECK3;
  m_textHeight: UNIT_FIELD;
  m_keepUpright: CHECK3;
  m_thickness: UNIT_FIELD;
  /** `m_autoTextThickness`, a BITMAP_BUTTON in check mode. */
  m_autoTextThickness: { checked: boolean; enabled: boolean; onClick: () => void };
  m_centerOnFP: CHECK;
  setToLayerDefaultsLabel: string;
  /** `m_grid`: the layer defaults, header row first, read-only. */
  m_grid: wxGrid;
  onOK: () => void;
  /** wxID_APPLY: wxDialog's default, Validate() and TransferDataFromWindow() without closing. */
  onApply: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;
const RL = wxRIGHT | wxLEFT;

/** `m_grid->SetColSize( n, … )`. */
const GRID_COLUMNS = [132, 120, 120, 120, 120, 96, 96].map((width) => ({ width }));

export function DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE(
  p: DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE_PROPS,
): JSX.Element {
  const layerBox = (l: LAYER_BOX, aName: string): JSX.Element => (
    <Combo
      value={l.value}
      options={l.rows}
      onChange={l.onChange}
      disabled={l.enabled === false}
      ariaLabel={aName}
    />
  );
  /** A label / control / unit triple of fgSizer1. */
  const unit = (f: UNIT_FIELD, aCtrlFlag = wxEXPAND | RL, aMin?: readonly [number, number]) => (
    <>
      <SizerItem flag={CV | RL} border={5}>
        <StaticText label={f.label} disabled={!f.enabled} />
      </SizerItem>
      <SizerItem flag={aCtrlFlag} border={5} minSize={aMin}>
        <TextCtrl
          value={f.value}
          onChange={f.onChange}
          disabled={!f.enabled}
          ariaLabel={f.label.replace(/:$/, '')}
        />
      </SizerItem>
    </>
  );
  const unitText = (f: UNIT_FIELD): JSX.Element => (
    <SizerItem flag={CV | wxRIGHT} border={5}>
      <StaticText label={f.units} disabled={!f.enabled} />
    </SizerItem>
  );

  return (
    <DialogShim title={_('Edit Text and Graphic Properties')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* bSizerTop */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxTOP | RL} border={10}>
              <StaticBoxSizer label={_('Scope')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | RL} border={5}>
                  {/* fgSizer3 = wxFlexGridSizer( 0, 2, 5, 30 ) */}
                  <FlexGridSizer cols={2} vgap={5} hgap={30}>
                    <SizerItem border={5}>
                      <CheckBox label={_('Reference designators')} check={p.m_references} />
                    </SizerItem>
                    <SizerItem border={5} shown={p.boardItemsShown}>
                      <CheckBox label={_('PCB graphic items')} check={p.m_boardGraphics} />
                    </SizerItem>
                    <SizerItem border={5}>
                      <CheckBox label={_('Values')} check={p.m_values} />
                    </SizerItem>
                    <SizerItem border={5} shown={p.boardItemsShown}>
                      <CheckBox label={_('PCB text items')} check={p.m_boardText} />
                    </SizerItem>
                    <SizerItem border={5}>
                      <CheckBox
                        label={_('Other footprint fields')}
                        check={p.m_otherFootprintFields}
                        title={_(
                          'Footprint fields that are not the reference designator or value field',
                        )}
                      />
                    </SizerItem>
                    <SizerItem border={5} shown={p.boardItemsShown}>
                      <CheckBox label={_('PCB dimensions')} check={p.m_boardDimensions} />
                    </SizerItem>
                    <SizerItem flag={wxTOP} border={5}>
                      <CheckBox
                        label={p.m_footprintGraphics.label}
                        check={p.m_footprintGraphics.check}
                      />
                    </SizerItem>
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem border={5}>
                      <CheckBox
                        label={p.m_footprintTexts.label}
                        check={p.m_footprintTexts.check}
                        title={_('Footprint text items not associated with a field')}
                      />
                    </SizerItem>
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem border={5}>
                      <CheckBox
                        label={p.m_footprintDimensions.label}
                        check={p.m_footprintDimensions.check}
                      />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | RL} border={10}>
              <StaticBoxSizer label={_('Filter Items')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
                  {/* fgSizer2 = wxFlexGridSizer( 0, 2, 3, 0 ) */}
                  <FlexGridSizer cols={2} vgap={3} hgap={0} growableCols={[1]}>
                    <SizerItem flag={CV | wxLEFT} border={5}>
                      <CheckBox label={_('By layer:')} check={p.m_layerFilterOpt} />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
                      {layerBox(p.m_layerFilter, 'Layer filter')}
                    </SizerItem>
                    <Spacer
                      width={0}
                      height={0}
                      proportion={1}
                      flag={wxEXPAND | wxTOP | wxBOTTOM}
                      border={2}
                    />
                    <Spacer
                      width={0}
                      height={0}
                      proportion={1}
                      flag={wxEXPAND | wxTOP | wxBOTTOM}
                      border={2}
                    />
                    <SizerItem flag={CV | wxLEFT} border={5} shown={p.boardItemsShown}>
                      <CheckBox
                        label={_('By parent reference designator:')}
                        check={p.m_referenceFilterOpt}
                      />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxLEFT} border={5} shown={p.boardItemsShown}>
                      <TextCtrl
                        value={p.m_referenceFilter.value}
                        onChange={p.m_referenceFilter.onChange}
                        ariaLabel={_('Parent reference designator')}
                      />
                    </SizerItem>
                    <SizerItem flag={CV | wxBOTTOM | wxLEFT} border={5} shown={p.boardItemsShown}>
                      <CheckBox
                        label={_('By parent footprint library link:')}
                        check={p.m_footprintFilterOpt}
                      />
                    </SizerItem>
                    <SizerItem
                      flag={wxBOTTOM | wxEXPAND | wxLEFT}
                      border={5}
                      shown={p.boardItemsShown}
                    >
                      <TextCtrl
                        value={p.m_footprintFilter.value}
                        onChange={p.m_footprintFilter.onChange}
                        ariaLabel={_('Parent footprint library link')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALL} border={5}>
                      <CheckBox label={_('Selected items only')} check={p.m_selectedItemsFilter} />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | RL} border={10}>
          <StaticBoxSizer label={_('Action')} orient={wxVERTICAL}>
            <SizerItem flag={wxRIGHT} border={5}>
              <RadioButton
                label={_('Set to specified values:')}
                name="m_action"
                checked={p.m_setToSpecifiedValues.value}
                onChange={() => p.m_setToSpecifiedValues.onSelect(true)}
              />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxBOTTOM | wxLEFT} border={18}>
              {/* m_specifiedValues > bSizer2 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxTOP} border={2}>
                  {/* fgSizer1 = wxFlexGridSizer( 0, 5, 2, 0 ) */}
                  <FlexGridSizer cols={5} vgap={2} hgap={0} growableCols={[1, 4]}>
                    <SizerItem flag={CV | RL} border={5}>
                      <StaticText label={_('Layer:')} disabled={p.m_LayerCtrl.enabled === false} />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | RL} border={5}>
                      {layerBox(p.m_LayerCtrl, 'Layer')}
                    </SizerItem>
                    <Spacer width={0} height={0} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} flag={wxEXPAND | RL} border={5} />
                    <SizerItem flag={CV | wxLEFT} border={120}>
                      <TriStateCheck
                        label={_('Visible  (fields only)')}
                        check={p.m_visible}
                        allowThirdStateForUser
                      />
                    </SizerItem>
                    {unit(p.m_lineWidth)}
                    {unitText(p.m_lineWidth)}
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer
                      width={0}
                      height={0}
                      proportion={1}
                      flag={wxEXPAND | wxTOP}
                      border={5}
                    />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxTOP | RL | CV} border={5}>
                      <StaticText label={_('Font:')} disabled={!p.m_fontCtrl.enabled} />
                    </SizerItem>
                    <SizerItem flag={wxTOP | RL | CV | wxEXPAND} border={5}>
                      <FontChoice
                        face={p.m_fontCtrl.face}
                        indeterminate
                        disabled={!p.m_fontCtrl.enabled}
                        onChange={p.m_fontCtrl.onChange}
                      />
                    </SizerItem>
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxLEFT | CV} border={120}>
                      <TriStateCheck label={_('Bold')} check={p.m_bold} allowThirdStateForUser />
                    </SizerItem>
                    {unit(p.m_textWidth, wxEXPAND | RL, [120, -1])}
                    {unitText(p.m_textWidth)}
                    <Spacer width={0} height={0} flag={wxEXPAND | RL} border={20} />
                    <SizerItem flag={CV | RL} border={120}>
                      <TriStateCheck
                        label={_('Italic')}
                        check={p.m_italic}
                        allowThirdStateForUser
                      />
                    </SizerItem>
                    {unit(p.m_textHeight)}
                    {unitText(p.m_textHeight)}
                    <Spacer width={0} height={0} flag={wxEXPAND | RL} border={20} />
                    <SizerItem flag={CV | wxLEFT | wxRIGHT} border={120}>
                      <TriStateCheck
                        label={_('Keep upright')}
                        check={p.m_keepUpright}
                        allowThirdStateForUser
                      />
                    </SizerItem>
                    {unit(p.m_thickness, wxEXPAND | RL | CV)}
                    <SizerItem flag={CV} border={5}>
                      {/* bSizer4 */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={CV | wxRIGHT} border={5}>
                          <StaticText
                            label={p.m_thickness.units}
                            disabled={!p.m_thickness.enabled}
                          />
                        </SizerItem>
                        <SizerItem flag={CV | RL} border={5}>
                          <BitmapButton
                            bitmap="edit_cmp_symb_links"
                            tooltip={_('Adjust the text thickness')}
                            checked={p.m_autoTextThickness.checked}
                            disabled={!p.m_autoTextThickness.enabled}
                            onClick={p.m_autoTextThickness.onClick}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <Spacer width={0} height={0} flag={wxEXPAND | RL} border={20} />
                    <SizerItem flag={CV | RL} border={120}>
                      <CheckBox
                        label={_('Center on footprint')}
                        check={p.m_centerOnFP}
                        title={_('Move footprint texts to the center of their parent')}
                      />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxTOP | wxBOTTOM | wxEXPAND} border={3}>
              <RadioButton
                label={p.setToLayerDefaultsLabel}
                name="m_action"
                checked={!p.m_setToSpecifiedValues.value}
                onChange={() => p.m_setToSpecifiedValues.onSelect(false)}
              />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxLEFT} border={23}>
              {/* m_grid: 7 x 7, read-only, no labels, BTNFACE cells, the info font */}
              <WxGridView
                grid={p.m_grid}
                columns={GRID_COLUMNS}
                rowLabels={false}
                colLabels={false}
                ariaLabel={_('Layer defaults')}
              />
            </SizerItem>
            <Spacer width={0} height={0} flag={wxEXPAND | wxBOTTOM} border={5} />
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          <StdDialogButtonSizer
            okLabel={_('Apply and Close')}
            onOk={p.onOK}
            onApply={p.onApply}
            cancelLabel={_('Close')}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
