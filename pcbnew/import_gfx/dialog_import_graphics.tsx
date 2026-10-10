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
import { GRAPHICS_IMPORTER_PCBNEW } from './graphics_importer_pcbnew.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { BOARD_ITEM_CONTAINER } from '../board_item_container.js';
import { LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
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
import { DialogImportGraphicsBase } from './dialog_import_graphics_ui.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import type { PCB_LAYER_NAME } from '@ziroeda/common/layer_ids.js';

/**
 * The units the DXF group offers. `dxfUnitsMap` (`:44-50`) is a `std::map`
 * keyed by `DXF_IMPORT_UNITS`, so `wxChoice::Append`'s order is ascending by
 * the enum's own value (INCH=1, FEET=2, MM=4, CM=5, MILS=9) rather than the
 * order the map literal is written in — the same table and the same reasoning
 * as eeschema's `DXF_UNIT_CHOICES`, which this is deliberately identical to.
 */
export const DXF_UNIT_CHOICES: readonly { value: DXF_IMPORT_UNITS; label: string }[] = [
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
 * "Layer:" checked with Dwgs.User — the importer's own
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
  // `Dwgs_User`, GRAPHICS_IMPORTER_PCBNEW's own `m_layer`.
  layer: 'Dwgs.User',
  groupItems: true,
  fixDiscontinuities: true,
  toleranceMM: 1,
  lineWidthMM: 0.2,
  dxfUnits: DXF_UNIT_CHOICES[0]!.value,
};

/** What one import produced, for the dialog to report before OK is live. */
export interface Imported {
  items: BOARD_ITEM[];
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
  aParent: BOARD_ITEM_CONTAINER | null,
): Imported {
  const empty = { items: [], widthMM: 0, heightMM: 0, notes: [] };

  const plugin = getPluginByExt(fileExtension(name));
  if (!plugin) return { ...empty, error: 'There is no plugin to handle this file type.' };

  const importer = new GRAPHICS_IMPORTER_PCBNEW(aParent);

  if (plugin instanceof DXF_IMPORT_PLUGIN) {
    plugin.SetUnit(p.dxfUnits);
    importer.SetLineWidthMM(p.lineWidthMM);
  } else {
    importer.SetLineWidthMM(0.0);
  }

  plugin.SetImporter(importer);
  importer.SetLayer(LSET_NameToLayer(p.setLayer ? p.layer : activeLayer));

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
  /** `GRAPHICS_IMPORTER_PCBNEW( m_parent->GetModel() )`: the items' parent. */
  parent: BOARD_ITEM_CONTAINER | null;
  /** `cfg->m_Display.m_Display{Invert{X,Y}Axis}`. */
  invertX: boolean;
  invertY: boolean;
  onOk: (
    items: BOARD_ITEM[],
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
  parent,
  invertX,
  invertY,
  onOk,
  onCancel,
}: Props): JSX.Element {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [typed, setTyped] = useState<Record<string, string>>({});

  // `onFilename` (`:126-138`): the DXF group is enabled only for a file whose
  // plugin IS the DXF one.
  const isDxf =
    file !== null && getPluginByExt(fileExtension(file.name)) instanceof DXF_IMPORT_PLUGIN;

  const imported = useMemo(() => {
    if (!file) return null;
    return runImport(file.name, file.text, params, invertX, invertY, activeLayer, parent);
  }, [file, params, invertX, invertY, activeLayer, parent]);

  const choose = async (chosen: File | undefined): Promise<void> => {
    if (!chosen) return;
    setFile({ name: chosen.name, text: await chosen.text() });
  };

  const count = imported ? imported.items.length : 0;
  const empty = imported !== null && !imported.error && count === 0;
  // `wxMessageBox( _( "Import scale must be a positive number." ) );`
  const badScale = params.scale <= 0;
  const badLayer = params.setLayer && layers.length > 0 && !layers.includes(params.layer);
  const canOk = !!imported && !imported.error && !empty && !badScale && !badLayer;

  return (
    <DialogImportGraphicsBase
      units={units}
      layers={layers}
      layerColor={layerColor}
      params={params}
      setParams={setParams}
      typed={typed}
      setTyped={setTyped}
      isDxf={isDxf}
      imported={imported}
      count={count}
      empty={empty}
      canOk={canOk}
      acceptedExtensions={acceptedExtensions()}
      onFile={(f) => void choose(f)}
      onCancel={onCancel}
      onOk={() =>
        imported &&
        onOk(imported.items, {
          group: params.groupItems,
          // `IsPlacementInteractive` (`.h:48`): `!m_placeAtCheckbox->GetValue()`.
          interactive: !params.placeAt,
          fixDiscontinuities: params.fixDiscontinuities,
          toleranceMM: params.toleranceMM,
        })
      }
    />
  );
}
