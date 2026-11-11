// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHAPE_PROPERTIES_BASE` (eeschema/dialogs/dialog_shape_properties_base.cpp): the sizer
 * tree, Add() for Add() - the info bar, the rule-area checkboxes, the border grid, `m_fillBook`
 * (a wxSimplebook: the schematic page's fill choice, the symbol editor's fill radios) and the
 * symbol-editor checkboxes. Which parts show is DIALOG_SHAPE_PROPERTIES's call.
 */
import type { JSX, RefObject } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  Panel,
  RadioButton,
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
import { Simplebook } from '@ziroeda/wx/simplebook.js';
import {
  BoxSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A wxBitmapComboBox row: `Append( name, bitmap )`. */
export interface BITMAP_COMBO_ITEM {
  label: string;
  bitmap?: string;
}

/** A COLOR_SWATCH member. */
export interface SWATCH {
  color: Color4d;
  background?: Color4d;
  enabled?: boolean;
  onChange: (aColor: Color4d) => void;
  /** `GetNewSwatchColor()`: each new value opens the colour picker. */
  openRequest?: number;
}

/** `m_rbFillNone` .. `m_rbFillCustom`, their wx ids NO_FILL .. FILLED_WITH_COLOR. */
export type FILL_RADIO = 'none' | 'outline' | 'background' | 'custom';

export interface DIALOG_SHAPE_PROPERTIES_BASE_PROPS {
  /** `SetTitle( wxString::Format( GetTitle(), aShape->GetFriendlyName() ) )`: "%s Properties". */
  title: string;
  m_infoBar: string | null;
  /** `m_ruleAreaSizer->Show( … )`. */
  ruleAreaShown: boolean;
  m_cbExcludeFromSim: CHECK;
  m_cbExcludeFromBom: CHECK;
  m_cbExcludeFromBoard: CHECK;
  m_cbDNP: CHECK;
  m_borderCheckbox: CHECK;
  m_borderWidthCtrl: string;
  onBorderWidth: (aText: string) => void;
  borderWidthRef?: RefObject<HTMLInputElement>;
  /** `m_borderWidth` (the UNIT_BINDER) enabled, and its units. */
  borderEnabled: boolean;
  units: string;
  m_borderColorSwatch: SWATCH;
  borderStyleItems: readonly BITMAP_COMBO_ITEM[];
  m_borderStyleCombo: CHOICE;
  /** `m_fillBook->SetSelection( … )`: 0 the schematic page, 1 the symbol editor's. */
  fillBookSelection: number;
  fillChoices: readonly string[];
  m_fillCtrl: CHOICE;
  m_fillColorSwatch: SWATCH;
  fillRadio: FILL_RADIO;
  onFillRadio: (aRadio: FILL_RADIO) => void;
  m_customColorSwatch: SWATCH;
  /** `m_symbolEditorSizer->Show( … )`. */
  symbolEditorShown: boolean;
  m_privateCheckbox: CHECK;
  m_checkApplyToAllUnits: CHECK;
  m_checkApplyToAllBodyStyles: CHECK;
  /** `m_sdbSizerOK->SetLabel( "Read Only" ); Enable( false )` for a read-only symbol. */
  okLabel?: string;
  okEnabled?: boolean;
  onOK: () => void;
  onCancel: () => void;
}

function SwatchPanel({ label, s }: { label: string; s: SWATCH }): JSX.Element {
  return (
    <Panel border="simple">
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALIGN_CENTER_HORIZONTAL} border={5}>
          <ColorSwatch
            label={label}
            color={s.color}
            background={s.background}
            disabled={s.enabled === false}
            onChange={s.onChange}
          />
        </SizerItem>
      </BoxSizer>
    </Panel>
  );
}

export function DIALOG_SHAPE_PROPERTIES_BASE(p: DIALOG_SHAPE_PROPERTIES_BASE_PROPS): JSX.Element {
  const fillColorOn = p.m_fillColorSwatch.enabled !== false;

  const schematicPage = (
    // m_schematicPage: bSizer8
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT} border={5}>
        {/* m_fillSizer = wxGridBagSizer( 3, 3 ), SetEmptyCellSize( wxSize( 36,12 ) ) */}
        <GridBagSizer vgap={3} hgap={3} emptyCellSize={[36, 12]}>
          <SizerItem pos={[0, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
            <StaticText label={_('Fill:')} />
          </SizerItem>
          <SizerItem
            pos={[0, 1]}
            span={[1, 1]}
            flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
            border={5}
          >
            <Choice choices={p.fillChoices} choice={p.m_fillCtrl} ariaLabel="Fill" />
          </SizerItem>
          <SizerItem pos={[1, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
            <StaticText label={_('Fill color:')} disabled={!fillColorOn} />
          </SizerItem>
          <SizerItem pos={[1, 1]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
            {/* m_panelFillColor, wxBORDER_SIMPLE */}
            <SwatchPanel label={_HKI('Fill color')} s={p.m_fillColorSwatch} />
          </SizerItem>
          <SizerItem pos={[4, 0]} span={[1, 2]} flag={wxTOP | wxRIGHT} border={8}>
            {/* m_helpLabel2, SetFont( GetInfoFont( this ).Italic() ) */}
            <StaticText
              label={_('Clear colors to use Schematic Editor colors.')}
              font="info"
              italic
            />
          </SizerItem>
        </GridBagSizer>
      </SizerItem>
    </BoxSizer>
  );

  const radio = (label: string, value: FILL_RADIO): JSX.Element => (
    <RadioButton
      label={label}
      name="shape-fill"
      checked={p.fillRadio === value}
      onChange={() => p.onFillRadio(value)}
    />
  );

  const symbolEditorPage = (
    // m_symbolEditorPage: bSizer9
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        <StaticBoxSizer label={_('Fill Style')} orient={wxVERTICAL}>
          <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
            {/* gbSizer1 = wxGridBagSizer( 3, 0 ) */}
            <GridBagSizer vgap={3} hgap={0}>
              <SizerItem pos={[0, 0]} span={[1, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                {radio(_('Do not fill'), 'none')}
              </SizerItem>
              <SizerItem pos={[1, 0]} span={[1, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                {radio(_('Fill with body outline color'), 'outline')}
              </SizerItem>
              <SizerItem pos={[2, 0]} span={[1, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                {radio(_('Fill with body background color'), 'background')}
              </SizerItem>
              <SizerItem pos={[3, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                {radio(_('Fill with:'), 'custom')}
              </SizerItem>
              <SizerItem
                pos={[3, 1]}
                span={[1, 1]}
                flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                border={5}
              >
                {/* m_customColorSwatch: a bare COLOR_SWATCH, no panel */}
                <ColorSwatch
                  key={p.m_customColorSwatch.openRequest ?? 0}
                  openOnMount={!!p.m_customColorSwatch.openRequest}
                  label="Fill with color"
                  color={p.m_customColorSwatch.color}
                  background={p.m_customColorSwatch.background}
                  onChange={p.m_customColorSwatch.onChange}
                />
              </SizerItem>
            </GridBagSizer>
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel} initialFocus={p.borderWidthRef}>
      {/* mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxBOTTOM | wxEXPAND} border={5} shown={p.m_infoBar !== null}>
          <Infobar message={p.m_infoBar ?? ''} />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5} shown={p.ruleAreaShown}>
          {/* m_ruleAreaSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
              <CheckBox label={_('Exclude from simulation')} check={p.m_cbExcludeFromSim} />
            </SizerItem>
            <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxALL} border={5}>
              <CheckBox
                label={_('Exclude from bill of materials')}
                title={
                  'This is useful for adding symbols for board footprints such as fiducials\n' +
                  'and logos that you do not want to appear in the bill of materials export'
                }
                check={p.m_cbExcludeFromBom}
              />
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              <CheckBox
                label={_('Exclude from board')}
                title={
                  'This is useful for adding symbols that only get exported to the bill of materials but\n' +
                  'not required to layout the board such as mechanical fasteners and enclosures'
                }
                check={p.m_cbExcludeFromBoard}
              />
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
              <CheckBox label={_('Do not populate')} check={p.m_cbDNP} />
            </SizerItem>
            <Spacer width={0} height={5} proportion={1} flag={wxEXPAND} border={5} />
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bColumns */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={9} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
              {/* m_borderSizer = wxGridBagSizer( 3, 3 ), SetEmptyCellSize( wxSize( 36,-1 ) ) */}
              <GridBagSizer vgap={3} hgap={3} emptyCellSize={[36, -1]}>
                <SizerItem pos={[0, 0]} span={[1, 2]} flag={wxBOTTOM} border={2}>
                  <CheckBox label={_('Border')} check={p.m_borderCheckbox} />
                </SizerItem>
                <SizerItem pos={[1, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={_('Width:')} disabled={!p.borderEnabled} />
                </SizerItem>
                <SizerItem pos={[1, 1]} span={[1, 2]} flag={wxEXPAND} border={5}>
                  {/* bSizer7 */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <TextCtrl
                        value={p.m_borderWidthCtrl}
                        onChange={p.onBorderWidth}
                        inputRef={p.borderWidthRef}
                        disabled={!p.borderEnabled}
                        ariaLabel="Border width"
                      />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={3}>
                      <StaticText label={p.units} disabled={!p.borderEnabled} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={15}>
                      <StaticText label={_('Color:')} disabled={!p.borderEnabled} />
                    </SizerItem>
                    <Spacer width={5} height={0} border={5} />
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      {/* m_panelBorderColor, wxBORDER_SIMPLE */}
                      <SwatchPanel label="Border color" s={p.m_borderColorSwatch} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem pos={[2, 0]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={_('Style:')} disabled={!p.borderEnabled} />
                </SizerItem>
                <SizerItem
                  pos={[2, 1]}
                  span={[1, 2]}
                  flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                  border={5}
                  minSize={[240, -1]}
                >
                  <Combo
                    ariaLabel="Border style"
                    value={String(p.m_borderStyleCombo.value)}
                    disabled={!p.borderEnabled}
                    options={p.borderStyleItems.map((it, i) => ({
                      value: String(i),
                      label: it.label,
                      ...(it.bitmap ? { bitmap: it.bitmap } : {}),
                    }))}
                    onChange={(v) => p.m_borderStyleCombo.onChange(Number(v))}
                  />
                </SizerItem>
                <SizerItem pos={[3, 0]} span={[1, 2]} flag={wxTOP} border={8}>
                  {/* m_helpLabel1, Wrap( 320 ), SetFont( GetInfoFont( this ).Italic() ) */}
                  <StaticText
                    label={_("Set border width to 0 to use schematic's default line width.")}
                    wrap={320}
                    font="info"
                    italic
                  />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
            <Spacer width={15} height={0} flag={wxEXPAND} border={5} />
            <SizerItem proportion={8} flag={wxEXPAND | wxALL} border={10}>
              {/* m_fillBook */}
              <Simplebook
                pages={[schematicPage, symbolEditorPage]}
                selection={p.fillBookSelection}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem
          proportion={1}
          flag={wxEXPAND | wxTOP | wxBOTTOM}
          border={5}
          shown={p.symbolEditorShown}
        >
          {/* m_symbolEditorSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bColumns2 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={9} flag={wxEXPAND | wxRIGHT | wxLEFT} border={10}>
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={wxTOP} border={5}>
                      <CheckBox label={_('Private to Symbol Editor')} check={p.m_privateCheckbox} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <Spacer width={15} height={0} flag={wxEXPAND} border={5} />
                <SizerItem proportion={8} flag={wxEXPAND | wxRIGHT | wxLEFT} border={10}>
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={wxTOP | wxRIGHT} border={5}>
                      <CheckBox
                        label={_('Common to all units in symbol')}
                        check={p.m_checkApplyToAllUnits}
                      />
                    </SizerItem>
                    <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT} border={5}>
                      <CheckBox
                        label={_('Common to all body styles')}
                        check={p.m_checkApplyToAllBodyStyles}
                      />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* m_sdbSizer: OK, Cancel */}
          <StdDialogButtonSizer
            okLabel={p.okLabel}
            okDisabled={p.okEnabled === false}
            onOk={p.onOK}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
