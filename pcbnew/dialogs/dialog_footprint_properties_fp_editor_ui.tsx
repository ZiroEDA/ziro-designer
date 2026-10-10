// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR`'s window
 * (`pcbnew/dialogs/dialog_footprint_properties_fp_editor_base.cpp`): the
 * notebook — General (Fields, Metadata, Fabrication Attributes), Layers
 * (Custom Layers, Private Layers), Clearance Overrides (Clearances,
 * Courtyards), Pad Connections (Connection to Copper Zones, Net Ties,
 * Jumpers) and 3D Models — over the model in
 * `dialog_footprint_properties_fp_editor.ts`, which OK hands the controls to.
 *
 * Not drawn: the Embedded Files page, which the model does not carry either.
 */

import { type JSX, type ReactNode, useRef, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { type PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxGRID_VALUE_NUMBER,
  wxGRID_VALUE_STRING,
  wxGridCellAttr,
  wxGridSelectionModes,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import type { FOOTPRINT, FP_3DMODEL } from '../footprint.js';
import {
  GRID_CELL_LAYER_RENDERER,
  GRID_CELL_LAYER_SELECTOR,
  allLayerChoices,
  choiceOf,
} from '../grid_layer_box_helpers.js';
import { PCB_FIELDS_GRID_TABLE } from '../pcb_fields_grid_table.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import {
  COMPONENT_TYPES,
  DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR,
  type FootprintFpEditorValues,
} from './dialog_footprint_properties_fp_editor.js';
import type { PANEL_3D_MODEL_HOST, SELECTED_3D_MODEL } from './panel_fp_properties_3d_model.js';
import {
  PanelFpProperties3dModel,
  type PANEL_3D_MODEL_API,
} from './panel_fp_properties_3d_model_ui.js';

type Page = 'general' | 'layers' | 'clearances' | 'padConnections' | 'models3d';

/** One text column, as `m_nettieGroupsGrid` / `m_jumperGroupsGrid` are. */
class STRING_LIST_TABLE extends WX_GRID_TABLE_BASE {
  constructor(public m_rows: string[]) {
    super();
  }
  GetNumberRows(): number {
    return this.m_rows.length;
  }
  GetNumberCols(): number {
    return 1;
  }
  override CanGetValueAs(_r: number, _c: number, aType: string): boolean {
    return aType === wxGRID_VALUE_STRING;
  }
  GetValue(aRow: number): string {
    return this.m_rows[aRow] ?? '';
  }
  SetValue(aRow: number, _aCol: number, aValue: string): void {
    this.m_rows[aRow] = aValue;
  }
  override AppendRows(aNum = 1): boolean {
    for (let i = 0; i < aNum; ++i) this.m_rows.push('');
    return super.AppendRows(aNum);
  }
  override DeleteRows(aPos = 0, aNum = 1): boolean {
    this.m_rows.splice(aPos, aNum);
    return super.DeleteRows(aPos, aNum);
  }
}

/** `LAYERS_GRID_TABLE`: one layer column, a layer selector to edit it. */
class LAYERS_GRID_TABLE extends WX_GRID_TABLE_BASE {
  constructor(public m_layers: PCB_LAYER_ID[]) {
    super();
  }
  GetNumberRows(): number {
    return this.m_layers.length;
  }
  GetNumberCols(): number {
    return 1;
  }
  override CanGetValueAs(_r: number, _c: number, aType: string): boolean {
    return aType === wxGRID_VALUE_NUMBER;
  }
  override CanSetValueAs(_r: number, _c: number, aType: string): boolean {
    return aType === wxGRID_VALUE_NUMBER;
  }
  GetValue(aRow: number): string {
    return String(this.m_layers[aRow] ?? '');
  }
  SetValue(): void {}
  override GetValueAsLong(aRow: number): number {
    return this.m_layers[aRow] ?? -1;
  }
  override SetValueAsLong(aRow: number, _aCol: number, aValue: number): void {
    this.m_layers[aRow] = aValue as PCB_LAYER_ID;
  }
  override DeleteRows(aPos = 0, aNum = 1): boolean {
    this.m_layers.splice(aPos, aNum);
    return super.DeleteRows(aPos, aNum);
  }
}

function makeGrid<T extends WX_GRID_TABLE_BASE>(
  aTable: T,
  aLayerCol = false,
): { grid: WX_GRID; table: T; tricks: GRID_TRICKS } {
  const grid = new WX_GRID();
  grid.SetTable(aTable, true, wxGridSelectionModes.wxGridSelectRows);

  if (aLayerCol) {
    const attr = new wxGridCellAttr();
    attr.SetRenderer(new GRID_CELL_LAYER_RENDERER(choiceOf));
    attr.SetEditor(
      new GRID_CELL_LAYER_SELECTOR(() =>
        allLayerChoices().map((c) => ({
          layer: LSET_NameToLayer(c.value),
          label: c.label,
          swatch: c.swatch,
        })),
      ),
    );
    grid.SetColAttr(0, attr);
  }

  return { grid, table: aTable, tricks: new GRID_TRICKS(grid) };
}

export interface DialogFootprintPropertiesFpEditorProps {
  dialog: DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR;
  units: StatusUnits;
  /** `EndModal`: true for wxID_OK, false for Cancel. */
  onClose: (aOk: boolean) => void;
  /** The 3D Models page and what it asks of the frame. */
  model3d?: {
    footprint: FOOTPRINT;
    host: PANEL_3D_MODEL_HOST;
    renderPreview: (
      aModels: readonly FP_3DMODEL[],
      aSelected: number,
      aVersion: number,
    ) => ReactNode;
    pickModel: () => Promise<SELECTED_3D_MODEL | null>;
  };
}

export function DialogFootprintPropertiesFpEditor({
  dialog,
  units,
  onClose,
  model3d,
}: DialogFootprintPropertiesFpEditorProps): JSX.Element {
  const [initial] = useState(() => dialog.TransferDataToWindow());
  const [v, setV] = useState<FootprintFpEditorValues>(initial);
  const [page, setPage] = useState<Page>('general');
  const [text, setText] = useState<Record<string, string>>({});
  const modelsApi = useRef<PANEL_3D_MODEL_API | null>(null);

  const [fields] = useState(() =>
    makeGrid(new PCB_FIELDS_GRID_TABLE(dialog.GetFrame().GetUnitsProvider(), initial.fields)),
  );
  const [netTies] = useState(() => makeGrid(new STRING_LIST_TABLE([...initial.netTieGroups])));
  const [jumpers] = useState(() => makeGrid(new STRING_LIST_TABLE([...initial.jumperGroups])));
  const [privateLayers] = useState(() =>
    makeGrid(new LAYERS_GRID_TABLE([...initial.privateLayers]), true),
  );
  const [customLayers] = useState(() =>
    makeGrid(new LAYERS_GRID_TABLE([...initial.customUserLayers]), true),
  );

  const set = (patch: Partial<FootprintFpEditorValues>): void => setV((p) => ({ ...p, ...patch }));

  const commitGrids = (): boolean =>
    [fields, netTies, jumpers, privateLayers, customLayers].every((g) =>
      g.grid.CommitPendingChanges(),
    );

  const collect = (): FootprintFpEditorValues => ({
    ...v,
    fields: [...fields.table.GetFields()],
    netTieGroups: [...netTies.table.m_rows],
    jumperGroups: [...jumpers.table.m_rows],
    privateLayers: [...privateLayers.table.m_layers],
    customUserLayers: [...customLayers.table.m_layers],
    models: modelsApi.current ? modelsApi.current.GetModelList() : v.models,
  });

  const onOk = async (): Promise<void> => {
    if (!commitGrids()) return;
    if (modelsApi.current && !modelsApi.current.CommitPendingChanges()) return;

    const values = collect();
    const check = await dialog.Validate(values);

    if (!check.ok) {
      if (check.page) setPage(check.page);
      if (check.message) DisplayErrorMessage(check.message);
      return;
    }

    const r = dialog.TransferDataFromWindow(values);

    if (!r.ok) {
      if (r.message) DisplayErrorMessage(r.message);
      return;
    }

    onClose(true);
  };

  /** A distance override: blank is null — "use the netclass value" — and 0 is a real 0. */
  const overrideField = (
    label: string,
    key: 'localClearance' | 'localSolderMaskMargin' | 'localSolderPasteMargin',
    title?: string,
  ): JSX.Element => {
    const stored = v[key];
    return (
      <>
        <span className="ze-fpfe-label" title={title}>
          {label}
        </span>
        <input
          type="text"
          className="ze-fpfe-input"
          value={text[key] ?? (stored === null ? '' : pcbUnitText(stored, units))}
          onChange={(e) => {
            const s = e.target.value;
            setText((p) => ({ ...p, [key]: s }));
            if (s.trim() === '') return set({ [key]: null } as Partial<FootprintFpEditorValues>);
            const iu = pcbUnitValue(s, units);
            if (Number.isFinite(iu)) set({ [key]: iu } as Partial<FootprintFpEditorValues>);
          }}
        />
        <span className="ze-unit-label">{unitLabel(units)}</span>
      </>
    );
  };

  const check = (
    label: string,
    key:
      | 'boardOnly'
      | 'excludeFromPosFiles'
      | 'excludeFromBOM'
      | 'dnp'
      | 'allowMissingCourtyard'
      | 'allowSolderMaskBridges'
      | 'customLayers'
      | 'duplicatePadsAreJumpers',
    title?: string,
  ): JSX.Element => (
    <label className="ze-fpfe-check" title={title}>
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<FootprintFpEditorValues>)}
      />
      {label}
    </label>
  );

  /** `bButtonSize`: add, a 20 px gap, delete. */
  const addDelete = (
    aGrid: { grid: WX_GRID; table: WX_GRID_TABLE_BASE },
    aAddTitle: string,
    aDeleteTitle: string,
    aOnAdd: () => void,
    aDisabled = false,
    aCanDelete: (aRow: number) => boolean = () => true,
  ): JSX.Element => (
    <div className="ze-grid-btns">
      <StdBitmapButton
        bitmap="small_plus"
        title={aAddTitle}
        disabled={aDisabled}
        onClick={aOnAdd}
      />
      <span className="ze-fieldnames-gap" />
      <StdBitmapButton
        bitmap="small_trash"
        title={aDeleteTitle}
        disabled={aDisabled}
        onClick={() =>
          aGrid.grid.OnDeleteRows(() => {
            const rows = aGrid.grid.GetSelectedRows();
            const row = rows.length > 0 ? rows[0]! : aGrid.grid.GetGridCursorRow();
            if (row >= 0 && aCanDelete(row)) aGrid.table.DeleteRows(row, 1);
          })
        }
      />
    </div>
  );

  const tab = (id: Page, label: string): JSX.Element => (
    <button
      type="button"
      className={`ze-tab${page === id ? ' active' : ''}`}
      onClick={() => setPage(id)}
    >
      {label}
    </button>
  );

  return (
    <DialogShim
      title="Footprint Properties"
      onClose={() => onClose(false)}
      className="ze-fpfe-dialog"
    >
      <div className="ze-tabbar ze-fpprops-tabs">
        {tab('general', 'General')}
        {tab('layers', 'Layers')}
        {tab('clearances', 'Clearance Overrides')}
        {tab('padConnections', 'Pad Connections')}
        {model3d && tab('models3d', '3D Models')}
      </div>

      <div className="ze-modal-body ze-fpfe-body">
        <div hidden={page !== 'general'}>
          <fieldset className="ze-fpfe-box">
            <legend>Fields</legend>
            <div className="ze-grid-pane ze-fpfe-fields">
              <WxGridView
                grid={fields.grid}
                tricks={fields.tricks}
                flexCol={1}
                ariaLabel="Fields"
              />
            </div>
            {addDelete(
              fields,
              'Add field',
              'Delete field',
              () =>
                fields.grid.OnAddRow(() => {
                  fields.table.push_back(dialog.MakeNewField(fields.table.GetFields()));
                  fields.table.AppendRows(1);
                  return [fields.table.GetNumberRows() - 1, 0];
                }),
              false,
              (aRow) => {
                const refusal = dialog.CanDeleteField(aRow, fields.table.GetFields());
                if (refusal) DisplayErrorMessage(refusal);
                return refusal === null;
              },
            )}
          </fieldset>
          <div className="ze-fpfe-columns">
            <fieldset className="ze-fpfe-box ze-fpfe-grow">
              <legend>Metadata</legend>
              <div className="ze-fpfe-grid2">
                <span className="ze-fpfe-label">Footprint name:</span>
                <input
                  type="text"
                  className="ze-fpfe-input"
                  value={v.footprintName}
                  onChange={(e) => set({ footprintName: e.target.value })}
                />
                <span className="ze-fpfe-label">Description:</span>
                <input
                  type="text"
                  className="ze-fpfe-input"
                  value={v.description}
                  onChange={(e) => set({ description: e.target.value })}
                />
                <span className="ze-fpfe-label">Keywords:</span>
                <input
                  type="text"
                  className="ze-fpfe-input"
                  value={v.keywords}
                  onChange={(e) => set({ keywords: e.target.value })}
                />
              </div>
            </fieldset>
            <fieldset className="ze-fpfe-box">
              <legend>Fabrication Attributes</legend>
              <div className="ze-fpfe-row">
                <span className="ze-fpfe-label">Component type:</span>
                <Combo
                  value={String(v.componentType)}
                  options={COMPONENT_TYPES.map((label, i) => ({ value: String(i), label }))}
                  onChange={(s) =>
                    set({ componentType: Number(s) as FootprintFpEditorValues['componentType'] })
                  }
                />
              </div>
              {check('Not in schematic', 'boardOnly')}
              {check('Exclude from position files', 'excludeFromPosFiles')}
              {check('Exclude from bill of materials', 'excludeFromBOM')}
              {check('Do not populate', 'dnp')}
            </fieldset>
          </div>
        </div>

        <div hidden={page !== 'layers'} className="ze-fpfe-columns">
          <fieldset className="ze-fpfe-box ze-fpfe-grow">
            <legend>Custom Layers</legend>
            {check('Use custom stackup', 'customLayers')}
            <div className="ze-fpfe-row">
              <span className="ze-fpfe-label">Copper layers</span>
              <Combo
                disabled={!v.customLayers}
                value={String(v.copperLayerCountSel)}
                options={Array.from({ length: 16 }, (_, i) => ({
                  value: String(i),
                  label: String((i + 1) * 2),
                }))}
                onChange={(s) => set({ copperLayerCountSel: Number(s) })}
              />
            </div>
            <fieldset className="ze-fpfe-box">
              <legend>User Layers</legend>
              <div className="ze-grid-pane ze-fpfe-layers">
                <WxGridView
                  grid={customLayers.grid}
                  tricks={customLayers.tricks}
                  colLabels={false}
                  columns={[{ width: 180 }]}
                  ariaLabel="User layers"
                />
              </div>
              {addDelete(
                customLayers,
                'Add user layer',
                'Delete user layer',
                () =>
                  customLayers.grid.OnAddRow(() => {
                    customLayers.table.m_layers.push(
                      DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR.NextUserLayer(
                        customLayers.table.m_layers,
                      ),
                    );
                    customLayers.table.AppendRows(1);
                    return [customLayers.table.GetNumberRows() - 1, 0];
                  }),
                !v.customLayers,
              )}
            </fieldset>
          </fieldset>
          <fieldset className="ze-fpfe-box ze-fpfe-grow">
            <legend>Private Layers</legend>
            <div className="ze-grid-pane ze-fpfe-layers">
              <WxGridView
                grid={privateLayers.grid}
                tricks={privateLayers.tricks}
                colLabels={false}
                columns={[{ width: 180 }]}
                ariaLabel="Private layers"
              />
            </div>
            {addDelete(privateLayers, 'Add private layer', 'Delete private layer', () =>
              privateLayers.grid.OnAddRow(() => {
                privateLayers.table.m_layers.push(
                  DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR.NextUserLayer(privateLayers.table.m_layers),
                );
                privateLayers.table.AppendRows(1);
                return [privateLayers.table.GetNumberRows() - 1, 0];
              }),
            )}
          </fieldset>
        </div>

        <div hidden={page !== 'clearances'}>
          <fieldset className="ze-fpfe-box">
            <legend>Clearances</legend>
            <div className="ze-fpfe-note">Leave values blank to use netclass values.</div>
            <div className="ze-fpfe-grid3">
              {overrideField(
                'Pad clearance:',
                'localClearance',
                'This is the local net clearance for all pads of this footprint.\nIf 0, the Netclass values are used.\nThis value can be overridden on a pad-by-pad basis in the Local\nClearance and Settings tab of Pad Properties.',
              )}
              {overrideField(
                'Solder mask expansion:',
                'localSolderMaskMargin',
                'This is the local clearance between pads and the solder mask for \nthis footprint.\nIf 0, the global value is used.\nThis value can be overridden on a pad-by-pad basis in the Local\nClearance and Settings tab of Pad Properties.',
              )}
              <span className="ze-fpfe-span3">
                {check(
                  'Allow bridged solder mask apertures between pads',
                  'allowSolderMaskBridges',
                )}
              </span>
              {overrideField(
                'Solder paste clearance:',
                'localSolderPasteMargin',
                'Solder paste clearance relative to pad size.\nEnter an absolute value (e.g., -0.1mm), a percentage (e.g., -5%), or both (e.g., -0.1mm - 5%).\nThis value can be superseded by local values for a footprint or a pad.',
              )}
              <span className="ze-fpfe-label">Solder paste relative clearance:</span>
              <input
                type="text"
                className="ze-fpfe-input"
                value={
                  text.ratio ??
                  (v.localSolderPasteMarginRatio === null
                    ? ''
                    : String(v.localSolderPasteMarginRatio * 100))
                }
                onChange={(e) => {
                  const s = e.target.value;
                  setText((p) => ({ ...p, ratio: s }));
                  if (s.trim() === '') return set({ localSolderPasteMarginRatio: null });
                  const n = Number(s);
                  if (Number.isFinite(n)) set({ localSolderPasteMarginRatio: n / 100 });
                }}
              />
              <span className="ze-unit-label">%</span>
            </div>
            <div className="ze-fpfe-note">
              Note: solder mask and paste values are used only for pads on copper layers.
            </div>
          </fieldset>
          <fieldset className="ze-fpfe-box">
            <legend>Courtyards</legend>
            {check(
              'Exempt from courtyard requirement',
              'allowMissingCourtyard',
              'Will not generate "missing courtyard" DRC violations',
            )}
          </fieldset>
        </div>

        <div hidden={page !== 'padConnections'}>
          <fieldset className="ze-fpfe-box">
            <legend>Connection to Copper Zones</legend>
            <div className="ze-fpfe-row">
              <span className="ze-fpfe-label">Pad connection to zones:</span>
              <Combo
                value={String(v.zoneConnection)}
                options={['Use zone setting', 'Solid', 'Thermal relief', 'None'].map(
                  (label, i) => ({
                    value: String(i),
                    label,
                  }),
                )}
                onChange={(s) =>
                  set({ zoneConnection: Number(s) as FootprintFpEditorValues['zoneConnection'] })
                }
              />
            </div>
          </fieldset>
          <fieldset className="ze-fpfe-box">
            <legend>Net Ties</legend>
            <div className="ze-fpfe-label">Pad groups allowed to short different nets:</div>
            <div className="ze-grid-pane ze-fpfe-groups">
              <WxGridView
                grid={netTies.grid}
                tricks={netTies.tricks}
                colLabels={false}
                columns={[{ width: 320 }]}
                ariaLabel="Net tie pad groups"
              />
            </div>
            {addDelete(netTies, 'Add net-tie group', 'Remove net-tie group', () =>
              netTies.grid.OnAddRow(() => {
                netTies.table.AppendRows(1);
                return [netTies.table.GetNumberRows() - 1, 0];
              }),
            )}
          </fieldset>
          <fieldset className="ze-fpfe-box">
            <legend>Jumpers</legend>
            {check(
              'All pads with duplicate numbers are jumpers',
              'duplicatePadsAreJumpers',
              'When enabled, this footprint can have more than one pad with the same number, and pads with the same number will be considered to be jumpered together internally.',
            )}
            <div className="ze-fpfe-label">Explicit jumper pad groups:</div>
            <div className="ze-grid-pane ze-fpfe-groups">
              <WxGridView
                grid={jumpers.grid}
                tricks={jumpers.tricks}
                colLabels={false}
                columns={[{ width: 320 }]}
                ariaLabel="Jumper pad groups"
              />
            </div>
            {addDelete(jumpers, 'Add jumper group', 'Remove jumper group', () =>
              jumpers.grid.OnAddRow(() => {
                jumpers.table.AppendRows(1);
                return [jumpers.table.GetNumberRows() - 1, 0];
              }),
            )}
          </fieldset>
        </div>

        {/* Mounted for the dialog's life, so the list survives a change of page. */}
        {model3d && (
          <div className="ze-fp3d-host" hidden={page !== 'models3d'}>
            <PanelFpProperties3dModel
              footprint={model3d.footprint}
              host={model3d.host}
              renderPreview={model3d.renderPreview}
              pickModel={model3d.pickModel}
              apiRef={modelsApi}
            />
          </div>
        )}
      </div>

      <div className="ze-modal-footer">
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => onClose(false)}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => void onOk()}>
          OK
        </button>
      </div>
    </DialogShim>
  );
}
