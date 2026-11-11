// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_OUTSET_ITEMS` (`pcbnew/dialogs/dialog_outset_items.cpp`): CONVERT_TOOL::OutsetItems'
 * outset distance, rounding, layer and width, edited into the tool's persistent
 * OUTSET_ROUTINE::PARAMETERS on OK.
 *
 * The three entries are wxComboBoxes whose lists are the presets plus the session's recent
 * values, sorted and unique (fillOptionList); OK adds the values used to the recent lists. The
 * grid pitch persists for the session even while rounding is off.
 *
 * `DialogOutsetItems` below is the window, DIALOG_OUTSET_ITEMS_BASE over the class.
 */
import { type JSX, useReducer, useState } from 'react';
import { MessageDialogError } from '@ziroeda/common/dialogs/dialog_message.js';
import { toCssColor } from '@ziroeda/common/gal/color4d.js';
import { pcbIUScale, unitLabel } from '@ziroeda/common/eda_units.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { type PCB_LAYER_ID, ToLAYER_ID } from '@ziroeda/common/layer_id.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import { PCB_LAYER_BOX_SELECTOR } from '../pcb_layer_box_selector.js';
import type { OUTSET_PARAMETERS } from '../tools/item_modification_routine.js';
import { DIALOG_OUTSET_ITEMS_BASE, type UNIT_COMBO } from './dialog_outset_items_base.js';
import { _ } from '@ziroeda/wx/translation.js';

/** Some handy preset values for common outset distances. */
const s_outsetPresetValue: readonly number[] = [
  // Outsetting a 0.1mm line to touch a 0.1mm line
  pcbIUScale.mmToIU(0.1),
  // 0.12mm line to touch a 0.1mm line
  pcbIUScale.mmToIU(0.11),
  // IPC dense courtyard
  pcbIUScale.mmToIU(0.15),
  // IPC normal courtyard
  pcbIUScale.mmToIU(0.25),
  // Keep 0.12mm silkscreen line 0.2mm from copper
  pcbIUScale.mmToIU(0.26),
  // IPC connector courtyard
  pcbIUScale.mmToIU(0.5),
  // Common router bits
  pcbIUScale.mmToIU(1.0),
  pcbIUScale.mmToIU(2.0),
];

// The user can also get the current board design settings widths with the "Layer Default"
// button.
const s_presetLineWidths: readonly number[] = [
  // Courtyard
  pcbIUScale.mmToIU(0.05),
  pcbIUScale.mmToIU(0.1),
  // Silkscreen
  pcbIUScale.mmToIU(0.12),
  pcbIUScale.mmToIU(0.15),
  pcbIUScale.mmToIU(0.2),
];

const s_presetGridRounding: readonly number[] = [
  // 0.01 is a common IPC grid round-off value
  pcbIUScale.mmToIU(0.01),
];

let s_gridRoundValuePersist = s_presetGridRounding[0]!;
const s_outsetRecentValues: number[] = [];
const s_lineWidthRecentValues: number[] = [];
const s_gridRoundingRecentValues: number[] = [];

export class DIALOG_OUTSET_ITEMS {
  private readonly m_parent: PCB_BASE_FRAME;
  private readonly m_params: OUTSET_PARAMETERS;

  readonly m_outset: UNIT_BINDER;
  readonly m_lineWidth: UNIT_BINDER;
  readonly m_roundingGrid: UNIT_BINDER;
  readonly m_LayerSelectionCtrl = new PCB_LAYER_BOX_SELECTOR();
  m_layerSelectionEnabled = true;
  m_roundCorners = false;
  /** `m_roundToGrid->SetValue( true )` in the base. */
  m_roundToGrid = true;
  m_copyLayers = false;
  m_copyWidths = false;
  m_deleteSourceItems = false;
  /** `DisplayErrorMessage( this, … )`, answered by the window. */
  m_error: string | null = null;

  constructor(aParent: PCB_BASE_FRAME, aParams: OUTSET_PARAMETERS) {
    this.m_parent = aParent;
    this.m_params = aParams;
    this.m_outset = new UNIT_BINDER(aParent, _('Outset:'));
    this.m_lineWidth = new UNIT_BINDER(aParent, _('Line width:'));
    this.m_roundingGrid = new UNIT_BINDER(aParent, _('Grid size:'));

    this.m_LayerSelectionCtrl.ShowNonActivatedLayers(false);
    this.m_LayerSelectionCtrl.SetLayersHotkeys(false);
    this.m_LayerSelectionCtrl.SetBoardFrame(aParent);
    this.m_LayerSelectionCtrl.Resync();

    const fillOptionList = (
      aCombo: UNIT_BINDER,
      aPresets: readonly number[],
      aRecentPresets: readonly number[],
    ): void => {
      // Sort the vector and remove duplicates
      const optionList = [...new Set([...aPresets, ...aRecentPresets])].sort((a, b) => a - b);
      aCombo.SetOptionsList(optionList);
    };

    fillOptionList(this.m_outset, s_outsetPresetValue, s_outsetRecentValues);
    fillOptionList(this.m_lineWidth, s_presetLineWidths, s_lineWidthRecentValues);
    fillOptionList(this.m_roundingGrid, s_presetGridRounding, s_gridRoundingRecentValues);
  }

  OnLayerDefaultClick(): void {
    const settings = this.m_parent.GetBoard()!.GetDesignSettings();
    const selLayer = ToLAYER_ID(this.m_LayerSelectionCtrl.GetLayerSelection());
    const defaultWidth = settings.GetLineThickness(selLayer);

    this.m_lineWidth.SetValue(defaultWidth);
  }

  OnCopyLayersChecked(): void {
    this.m_layerSelectionEnabled = !this.m_copyLayers;
  }

  OnRoundToGridChecked(): void {
    this.m_roundingGrid.Enable(this.m_roundToGrid);
  }

  TransferDataToWindow(): boolean {
    const p = this.m_params;

    this.m_LayerSelectionCtrl.SetLayerSelection(p.layer);
    this.m_outset.SetValue(p.outsetDistance);
    this.m_roundCorners = p.roundCorners;
    this.m_lineWidth.SetValue(p.lineWidth);
    this.m_roundToGrid = p.gridRounding !== null;
    this.m_roundingGrid.SetValue(p.gridRounding ?? s_gridRoundValuePersist);
    this.m_copyLayers = p.useSourceLayers;
    this.m_copyWidths = p.useSourceWidths;

    this.m_roundingGrid.Enable(this.m_roundToGrid);
    this.m_layerSelectionEnabled = !this.m_copyLayers;

    this.m_deleteSourceItems = p.deleteSourceItems;

    return true;
  }

  TransferDataFromWindow(): boolean {
    if (this.m_lineWidth.GetIntValue() <= 0) {
      this.m_error = _('Line width must be a positive value.');
      return false;
    }

    const p = this.m_params;

    p.layer = ToLAYER_ID(this.m_LayerSelectionCtrl.GetLayerSelection());
    p.outsetDistance = this.m_outset.GetIntValue();
    p.roundCorners = this.m_roundCorners;
    p.lineWidth = this.m_lineWidth.GetIntValue();
    p.useSourceLayers = this.m_copyLayers;
    p.useSourceWidths = this.m_copyWidths;

    if (this.m_roundToGrid) p.gridRounding = this.m_roundingGrid.GetValue();
    else p.gridRounding = null;

    s_gridRoundValuePersist = this.m_roundingGrid.GetIntValue();
    p.deleteSourceItems = this.m_deleteSourceItems;

    // Keep the recent values list up to date
    const saveRecentValue = (aRecentValues: number[], aValue: number): void => {
      // Already have it
      if (aRecentValues.includes(aValue)) return;

      aRecentValues.push(aValue);
    };

    saveRecentValue(s_outsetRecentValues, p.outsetDistance);
    saveRecentValue(s_lineWidthRecentValues, p.lineWidth);

    if (p.gridRounding !== null) saveRecentValue(s_gridRoundingRecentValues, p.gridRounding);

    return true;
  }
}

type BOX =
  | 'm_roundCorners'
  | 'm_roundToGrid'
  | 'm_copyLayers'
  | 'm_copyWidths'
  | 'm_deleteSourceItems';

/** `ShowModal()` of DIALOG_OUTSET_ITEMS: `onClose( true )` is wxID_OK. */
export function DialogOutsetItems({
  dialog,
  onClose,
}: {
  dialog: DIALOG_OUTSET_ITEMS;
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState<string | null>(null);

  // OnInitDialog -> TransferDataToWindow
  useState(() => dialog.TransferDataToWindow());

  const combo = (aBinder: UNIT_BINDER): UNIT_COMBO => ({
    value: aBinder.GetText(),
    options: aBinder.GetOptionsList(),
    units: unitLabel(aBinder.GetUnits()),
    enabled: aBinder.IsEnabled(),
    onChange: (aText) => {
      aBinder.SetText(aText);
      bump();
    },
  });
  const check = (aKey: BOX, aHandler?: () => void) => ({
    value: dialog[aKey],
    onChange: (aOn: boolean) => {
      dialog[aKey] = aOn;
      aHandler?.();
      bump();
    },
  });
  const box = dialog.m_LayerSelectionCtrl;

  return (
    <>
      <DIALOG_OUTSET_ITEMS_BASE
        m_outset={combo(dialog.m_outset)}
        m_roundCorners={check('m_roundCorners')}
        m_roundToGrid={check('m_roundToGrid', () => dialog.OnRoundToGridChecked())}
        m_roundingGrid={combo(dialog.m_roundingGrid)}
        m_copyLayers={check('m_copyLayers', () => dialog.OnCopyLayersChecked())}
        layerRows={box.GetRows().map((r) => ({
          value: LSET_Name(r.layerid),
          label: r.name,
          swatch: r.swatch ? toCssColor(r.swatch) : undefined,
        }))}
        layer={LSET_Name(ToLAYER_ID(box.GetLayerSelection()))}
        layerEnabled={dialog.m_layerSelectionEnabled}
        onLayerChange={(aLayer) => {
          box.SetLayerSelection(LSET_NameToLayer(aLayer as never) as PCB_LAYER_ID);
          bump();
        }}
        m_copyWidths={check('m_copyWidths')}
        m_lineWidth={combo(dialog.m_lineWidth)}
        onLayerDefault={() => {
          dialog.OnLayerDefaultClick();
          bump();
        }}
        m_deleteSourceItems={check('m_deleteSourceItems')}
        onOK={() => {
          if (dialog.TransferDataFromWindow()) onClose(true);
          else {
            setError(dialog.m_error);
            dialog.m_error = null;
          }
        }}
        onCancel={() => onClose(false)}
      />
      {error !== null && <MessageDialogError message={error} onClose={() => setError(null)} />}
    </>
  );
}
