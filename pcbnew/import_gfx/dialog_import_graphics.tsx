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

import { useRef, useState, type JSX } from 'react';
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
import { DIALOG_IMPORT_GRAPHICS_BASE } from './dialog_import_graphics_base.js';
import { MessageDialogOk } from '@ziroeda/common/dialogs/dialog_message.js';
import { HtmlMessageBox } from '@ziroeda/common/dialogs/html_message_box.js';
import { pcbUnitTextMM, pcbUnitValueMM, unitLabel } from '../pcb_unit_binder.js';
import { DoubleValueFromString } from '@ziroeda/common/eda_units.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import type { PCB_LAYER_NAME } from '@ziroeda/common/layer_ids.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/**
 * The units the DXF group offers. `dxfUnitsMap` (`:44-50`) is a `std::map`
 * keyed by `DXF_IMPORT_UNITS`, so `wxChoice::Append`'s order is ascending by
 * the enum's own value (INCH=1, FEET=2, MM=4, CM=5, MILS=9) rather than the
 * order the map literal is written in — the same table and the same reasoning
 * as eeschema's `DXF_UNIT_CHOICES`, which this is deliberately identical to.
 */
export const DXF_UNIT_CHOICES: readonly { value: DXF_IMPORT_UNITS; label: string }[] = [
  { value: DXF_IMPORT_UNITS.INCH, label: _HKI('Inches') },
  { value: DXF_IMPORT_UNITS.FEET, label: _HKI('Feet') },
  { value: DXF_IMPORT_UNITS.MM, label: _HKI('Millimeters') },
  { value: DXF_IMPORT_UNITS.CM, label: _HKI('Centimeter') },
  { value: DXF_IMPORT_UNITS.MILS, label: _HKI('Mils') },
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
  if (!plugin) return { ...empty, error: _('There is no plugin to handle this file type.') };

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
  // The file the browser's open dialog handed over, standing in for the path on disk.
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileName, setFileName] = useState('');
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [scaleText, setScaleText] = useState('1.0');
  const [texts, setTexts] = useState<
    Partial<Record<'lineWidth' | 'x' | 'y' | 'tolerance', string>>
  >({});
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ notes: string[]; done: () => void } | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);

  const set = (patch: Partial<Params>): void => setParams((p) => ({ ...p, ...patch }));

  // onFilename: the DXF controls are live unless a known plugin that is not DXF takes the file.
  const plugin = getPluginByExt(fileExtension(fileName));
  const dxf = plugin === null || plugin instanceof DXF_IMPORT_PLUGIN;

  const length = (
    aKey: 'lineWidth' | 'x' | 'y' | 'tolerance',
    aMM: number,
    aApply: (aMM: number) => void,
    aEnabled: boolean,
  ) => ({
    value: texts[aKey] ?? pcbUnitTextMM(aMM, units),
    enabled: aEnabled,
    onChange: (aText: string) => {
      setTexts((t) => ({ ...t, [aKey]: aText }));
      const mm = pcbUnitValueMM(aText, units);
      if (Number.isFinite(mm)) aApply(mm);
    },
    onBlur: () => setTexts((t) => ({ ...t, [aKey]: undefined })),
  });

  /** TransferDataFromWindow: the three refusals, then the import and its warnings. */
  const ok = (): void => {
    if (fileName.trim() === '' || file === null) {
      setMessage(_('Please select a file to import.'));
      return;
    }

    if (params.setLayer && !layers.includes(params.layer)) {
      setMessage(_('Please select a valid layer.'));
      return;
    }

    const scale = DoubleValueFromString(scaleText);

    if (!(scale > 0.0)) {
      setMessage(_('Import scale must be a positive number.'));
      return;
    }

    const imported = runImport(
      file.name,
      file.text,
      { ...params, scale },
      invertX,
      invertY,
      activeLayer,
      parent,
    );

    if (imported.error === _('There is no plugin to handle this file type.')) {
      setMessage(imported.error);
      return;
    }

    const finish = (): void =>
      onOk(imported.items, {
        group: params.groupItems,
        // `IsPlacementInteractive` (`.h:48`): `!m_placeAtCheckbox->GetValue()`.
        interactive: !params.placeAt,
        fixDiscontinuities: params.fixDiscontinuities,
        toleranceMM: params.toleranceMM,
      });

    const notes = imported.error ? [imported.error, ...imported.notes] : imported.notes;

    if (notes.length > 0) setWarning({ notes, done: finish });
    else finish();
  };

  return (
    <>
      <DIALOG_IMPORT_GRAPHICS_BASE
        m_textCtrlFileName={{ value: fileName, onChange: setFileName }}
        onBrowseFiles={() => picker.current?.click()}
        m_importScaleCtrl={{ value: scaleText, onChange: setScaleText }}
        m_lineWidthCtrl={length(
          'lineWidth',
          params.lineWidthMM,
          (mm) => set({ lineWidthMM: mm }),
          dxf,
        )}
        units={unitLabel(units)}
        m_dxfUnitsChoice={{
          choices: DXF_UNIT_CHOICES.map((c) => c.label),
          value: DXF_UNIT_CHOICES.findIndex((c) => c.value === params.dxfUnits),
          enabled: dxf,
          onChange: (aIndex) => set({ dxfUnits: DXF_UNIT_CHOICES[aIndex]!.value }),
        }}
        m_placeAtCheckbox={{ value: params.placeAt, onChange: (aOn) => set({ placeAt: aOn }) }}
        m_xCtrl={length(
          'x',
          params.originMM.x,
          (mm) => set({ originMM: { ...params.originMM, x: mm } }),
          params.placeAt,
        )}
        m_yCtrl={length(
          'y',
          params.originMM.y,
          (mm) => set({ originMM: { ...params.originMM, y: mm } }),
          params.placeAt,
        )}
        m_setLayerCheckbox={{ value: params.setLayer, onChange: (aOn) => set({ setLayer: aOn }) }}
        m_SelLayerBox={{
          rows: layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) })),
          value: params.layer,
          enabled: params.setLayer,
          onChange: (aLayer) => set({ layer: aLayer as PCB_LAYER_NAME }),
        }}
        m_cbGroupItems={{ value: params.groupItems, onChange: (aOn) => set({ groupItems: aOn }) }}
        m_rbFixDiscontinuities={{
          value: params.fixDiscontinuities,
          onChange: (aOn) => set({ fixDiscontinuities: aOn }),
        }}
        m_toleranceCtrl={length(
          'tolerance',
          params.toleranceMM,
          (mm) => set({ toleranceMM: mm }),
          params.fixDiscontinuities,
        )}
        onOK={ok}
        onCancel={onCancel}
      />
      {/* onBrowseFiles' wxFileDialog: "All supported formats" over every plugin's extensions */}
      <input
        ref={picker}
        type="file"
        hidden
        accept={acceptedExtensions()}
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (!chosen) return;
          void chosen.text().then((aText) => {
            setFile({ name: chosen.name, text: aText });
            setFileName(chosen.name);
          });
        }}
      />
      {message !== null && <MessageDialogOk message={message} onClose={() => setMessage(null)} />}
      {warning !== null && (
        <HtmlMessageBox
          caption={_('Warning')}
          // MessageSet() over the file's own messages; they are text from the file, so they go
          // in as list rows and never as HTML.
          messages={[
            _('Items in the imported file could not be handled properly.'),
            ...warning.notes,
          ]}
          onClose={() => {
            const done = warning.done;
            setWarning(null);
            done();
          }}
        />
      )}
    </>
  );
}
