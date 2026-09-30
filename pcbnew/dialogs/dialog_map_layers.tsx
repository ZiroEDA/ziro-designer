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
import { useState, type JSX } from 'react';
import { MessageDialogOk } from '@ziroeda/common/dialogs/dialog_message.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { LayerName, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { INPUT_LAYER_DESC } from '../pcb_io/common/plugin_common_layer_mapping.js';

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
export const UNMATCHED_REQUIRED_MESSAGE =
  "All required layers (marked with '*') must be matched. Please click 'Auto-Match Layers' to automatically match the remaining layers";

/** wxListCtrl's click selection: plain replaces, Ctrl toggles, Shift extends from the anchor. */
function clickSelect(
  aSel: readonly number[],
  aAnchor: number,
  aRow: number,
  aMods: { ctrl: boolean; shift: boolean },
): number[] {
  if (aMods.shift && aAnchor >= 0) {
    const [a, b] = aAnchor < aRow ? [aAnchor, aRow] : [aRow, aAnchor];
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }

  if (aMods.ctrl) return aSel.includes(aRow) ? aSel.filter((r) => r !== aRow) : [...aSel, aRow];

  return [aRow];
}

function LayerList({
  rows,
  selected,
  onSelect,
  onActivate,
  ariaLabel,
  columns,
}: {
  rows: readonly (readonly string[])[];
  selected: readonly number[];
  onSelect: (sel: number[], anchor: number) => void;
  onActivate: () => void;
  ariaLabel: string;
  /** Column headers; absent is `wxLC_NO_HEADER`. */
  columns?: readonly string[];
}): JSX.Element {
  const [anchor, setAnchor] = useState(0);

  return (
    <div className="ze-grid-pane ze-maplayers-list">
      <table className="ze-grid" aria-label={ariaLabel}>
        {columns && (
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((cells, i) => (
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: a list control's rows are its indices
              key={i}
              aria-selected={selected.includes(i)}
              className={selected.includes(i) ? 'selected' : undefined}
              onMouseDown={(e) => {
                onSelect(
                  clickSelect(selected, anchor, i, { ctrl: e.ctrlKey, shift: e.shiftKey }),
                  i,
                );
                if (!e.shiftKey) setAnchor(i);
              }}
              onDoubleClick={onActivate}
            >
              {cells.map((c, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

  useModalEscape(finish, !error);

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
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-maplayers" role="dialog" aria-modal="true">
        <div className="ze-modal-header">Import Layer Mapping</div>
        <div className="ze-modal-body ze-maplayers-body">
          <div className="ze-maplayers-top">
            <fieldset className="ze-sbox ze-maplayers-box ze-maplayers-unmatched">
              <legend>Unmatched Layers</legend>
              <div className="ze-maplayers-fg">
                <span className="ze-maplayers-lbl">Imported Layers</span>
                <span className="ze-maplayers-lbl">KiCad Layers</span>
                <LayerList
                  ariaLabel="Unmatched imported layers"
                  rows={dlg.m_unmatched_rows.map((r) => [r])}
                  selected={unmatchedSel}
                  onSelect={(s) => setUnmatchedSel(s)}
                  onActivate={add}
                />
                {/* wxLC_SINGLE_SEL */}
                <LayerList
                  ariaLabel="KiCad layers"
                  rows={dlg.m_kicad_rows.map((r) => [r.name])}
                  selected={kicadSel}
                  onSelect={(_s, anchor) => setKicadSel([anchor])}
                  onActivate={add}
                />
              </div>
            </fieldset>
            <div className="ze-maplayers-arrows">
              <button
                type="button"
                className="ze-maplayers-add"
                title="Add selected layers to matched layers list."
                onClick={add}
              >
                &gt;
              </button>
              <button
                type="button"
                className="ze-maplayers-remove"
                title="Remove selected layers from matched layers list."
                onClick={() => remove(matchedSel)}
              >
                &lt;
              </button>
              <button
                type="button"
                className="ze-maplayers-removeall"
                title="Remove all matched layers."
                onClick={() => remove('all')}
              >
                &lt;&lt;
              </button>
            </div>
            <fieldset className="ze-sbox ze-maplayers-box ze-maplayers-matched">
              <legend>Matched Layers</legend>
              <LayerList
                ariaLabel="Matched layers"
                columns={['Imported Layer', 'KiCad Layer']}
                rows={dlg.m_matched_rows.map((r) => [r.imported, r.kicad])}
                selected={matchedSel}
                onSelect={(s) => setMatchedSel(s)}
                onActivate={() => remove(matchedSel)}
              />
            </fieldset>
          </div>
          <div className="ze-maplayers-bottom">
            <button
              type="button"
              title="Automatically match any unmatched layers to their KiCad equivalent."
              onClick={() => {
                dlg.OnAutoMatchLayersClicked();
                setUnmatchedSel([]);
                refresh();
              }}
            >
              Auto-Match Layers
            </button>
            <label
              className="ze-pref-check"
              title="If checked, layers will keep their standard KiCad names instead of being renamed to the imported layer names."
            >
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Keep KiCad layer names
            </label>
            <span className="ze-sdb-spacer" />
            <button type="button" className="ze-btn primary" onClick={finish}>
              OK
            </button>
          </div>
        </div>
        {error && (
          <MessageDialogOk
            caption="Unmatched Layers"
            icon="error"
            message={UNMATCHED_REQUIRED_MESSAGE}
            onClose={() => setError(false)}
          />
        )}
      </div>
    </div>
  );
}
