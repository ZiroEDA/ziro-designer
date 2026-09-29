// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Import Vector Graphics File. Counterpart: `DIALOG_IMPORT_GRAPHICS`
 * (`pcbnew/import_gfx/dialog_import_graphics.{h,cpp}`) and its `_base` sizer
 * tree, `DIALOG_IMPORT_GRAPHICS_BASE`.
 *
 * The layout is `_base`'s, top to bottom: a file row, a 3-column flex grid
 * (Import scale / DXF default line width+unit / DXF default units), a
 * separator, a grid-bag row for "Place at:" (X/Y, greyed unless checked) and
 * "Layer:" (greyed unless checked, using the board's active layer otherwise),
 * "Group imported items", a second separator, and "Fix discontinuities" with
 * its Tolerance field. `onUpdateUI` (`:257-264`) is what greys the four pairs;
 * this reads the same four booleans straight from state instead of an event.
 *
 * `onFilename` (`:126-138`) is what enables the DXF group only for a file a
 * `DXF_IMPORT_PLUGIN` will open — computed here as `isDxf` from the chosen
 * file's extension, the same test.
 *
 * The import itself is NOT deferred to OK. It reruns on every parameter change
 * so the dialog can report "No graphic items found in file." before it closes
 * and so a size readout exists to judge a silly scale by — same reasoning as
 * `eeschema/import_gfx/dialog_import_gfx_sch.tsx`, which this mirrors for the
 * parts both dialogs share (the file row, the DXF group, the live re-import).
 * `TransferDataFromWindow` (`:174-238`) is `runImport` below, plus the two
 * validations before it (`onBrowseFiles` has no equivalent — the browser's
 * own `<input type="file">` is the picker).
 */

import { useMemo, useState, type JSX } from 'react';
import {
  GRAPHICS_IMPORTER_PCBNEW,
  DEFAULT_IMPORT_LAYER,
  type IMPORTED_ITEM,
} from './graphics_importer_pcbnew.js';
import {
  fileExtension,
  getImportableFileTypes,
  getPlugin,
  getPluginByExt,
} from '@ziroeda/common/import_gfx/graphics_import_mgr.js';
import {
  DXF_IMPORT_PLUGIN,
  DXF_IMPORT_UNITS,
} from '@ziroeda/common/import_gfx/dxf_import_plugin.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { pcbUnitTextMM, pcbUnitValueMM, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import type { PCB_LAYER_NAME } from '@ziroeda/common/layer_ids.js';

/**
 * The units the DXF group offers. `dxfUnitsMap` (`:44-50`) is a `std::map`
 * keyed by `DXF_IMPORT_UNITS`, so `wxChoice::Append`'s order is ascending by
 * the enum's own value (INCH=1, FEET=2, MM=4, CM=5, MILS=9) rather than the
 * order the map literal is written in — the same table and the same reasoning
 * as eeschema's `DXF_UNIT_CHOICES`, which this is deliberately identical to.
 */
const DXF_UNIT_CHOICES: readonly { value: DXF_IMPORT_UNITS; label: string }[] = [
  { value: DXF_IMPORT_UNITS.INCH, label: 'Inches' },
  { value: DXF_IMPORT_UNITS.FEET, label: 'Feet' },
  { value: DXF_IMPORT_UNITS.MM, label: 'Millimeters' },
  { value: DXF_IMPORT_UNITS.CM, label: 'Centimeter' },
  { value: DXF_IMPORT_UNITS.MILS, label: 'Mils' },
];

/** What `TransferDataFromWindow` reads off the dialog. */
export interface Params {
  /** `m_importScaleCtrl`, a plain `wxTextCtrl` (not a `UNIT_BINDER`): unitless. */
  scale: number;
  /** `m_placeAtCheckbox` / `m_xOrigin` / `m_yOrigin`. */
  placeAt: boolean;
  originMM: { x: number; y: number };
  /** `m_setLayerCheckbox` / `m_SelLayerBox`. */
  setLayer: boolean;
  layer: PCB_LAYER_NAME;
  /** `m_cbGroupItems`. */
  groupItems: boolean;
  /** `m_rbFixDiscontinuities` / `m_toleranceCtrl`. */
  fixDiscontinuities: boolean;
  toleranceMM: number;
  /** `m_defaultLineWidth` / `m_dxfUnitsChoice`, read only for a DXF. */
  lineWidthMM: number;
  dxfUnits: DXF_IMPORT_UNITS;
}

/**
 * `_base`'s literal defaults: place-at unchecked (interactive placement),
 * "Layer:" checked with {@link DEFAULT_IMPORT_LAYER} — the importer's own
 * default, since nothing in `dialog_import_graphics.cpp` calls
 * `SetLayerSelection` before the first paint — group items and fix
 * discontinuities both checked, tolerance "1" and line width "0.2", both read
 * in the user's current display unit; here millimetres directly, since every
 * caller already carries a `StatusUnits` for display only.
 */
export const DEFAULT_PARAMS: Params = {
  scale: 1,
  placeAt: false,
  originMM: { x: 0, y: 0 },
  setLayer: true,
  layer: DEFAULT_IMPORT_LAYER,
  groupItems: true,
  fixDiscontinuities: true,
  toleranceMM: 1,
  lineWidthMM: 0.2,
  dxfUnits: DXF_UNIT_CHOICES[0]!.value,
};

/** What one import produced, for the dialog to report before OK is live. */
export interface Imported {
  items: IMPORTED_ITEM[];
  /** `GetImageWidth`/`Height`: the drawing's extent in millimetres. */
  widthMM: number;
  heightMM: number;
  /** `ReportMsg`, from both the plugin and the importer. */
  notes: string[];
  error?: string;
}

/** Every extension any plugin handles, as the file input's `accept`. */
const acceptedExtensions = (): string =>
  getImportableFileTypes()
    .flatMap((t) => getPlugin(t).GetFileExtensions())
    .map((e) => `.${e}`)
    .join(',');

/**
 * `TransferDataFromWindow`'s import half (`:196-227`), minus the two
 * validations that precede it (empty filename / no layer selected — the
 * dialog below refuses OK for those instead of popping a `wxMessageBox`).
 *
 * `origin` is the DXF/SVG-file-space offset that, after
 * `GRAPHICS_IMPORTER_PCBNEW::MapCoordinate`'s `coord*scale + offset`, lands
 * the drawing's own (0,0) at the typed X/Y — `origin = typed / scale`, signed
 * per axis for the frame's invert-axis display options, exactly the formula
 * at `:216-220`. Interactive placement passes `{ x: 0, y: 0 }` for `originMM`
 * regardless of the X/Y fields (they are disabled in that mode, per
 * `onUpdateUI`), so the drawing lands at the model origin and the caller's
 * move gesture is what carries it to the cursor.
 */
export function runImport(
  name: string,
  text: string,
  p: Params,
  invertX: boolean,
  invertY: boolean,
  activeLayer: PCB_LAYER_NAME,
): Imported {
  const empty = { items: [], widthMM: 0, heightMM: 0, notes: [] };

  const plugin = getPluginByExt(fileExtension(name));
  if (!plugin) return { ...empty, error: 'There is no plugin to handle this file type.' };

  const importer = new GRAPHICS_IMPORTER_PCBNEW();

  if (plugin instanceof DXF_IMPORT_PLUGIN) {
    plugin.SetUnit(p.dxfUnits);
    importer.SetLineWidthMM(p.lineWidthMM);
  } else {
    importer.SetLineWidthMM(0.0);
  }

  plugin.SetImporter(importer);
  importer.SetLayer(p.setLayer ? p.layer : activeLayer);

  const xscale = p.scale * (invertX ? -1 : 1);
  const yscale = p.scale * (invertY ? -1 : 1);
  const origin = p.placeAt
    ? { x: p.originMM.x / xscale, y: p.originMM.y / yscale }
    : { x: 0, y: 0 };
  importer.SetImportOffsetMM(origin);

  if (!plugin.Load(text)) return { ...empty, error: 'The file could not be read.' };

  importer.SetScale({ x: p.scale, y: p.scale });
  plugin.Import();

  const notes = [plugin.GetMessages(), importer.GetMessages()]
    .join('')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');

  return {
    items: importer.GetItems(),
    widthMM: plugin.GetImageWidth(),
    heightMM: plugin.GetImageHeight(),
    notes: [...new Set(notes)],
  };
}

interface Props {
  units: StatusUnits;
  /** The board's own layers, for the "Layer:" selector — `Resync()`. */
  layers: readonly string[];
  layerColor: (layer: string) => string;
  /** `m_parent->GetActiveLayer()`, used when "Layer:" is unchecked. */
  activeLayer: PCB_LAYER_NAME;
  /** `cfg->m_Display.m_Display{Invert{X,Y}Axis}`. */
  invertX: boolean;
  invertY: boolean;
  onOk: (
    items: IMPORTED_ITEM[],
    opts: {
      group: boolean;
      interactive: boolean;
      fixDiscontinuities: boolean;
      toleranceMM: number;
    },
  ) => void;
  onCancel: () => void;
}

export function DialogImportGraphics({
  units,
  layers,
  layerColor,
  activeLayer,
  invertX,
  invertY,
  onOk,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask.
  useModalEscape(onCancel);

  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [typed, setTyped] = useState<Record<string, string>>({});

  // `onFilename` (`:126-138`): the DXF group is enabled only for a file whose
  // plugin IS the DXF one.
  const isDxf =
    file !== null && getPluginByExt(fileExtension(file.name)) instanceof DXF_IMPORT_PLUGIN;

  const imported = useMemo(() => {
    if (!file) return null;
    return runImport(file.name, file.text, params, invertX, invertY, activeLayer);
  }, [file, params, invertX, invertY, activeLayer]);

  const choose = async (chosen: File | undefined): Promise<void> => {
    if (!chosen) return;
    setFile({ name: chosen.name, text: await chosen.text() });
  };

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

  const count = imported ? imported.items.length : 0;
  const empty = imported !== null && !imported.error && count === 0;
  // `wxMessageBox( _( "Import scale must be a positive number." ) );`
  const badScale = params.scale <= 0;
  const badLayer = params.setLayer && layers.length > 0 && !layers.includes(params.layer);
  const canOk = !!imported && !imported.error && !empty && !badScale && !badLayer;

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Import Vector Graphics File
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div
          className="ze-label-dialog-body"
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
              accept={acceptedExtensions()}
              onChange={(e) => void choose(e.target.files?.[0])}
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
            <div style={{ display: 'flex', gap: 16 }}>
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
          <button
            type="button"
            className="ze-btn primary"
            disabled={!canOk}
            onClick={() =>
              imported &&
              onOk(imported.items, {
                group: params.groupItems,
                // `IsPlacementInteractive` (`.h:48`): `!m_placeAtCheckbox->GetValue()`.
                interactive: !params.placeAt,
                fixDiscontinuities: params.fixDiscontinuities,
                toleranceMM: params.toleranceMM,
              })
            }
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
