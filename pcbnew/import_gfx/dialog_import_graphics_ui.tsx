// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/import_gfx/dialog_import_graphics_base.cpp` (wxFormBuilder):
 * DIALOG_IMPORT_GRAPHICS_BASE, the widget tree only. Every value and handler
 * comes in as a prop; `dialog_import_graphics.tsx` owns the state.
 */
import type { Dispatch, JSX, SetStateAction } from 'react';
import type { DXF_IMPORT_UNITS } from '@ziroeda/common/import_gfx/dxf_import_plugin.js';
import type { PCB_LAYER_NAME } from '@ziroeda/common/layer_ids.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { pcbUnitTextMM, pcbUnitValueMM, unitLabel } from '../pcb_unit_binder.js';
import type { Imported, Params } from './dialog_import_graphics.js';
import { DXF_UNIT_CHOICES } from './dialog_import_graphics.js';

export interface DialogImportGraphicsBaseProps {
  units: StatusUnits;
  layers: readonly string[];
  layerColor: (layer: string) => string;
  params: Params;
  setParams: Dispatch<SetStateAction<Params>>;
  typed: Record<string, string>;
  setTyped: Dispatch<SetStateAction<Record<string, string>>>;
  isDxf: boolean;
  imported: Imported | null;
  count: number;
  empty: boolean;
  canOk: boolean;
  acceptedExtensions: string;
  onFile: (file: File | undefined) => void;
  onOk: () => void;
  onCancel: () => void;
}

export function DialogImportGraphicsBase({
  units,
  layers,
  layerColor,
  params,
  setParams,
  typed,
  setTyped,
  isDxf,
  imported,
  count,
  empty,
  canOk,
  acceptedExtensions,
  onFile,
  onOk,
  onCancel,
}: DialogImportGraphicsBaseProps): JSX.Element {
  // wxDialog's Esc is the Cancel button, registered where the backdrop renders.
  const shown = (key: string, text: string): string => typed[key] ?? text;

  const num = (
    label: string,
    key: string,
    valueMM: number,
    apply: (mm: number) => void,
    enabled = true,
  ): JSX.Element => (
    <label className="ze-tvp-row">
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        disabled={!enabled}
        value={shown(key, pcbUnitTextMM(valueMM, units))}
        onChange={(e) => {
          setTyped((p) => ({ ...p, [key]: e.target.value }));
          apply(pcbUnitValueMM(e.target.value, units));
        }}
        onBlur={() => setTyped((p) => ({ ...p, [key]: undefined as unknown as string }))}
      />
      <span className="ze-unit-label">{unitLabel(units)}</span>
    </label>
  );

  const scaleField = (
    <label className="ze-tvp-row">
      <span className="ze-tvp-label">Import scale:</span>
      <input
        type="text"
        className="ze-tvp-input"
        value={shown('scale', String(params.scale))}
        onChange={(e) => {
          setTyped((p) => ({ ...p, scale: e.target.value }));
          const n = Number(e.target.value);
          if (Number.isFinite(n)) setParams((p) => ({ ...p, scale: n }));
        }}
        onBlur={() => setTyped((p) => ({ ...p, scale: undefined as unknown as string }))}
      />
    </label>
  );

  return (
    <DialogShim title="Import Vector Graphics File" onClose={onCancel} className="ze-label-dialog">
      <div
        className="ze-label-dialog-body"
        // [data] gap 10: bSizerMain's file row / bSizerGroupOpt / bSizer11 borders (dialog_import_graphics_base.cpp:41,191 wx 10)
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {/* `bSizerFile` (`:23-40`): file row plus browse button — the
          browser's own file input is the whole of `onBrowseFiles`, there
          being no filesystem to browse behind it. */}
        <label
          className="ze-tvp-row"
          title="Only vectors will be imported.  Bitmaps and fonts will be ignored."
        >
          <span className="ze-tvp-label">File:</span>
          <input
            type="file"
            className="ze-tvp-input"
            accept={acceptedExtensions}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>

        {imported && (
          <div className={imported.error || empty ? 'ze-error' : 'ze-muted'}>
            {imported.error ??
              // `wxMessageBox( _( "No graphic items found in file." ) );`
              (empty
                ? 'No graphic items found in file.'
                : `${count} item(s), drawing ${imported.widthMM.toFixed(1)} × ${imported.heightMM.toFixed(1)} mm`)}
          </div>
        )}
        {imported?.notes.map((n) => (
          <div key={n} className="ze-warning">
            {n}
          </div>
        ))}

        {/* `fgSizer3` (`:41-83`): Import scale / DXF default line width /
          DXF default units, in one three-column flex grid. */}
        <fieldset>
          <legend>Import Parameters</legend>
          {scaleField}
          <label
            className="ze-tvp-row"
            title="Used when the DXF items in file have no line thickness set"
          >
            <span className="ze-tvp-label">DXF default line width:</span>
            <input
              type="text"
              className="ze-tvp-input"
              disabled={!isDxf}
              value={shown('lw', pcbUnitTextMM(params.lineWidthMM, units))}
              onChange={(e) => {
                setTyped((p) => ({ ...p, lw: e.target.value }));
                const mm = pcbUnitValueMM(e.target.value, units);
                setParams((p) => ({ ...p, lineWidthMM: mm }));
              }}
              onBlur={() => setTyped((p) => ({ ...p, lw: undefined as unknown as string }))}
            />
            <span className="ze-unit-label">{unitLabel(units)}</span>
          </label>
          <label className="ze-tvp-row" title="Used when the DXF file has no unit set">
            <span className="ze-tvp-label">DXF default units:</span>
            <Combo
              disabled={!isDxf}
              value={String(params.dxfUnits)}
              options={DXF_UNIT_CHOICES.map((u) => ({ value: String(u.value), label: u.label }))}
              onChange={(v) =>
                setParams((p) => ({ ...p, dxfUnits: Number(v) as DXF_IMPORT_UNITS }))
              }
            />
          </label>
        </fieldset>

        {/* `gbSizer2` (`:99-153`): Place at: X/Y, then Layer:. */}
        <fieldset>
          <legend>Placement</legend>
          <label className="ze-tvp-row" title="If not checked: use interactive placement.">
            <input
              type="checkbox"
              checked={params.placeAt}
              onChange={(e) => setParams((p) => ({ ...p, placeAt: e.target.checked }))}
            />
            <span>Place at:</span>
          </label>
          <div
            style={{
              display: 'flex',
              // [data] gbSizer2->Add( m_yLabel, ..., wxLEFT, 18 ) (dialog_import_graphics_base.cpp:121)
              gap: 18,
            }}
          >
            {num(
              'X:',
              'x',
              params.originMM.x,
              (mm) => setParams((p) => ({ ...p, originMM: { ...p.originMM, x: mm } })),
              params.placeAt,
            )}
            {num(
              'Y:',
              'y',
              params.originMM.y,
              (mm) => setParams((p) => ({ ...p, originMM: { ...p.originMM, y: mm } })),
              params.placeAt,
            )}
          </div>
          <label
            className="ze-tvp-row"
            title={
              'If checked, use the selected layer in this dialog\nIf unchecked, use the Board Editor active layer'
            }
          >
            <input
              type="checkbox"
              checked={params.setLayer}
              onChange={(e) => setParams((p) => ({ ...p, setLayer: e.target.checked }))}
            />
            <span>Layer:</span>
            <Combo
              disabled={!params.setLayer}
              value={params.layer}
              options={layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) }))}
              onChange={(l) => setParams((p) => ({ ...p, layer: l as PCB_LAYER_NAME }))}
            />
          </label>
          <label className="ze-tvp-row" title="Add all imported items to a new group">
            <input
              type="checkbox"
              checked={params.groupItems}
              onChange={(e) => setParams((p) => ({ ...p, groupItems: e.target.checked }))}
            />
            <span>Group imported items</span>
          </label>
        </fieldset>

        {/* `bSizer11` (`:189-208`). */}
        <fieldset>
          <legend>Discontinuities</legend>
          <label
            className="ze-tvp-row"
            title="Trim/extend open shapes or add segments to make vertices of shapes coincide"
          >
            <input
              type="checkbox"
              checked={params.fixDiscontinuities}
              onChange={(e) => setParams((p) => ({ ...p, fixDiscontinuities: e.target.checked }))}
            />
            <span>Fix discontinuities</span>
          </label>
          {num(
            'Tolerance:',
            'tol',
            params.toleranceMM,
            (mm) => setParams((p) => ({ ...p, toleranceMM: mm })),
            params.fixDiscontinuities,
          )}
        </fieldset>
      </div>

      <div className="ze-modal-footer">
        <button type="button" className="ze-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="ze-btn primary" disabled={!canOk} onClick={onOk}>
          OK
        </button>
      </div>
    </DialogShim>
  );
}
