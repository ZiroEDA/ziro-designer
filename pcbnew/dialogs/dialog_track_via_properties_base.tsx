// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TRACK_VIA_PROPERTIES_BASE` (dialog_track_via_properties_base.cpp): the sizer tree, Add()
 * for Add(). Every control's value, enable and Show() and the events are props; the behaviour is
 * DIALOG_TRACK_VIA_PROPERTIES's (dialog_track_via_properties.tsx).
 */
import type { JSX } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { NetSelector, type NetSelectorProps } from '@ziroeda/common/widgets/net_selector.js';
import { Combo, type ComboOption } from '@ziroeda/wx/combobox.js';
import { type CHOICE, Choice, StaticLine, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import { type CHECK3, TriStateCheck } from '@ziroeda/wx/wx_checkbox.js';
import {
  wxALIGN_BOTTOM,
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
import {
  BoxSizer,
  FlexGridSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The base's fixed choice lists. */
export const VIA_TYPE_CHOICES = [
  _HKI('Through'),
  _HKI('Micro'),
  _HKI('Blind'),
  _HKI('Buried'),
] as const;
export const PADSTACK_MODE_CHOICES = [
  _HKI('Normal'),
  _HKI('Front/Inner/Back'),
  _HKI('Custom'),
] as const;
export const ANNULAR_RINGS_CHOICES = [
  _HKI('All copper layers'),
  _HKI('Start, end, and connected layers'),
  _HKI('Connected layers only'),
  _HKI('Start and end layers only'),
] as const;
export const BACKDRILL_CHOICES = [_HKI('None'), _HKI('Bottom'), _HKI('Top'), _HKI('Both')] as const;
export const POST_MACHINE_CHOICES = [
  _HKI('None'),
  _HKI('Countersink'),
  _HKI('Counterbore'),
] as const;

/** A UNIT_BINDER over a wxTextCtrl, with its label and units text. */
export interface UNIT {
  value: string;
  enabled?: boolean;
  onChange: (aValue: string) => void;
  /** The units wxStaticText's label (`EDA_UNIT_UTILS::GetLabel`). */
  units: string;
  /** The label, where the handler relabels it (post-machining's Angle:/Depth:). */
  label?: string;
}

/** A choice whose rows the window fills (`Append`), and its selection; -1 is wxNOT_FOUND. */
export interface LIST {
  rows: readonly ComboOption[];
  value: number;
  enabled?: boolean;
  onChange: (aIndex: number) => void;
}

/** A PCB_LAYER_BOX_SELECTOR: the layer rows with their swatches, keyed by layer name. */
export interface LAYERBOX {
  rows: readonly ComboOption[];
  /** The selected row's layer id, as text; UNDEFINED_LAYER's is the "None" row, or no row. */
  value: string;
  enabled?: boolean;
  onChange: (aLayer: string) => void;
}

export interface DIALOG_TRACK_VIA_PROPERTIES_BASE_PROPS {
  // ----- m_sbCommonSizer -----
  /** `m_netSelector`. */
  net: Pick<NetSelectorProps, 'netInfo' | 'netcode' | 'indeterminateString' | 'onChange'> & {
    enabled?: boolean;
  };
  /** `m_viaNotFree`, `onViaNotFreeClicked`; Hide()-n without vias. */
  m_viaNotFree: CHECK3;
  viaNotFreeShown: boolean;
  m_lockedCbox: CHECK3;
  // ----- m_sbTrackSizer -----
  /** `m_MainSizer->Hide( m_sbTrackSizer )` without tracks. */
  tracksShown: boolean;
  m_trackStartX: UNIT;
  m_trackStartY: UNIT;
  m_trackEndX: UNIT;
  m_trackEndY: UNIT;
  /** `m_predefinedTrackWidthsCtrl`, `onWidthSelect`. */
  m_predefinedTrackWidthsCtrl: LIST;
  predefinedTrackWidthsUnits: string;
  /** `m_trackWidth`, `onWidthEdit`. */
  m_trackWidth: UNIT;
  m_TrackLayerCtrl: LAYERBOX;
  /** `onTrackEdit`'s enables: the technical layers label and the mask check. */
  techLayersEnabled: boolean;
  m_trackHasSolderMask: CHECK3;
  m_trackMaskMargin: UNIT;
  // ----- m_sbViaSizer -----
  /** `m_MainSizer->Hide( m_sbViaSizer )` without vias. */
  viasShown: boolean;
  m_viaX: UNIT;
  m_viaY: UNIT;
  /** `m_predefinedViaSizesCtrl`, `onViaSelect`. */
  m_predefinedViaSizesCtrl: LIST;
  predefinedViaSizesUnits: string;
  /** `m_cbPadstackMode`, `onPadstackModeChanged`. */
  m_cbPadstackMode: CHOICE;
  /** `m_cbEditLayer`, `onEditLayerChanged`. */
  m_cbEditLayer: LIST;
  m_viaDiameter: UNIT;
  m_viaDrill: UNIT;
  m_ViaTypeChoice: CHOICE;
  m_ViaStartLayer: LAYERBOX;
  m_ViaEndLayer: LAYERBOX;
  /** `m_annularRingsLabel` / `m_annularRingsCtrl`'s Show( getLayerDepth() > 1 ). */
  annularRingsShown: boolean;
  m_annularRingsCtrl: CHOICE;
  /** `m_protectionFeatures`: the IPC-4761 presets the mixin appends. */
  m_protectionFeatures: LIST;
  /** `m_backdrillChoice`, `onBackdrillChange`. */
  m_backdrillChoice: CHOICE;
  m_backdrillFrontSize: UNIT;
  m_backdrillFrontLayer: LAYERBOX;
  m_backdrillBackSize: UNIT;
  m_backdrillBackLayer: LAYERBOX;
  /** `m_topPostMachine`, `onTopPostMachineChange`, and its two binders. */
  m_topPostMachine: CHOICE;
  m_topPostMachineSize1: UNIT;
  m_topPostMachineSize2: UNIT;
  m_bottomPostMachine: CHOICE;
  m_bottomPostMachineSize1: UNIT;
  m_bottomPostMachineSize2: UNIT;
  /** `m_legacyTeardropsWarning->Show( LegacyTeardrops() )`. */
  legacyTeardropsShown: boolean;
  /** `onTeardropsUpdateUi`: the teardrop controls are enabled unless the board has legacy ones. */
  teardropsEnabled: boolean;
  m_cbTeardrops: CHECK3;
  m_cbTeardropsUseNextTrack: CHECK3;
  m_teardropHDPercent: UNIT;
  m_teardropLenPercent: UNIT;
  m_teardropMaxLen: UNIT;
  m_teardropWidthPercent: UNIT;
  m_teardropMaxWidth: UNIT;
  m_curvedEdges: CHECK3;
  onOK: () => void;
  onCancel: () => void;
}

/** A wxStaticText that is a UNIT_BINDER's label or units, greyed with it. */
function Label({ text, enabled }: { text: string; enabled?: boolean }): JSX.Element {
  return <StaticText label={text} disabled={enabled === false} />;
}

function Ctrl({ unit, ariaLabel, title }: { unit: UNIT; ariaLabel: string; title?: string }) {
  return (
    <TextCtrl
      value={unit.value}
      onChange={unit.onChange}
      disabled={unit.enabled === false}
      ariaLabel={ariaLabel}
      title={title}
    />
  );
}

function List({ list, ariaLabel, title }: { list: LIST; ariaLabel: string; title?: string }) {
  return (
    <span title={title}>
      <Combo
        value={list.value < 0 ? '' : String(list.value)}
        options={list.rows}
        onChange={(v) => list.onChange(Number(v))}
        disabled={list.enabled === false}
        ariaLabel={ariaLabel}
      />
    </span>
  );
}

function LayerBox({ box, ariaLabel, title }: { box: LAYERBOX; ariaLabel: string; title?: string }) {
  return (
    <span title={title}>
      <Combo
        value={box.value}
        options={box.rows}
        onChange={box.onChange}
        disabled={box.enabled === false}
        ariaLabel={ariaLabel}
      />
    </span>
  );
}

/** A post-machining column (fgSizer9 / fgSizer10): the choice, Size and the second binder. */
function PostMachine({
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
    <FlexGridSizer cols={3} vgap={0} hgap={0} growableCols={[1]}>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
        <StaticText label={side} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxTOP | wxBOTTOM} border={3}>
        <Choice
          choices={POST_MACHINE_CHOICES}
          choice={choice}
          ariaLabel={`${side.replace(':', '')} post-machining`}
        />
      </SizerItem>
      <Spacer proportion={1} flag={wxEXPAND} border={5} />
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
        <Label text={_('Size:')} enabled={size1.enabled} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxTOP | wxBOTTOM} border={2}>
        <Ctrl unit={size1} ariaLabel={`${side.replace(':', '')} post-machining size`} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
        <Label text={size1.units} enabled={size1.enabled} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
        <Label text={size2.label ?? _('Angle:')} enabled={size2.enabled} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxTOP | wxBOTTOM} border={2}>
        <Ctrl
          unit={size2}
          ariaLabel={`${side.replace(':', '')} post-machining ${(size2.label ?? _('Angle:')).replace(':', '').toLowerCase()}`}
        />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
        <Label text={size2.units} enabled={size2.enabled} />
      </SizerItem>
    </FlexGridSizer>
  );
}

export function DIALOG_TRACK_VIA_PROPERTIES_BASE(
  p: DIALOG_TRACK_VIA_PROPERTIES_BASE_PROPS,
): JSX.Element {
  const td = p.teardropsEnabled;
  const tdUnit = (u: UNIT): UNIT => ({ ...u, enabled: td && u.enabled !== false });

  return (
    <DialogShim title={_('Track & Via Properties')} onClose={p.onCancel}>
      {/* m_MainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={10}>
          <StaticBoxSizer label={_('Common')} orient={wxVERTICAL}>
            <SizerItem proportion={5} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              {/* bSizerNetWidgets */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={10}>
                  {/* bNetWidgetsLeftCol */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={1}>
                      <Label text={_('Net:')} enabled={p.net.enabled} />
                    </SizerItem>
                    <SizerItem
                      proportion={1}
                      flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                      border={5}
                    >
                      {/* m_netSelector: NET_SELECTOR */}
                      <NetSelector
                        netInfo={p.net.netInfo}
                        netcode={p.net.netcode}
                        indeterminateString={p.net.indeterminateString}
                        onChange={p.net.onChange}
                        disabled={p.net.enabled === false}
                        ariaLabel="Net"
                      />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                  {/* bNetWidgetsRightCol */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                      border={5}
                      shown={p.viaNotFreeShown}
                    >
                      <TriStateCheck
                        label={_('Automatically update via nets')}
                        title={_(
                          'Automatically change the net of this via when the pads or zones it touches are changed',
                        )}
                        check={p.m_viaNotFree}
                      />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxBOTTOM} border={2}>
              <StaticLine />
            </SizerItem>
            <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxTOP | wxBOTTOM | wxLEFT} border={4}>
              <TriStateCheck label={_('Locked')} check={p.m_lockedCbox} />
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={10} shown={p.tracksShown}>
          <StaticBoxSizer label={_('Tracks')} orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              {/* bSizerTracksLeftCol */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxBOTTOM} border={8}>
                  {/* fgTrackEnds = wxFlexGridSizer( 7, 5, 3, 3 ), AddGrowableCol( 1 ), ( 3 ) */}
                  <FlexGridSizer cols={5} vgap={3} hgap={3} growableCols={[1, 3]}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={1}>
                      <Label text={_('Start X:')} enabled={p.m_trackStartX.enabled} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={3}>
                      <Ctrl unit={p.m_trackStartX} ariaLabel="Start X" />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={8}>
                      <Label text="Y:" enabled={p.m_trackStartY.enabled} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={3}>
                      <Ctrl unit={p.m_trackStartY} ariaLabel="Start Y" />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <Label text={p.m_trackStartY.units} enabled={p.m_trackStartY.enabled} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={1}>
                      <Label text={_('End X:')} enabled={p.m_trackEndX.enabled} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={3}>
                      <Ctrl unit={p.m_trackEndX} ariaLabel={_HKI('End X')} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={8}>
                      <Label text="Y:" enabled={p.m_trackEndY.enabled} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={3}>
                      <Ctrl unit={p.m_trackEndY} ariaLabel={_HKI('End Y')} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={8}>
                      <Label text={p.m_trackEndY.units} enabled={p.m_trackEndY.enabled} />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
                  {/* gbSizer1 = wxGridBagSizer( 3, 3 ), SetEmptyCellSize( -1, 0 ), AddGrowableCol( 1 ) */}
                  <GridBagSizer vgap={3} hgap={3} emptyCellSize={[0, 0]} growableCols={[1]}>
                    <SizerItem pos={[1, 0]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={1}>
                      <StaticText label={_('Pre-defined sizes:')} />
                    </SizerItem>
                    <SizerItem
                      pos={[1, 1]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxTOP | wxBOTTOM}
                      border={3}
                    >
                      <List
                        list={p.m_predefinedTrackWidthsCtrl}
                        ariaLabel="Pre-defined track widths"
                      />
                    </SizerItem>
                    <SizerItem pos={[1, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={p.predefinedTrackWidthsUnits} />
                    </SizerItem>
                    <SizerItem pos={[2, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <Label text={_('Track width:')} enabled={p.m_trackWidth.enabled} />
                    </SizerItem>
                    <SizerItem pos={[2, 1]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                      <Ctrl unit={p.m_trackWidth} ariaLabel={_HKI('Track width')} />
                    </SizerItem>
                    <SizerItem pos={[2, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <Label text={p.m_trackWidth.units} enabled={p.m_trackWidth.enabled} />
                    </SizerItem>
                  </GridBagSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <Spacer flag={wxEXPAND | wxRIGHT | wxLEFT} border={15} />
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bSizerTrackRightControl */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxRIGHT} border={3}>
                  {/* fgTrackRightSizer = wxFlexGridSizer( 1, 3, 3, 5 ), AddGrowableCol( 2 ) */}
                  <FlexGridSizer cols={3} vgap={3} hgap={5} growableCols={[2]}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <StaticText label={_('Layer:')} />
                    </SizerItem>
                    <Spacer width={25} height={0} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT} border={5}>
                      <LayerBox box={p.m_TrackLayerCtrl} ariaLabel="Track layer" />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND} border={3}>
                  {/* bSizerTechLayers */}
                  <BoxSizer orient={wxVERTICAL}>
                    <Spacer width={0} height={15} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxEXPAND} border={5}>
                      {/* bSizer26 */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                          {/* m_techLayersLabel: KIUI::GetSmallInfoFont */}
                          <StaticText
                            label={_('Technical Layers')}
                            font="smallInfo"
                            disabled={!p.techLayersEnabled}
                          />
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
                    <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={2}>
                      {/* fgSizerTrackMaskMargin = wxFlexGridSizer( 0, 4, 3, 5 ), AddGrowableCol( 2 ) */}
                      <FlexGridSizer cols={4} vgap={3} hgap={5} growableCols={[2]}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                          <TriStateCheck label={_('Solder mask')} check={p.m_trackHasSolderMask} />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                          <Label text={_('Expansion:')} enabled={p.m_trackMaskMargin.enabled} />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                          <Ctrl
                            unit={p.m_trackMaskMargin}
                            ariaLabel="Solder mask expansion"
                            title={_(
                              'This is the local clearance between the track and the solder mask opening.\nLeave blank to use the value defined in the Board Setup.',
                            )}
                          />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                          <Label
                            text={p.m_trackMaskMargin.units}
                            enabled={p.m_trackMaskMargin.enabled}
                          />
                        </SizerItem>
                      </FlexGridSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10} shown={p.viasShown}>
          <StaticBoxSizer label={_('Vias')} orient={wxVERTICAL}>
            <SizerItem flag={wxALL | wxEXPAND} border={5}>
              {/* bSizerViaCols */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* bSizerViasLeftCol */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={wxEXPAND | wxBOTTOM} border={8}>
                      {/* fgViaPos = wxFlexGridSizer( 6, 5, 4, 2 ), AddGrowableCol( 1 ), ( 3 ) */}
                      <FlexGridSizer cols={5} vgap={4} hgap={2} growableCols={[1, 3]}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={1}>
                          <Label text={_('Position X:')} enabled={p.m_viaX.enabled} />
                        </SizerItem>
                        <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} border={3}>
                          <Ctrl unit={p.m_viaX} ariaLabel={_HKI('Position X')} />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={8}>
                          <Label text="Y:" enabled={p.m_viaY.enabled} />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={3}>
                          <Ctrl unit={p.m_viaY} ariaLabel={_HKI('Position Y')} />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <Label text={p.m_viaY.units} enabled={p.m_viaY.enabled} />
                        </SizerItem>
                      </FlexGridSizer>
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
                      {/* gbSizer3 = wxGridBagSizer( 3, 3 ), SetEmptyCellSize( -1, 0 ), AddGrowableCol( 1 ) */}
                      <GridBagSizer vgap={3} hgap={3} emptyCellSize={[0, 0]} growableCols={[1]}>
                        <SizerItem pos={[1, 0]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={1}>
                          <StaticText label={_('Pre-defined sizes:')} />
                        </SizerItem>
                        <SizerItem
                          pos={[1, 1]}
                          flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxTOP | wxBOTTOM}
                          border={3}
                        >
                          <List
                            list={p.m_predefinedViaSizesCtrl}
                            ariaLabel="Pre-defined via sizes"
                          />
                        </SizerItem>
                        <SizerItem pos={[1, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <StaticText label={p.predefinedViaSizesUnits} />
                        </SizerItem>
                        <SizerItem pos={[2, 0]} span={[1, 3]} flag={wxEXPAND} border={0}>
                          {/* m_sbPadstackSettings */}
                          <BoxSizer orient={wxHORIZONTAL}>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <StaticText label={_('Padstack mode:')} />
                            </SizerItem>
                            <SizerItem flag={wxALL} border={5}>
                              <Choice
                                choices={PADSTACK_MODE_CHOICES}
                                choice={p.m_cbPadstackMode}
                                ariaLabel="Padstack mode"
                              />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                              <Label text={_('Edit layer:')} enabled={p.m_cbEditLayer.enabled} />
                            </SizerItem>
                            <SizerItem flag={wxTOP | wxBOTTOM | wxLEFT} border={5}>
                              <List list={p.m_cbEditLayer} ariaLabel="Edit layer" />
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                        <SizerItem pos={[3, 0]} flag={wxLEFT | wxALIGN_CENTER_VERTICAL} border={1}>
                          <Label text={_('Via diameter:')} enabled={p.m_viaDiameter.enabled} />
                        </SizerItem>
                        <SizerItem
                          pos={[3, 1]}
                          flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                          border={5}
                        >
                          <Ctrl unit={p.m_viaDiameter} ariaLabel={_HKI('Via diameter')} />
                        </SizerItem>
                        <SizerItem pos={[3, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <Label text={p.m_viaDiameter.units} enabled={p.m_viaDiameter.enabled} />
                        </SizerItem>
                        <SizerItem pos={[4, 0]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={1}>
                          <Label text={_('Via hole:')} enabled={p.m_viaDrill.enabled} />
                        </SizerItem>
                        <SizerItem
                          pos={[4, 1]}
                          flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                          border={5}
                        >
                          <Ctrl unit={p.m_viaDrill} ariaLabel="Via hole" />
                        </SizerItem>
                        <SizerItem pos={[4, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <Label text={p.m_viaDrill.units} enabled={p.m_viaDrill.enabled} />
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <Spacer flag={wxEXPAND | wxRIGHT | wxLEFT} border={15} />
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* viaRightColumn > gbSizer4 = wxGridBagSizer( 1, 0 ), AddGrowableCol( 1 ) */}
                  <GridBagSizer vgap={1} hgap={0} growableCols={[1]}>
                    <SizerItem
                      pos={[0, 0]}
                      flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                      border={5}
                    >
                      <Label text={_('Via type:')} enabled={p.m_ViaTypeChoice.enabled} />
                    </SizerItem>
                    <SizerItem
                      pos={[0, 1]}
                      flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxBOTTOM}
                      border={2}
                    >
                      <Choice
                        choices={VIA_TYPE_CHOICES}
                        choice={p.m_ViaTypeChoice}
                        ariaLabel="Via type"
                      />
                    </SizerItem>
                    <SizerItem
                      pos={[1, 0]}
                      flag={wxALIGN_LEFT | wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <Label text={_('Start layer:')} enabled={p.m_ViaStartLayer.enabled} />
                    </SizerItem>
                    <SizerItem pos={[1, 1]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                      <LayerBox box={p.m_ViaStartLayer} ariaLabel="Start layer" />
                    </SizerItem>
                    <SizerItem
                      pos={[2, 0]}
                      flag={wxALIGN_LEFT | wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <Label text={_('End layer:')} enabled={p.m_ViaEndLayer.enabled} />
                    </SizerItem>
                    <SizerItem pos={[2, 1]} flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} border={5}>
                      <LayerBox box={p.m_ViaEndLayer} ariaLabel="End layer" />
                    </SizerItem>
                    <SizerItem
                      pos={[4, 0]}
                      flag={wxALIGN_LEFT | wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                      border={5}
                      shown={p.annularRingsShown}
                    >
                      <StaticText label={_('Annular rings:')} />
                    </SizerItem>
                    <SizerItem
                      pos={[4, 1]}
                      flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM}
                      border={3}
                      shown={p.annularRingsShown}
                    >
                      <Choice
                        choices={ANNULAR_RINGS_CHOICES}
                        choice={p.m_annularRingsCtrl}
                        ariaLabel="Annular rings"
                      />
                    </SizerItem>
                    <SizerItem
                      pos={[5, 0]}
                      flag={wxALIGN_LEFT | wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <StaticText label={_('Protection features:')} />
                    </SizerItem>
                    <SizerItem
                      pos={[5, 1]}
                      flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM}
                      border={3}
                    >
                      <List
                        list={p.m_protectionFeatures}
                        ariaLabel="Protection features"
                        title={_(
                          'Select which protection feature according to IPC-4761 the via should have.',
                        )}
                      />
                    </SizerItem>
                  </GridBagSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* bBackdrillLabel */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem
                  proportion={1}
                  flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM | wxRIGHT}
                  border={3}
                >
                  <StaticLine />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* bSizerBackdrill */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} border={5}>
                  {/* fgSizer6 = wxFlexGridSizer( 0, 2, 0, 0 ) */}
                  <FlexGridSizer cols={2} vgap={0} hgap={0}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Backdrill:')} />
                    </SizerItem>
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <Choice
                        choices={BACKDRILL_CHOICES}
                        choice={p.m_backdrillChoice}
                        ariaLabel="Backdrill"
                      />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
                <SizerItem proportion={2} flag={wxEXPAND} border={5}>
                  {/* fgSizer7 = wxFlexGridSizer( 0, 2, 2, 0 ) */}
                  <FlexGridSizer cols={2} vgap={2} hgap={0}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <Label
                        text={_('Top backdrill size:')}
                        enabled={p.m_backdrillFrontSize.enabled}
                      />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {/* bSizer31 */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                          <Ctrl unit={p.m_backdrillFrontSize} ariaLabel="Top backdrill size" />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                          <Label
                            text={p.m_backdrillFrontSize.units}
                            enabled={p.m_backdrillFrontSize.enabled}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <Label
                        text={_('Top backdrill must-cut:')}
                        enabled={p.m_backdrillFrontLayer.enabled}
                      />
                    </SizerItem>
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <LayerBox box={p.m_backdrillFrontLayer} ariaLabel="Top backdrill must-cut" />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
                <SizerItem proportion={2} flag={wxEXPAND} border={5}>
                  {/* fgSizer8 = wxFlexGridSizer( 0, 2, 2, 0 ) */}
                  <FlexGridSizer cols={2} vgap={2} hgap={0}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <Label
                        text={_('Bottom backdrill size:')}
                        enabled={p.m_backdrillBackSize.enabled}
                      />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {/* bSizer32 */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                          <Ctrl unit={p.m_backdrillBackSize} ariaLabel="Bottom backdrill size" />
                        </SizerItem>
                        <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                          <Label
                            text={p.m_backdrillBackSize.units}
                            enabled={p.m_backdrillBackSize.enabled}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM | wxLEFT}
                      border={5}
                    >
                      <Label
                        text={_('Bottom backdrill must-cut:')}
                        enabled={p.m_backdrillBackLayer.enabled}
                      />
                    </SizerItem>
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <LayerBox
                        box={p.m_backdrillBackLayer}
                        ariaLabel="Bottom backdrill must-cut"
                        title={_('The backdrill must pass through this layer')}
                      />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* bPostMachineLabel */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
                  {/* m_postMachineSectionLabel: KIUI::GetSmallInfoFont */}
                  <StaticText label={_('Hole Post-machining')} font="smallInfo" />
                </SizerItem>
                <SizerItem
                  proportion={1}
                  flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT}
                  border={3}
                >
                  <StaticLine />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* bSizerPostMachine */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  <PostMachine
                    side="Top:"
                    choice={p.m_topPostMachine}
                    size1={p.m_topPostMachineSize1}
                    size2={p.m_topPostMachineSize2}
                  />
                </SizerItem>
                <Spacer flag={wxEXPAND | wxLEFT | wxRIGHT} border={15} />
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  <PostMachine
                    side="Bottom:"
                    choice={p.m_bottomPostMachine}
                    size1={p.m_bottomPostMachineSize1}
                    size2={p.m_bottomPostMachineSize2}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={8}>
              <StaticLine />
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5} shown={p.legacyTeardropsShown}>
              {/* m_legacyTeardropsWarning */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  {/* m_legacyTeardropsIcon: dialog_warning */}
                  <img src={bitmapUrl('dialog_warning')} alt="" />
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
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bSizerTeardrops */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxTOP} border={3}>
                  {/* bSizerCols11 */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxLEFT} border={1}>
                      {/* bSizerLeftCol11 */}
                      <BoxSizer orient={wxVERTICAL}>
                        <Spacer width={0} height={2} flag={wxEXPAND} border={5} />
                        <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={3}>
                          <TriStateCheck
                            label={_("Add teardrops on via's track connections")}
                            check={{
                              ...p.m_cbTeardrops,
                              enabled: td && p.m_cbTeardrops.enabled !== false,
                            }}
                          />
                        </SizerItem>
                        <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                          <TriStateCheck
                            label={_('Allow teardrops to span two track segments')}
                            title={_(
                              'Allows a teardrop to extend over the first 2 connected track segments if the first track segment is too short to accommodate the best length.',
                            )}
                            check={{
                              ...p.m_cbTeardropsUseNextTrack,
                              enabled: td && p.m_cbTeardropsUseNextTrack.enabled !== false,
                            }}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
                    <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={10}>
                      {/* bSizerRightCol11 */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem flag={wxEXPAND} border={3}>
                          {/* bSizer39 */}
                          <BoxSizer orient={wxHORIZONTAL}>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <span
                                title={_(
                                  'Max pad/via size to track width ratio to create a teardrop.\n100 always creates a teardrop.',
                                )}
                              >
                                <Label text={_('Maximum track width:')} enabled={td} />
                              </span>
                            </SizerItem>
                            <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                              <Ctrl
                                unit={tdUnit(p.m_teardropHDPercent)}
                                ariaLabel="Maximum track width"
                                title={_(
                                  'Tracks which are similar in size to the via do not need teardrops.',
                                )}
                              />
                            </SizerItem>
                            <SizerItem flag={wxRIGHT | wxALIGN_CENTER_VERTICAL} border={5}>
                              <Label text="%" enabled={td} />
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                        <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
                          {/* bSizer17 > m_minTrackWidthHint: KIUI::GetInfoFont().Italic() */}
                          <BoxSizer orient={wxVERTICAL}>
                            <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={2}>
                              <StaticText
                                label={_('(as a percentage of pad/via/track size)')}
                                font="info"
                                italic
                                disabled={!td}
                              />
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
                <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={3}>
                  {/* bSizerShapeColumns */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={10}>
                      {/* bSizerLeftCol > m_bitmapTeardrop: teardrop_sizes */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem proportion={1} flag={wxALIGN_CENTER_HORIZONTAL} border={5}>
                          <img
                            src={bitmapUrl('teardrop_sizes')}
                            alt=""
                            style={td ? undefined : { opacity: 0.5 }}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {/* bSizer20 */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem
                          proportion={1}
                          flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP}
                          border={5}
                        >
                          {/* fgSizerRightCol = wxFlexGridSizer( 0, 3, 3, 5 ), AddGrowableCol( 1 ) */}
                          <FlexGridSizer cols={3} vgap={3} hgap={5} growableCols={[1]}>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                              <Label text={_('Best length (L):')} enabled={td} />
                            </SizerItem>
                            <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} border={5}>
                              <Ctrl unit={tdUnit(p.m_teardropLenPercent)} ariaLabel="Best length" />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              {/* bSizer131: "%(", the italic "d", " )" */}
                              <BoxSizer orient={wxHORIZONTAL}>
                                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                                  <Label text="%(" enabled={td} />
                                </SizerItem>
                                <SizerItem flag={wxALIGN_BOTTOM} border={1}>
                                  <StaticText label="d" italic disabled={!td} />
                                </SizerItem>
                                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                                  <Label text=" )" enabled={td} />
                                </SizerItem>
                              </BoxSizer>
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                              <Label text={_('Maximum length (L):')} enabled={td} />
                            </SizerItem>
                            <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} border={5}>
                              <Ctrl unit={tdUnit(p.m_teardropMaxLen)} ariaLabel="Maximum length" />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={3}>
                              <Label text={p.m_teardropMaxLen.units} enabled={td} />
                            </SizerItem>
                            <Spacer
                              width={0}
                              height={3}
                              proportion={1}
                              flag={wxEXPAND}
                              border={5}
                            />
                            <Spacer proportion={1} flag={wxEXPAND} border={5} />
                            <Spacer proportion={1} flag={wxEXPAND} border={5} />
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                              <Label text={_('Best width (W):')} enabled={td} />
                            </SizerItem>
                            <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} border={5}>
                              <Ctrl
                                unit={tdUnit(p.m_teardropWidthPercent)}
                                ariaLabel="Best width"
                              />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              {/* bSizer1311 */}
                              <BoxSizer orient={wxHORIZONTAL}>
                                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                                  <Label text="%(" enabled={td} />
                                </SizerItem>
                                <SizerItem flag={wxALIGN_BOTTOM} border={1}>
                                  <StaticText label="d" italic disabled={!td} />
                                </SizerItem>
                                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                                  <Label text=" )" enabled={td} />
                                </SizerItem>
                              </BoxSizer>
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                              <Label text={_('Maximum width (W):')} enabled={td} />
                            </SizerItem>
                            <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL} border={5}>
                              <Ctrl unit={tdUnit(p.m_teardropMaxWidth)} ariaLabel="Maximum width" />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={3}>
                              <Label text={p.m_teardropMaxWidth.units} enabled={td} />
                            </SizerItem>
                          </FlexGridSizer>
                        </SizerItem>
                        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxTOP} border={5}>
                          {/* bSizer44 */}
                          <BoxSizer orient={wxHORIZONTAL}>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                              <TriStateCheck
                                label={_('Curved edges')}
                                check={{
                                  ...p.m_curvedEdges,
                                  enabled: td && p.m_curvedEdges.enabled !== false,
                                }}
                              />
                            </SizerItem>
                            <Spacer width={45} height={0} border={5} />
                          </BoxSizer>
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
      </BoxSizer>
      {/* m_StdButtons: wxEXPAND|wxALL 5 */}
      <StdDialogButtonSizer onCancel={p.onCancel} onOk={p.onOK} />
    </DialogShim>
  );
}
