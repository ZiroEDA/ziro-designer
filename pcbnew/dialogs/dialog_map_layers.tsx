// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_MAP_LAYERS` (`pcbnew/dialogs/dialog_map_layers.cpp` over
 * `dialog_imported_layers_base.cpp`): the layer-mapping dialog a
 * `LAYER_MAPPABLE_PLUGIN` (Altium, CircuitMaker, CircuitStudio, SolidWorks,
 * PADS, Allegro) calls during a board import. Its sizer tree:
 *
 *     bSizerMain (V)
 *       bSizerTop (H)                                   wxEXPAND|wxRIGHT|wxLEFT 5, proportion 1
 *         "Unmatched Layers" wxStaticBoxSizer (H)       proportion 1, wxEXPAND|wxTOP|wxRIGHT|wxLEFT 5
 *           fgSizer1 (2 cols, both growable)
 *             "Imported Layers"  "KiCad Layers"         wxALL 5
 *             m_unmatched_layers_list (NO_HEADER, multi)   min 120     wxBOTTOM|wxEXPAND|wxLEFT|wxRIGHT 5
 *             m_kicad_layers_list     (NO_HEADER, SINGLE_SEL) min 120  same
 *         bSizer6 (V)                                   wxEXPAND|wxTOP 10
 *           ">" 36x100, "<" 36x100, "<<" 36x50          wxALL 5
 *         "Matched Layers" wxStaticBoxSizer (H)         proportion 1, wxEXPAND|wxLEFT|wxRIGHT|wxTOP 5
 *           m_matched_layers_list (REPORT, two columns) min 120
 *       bSizerBottom (H)                                wxBOTTOM|wxEXPAND|wxLEFT|wxTOP 5
 *         "Auto-Match Layers"                           wxALL 5
 *         "Keep KiCad layer names"                      wxALL|wxALIGN_CENTER_VERTICAL 5
 *         wxStdDialogButtonSizer: OK only               proportion 1
 *
 * {@link DIALOG_MAP_LAYERS} is the dialog's state and every decision in it
 * (`AddMappings`, `RemoveMappings`, `OnAutoMatchLayersClicked`,
 * `GetUnmappedRequiredLayers`, the `" *"` marker on a required layer);
 * {@link DialogMapLayers} is the controls plus `RunModal`'s loop: OK, or closing
 * the window, with a required layer unmatched raises "All required layers ..."
 * and leaves the dialog up.
 *
 * Wired: `PCB_EDIT_FRAME::ImportNonKicadBoard` (files.ts) registers it for a
 * mappable plugin, as `OpenProjectFiles` does (`files.cpp:642-649`).
 */
import { type JSX, useState } from 'react';
import { GetTextExtent } from '@ziroeda/wx/controls.js';
import { DIALOG_IMPORTED_LAYERS_BASE } from './dialog_imported_layers_base.js';
import { MessageDialogOk } from '@ziroeda/common/dialogs/dialog_message.js';
import { LayerName, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { INPUT_LAYER_DESC } from '../pcb_io/common/plugin_common_layer_mapping.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

export class DIALOG_MAP_LAYERS {
  m_input_layers: INPUT_LAYER_DESC[] = [];
  /** `m_unmatched_layer_names`: the vector, which is not the list's row order. */
  m_unmatched_layer_names: string[] = [];
  m_matched_layers_map = new Map<string, PCB_LAYER_ID>();
  /** `m_unmatched_layers_list`'s rows. */
  m_unmatched_rows: string[] = [];
  /** `m_kicad_layers_list`'s rows: the layer and its `LayerName`. */
  m_kicad_rows: { id: PCB_LAYER_ID; name: string }[] = [];
  /** `m_matched_layers_list`'s rows: imported name, KiCad name. */
  m_matched_rows: { imported: string; kicad: string }[] = [];

  constructor(aLayerDesc: readonly INPUT_LAYER_DESC[]) {
    const kiCadLayers = new LSET();

    // Read in the input layers
    for (const inLayer of aLayerDesc) {
      this.m_input_layers.push(inLayer);
      const layerName = inLayer.Required
        ? DIALOG_MAP_LAYERS.WrapRequired(inLayer.Name)
        : inLayer.Name;
      this.m_unmatched_layer_names.push(layerName);
      kiCadLayers.orAssign(inLayer.PermittedLayers);
    }

    // Load the input layer list to unmatched layers
    this.m_unmatched_rows = [...this.m_unmatched_layer_names];

    // Load the KiCad Layer names
    for (const layer of kiCadLayers.UIOrder()) {
      this.m_kicad_rows.push({ id: layer, name: LayerName(layer) });
    }
  }

  static WrapRequired(aLayerName: string): string {
    return `${aLayerName} *`;
  }

  static UnwrapRequired(aLayerName: string): string {
    if (!aLayerName.endsWith(' *')) return aLayerName;

    return aLayerName.slice(0, aLayerName.length - 2);
  }

  GetLayerDescription(aLayerName: string): INPUT_LAYER_DESC | null {
    const layerName = DIALOG_MAP_LAYERS.UnwrapRequired(aLayerName);

    return this.m_input_layers.find((d) => d.Name === layerName) ?? null;
  }

  GetAutoMatchLayerID(aInputLayerName: string): PCB_LAYER_ID {
    const pureInputLayerName = DIALOG_MAP_LAYERS.UnwrapRequired(aInputLayerName);

    for (const inputLayerDesc of this.m_input_layers) {
      if (
        inputLayerDesc.Name === pureInputLayerName &&
        inputLayerDesc.AutoMapLayer !== PCB_LAYER_ID.UNSELECTED_LAYER
      )
        return inputLayerDesc.AutoMapLayer;
    }

    return PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  /** `GetSelectedLayerID()`, given the selected row of the KiCad list (or -1). */
  GetSelectedLayerID(aKiCadRow: number): PCB_LAYER_ID {
    return this.m_kicad_rows[aKiCadRow]?.id ?? PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  /** `m_matched_layers_list->InsertItem( 0, … )`, the map's `insert` and the vector's `erase`. */
  private match(aLayerName: string, aLayer: PCB_LAYER_ID): void {
    this.m_matched_rows.unshift({ imported: aLayerName, kicad: LayerName(aLayer) });

    // std::map::insert: the first layer of a name stays
    const pure = DIALOG_MAP_LAYERS.UnwrapRequired(aLayerName);
    if (!this.m_matched_layers_map.has(pure)) this.m_matched_layers_map.set(pure, aLayer);

    const at = this.m_unmatched_layer_names.indexOf(aLayerName);
    if (at >= 0) this.m_unmatched_layer_names.splice(at, 1);
  }

  /** `DeleteListItems`: highest row first, so the lower ones keep their numbers. */
  private static deleteRows<T>(aRows: T[], aRowsToDelete: readonly number[]): void {
    for (let n = aRowsToDelete.length - 1; n >= 0; n--) aRows.splice(aRowsToDelete[n]!, 1);
  }

  /**
   * `AddMappings()`: the selected unmatched layers onto the selected KiCad layer.
   * Nothing is selected on the KiCad side, nothing happens. Returns the rows to
   * leave selected in the unmatched list ("Auto select the first item").
   */
  AddMappings(aUnmatchedSelection: readonly number[], aKiCadRow: number): number[] {
    const selectedKiCadLayerID = this.GetSelectedLayerID(aKiCadRow);

    if (selectedKiCadLayerID === PCB_LAYER_ID.UNDEFINED_LAYER) return [...aUnmatchedSelection];

    const rowsToDelete: number[] = [];

    for (const itemIndex of [...aUnmatchedSelection].sort((a, b) => a - b)) {
      const selectedLayerName = this.m_unmatched_rows[itemIndex];
      if (selectedLayerName === undefined) continue;

      this.match(selectedLayerName, selectedKiCadLayerID);
      rowsToDelete.push(itemIndex);
    }

    DIALOG_MAP_LAYERS.deleteRows(this.m_unmatched_rows, rowsToDelete);

    return this.m_unmatched_rows.length > 0 ? [0] : [];
  }

  /** `RemoveMappings( selected )` / `RemoveMappings( allitems )`. */
  RemoveMappings(aRows: readonly number[] | 'all'): void {
    const rows =
      aRows === 'all' ? this.m_matched_rows.map((_, i) => i) : [...aRows].sort((a, b) => a - b);
    const rowsToDelete: number[] = [];

    for (const itemIndex of rows) {
      const selectedLayerName = this.m_matched_rows[itemIndex]?.imported;
      if (selectedLayerName === undefined) continue;

      this.m_matched_layers_map.delete(DIALOG_MAP_LAYERS.UnwrapRequired(selectedLayerName));
      rowsToDelete.push(itemIndex);

      this.m_unmatched_rows.unshift(selectedLayerName);
      this.m_unmatched_layer_names.push(selectedLayerName);
    }

    DIALOG_MAP_LAYERS.deleteRows(this.m_matched_rows, rowsToDelete);
  }

  /** `OnAutoMatchLayersClicked`: every unmatched layer that has an automatic match. */
  OnAutoMatchLayersClicked(): void {
    const rowsToDelete: number[] = [];

    this.m_unmatched_rows.forEach((layerName, itemIndex) => {
      const autoMatchLayer = this.GetAutoMatchLayerID(layerName);

      if (autoMatchLayer === PCB_LAYER_ID.UNDEFINED_LAYER) return;

      this.match(layerName, autoMatchLayer);
      rowsToDelete.push(itemIndex);
    });

    DIALOG_MAP_LAYERS.deleteRows(this.m_unmatched_rows, rowsToDelete);
  }

  /** The required layers (by their plain names) that are not mapped yet. */
  GetUnmappedRequiredLayers(): string[] {
    const unmappedLayers: string[] = [];

    for (const layerName of this.m_unmatched_layer_names) {
      const layerDesc = this.GetLayerDescription(layerName);

      if (layerDesc?.Required) unmappedLayers.push(layerDesc.Name);
    }

    return unmappedLayers;
  }
}

/** `RunModal`'s message for a required layer left unmatched. */
export const UNMATCHED_REQUIRED_MESSAGE = _HKI(
  "All required layers (marked with '*') must be matched. Please click 'Auto-Match Layers' to automatically match the remaining layers",
);

export function DialogMapLayers({
  layers,
  keepKiCadLayerNames,
  onDone,
}: {
  layers: readonly INPUT_LAYER_DESC[];
  /** `m_ImportKeepKiCadLayerNames`, the checkbox's initial value. */
  keepKiCadLayerNames: boolean;
  /** `RunModal`'s return, plus the checkbox's value it stores back. */
  onDone: (aMap: Map<string, PCB_LAYER_ID>, aKeepKiCadLayerNames: boolean) => void;
}): JSX.Element {
  const [dlg] = useState(() => new DIALOG_MAP_LAYERS(layers));
  const [, tick] = useState(0);
  const refresh = (): void => tick((n) => n + 1);

  // "Auto select the first item to improve ease-of-use"
  const [unmatchedSel, setUnmatchedSel] = useState<number[]>(() =>
    dlg.m_unmatched_rows.length ? [0] : [],
  );
  const [kicadSel, setKicadSel] = useState<number[]>(() => (dlg.m_kicad_rows.length ? [0] : []));
  const [matchedSel, setMatchedSel] = useState<number[]>([]);
  const [keep, setKeep] = useState(keepKiCadLayerNames);
  const [error, setError] = useState(false);

  // `dlg.ShowModal()` returning (OK, or the window closed), then `RunModal`'s loop.
  const finish = (): void => {
    if (dlg.GetUnmappedRequiredLayers().length > 0) {
      setError(true);
      return;
    }

    onDone(dlg.m_matched_layers_map, keep);
  };

  const add = (): void => {
    setUnmatchedSel(dlg.AddMappings(unmatchedSel, kicadSel[0] ?? -1));
    setMatchedSel([]);
    refresh();
  };

  const remove = (rows: readonly number[] | 'all'): void => {
    dlg.RemoveMappings(rows);
    setMatchedSel([]);
    refresh();
  };

  return (
    <>
      <DIALOG_IMPORTED_LAYERS_BASE
        title={wxGetTranslation('Import Layer Mapping')}
        importedLayersHeader={wxGetTranslation('Imported Layer')}
        kicadLayersHeader={wxGetTranslation('KiCad Layer')}
        // maxTextWidth + 15 over the header and every imported name; "User.Drawings" + 5.
        importedWidth={
          Math.max(
            GetTextExtent(wxGetTranslation('Imported Layer')),
            ...layers.map((l) => GetTextExtent(l.Name)),
          ) + 15
        }
        kicadWidth={GetTextExtent('User.Drawings') + 5}
        m_unmatched_layers_list={{
          rows: dlg.m_unmatched_rows.map((r) => [r]),
          selected: unmatchedSel,
          onSelect: (aRows) => setUnmatchedSel(aRows),
          onActivate: add,
        }}
        // wxLC_SINGLE_SEL
        m_kicad_layers_list={{
          rows: dlg.m_kicad_rows.map((r) => [r.name]),
          selected: kicadSel,
          onSelect: (_aRows, aClicked) => setKicadSel([aClicked]),
          onActivate: add,
        }}
        m_matched_layers_list={{
          rows: dlg.m_matched_rows.map((r) => [r.imported, r.kicad]),
          selected: matchedSel,
          onSelect: (aRows) => setMatchedSel(aRows),
          onActivate: () => remove(matchedSel),
        }}
        onAddClick={add}
        onRemoveClick={() => remove(matchedSel)}
        onRemoveAllClick={() => remove('all')}
        onAutoMatchLayersClicked={() => {
          dlg.OnAutoMatchLayersClicked();
          setUnmatchedSel([]);
          refresh();
        }}
        m_cbKeepKiCadLayerNames={{ value: keep, onChange: setKeep }}
        onOK={finish}
      />
      {error && (
        <MessageDialogOk
          caption={wxGetTranslation('Unmatched Layers')}
          icon="error"
          message={UNMATCHED_REQUIRED_MESSAGE}
          onClose={() => setError(false)}
        />
      )}
    </>
  );
}
