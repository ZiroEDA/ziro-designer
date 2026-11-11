// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PAD_PROPERTIES_BASE` (pcbnew/dialogs/dialog_pad_properties_base.cpp): the sizer tree,
 * Add() for Add(). The members are props - each UNIT_BINDER's label, entry and units, each
 * check box and choice - and the events go back to DIALOG_PAD_PROPERTIES
 * (dialog_pad_properties.tsx), which owns every value. `m_padPreviewGAL` is the derived
 * `prepareCanvas`'s `m_padPreviewSizer->Add( m_padPreviewGAL, 12, wxEXPAND | wxALL, 5 )`.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { NetSelector, type NetSelectorProps } from '@ziroeda/common/widgets/net_selector.js';
import { TextCombo } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  Panel,
  StaticBitmap,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_BOTTOM,
  wxALIGN_CENTER_HORIZONTAL,
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_TOP,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRESERVE_SPACE_EVEN_IF_HIDDEN,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { Notebook } from '@ziroeda/wx/notebook_ui.js';
import { Simplebook } from '@ziroeda/wx/simplebook.js';
import {
  BoxSizer,
  FlexGridSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A UNIT_BINDER: its label's text, the entry, the units label, Enable() and Show(). */
export interface UNIT {
  label: string;
  value: string;
  enabled?: boolean;
  shown?: boolean;
  units: string;
  onChange: (aText: string) => void;
}

/** A wxTextCtrl with no binder. */
export interface TEXT {
  value: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
}

/** A wxSpinCtrlDouble: its value and the onModify it sends. */
export interface SPIN {
  value: number;
  enabled?: boolean;
  onChange: (aValue: number) => void;
}

/** A wxChoice with the strings its owner fills at run time. */
export interface FILLED_CHOICE extends CHOICE {
  choices: readonly string[];
}

/** A technical-layer box: `SetLabel( m_board->GetLayerName( … ) )`. */
export interface LAYER_CHECK extends CHECK {
  label: string;
}

/** The images `Show()` gives the stackup pages; page 3 has none. */
export interface STACKUP_IMAGES {
  page0: string;
  page1: string;
  page2: string;
  page4: string;
  page5: string;
  page6: string;
  page7: string;
}

export interface DIALOG_PAD_PROPERTIES_BASE_PROPS {
  /** `SetTitle()`, a leading "*" once OnModify has run. */
  title: string;
  m_notebook: { selection: number; onPageChanged: (aPage: number) => void };
  // ----- m_panelGeneral -----
  m_padType: CHOICE;
  m_padNumCtrl: TEXT;
  /** `m_padNetLabel->Show( false )` / `m_padNetSelector->Show( false )` in the footprint editor. */
  padNetShown: boolean;
  m_padNetSelector: Pick<NetSelectorProps, 'netInfo' | 'netcode' | 'onChange'> & {
    enabled?: boolean;
  };
  m_posX: UNIT;
  m_posY: UNIT;
  /** `m_padstackControls->Show()`: PTH pads only. */
  padstackControlsShown: boolean;
  m_cbPadstackMode: CHOICE;
  m_cbEditLayer: FILLED_CHOICE;
  m_PadShapeSelector: CHOICE;
  /** `m_shapePropsBook->SetSelection()`. */
  shapePropsPage: number;
  m_trapDelta: UNIT;
  m_trapAxisCtrl: CHOICE;
  m_cornerRatio: UNIT;
  m_cornerRadius: UNIT;
  m_chamferRatio: UNIT;
  m_cbTopLeft: CHECK;
  m_cbTopRight: CHECK;
  m_cbBottomLeft: CHECK;
  m_cbBottomRight: CHECK;
  m_mixedChamferRatio: UNIT;
  m_cbTopLeft1: CHECK;
  m_cbTopRight1: CHECK;
  m_cbBottomLeft1: CHECK;
  m_cbBottomRight1: CHECK;
  m_mixedCornerRatio: UNIT;
  m_sizeX: UNIT;
  m_sizeY: UNIT;
  /** `m_pad_orientation` over the `m_cb_padrotation` wxComboBox. */
  m_pad_orientation: UNIT;
  m_offsetShapeOpt: CHECK;
  /** `m_offsetCtrls->Show()` / `m_offsetShapeOptLabel->Show()`. */
  offsetCtrlsShown: boolean;
  m_offsetX: UNIT;
  m_offsetY: UNIT;
  /** `m_gbSizerHole->Show()` and `m_staticline71->Show()`. */
  holeSizerShown: boolean;
  m_holeShapeCtrl: CHOICE;
  m_holeX: UNIT;
  m_holeY: UNIT;
  m_padToDieOpt: CHECK;
  m_padToDie: UNIT;
  m_padToDieDelayOpt: CHECK;
  m_padToDieDelay: UNIT;
  /** `m_FlippedWarningSizer->Show()`. */
  flippedWarningShown: boolean;
  warningBitmap: string;
  m_rbCopperLayersSel: FILLED_CHOICE;
  m_layerFrontAdhesive: LAYER_CHECK;
  m_layerBackAdhesive: LAYER_CHECK;
  m_layerFrontPaste: LAYER_CHECK;
  m_layerBackPaste: LAYER_CHECK;
  m_layerFrontSilk: LAYER_CHECK;
  m_layerBackSilk: LAYER_CHECK;
  m_layerFrontMask: LAYER_CHECK;
  m_layerBackMask: LAYER_CHECK;
  m_layerUserDwgs: LAYER_CHECK;
  m_layerECO1: LAYER_CHECK;
  m_layerECO2: LAYER_CHECK;
  m_choiceFabProperty: CHOICE;
  // ----- m_connectionsPanel -----
  /** `m_legacyTeardropsWarning->Show( m_board->LegacyTeardrops() )`. */
  legacyTeardropsShown: boolean;
  /** `onTeardropsUpdateUi`: every teardrop control's `event.Enable()`. */
  teardropsEnabled: boolean;
  m_cbTeardrops: CHECK;
  m_cbPreferZoneConnection: CHECK;
  m_cbTeardropsUseNextTrack: CHECK;
  m_spTeardropHDPercent: SPIN;
  /** `m_minTrackWidthHint`, `m_stLenPercentHint`, `m_stWidthPercentHint`: "d" or "w". */
  teardropHint: string;
  /** `m_bitmapTeardrop->SetBitmap()`. */
  teardropBitmap: string;
  m_spTeardropLenPercent: SPIN;
  m_teardropMaxLenSetting: UNIT;
  m_spTeardropSizePercent: SPIN;
  m_teardropMaxHeightSetting: UNIT;
  m_curvedEdges: CHECK;
  m_ZoneConnectionChoice: CHOICE;
  m_ZoneCustomPadShape: CHOICE;
  m_thermalGap: UNIT;
  m_spokeWidth: UNIT;
  m_spokeAngle: UNIT;
  // ----- m_localSettingsPanel -----
  m_clearance: UNIT;
  m_maskMargin: UNIT;
  /** MARGIN_OFFSET_BINDER over `m_pasteMarginCtrl`. */
  m_pasteMargin: UNIT;
  /** `m_nonCopperWarningBook->ChangeSelection()`. */
  nonCopperWarningPage: number;
  // ----- m_backDrillPanel -----
  m_topPostMachining: CHOICE;
  m_topPostMachineSize1: UNIT;
  m_topPostMachineSize2: UNIT;
  m_bottomPostMachining: CHOICE;
  m_bottomPostMachineSize1: UNIT;
  m_bottomPostMachineSize2: UNIT;
  m_backDrillChoice: CHOICE;
  m_backDrillTopLayer: FILLED_CHOICE;
  m_backDrillTopSize: UNIT;
  m_backDrillBottomLayer: FILLED_CHOICE;
  m_backDrillBottomSize: UNIT;
  // ----- the preview -----
  /** `m_stackupImagesBook->SetSelection()`. */
  stackupImagesPage: number;
  stackupImages: STACKUP_IMAGES;
  m_padPreviewGAL: ReactNode;
  m_parentInfo: string;
  m_cbShowPadOutline: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

/** A binder's label: `Enable()` greys it, `SetLabel()` renames it. */
function Label({ u, title }: { u: UNIT; title?: string }): JSX.Element {
  return <StaticText label={u.label} disabled={u.enabled === false} title={title} />;
}

/** A binder's entry. */
function Entry({ u, title }: { u: UNIT; title?: string }): JSX.Element {
  return (
    <TextCtrl
      value={u.value}
      onChange={u.onChange}
      disabled={u.enabled === false}
      ariaLabel={u.label.replace(/:$/, '')}
      title={title}
    />
  );
}

/** A binder's units label. */
function Units({ u }: { u: UNIT }): JSX.Element {
  return <StaticText label={u.units} disabled={u.enabled === false} />;
}

const shown = (u: UNIT): boolean => u.shown !== false;

const CORNER_RATIO_TIP = _HKI(
  'Corner radius in percent  of the pad width.\nThe width is the smaller value between size X and size Y.\nThe max value is 50 percent.',
);
const CHAMFER_RATIO_TIP = _HKI(
  'Chamfer size in percent of the pad width.\nThe width is the smaller value between size X and size Y.\nThe max value is 50 percent.',
);
const CHAMFER_CORNER_TIP = _HKI(
  'Chamfered corners. The position is relative to a pad orientation 0 degree.',
);
const BACKDRILL_LAYER_TIP = _HKI('The backdrill must pass through this layer');

/** gCornersSizer / gMixedCornersSizer: a wxGridSizer( 0, 2, vgap, 6 ) of the four corners. */
function Corners({
  vgap,
  tl,
  tr,
  bl,
  br,
}: {
  vgap: number;
  tl: CHECK;
  tr: CHECK;
  bl: CHECK;
  br: CHECK;
}): JSX.Element {
  return (
    <FlexGridSizer cols={2} vgap={vgap} hgap={6} flexibleDirection={0}>
      <SizerItem border={5}>
        <CheckBox label={_('Top left')} check={tl} />
      </SizerItem>
      <SizerItem border={5}>
        <CheckBox label={_('Top right')} check={tr} />
      </SizerItem>
      <SizerItem border={5}>
        <CheckBox label={_('Bottom left')} check={bl} />
      </SizerItem>
      <SizerItem border={5}>
        <CheckBox label={_('Bottom right')} check={br} />
      </SizerItem>
    </FlexGridSizer>
  );
}

/** A teardrop spin control, enabled by onTeardropsUpdateUi. */
function TeardropSpin({
  spin,
  min,
  max,
  enabled,
  ariaLabel,
  title,
}: {
  spin: SPIN;
  min: number;
  max: number;
  enabled: boolean;
  ariaLabel: string;
  title?: string;
}): JSX.Element {
  return (
    <span title={title}>
      <SpinCtrl
        value={spin.value}
        onChange={spin.onChange}
        min={min}
        max={max}
        step={10}
        digits={0}
        disabled={!enabled}
        ariaLabel={ariaLabel}
      />
    </span>
  );
}

/** The `%( d )` after a teardrop ratio: bSizer39 / bSizer131 / bSizer13. */
function PercentHint({
  hint,
  enabled,
  hintFlag,
  hintBorder,
}: {
  hint: string;
  enabled: boolean;
  hintFlag: number;
  hintBorder: number;
}): JSX.Element {
  return (
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <StaticText label="%(" disabled={!enabled} />
      </SizerItem>
      <SizerItem flag={hintFlag} border={hintBorder}>
        {/* SetFont( wxFont( …, wxFONTSTYLE_ITALIC, … ) ) */}
        <StaticText label={hint} italic disabled={!enabled} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <StaticText label=" )" disabled={!enabled} />
      </SizerItem>
    </BoxSizer>
  );
}

/** gbPostMachiningLeftCol / gbPostMachiningRightCol: a wxGridBagSizer( 5, 5 ). */
function PostMachining({
  side,
  choice,
  size1,
  size2,
}: {
  side: 'Top:' | 'Bottom:';
  choice: CHOICE;
  size1: UNIT;
  size2: UNIT;
}): JSX.Element {
  return (
    <GridBagSizer vgap={5} hgap={5}>
      <SizerItem pos={[0, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <StaticText label={side} disabled={choice.enabled === false} />
      </SizerItem>
      <SizerItem pos={[0, 1]} span={[1, 2]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
        <Choice
          choices={[_('None'), _('Countersink'), _('Counterbore')]}
          choice={choice}
          ariaLabel={`${side.replace(':', '')} post machining`}
        />
      </SizerItem>
      <SizerItem pos={[1, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <Label u={size1} />
      </SizerItem>
      <SizerItem pos={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <Entry u={size1} />
      </SizerItem>
      <SizerItem pos={[1, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <Units u={size1} />
      </SizerItem>
      <SizerItem pos={[2, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <Label u={size2} />
      </SizerItem>
      <SizerItem pos={[2, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <Entry u={size2} />
      </SizerItem>
      <SizerItem pos={[2, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <Units u={size2} />
      </SizerItem>
    </GridBagSizer>
  );
}

/** gbBackdrillLeftCol / gbBackdrillRightCol: a wxGridBagSizer( 3, 5 ), the size row first. */
function Backdrill({
  layerLabel,
  layer,
  size,
}: {
  layerLabel: string;
  layer: FILLED_CHOICE;
  size: UNIT;
}): JSX.Element {
  return (
    <GridBagSizer vgap={3} hgap={5}>
      <SizerItem pos={[1, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <StaticText
          label={layerLabel}
          disabled={layer.enabled === false}
          title={BACKDRILL_LAYER_TIP}
        />
      </SizerItem>
      <SizerItem pos={[1, 1]} span={[1, 2]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
        <Choice
          choices={layer.choices}
          choice={layer}
          ariaLabel={layerLabel.replace(':', '')}
          title={BACKDRILL_LAYER_TIP}
        />
      </SizerItem>
      <SizerItem pos={[0, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <Label u={size} />
      </SizerItem>
      <SizerItem pos={[0, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <Entry u={size} />
      </SizerItem>
      <SizerItem pos={[0, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
        <Units u={size} />
      </SizerItem>
    </GridBagSizer>
  );
}

/** A stackup page: pageNSizer->Add( m_stackupImageN, 0, wxALL | wxALIGN_CENTER_HORIZONTAL, 5 ). */
function StackupPage({ image }: { image: string | null }): JSX.Element {
  return (
    <BoxSizer orient={wxVERTICAL}>
      {image !== null && (
        <SizerItem flag={wxALL | wxALIGN_CENTER_HORIZONTAL} border={5}>
          <StaticBitmap bitmap={image} />
        </SizerItem>
      )}
    </BoxSizer>
  );
}

function GeneralPage(p: DIALOG_PAD_PROPERTIES_BASE_PROPS): JSX.Element {
  const holeShown = p.holeSizerShown;

  return (
    // bGeneralSizer
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem flag={wxEXPAND | wxALL} border={5}>
        {/* m_LeftBoxSizer */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
            {/* gbSizerCommon = wxGridBagSizer( 4, 0 ) */}
            <GridBagSizer vgap={4} hgap={0} growableCols={[1, 4]}>
              <SizerItem
                pos={[0, 0]}
                flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT | wxLEFT}
                border={5}
              >
                <StaticText label={_('Pad type:')} />
              </SizerItem>
              <SizerItem
                pos={[0, 1]}
                span={[1, 5]}
                flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT}
                border={5}
              >
                <Choice
                  choices={[
                    _('Through-hole'),
                    _('SMD'),
                    _('Edge Connector'),
                    _('NPTH, Mechanical'),
                    _('SMD Aperture'),
                  ]}
                  choice={p.m_padType}
                  ariaLabel="Pad type"
                />
              </SizerItem>
              <SizerItem pos={[1, 0]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <StaticText label={_('Pad number:')} disabled={p.m_padNumCtrl.enabled === false} />
              </SizerItem>
              <SizerItem
                pos={[1, 1]}
                span={[1, 5]}
                flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT}
                border={5}
              >
                <TextCtrl
                  value={p.m_padNumCtrl.value}
                  onChange={p.m_padNumCtrl.onChange}
                  disabled={p.m_padNumCtrl.enabled === false}
                  ariaLabel="Pad number"
                />
              </SizerItem>
              <SizerItem
                pos={[2, 0]}
                flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                border={5}
                shown={p.padNetShown}
              >
                <StaticText
                  label={_('Net name:')}
                  disabled={p.m_padNetSelector.enabled === false}
                />
              </SizerItem>
              <SizerItem
                pos={[2, 1]}
                span={[1, 5]}
                flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT}
                border={5}
                shown={p.padNetShown}
              >
                <NetSelector
                  netInfo={p.m_padNetSelector.netInfo}
                  netcode={p.m_padNetSelector.netcode}
                  onChange={p.m_padNetSelector.onChange}
                  disabled={p.m_padNetSelector.enabled === false}
                  ariaLabel="Net name"
                />
              </SizerItem>
              <SizerItem pos={[3, 0]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <Label u={p.m_posX} />
              </SizerItem>
              <SizerItem pos={[3, 1]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                <Entry u={p.m_posX} />
              </SizerItem>
              <SizerItem pos={[3, 2]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <Units u={p.m_posX} />
              </SizerItem>
              <SizerItem pos={[3, 3]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <Label u={p.m_posY} />
              </SizerItem>
              <SizerItem pos={[3, 4]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                <Entry u={p.m_posY} />
              </SizerItem>
              <SizerItem pos={[3, 5]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <Units u={p.m_posY} />
              </SizerItem>
            </GridBagSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={7}>
            <StaticLine />
          </SizerItem>
          <SizerItem flag={wxEXPAND} border={5} shown={p.padstackControlsShown}>
            {/* m_padstackControls */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                <StaticText label={_('Padstack mode:')} />
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                <Choice
                  choices={[_('Normal'), _('Front/Inner/Back'), _('Custom')]}
                  choice={p.m_cbPadstackMode}
                  ariaLabel="Padstack mode"
                />
              </SizerItem>
              <Spacer proportion={1} flag={wxEXPAND} border={5} />
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={10}>
                <StaticText label={_('Edit layer:')} disabled={p.m_cbEditLayer.enabled === false} />
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                <Choice
                  choices={p.m_cbEditLayer.choices}
                  choice={p.m_cbEditLayer}
                  ariaLabel="Edit layer"
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND} border={5}>
            {/* gbSizerPadOrientation = wxGridBagSizer( 4, 5 ) */}
            <GridBagSizer vgap={4} hgap={5} growableCols={[1, 4]}>
              <SizerItem pos={[0, 0]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                <StaticText label={_('Pad shape:')} />
              </SizerItem>
              <SizerItem
                pos={[0, 1]}
                span={[1, 5]}
                flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT}
                border={5}
              >
                <Choice
                  choices={[
                    _('Circular'),
                    _('Oval'),
                    _('Rectangular'),
                    _('Trapezoidal'),
                    _('Rounded rectangle'),
                    _('Chamfered rectangle'),
                    _('Chamfered with other corners rounded'),
                    _('Custom (circular base)'),
                    _('Custom (rectangular base)'),
                  ]}
                  choice={p.m_PadShapeSelector}
                  ariaLabel={_('Pad shape')}
                />
              </SizerItem>
              <SizerItem pos={[1, 0]} span={[1, 6]} flag={wxEXPAND | wxLEFT} border={25}>
                <Simplebook
                  fitSelection
                  selection={p.shapePropsPage}
                  pages={[
                    // m_emptyProps
                    <span key="empty" />,
                    // m_trapProps: fgSizerTrapProps = wxFlexGridSizer( 0, 3, 4, 0 )
                    <FlexGridSizer key="trap" cols={3} vgap={4} hgap={0} growableCols={[1]}>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                        <Label u={p.m_trapDelta} />
                      </SizerItem>
                      <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                        <Entry u={p.m_trapDelta} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                        <Units u={p.m_trapDelta} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                        <StaticText label={_('Trapezoid axis:')} />
                      </SizerItem>
                      <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                        <Choice
                          choices={[_('Horizontal'), _('Vertical')]}
                          choice={p.m_trapAxisCtrl}
                          ariaLabel="Trapezoid axis"
                        />
                      </SizerItem>
                    </FlexGridSizer>,
                    // m_roudingProps: fgSizerRoundingProps = wxFlexGridSizer( 0, 3, 4, 0 )
                    <FlexGridSizer key="round" cols={3} vgap={4} hgap={0} growableCols={[1]}>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                        <Label u={p.m_cornerRatio} title={CORNER_RATIO_TIP} />
                      </SizerItem>
                      <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                        <Entry u={p.m_cornerRatio} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                        <Units u={p.m_cornerRatio} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                        <Label
                          u={p.m_cornerRadius}
                          title={_(
                            'Corner radius.\nCan be no more than half pad width.\nThe width is the smaller value between size X and size Y.\nNote: IPC norm gives a max value = 0.25mm.',
                          )}
                        />
                      </SizerItem>
                      <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                        <Entry u={p.m_cornerRadius} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                        <Units u={p.m_cornerRadius} />
                      </SizerItem>
                    </FlexGridSizer>,
                    // m_chamferProps: fgSizerChamferProps = wxFlexGridSizer( 0, 2, 4, 0 )
                    <FlexGridSizer key="chamfer" cols={2} vgap={4} hgap={0} growableCols={[1]}>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                        <Label u={p.m_chamferRatio} title={CHAMFER_RATIO_TIP} />
                      </SizerItem>
                      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                        {/* bSizer29 */}
                        <BoxSizer orient={wxHORIZONTAL}>
                          <SizerItem
                            proportion={1}
                            flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                            border={5}
                          >
                            <Entry u={p.m_chamferRatio} />
                          </SizerItem>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                            <Units u={p.m_chamferRatio} />
                          </SizerItem>
                        </BoxSizer>
                      </SizerItem>
                      <SizerItem border={5}>
                        <StaticText label={_('Chamfer corners:')} title={CHAMFER_CORNER_TIP} />
                      </SizerItem>
                      <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                        <Corners
                          vgap={3}
                          tl={p.m_cbTopLeft}
                          tr={p.m_cbTopRight}
                          bl={p.m_cbBottomLeft}
                          br={p.m_cbBottomRight}
                        />
                      </SizerItem>
                    </FlexGridSizer>,
                    // m_mixedProps: fgMixedProps = wxFlexGridSizer( 0, 2, 4, 0 )
                    <FlexGridSizer key="mixed" cols={2} vgap={4} hgap={0} growableCols={[1]}>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                        <Label u={p.m_mixedChamferRatio} title={CHAMFER_RATIO_TIP} />
                      </SizerItem>
                      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                        {/* bSizer30 */}
                        <BoxSizer orient={wxHORIZONTAL}>
                          <SizerItem
                            proportion={1}
                            flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                            border={5}
                          >
                            <Entry u={p.m_mixedChamferRatio} />
                          </SizerItem>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                            <Units u={p.m_mixedChamferRatio} />
                          </SizerItem>
                        </BoxSizer>
                      </SizerItem>
                      <SizerItem border={5}>
                        <StaticText label={_('Chamfer corners:')} title={CHAMFER_CORNER_TIP} />
                      </SizerItem>
                      <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                        <Corners
                          vgap={2}
                          tl={p.m_cbTopLeft1}
                          tr={p.m_cbTopRight1}
                          bl={p.m_cbBottomLeft1}
                          br={p.m_cbBottomRight1}
                        />
                      </SizerItem>
                      <SizerItem flag={wxBOTTOM | wxRIGHT | wxALIGN_CENTER_VERTICAL} border={5}>
                        <Label u={p.m_mixedCornerRatio} title={CORNER_RATIO_TIP} />
                      </SizerItem>
                      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                        {/* bSizer31 */}
                        <BoxSizer orient={wxHORIZONTAL}>
                          <SizerItem
                            proportion={1}
                            flag={wxBOTTOM | wxLEFT | wxALIGN_CENTER_VERTICAL}
                            border={5}
                          >
                            <Entry u={p.m_mixedCornerRatio} />
                          </SizerItem>
                          <SizerItem
                            flag={wxBOTTOM | wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                            border={5}
                          >
                            <Units u={p.m_mixedCornerRatio} />
                          </SizerItem>
                        </BoxSizer>
                      </SizerItem>
                    </FlexGridSizer>,
                  ]}
                />
              </SizerItem>
              <SizerItem pos={[2, 0]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                <Label u={p.m_sizeX} />
              </SizerItem>
              <SizerItem pos={[2, 1]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                <Entry u={p.m_sizeX} />
              </SizerItem>
              <SizerItem pos={[2, 2]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                <Units u={p.m_sizeX} />
              </SizerItem>
              <SizerItem
                pos={[2, 3]}
                flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                border={5}
                shown={shown(p.m_sizeY)}
              >
                <Label u={p.m_sizeY} />
              </SizerItem>
              <SizerItem
                pos={[2, 4]}
                flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                border={5}
                shown={shown(p.m_sizeY)}
              >
                <Entry u={p.m_sizeY} />
              </SizerItem>
              <SizerItem
                pos={[2, 5]}
                flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
                border={5}
                shown={shown(p.m_sizeY)}
              >
                <Units u={p.m_sizeY} />
              </SizerItem>
              <SizerItem pos={[3, 0]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <Label u={p.m_pad_orientation} />
              </SizerItem>
              <SizerItem
                pos={[3, 1]}
                flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                border={5}
                minSize={[100, -1]}
              >
                {/* m_cb_padrotation: wxComboBox( "0" ) with 0, 90, -90, 180 */}
                <TextCombo
                  value={p.m_pad_orientation.value}
                  options={['0', '90', '-90', '180']}
                  onChange={p.m_pad_orientation.onChange}
                  ariaLabel={_('Angle')}
                />
              </SizerItem>
              <SizerItem pos={[3, 2]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                <Units u={p.m_pad_orientation} />
              </SizerItem>
            </GridBagSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP} border={5}>
            {/* bSizer35 */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxTOP | wxLEFT} border={5}>
                <CheckBox label={_('Offset shape from hole')} check={p.m_offsetShapeOpt} />
              </SizerItem>
              <SizerItem flag={wxTOP | wxRIGHT} border={5} shown={p.offsetCtrlsShown}>
                <StaticText label=":" />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={0} height={2} flag={wxEXPAND} border={5} />
          <SizerItem
            flag={wxEXPAND | wxLEFT | wxRESERVE_SPACE_EVEN_IF_HIDDEN}
            border={25}
            shown={p.offsetCtrlsShown}
          >
            {/* m_offsetCtrls = wxFlexGridSizer( 0, 6, 0, 5 ) */}
            <FlexGridSizer cols={6} vgap={0} hgap={5} growableCols={[1, 4]}>
              <SizerItem
                flag={wxALIGN_CENTER_VERTICAL | wxRESERVE_SPACE_EVEN_IF_HIDDEN | wxLEFT}
                border={5}
              >
                <Label u={p.m_offsetX} />
              </SizerItem>
              <SizerItem
                flag={wxEXPAND | wxRESERVE_SPACE_EVEN_IF_HIDDEN | wxALIGN_CENTER_VERTICAL}
                border={5}
              >
                <Entry u={p.m_offsetX} />
              </SizerItem>
              <SizerItem
                flag={wxALIGN_CENTER_VERTICAL | wxRESERVE_SPACE_EVEN_IF_HIDDEN | wxRIGHT}
                border={5}
              >
                <Units u={p.m_offsetX} />
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={10}>
                <Label u={p.m_offsetY} />
              </SizerItem>
              <SizerItem
                flag={wxEXPAND | wxRESERVE_SPACE_EVEN_IF_HIDDEN | wxALIGN_CENTER_VERTICAL}
                border={5}
              >
                <Entry u={p.m_offsetY} />
              </SizerItem>
              <SizerItem
                flag={wxALIGN_CENTER_VERTICAL | wxRESERVE_SPACE_EVEN_IF_HIDDEN | wxRIGHT}
                border={5}
              >
                <Units u={p.m_offsetY} />
              </SizerItem>
            </FlexGridSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={12}>
            <StaticLine />
          </SizerItem>
          <SizerItem flag={wxEXPAND} border={5} shown={holeShown}>
            {/* m_gbSizerHole = wxGridBagSizer( 4, 5 ) */}
            <GridBagSizer vgap={4} hgap={5} growableCols={[1, 4]}>
              <SizerItem pos={[0, 0]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                <StaticText
                  label={_('Hole shape:')}
                  disabled={p.m_holeShapeCtrl.enabled === false}
                />
              </SizerItem>
              <SizerItem pos={[0, 1]} span={[1, 5]} flag={wxEXPAND | wxRIGHT} border={5}>
                <Choice
                  choices={[_('Round'), _('Oblong')]}
                  choice={p.m_holeShapeCtrl}
                  ariaLabel="Hole shape"
                />
              </SizerItem>
              <SizerItem pos={[1, 0]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                <Label u={p.m_holeX} />
              </SizerItem>
              <SizerItem pos={[1, 1]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                <Entry u={p.m_holeX} />
              </SizerItem>
              <SizerItem pos={[1, 2]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                <Units u={p.m_holeX} />
              </SizerItem>
              <SizerItem
                pos={[1, 3]}
                flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                border={10}
                shown={shown(p.m_holeY)}
              >
                <Label u={p.m_holeY} />
              </SizerItem>
              <SizerItem
                pos={[1, 4]}
                flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                border={5}
                shown={shown(p.m_holeY)}
              >
                <Entry u={p.m_holeY} />
              </SizerItem>
              <SizerItem
                pos={[1, 5]}
                flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
                border={5}
                shown={shown(p.m_holeY)}
              >
                <Units u={p.m_holeY} />
              </SizerItem>
            </GridBagSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={12} shown={holeShown}>
            <StaticLine />
          </SizerItem>
          <SizerItem flag={wxEXPAND} border={5}>
            {/* fgSizerPadToDie = wxFlexGridSizer( 14, 3, 0, 0 ) */}
            <FlexGridSizer cols={3} vgap={0} hgap={0} growableCols={[1]}>
              <SizerItem flag={wxEXPAND | wxRIGHT} border={5}>
                {/* bSizer34 */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                    <CheckBox label={_('Specify pad to die length')} check={p.m_padToDieOpt} />
                  </SizerItem>
                  <SizerItem
                    flag={wxALIGN_CENTER_VERTICAL | wxRESERVE_SPACE_EVEN_IF_HIDDEN}
                    border={5}
                    shown={shown(p.m_padToDie)}
                  >
                    <Label u={p.m_padToDie} />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
              <SizerItem
                flag={wxEXPAND | wxLEFT | wxRESERVE_SPACE_EVEN_IF_HIDDEN}
                border={5}
                shown={shown(p.m_padToDie)}
              >
                <TextCtrl
                  value={p.m_padToDie.value}
                  onChange={p.m_padToDie.onChange}
                  ariaLabel="Pad to die length"
                />
              </SizerItem>
              <SizerItem
                flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRESERVE_SPACE_EVEN_IF_HIDDEN | wxRIGHT}
                border={5}
                shown={shown(p.m_padToDie)}
              >
                <Units u={p.m_padToDie} />
              </SizerItem>
              <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                {/* bSizer341 */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                    <CheckBox label={_('Specify pad to die delay')} check={p.m_padToDieDelayOpt} />
                  </SizerItem>
                  <SizerItem
                    flag={wxALIGN_CENTER_VERTICAL | wxRESERVE_SPACE_EVEN_IF_HIDDEN}
                    border={5}
                    shown={shown(p.m_padToDieDelay)}
                  >
                    <Label u={p.m_padToDieDelay} />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
              <SizerItem
                flag={wxEXPAND | wxLEFT | wxRESERVE_SPACE_EVEN_IF_HIDDEN | wxTOP}
                border={5}
                shown={shown(p.m_padToDieDelay)}
              >
                <TextCtrl
                  value={p.m_padToDieDelay.value}
                  onChange={p.m_padToDieDelay.onChange}
                  ariaLabel="Pad to die delay"
                />
              </SizerItem>
              <SizerItem flag={wxALL} border={5} shown={shown(p.m_padToDieDelay)}>
                <Units u={p.m_padToDieDelay} />
              </SizerItem>
            </FlexGridSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxALL} border={3}>
        {/* m_middleBoxSizer */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND | wxALL} border={5}>
            {/* m_LayersSizer: a wxStaticBoxSizer with no label */}
            <StaticBoxSizer label="" orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxBOTTOM} border={10} shown={p.flippedWarningShown}>
                {/* m_FlippedWarningSizer */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxALIGN_TOP | wxBOTTOM | wxTOP} border={4}>
                    <StaticBitmap bitmap={p.warningBitmap} size={[48, 48]} />
                  </SizerItem>
                  <SizerItem
                    proportion={1}
                    flag={wxALIGN_TOP | wxBOTTOM | wxLEFT | wxRIGHT}
                    border={8}
                  >
                    <StaticText
                      label={_('Parent footprint on board is flipped.\nLayers will be reversed.')}
                      wrap={150}
                    />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
              <SizerItem flag={wxRIGHT | wxLEFT} border={4}>
                <StaticText label={_('Copper layers:')} />
              </SizerItem>
              <SizerItem proportion={1} flag={wxALL | wxEXPAND | wxTOP} border={4}>
                <Choice
                  choices={p.m_rbCopperLayersSel.choices}
                  choice={p.m_rbCopperLayersSel}
                  ariaLabel={_('Copper layers')}
                />
              </SizerItem>
              <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
                {/* bSizer444 */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                    {/* SetFont( KIUI::GetStatusFont( this ) ): the GUI font on GTK */}
                    <StaticText label={_('Technical Layers')} />
                  </SizerItem>
                  <SizerItem
                    proportion={1}
                    flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT | wxLEFT}
                    border={3}
                  >
                    <StaticLine />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
              <SizerItem flag={wxLEFT | wxRIGHT} border={4}>
                <CheckBox label={p.m_layerFrontAdhesive.label} check={p.m_layerFrontAdhesive} />
              </SizerItem>
              {(
                [
                  p.m_layerBackAdhesive,
                  p.m_layerFrontPaste,
                  p.m_layerBackPaste,
                  p.m_layerFrontSilk,
                  p.m_layerBackSilk,
                  p.m_layerFrontMask,
                  p.m_layerBackMask,
                  p.m_layerUserDwgs,
                  p.m_layerECO1,
                ] as const
              ).map((c, i) => (
                // The Add() order is fixed; the index is the item's identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: one item per Add()
                <SizerItem key={i} flag={wxTOP | wxRIGHT | wxLEFT} border={4}>
                  <CheckBox label={c.label} check={c} />
                </SizerItem>
              ))}
              <SizerItem flag={wxALL} border={4}>
                <CheckBox label={p.m_layerECO2.label} check={p.m_layerECO2} />
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
            <StaticText
              label={_('Fabrication property:')}
              title={_(
                'Optional property to specify a special purpose or constraint in fabrication files:\nBGA attribute is for pads in BGA footprints\nFiducial local is a fiducial for the parent footprint\nFiducial global is a fiducial for the whole board\nTest Point specifies an electrical test point\nHeatsink specifies a thermal pad\nCastellated specifies a through hole pad on a board edge\nMechanical specifies a through-hole pad that is used for mechanical support',
              )}
            />
          </SizerItem>
          <Spacer width={0} height={2} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
            <Choice
              choices={[
                _('None'),
                _('BGA pad'),
                _('Fiducial, local to footprint'),
                _('Fiducial, global to board'),
                _('Test point pad'),
                _('Heatsink pad'),
                _('Mechanical'),
                _('Castellated pad (TH only)'),
                _('Press-fit (round TH only)'),
              ]}
              choice={p.m_choiceFabProperty}
              ariaLabel="Fabrication property"
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}

function ConnectionsPage(p: DIALOG_PAD_PROPERTIES_BASE_PROPS): JSX.Element {
  const td = p.teardropsEnabled;
  const tdCheck = (c: CHECK): CHECK => ({ ...c, enabled: td });
  const tdUnit = (u: UNIT): UNIT => ({ ...u, enabled: td });

  return (
    // bSizerPanelConnections
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
        {/* bSizerConnectionsMargins */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
            <StaticBoxSizer label={_('Teardrops')} orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxBOTTOM} border={5} shown={p.legacyTeardropsShown}>
                {/* m_legacyTeardropsWarning */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                    <StaticBitmap bitmap={p.warningBitmap} />
                  </SizerItem>
                  <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                    {/* bSizer42 */}
                    <BoxSizer orient={wxVERTICAL}>
                      <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                        <StaticText label={_('Board contains legacy teardrops.')} />
                      </SizerItem>
                      <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                        <StaticText
                          label={_('Use Edit > Edit Teardrops to apply automatic teardrops.')}
                        />
                      </SizerItem>
                    </BoxSizer>
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
              <SizerItem flag={wxEXPAND} border={5}>
                {/* bSizerCols11 */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={3}>
                    {/* bSizerLeftCol11 */}
                    <BoxSizer orient={wxVERTICAL}>
                      <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                        <CheckBox
                          label={_("Add teardrops on pad's track connections")}
                          check={tdCheck(p.m_cbTeardrops)}
                        />
                      </SizerItem>
                      <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                        <CheckBox
                          label={_('Prefer zone connection')}
                          check={tdCheck(p.m_cbPreferZoneConnection)}
                          title={_(
                            'Do not create teardrops on tracks connected to pads that are also connected to a copper zone.',
                          )}
                        />
                      </SizerItem>
                      <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                        <CheckBox
                          label={_('Allow teardrops to span 2 track segments')}
                          check={tdCheck(p.m_cbTeardropsUseNextTrack)}
                          title={_(
                            'Allows a teardrop to spread over 2 tracks if the first track segment is too short',
                          )}
                        />
                      </SizerItem>
                    </BoxSizer>
                  </SizerItem>
                  <Spacer width={15} height={0} flag={wxEXPAND} border={5} />
                  <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={10}>
                    {/* bSizerRightCol11 */}
                    <BoxSizer orient={wxVERTICAL}>
                      <SizerItem border={3}>
                        {/* bSizer39 */}
                        <BoxSizer orient={wxHORIZONTAL}>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                            <StaticText
                              label={_('Track width limit:')}
                              disabled={!td}
                              title={_(
                                'Max pad/via size to track width ratio to create a teardrop.\n100 always creates a teardrop.',
                              )}
                            />
                          </SizerItem>
                          <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                            <TeardropSpin
                              spin={p.m_spTeardropHDPercent}
                              min={0}
                              max={100}
                              enabled={td}
                              ariaLabel="Track width limit"
                              title={_(
                                'Tracks which are similar in size to the pad do not need teardrops.',
                              )}
                            />
                          </SizerItem>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                            <StaticText label="%(" disabled={!td} />
                          </SizerItem>
                          <SizerItem flag={wxBOTTOM | wxALIGN_BOTTOM} border={3}>
                            <StaticText label={p.teardropHint} italic disabled={!td} />
                          </SizerItem>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                            <StaticText label=" )" disabled={!td} />
                          </SizerItem>
                        </BoxSizer>
                      </SizerItem>
                    </BoxSizer>
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
              <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
              <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                {/* SetFont( KIUI::GetStatusFont( this ) ): the GUI font on GTK */}
                <StaticText label={_('Teardrop Shape')} disabled={!td} />
              </SizerItem>
              <SizerItem flag={wxEXPAND} border={5}>
                <StaticLine />
              </SizerItem>
              <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxRIGHT} border={5}>
                {/* bSizerShapeColumns */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={10}>
                    {/* bSizerLeftCol */}
                    <BoxSizer orient={wxVERTICAL}>
                      <SizerItem
                        proportion={1}
                        flag={wxALIGN_CENTER_HORIZONTAL | wxRIGHT | wxLEFT}
                        border={5}
                      >
                        <StaticBitmap bitmap={p.teardropBitmap} disabled={!td} />
                      </SizerItem>
                    </BoxSizer>
                  </SizerItem>
                  <Spacer width={10} height={0} flag={wxEXPAND} border={5} />
                  <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                    {/* bSizer43 */}
                    <BoxSizer orient={wxVERTICAL}>
                      <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxLEFT} border={10}>
                        {/* fgSizerRightCol = wxFlexGridSizer( 0, 3, 2, 0 ) */}
                        <FlexGridSizer cols={3} vgap={2} hgap={0} growableCols={[1]}>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                            <StaticText label={_('Best length (L):')} disabled={!td} />
                          </SizerItem>
                          <SizerItem
                            flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                            border={3}
                          >
                            <TeardropSpin
                              spin={p.m_spTeardropLenPercent}
                              min={20}
                              max={200}
                              enabled={td}
                              ariaLabel="Best length"
                            />
                          </SizerItem>
                          <SizerItem
                            proportion={1}
                            flag={wxEXPAND | wxALIGN_CENTER_VERTICAL}
                            border={5}
                          >
                            <PercentHint
                              hint={p.teardropHint}
                              enabled={td}
                              hintFlag={wxALIGN_BOTTOM}
                              hintBorder={1}
                            />
                          </SizerItem>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                            <Label u={tdUnit(p.m_teardropMaxLenSetting)} />
                          </SizerItem>
                          <SizerItem
                            flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                            border={3}
                          >
                            <Entry u={tdUnit(p.m_teardropMaxLenSetting)} />
                          </SizerItem>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                            <Units u={tdUnit(p.m_teardropMaxLenSetting)} />
                          </SizerItem>
                          <Spacer width={0} height={5} proportion={1} flag={wxEXPAND} border={5} />
                          <Spacer proportion={1} flag={wxEXPAND} border={5} />
                          <Spacer proportion={1} flag={wxEXPAND} border={5} />
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={10}>
                            <StaticText label={_('Best width (W):')} disabled={!td} />
                          </SizerItem>
                          <SizerItem
                            flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                            border={3}
                          >
                            <TeardropSpin
                              spin={p.m_spTeardropSizePercent}
                              min={60}
                              max={100}
                              enabled={td}
                              ariaLabel="Best width"
                            />
                          </SizerItem>
                          <SizerItem
                            proportion={1}
                            flag={wxEXPAND | wxALIGN_CENTER_VERTICAL}
                            border={5}
                          >
                            <PercentHint
                              hint={p.teardropHint}
                              enabled={td}
                              hintFlag={wxALIGN_BOTTOM}
                              hintBorder={1}
                            />
                          </SizerItem>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={10}>
                            <Label u={tdUnit(p.m_teardropMaxHeightSetting)} />
                          </SizerItem>
                          <SizerItem
                            flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                            border={3}
                          >
                            <Entry u={tdUnit(p.m_teardropMaxHeightSetting)} />
                          </SizerItem>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                            <Units u={tdUnit(p.m_teardropMaxHeightSetting)} />
                          </SizerItem>
                        </FlexGridSizer>
                      </SizerItem>
                      <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={8}>
                        {/* bSizer44 */}
                        <BoxSizer orient={wxHORIZONTAL}>
                          <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                            <CheckBox label={_('Curved edges')} check={tdCheck(p.m_curvedEdges)} />
                          </SizerItem>
                        </BoxSizer>
                      </SizerItem>
                    </BoxSizer>
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP} border={10}>
            {/* bSizerConnectionsLower */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                <StaticBoxSizer label={_('Connection to Copper Zones')} orient={wxVERTICAL}>
                  <SizerItem border={5}>
                    {/* fgSizerCopperZonesOpts = wxFlexGridSizer( 0, 2, 5, 0 ) */}
                    <FlexGridSizer cols={2} vgap={5} hgap={0} growableCols={[1]}>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                        <StaticText label={_('Pad connection:')} />
                      </SizerItem>
                      <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                        <Choice
                          choices={[
                            _('From parent footprint'),
                            _('Solid'),
                            _('Thermal relief'),
                            _('None'),
                          ]}
                          choice={p.m_ZoneConnectionChoice}
                          ariaLabel="Pad connection"
                        />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                        <StaticText label={_('Zone knockout:')} />
                      </SizerItem>
                      <SizerItem
                        proportion={1}
                        flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxLEFT}
                        border={5}
                      >
                        <Choice
                          choices={[_('Pad shape'), _('Pad convex hull')]}
                          choice={p.m_ZoneCustomPadShape}
                          ariaLabel="Zone knockout"
                        />
                      </SizerItem>
                    </FlexGridSizer>
                  </SizerItem>
                </StaticBoxSizer>
              </SizerItem>
              <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
                <StaticBoxSizer label={_('Thermal Relief Overrides')} orient={wxVERTICAL}>
                  <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND} border={5}>
                    {/* fgSizerThermalReliefs = wxFlexGridSizer( 0, 3, 3, 0 ) */}
                    <FlexGridSizer cols={3} vgap={3} hgap={0} growableCols={[1]}>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                        <Label u={p.m_thermalGap} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxEXPAND} border={3}>
                        <Entry u={p.m_thermalGap} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                        <Units u={p.m_thermalGap} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                        <Label u={p.m_spokeWidth} />
                      </SizerItem>
                      <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxLEFT} border={3}>
                        <Entry u={p.m_spokeWidth} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                        <Units u={p.m_spokeWidth} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                        <Label u={p.m_spokeAngle} />
                      </SizerItem>
                      <SizerItem flag={wxEXPAND | wxLEFT} border={3}>
                        <Entry u={p.m_spokeAngle} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                        <Units u={p.m_spokeAngle} />
                      </SizerItem>
                    </FlexGridSizer>
                  </SizerItem>
                </StaticBoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}

function ClearancePage(p: DIALOG_PAD_PROPERTIES_BASE_PROPS): JSX.Element {
  const note = _('Note: solder mask and paste values are used only for pads on copper layers.');

  return (
    // bSizerPanelClearance
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
        {/* bSizerClearance */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxALL | wxEXPAND} border={5}>
            <StaticBoxSizer label={_('Clearance Overrides')} orient={wxVERTICAL}>
              <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                <StaticText
                  label={_('Leave values blank to use parent footprint or netclass values.')}
                />
              </SizerItem>
              <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={5}>
                <StaticText
                  label={_(
                    'Positive clearance means area bigger than the pad (usual for mask clearance).',
                  )}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                <StaticText
                  label={_(
                    'Negative clearance means area smaller than the pad (usual for paste clearance).',
                  )}
                />
              </SizerItem>
              <SizerItem flag={wxTOP | wxBOTTOM} border={10}>
                {/* fgClearancesGridSizer = wxFlexGridSizer( 4, 3, 4, 0 ) */}
                <FlexGridSizer cols={3} vgap={4} hgap={0} growableCols={[1]}>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                    <Label
                      u={p.m_clearance}
                      title={_(
                        'This is the local net clearance for this pad.\nIf 0, the footprint local value or the Netclass value is used.',
                      )}
                    />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} border={5}>
                    <Entry u={p.m_clearance} />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                    <Units u={p.m_clearance} />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                    <Label
                      u={p.m_maskMargin}
                      title={_(
                        'This is the local clearance between this pad and the solder mask.\nIf 0, the footprint local value or the global value is used.',
                      )}
                    />
                  </SizerItem>
                  <SizerItem
                    flag={wxEXPAND | wxTOP | wxBOTTOM | wxALIGN_CENTER_VERTICAL}
                    border={15}
                  >
                    <Entry u={p.m_maskMargin} />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                    <Units u={p.m_maskMargin} />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                    {/* The derived constructor's SetToolTip replaces the base's. */}
                    <Label
                      u={p.m_pasteMargin}
                      title={_(
                        'Local solder paste clearance for this pad.\nEnter an absolute value (e.g., -0.1mm), a percentage (e.g., -5%), or both (e.g., -0.1mm - 5%).\nIf blank, the footprint or global value is used.',
                      )}
                    />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} border={5}>
                    <Entry
                      u={p.m_pasteMargin}
                      title={_(
                        'Local solder paste clearance for this pad.\nEnter an absolute value (e.g., -0.1mm), a percentage (e.g., -5%), or both (e.g., -0.1mm - 5%).\nIf blank, the footprint or global value is used.',
                      )}
                    />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                    <Units u={p.m_pasteMargin} />
                  </SizerItem>
                </FlexGridSizer>
              </SizerItem>
              <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
                <Simplebook
                  selection={p.nonCopperWarningPage}
                  pages={[
                    // notePanel: bNoteSizer
                    <BoxSizer key="note" orient={wxVERTICAL}>
                      <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={5}>
                        <StaticText label={note} font="smallInfo" italic />
                      </SizerItem>
                      <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                        {/* m_staticTextInfoPaste: empty, and nothing sets it */}
                        <StaticText label="" font="smallInfo" italic />
                      </SizerItem>
                    </BoxSizer>,
                    // warningPanel: bWarningSizer, SetMinSize( wxSize( -1, 50 ) )
                    <SizerItem key="warning" minSize={[-1, 50]}>
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxALL} border={5}>
                          <StaticBitmap bitmap={p.warningBitmap} size={[48, 48]} />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
                          <StaticText label={note} />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>,
                  ]}
                />
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}

function BackdrillPage(p: DIALOG_PAD_PROPERTIES_BASE_PROPS): JSX.Element {
  return (
    // bSizer45
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
        {/* bSizer46 */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
            <StaticBoxSizer label={_('Hole Post Machining')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                {/* bPostMachiningColumns */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                    <PostMachining
                      side="Top:"
                      choice={p.m_topPostMachining}
                      size1={p.m_topPostMachineSize1}
                      size2={p.m_topPostMachineSize2}
                    />
                  </SizerItem>
                  <Spacer width={15} height={0} flag={wxEXPAND} border={5} />
                  <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                    <PostMachining
                      side="Bottom:"
                      choice={p.m_bottomPostMachining}
                      size1={p.m_bottomPostMachineSize1}
                      size2={p.m_bottomPostMachineSize2}
                    />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP} border={5}>
            <StaticBoxSizer label={_('Backdrill')} orient={wxVERTICAL}>
              <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
                <Choice
                  choices={[_('None'), _('Top'), _('Bottom'), _('Top & bottom')]}
                  choice={p.m_backDrillChoice}
                  ariaLabel={_('Backdrill')}
                />
              </SizerItem>
              <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={3}>
                {/* bBackdrillColumns */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={15}>
                    <Backdrill
                      layerLabel={_('Top backdrill must-cut:')}
                      layer={p.m_backDrillTopLayer}
                      size={p.m_backDrillTopSize}
                    />
                  </SizerItem>
                  <Spacer width={15} height={0} flag={wxEXPAND} border={5} />
                  <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                    <Backdrill
                      layerLabel={_('Bottom backdrill must-cut:')}
                      layer={p.m_backDrillBottomLayer}
                      size={p.m_backDrillBottomSize}
                    />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}

export function DIALOG_PAD_PROPERTIES_BASE(p: DIALOG_PAD_PROPERTIES_BASE_PROPS): JSX.Element {
  const img = p.stackupImages;

  return (
    // onPadShapeSelection: "Resize the dialog if its height is too small to show all widgets".
    <DialogShim
      title={p.title}
      onClose={p.onCancel}
      fitWhenTooShortKey={p.m_PadShapeSelector.value}
    >
      {/* m_MainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={8}>
          {/* bSizerUpper */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={12}>
              <Notebook
                selection={p.m_notebook.selection}
                onPageChanged={p.m_notebook.onPageChanged}
                ariaLabel={_('Pad Properties')}
                pages={[
                  { text: _('General'), content: <GeneralPage {...p} /> },
                  { text: _('Connections'), content: <ConnectionsPage {...p} /> },
                  { text: _('Clearance Overrides'), content: <ClearancePage {...p} /> },
                  { text: _('Backdrill'), content: <BackdrillPage {...p} /> },
                ]}
              />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5} minSize={[290, -1]}>
              {/* bSizerDisplayPad, SetMinSize( wxSize( 290, -1 ) ) */}
              <BoxSizer orient={wxVERTICAL}>
                <Spacer width={0} height={25} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={7}>
                  <Simplebook
                    border="simple"
                    selection={p.stackupImagesPage}
                    pages={[
                      <StackupPage key="0" image={img.page0} />,
                      <StackupPage key="1" image={img.page1} />,
                      <StackupPage key="2" image={img.page2} />,
                      <StackupPage key="3" image={null} />,
                      <StackupPage key="4" image={img.page4} />,
                      <StackupPage key="5" image={img.page5} />,
                      <StackupPage key="6" image={img.page6} />,
                      <StackupPage key="7" image={img.page7} />,
                    ]}
                  />
                </SizerItem>
                <Spacer width={0} height={4} flag={wxEXPAND} border={5} />
                <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={2}>
                  {/* m_boardViewPanel > m_padPreviewSizer, SetMinSize( wxSize( 280, -1 ) ) */}
                  <Panel>
                    <SizerItem proportion={1} flag={wxEXPAND} minSize={[280, -1]}>
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem proportion={12} flag={wxEXPAND | wxALL} border={5}>
                          {p.m_padPreviewGAL}
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </Panel>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
          {/* bottomSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxLEFT} border={8}>
              {/* SetFont( KIUI::GetSmallInfoFont( this ) ) */}
              <StaticText label={p.m_parentInfo} font="smallInfo" />
            </SizerItem>
            <Spacer width={20} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
              <CheckBox label={_('Preview pad in sketch mode')} check={p.m_cbShowPadOutline} />
            </SizerItem>
            <Spacer width={40} height={0} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
