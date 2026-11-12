// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Import Graphics. Counterpart: `DIALOG_IMPORT_GFX_SCH`
 * (eeschema/import_gfx/dialog_import_gfx_sch.cpp).
 *
 * Upstream's fields, in its order and with its labels: the file, a Placement
 * group offering interactive placement or an absolute X/Y, an Import
 * Parameters group with the scale, and a DXF Parameters group with the default
 * line width and the units.
 *
 * The plugin comes from `getPluginByExt`, as it does in `onFilename` and
 * `TransferDataFromWindow`, rather than from this file sniffing the extension
 * itself — so the formats the dialog accepts and the formats it can actually
 * read cannot drift apart.
 *
 * The import runs here rather than on OK, because the dialog has to be able to
 * say "No graphic items found in file." before it closes, and because a size
 * readout is the only way to tell a sensible scale from a silly one before
 * committing. It re-runs whenever a parameter changes: the scale, the origin,
 * the line width and the units all change what the import *produces*, not what
 * is done with it afterwards.
 *
 * The DXF Parameters group is enabled only for a DXF, as `onFilename` does:
 * neither the default line width nor the units mean anything to an SVG, which
 * carries both. The units decide only what a file that never declares
 * `$INSUNITS` is measured in — the header wins whenever there is one.
 */

import { Button, Combo, RadioButton } from '@ziroeda/wx/controls.js';
import { useMemo, useState, type JSX } from 'react';
import type { GRAPHICS_IMPORTER } from '@ziroeda/common/import_gfx/graphics_importer.js';
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
import type { SCH_ITEM } from '../sch_item.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { wxReadFileSync } from '@ziroeda/wx/filefn.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/**
 * What DIALOG_IMPORT_GFX_SCH hands back on OK: `GetImportedItems()` and
 * `IsPlacementInteractive()`; and, on a drag and drop, `SetFilenameOverride`'s file.
 */
export interface IMPORT_GFX_RESULT {
  items: SCH_ITEM[];
  interactive: boolean;
  /** `SetFilenameOverride( aFilename )`: the file dropped on the canvas, read at once. */
  filenameOverride?: string;
}

interface Props {
  /** OK: the imported items, and whether the user asked to place them by hand. */
  onOk: (items: SCH_ITEM[], interactive: boolean) => void;
  onCancel: () => void;
  /**
   * The constructor's importer choice: a fresh `GRAPHICS_IMPORTER_SCH` for a sheet,
   * `GRAPHICS_IMPORTER_LIB_SYMBOL( symbol, unit )` in the symbol editor.
   */
  importer: () => GRAPHICS_IMPORTER<SCH_ITEM>;
  /** `SetFilenameOverride( aFilename )`: open on this file (a drag and drop), read at once. */
  filenameOverride?: string;
}

/** The dropped file, as `onFilename` would read it: its name and text, or none. */
function overrideFile(aPath: string | undefined): { name: string; text: string } | null {
  if (!aPath) return null;

  const bytes = wxReadFileSync(aPath);

  if (!bytes) return null;

  return { name: aPath.slice(aPath.lastIndexOf('/') + 1), text: new TextDecoder().decode(bytes) };
}

/**
 * The units the dialog offers. Upstream's `dxfUnitsMap` is a `std::map` keyed
 * by the enum, so the order is by value rather than the order it is written in,
 * and `SetSelection( 0 )` opens on the first of them.
 */
const DXF_UNIT_CHOICES: readonly { value: DXF_IMPORT_UNITS; label: string }[] = [
  { value: DXF_IMPORT_UNITS.INCH, label: _HKI('Inches') },
  { value: DXF_IMPORT_UNITS.FEET, label: _HKI('Feet') },
  { value: DXF_IMPORT_UNITS.MM, label: _HKI('Millimeters') },
  { value: DXF_IMPORT_UNITS.CM, label: _HKI('Centimeter') },
  { value: DXF_IMPORT_UNITS.MILS, label: _HKI('Mils') },
];

/** What the parameters the import depends on currently are. */
export interface Params {
  scale: number;
  originMM: { x: number; y: number };
  lineWidthMM: number;
  dxfUnits: DXF_IMPORT_UNITS;
}

export const DEFAULT_PARAMS: Params = {
  scale: 1,
  originMM: { x: 0, y: 0 },
  lineWidthMM: 0.2,
  dxfUnits: DXF_UNIT_CHOICES[0]!.value,
};

/** What one import produced, so the dialog can report before it commits. */
export interface Imported {
  /** `GetImageWidth`/`Height`: the drawing's extent in millimetres. */
  widthMM: number;
  heightMM: number;
  /** `ReportMsg`, from both the plugin and the importer. */
  notes: string[];
  /** `GetImportedItems()`. */
  items: SCH_ITEM[];
  error?: string;
}

/** Every extension any plugin handles, as the file input's `accept`. */
const acceptedExtensions = (): string =>
  getImportableFileTypes()
    .flatMap((t) => getPlugin(t).GetFileExtensions())
    .map((e) => `.${e}`)
    .join(',');

/**
 * Run a file through its plugin and the schematic importer.
 *
 * This is `TransferDataFromWindow`: pick the plugin, hand the DXF one its two
 * extra settings, set the offset and scale on the importer, load, import.
 */
export function runImport(
  name: string,
  text: string,
  p: Params,
  aImporter: GRAPHICS_IMPORTER<SCH_ITEM>,
): Imported {
  const empty = { widthMM: 0, heightMM: 0, notes: [], items: [] };

  const plugin = getPluginByExt(fileExtension(name));
  if (!plugin) return { ...empty, error: 'Unsupported file format.' };

  const importer = aImporter;

  if (plugin instanceof DXF_IMPORT_PLUGIN) {
    plugin.SetUnit(p.dxfUnits);
    importer.SetLineWidthMM(p.lineWidthMM);
  } else {
    // "m_importer->SetLineWidthMM( 0.0 )" — an SVG carries its own widths.
    importer.SetLineWidthMM(0.0);
  }

  plugin.SetImporter(importer);
  importer.SetImportOffsetMM(p.originMM);

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

export function DialogImportGfx({
  onOk,
  onCancel,
  importer,
  filenameOverride,
}: Props): JSX.Element {
  const [file, setFile] = useState<{ name: string; text: string } | null>(() =>
    overrideFile(filenameOverride),
  );
  const [interactive, setInteractive] = useState(true);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [typed, setTyped] = useState<Record<string, string>>({});

  const isDxf =
    file !== null && getPluginByExt(fileExtension(file.name)) instanceof DXF_IMPORT_PLUGIN;

  const imported = useMemo(() => {
    if (!file) return null;
    // Interactive placement puts the drawing on the cursor, so the origin is
    // applied by the drop rather than by the import.
    return runImport(
      file.name,
      file.text,
      interactive ? { ...params, originMM: { x: 0, y: 0 } } : params,
      importer(),
    );
  }, [file, params, interactive, importer]);

  const choose = async (chosen: File | undefined): Promise<void> => {
    if (!chosen) return;
    setFile({ name: chosen.name, text: await chosen.text() });
  };

  const num = (
    label: string,
    key: 'scale' | 'lineWidthMM' | 'x' | 'y',
    value: number,
    unit: string,
    enabled = true,
  ): JSX.Element => (
    <label className="row">
      <span>{label}</span>
      <input
        type="text"
        className="ze-input"
        style={{ width: 90 }}
        disabled={!enabled}
        value={typed[key] ?? String(value)}
        onChange={(e) => {
          setTyped((p) => ({ ...p, [key]: e.target.value }));
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          setParams((p) =>
            key === 'scale'
              ? { ...p, scale: n }
              : key === 'lineWidthMM'
                ? { ...p, lineWidthMM: n }
                : { ...p, originMM: { ...p.originMM, [key]: n } },
          );
        }}
        onBlur={() => setTyped((p) => ({ ...p, [key]: undefined as unknown as string }))}
      />
      <span className="ze-muted">{unit}</span>
    </label>
  );

  const count = imported ? imported.items.length : 0;
  const empty = imported !== null && !imported.error && count === 0;

  /** The drawing's extent in millimetres, from the internal units it landed in. */
  const drawn =
    imported && count > 0
      ? `, drawing ${imported.widthMM.toFixed(1)} × ${imported.heightMM.toFixed(1)} mm`
      : '';

  return (
    <DialogShim title={_('Import Vector Graphics')} onClose={onCancel} className="ze-label-dialog">
      <div
        className="ze-label-dialog-body"
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <label className="row">
          <span>{_('File:')}</span>
          <input
            type="file"
            className="ze-input"
            accept={acceptedExtensions()}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </label>

        {imported && (
          <div className={imported.error || empty ? 'ze-error' : 'ze-muted'}>
            {imported.error ??
              (empty
                ? // `wxMessageBox( _( "No graphic items found in file." ) );`
                  _('No graphic items found in file.')
                : `${count} item(s)${drawn}`)}
          </div>
        )}

        {/* `ReportMsg` collects what the file held and the import could not
          carry; upstream shows it in the dialog's report panel. */}
        {imported?.notes.map((n) => (
          <div key={n} className="ze-warning">
            {n}
          </div>
        ))}

        <fieldset>
          <legend>{_('Placement')}</legend>
          <RadioButton
            label={_('Interactive placement')}
            checked={interactive}
            className="row"
            onChange={() => setInteractive(true)}
          />
          <RadioButton
            label={_('At')}
            checked={!interactive}
            className="row"
            onChange={() => setInteractive(false)}
          />
          <div style={{ display: 'flex', gap: 16 }}>
            {num('X:', 'x', params.originMM.x, _('mm'), !interactive)}
            {num('Y:', 'y', params.originMM.y, _('mm'), !interactive)}
          </div>
        </fieldset>

        <fieldset>
          <legend>{_('Import Parameters')}</legend>
          {num(_('Import scale:'), 'scale', params.scale, '')}
        </fieldset>

        <fieldset>
          <legend>{_('DXF Parameters')}</legend>
          {num(_('Default line width:'), 'lineWidthMM', params.lineWidthMM, _('mm'), isDxf)}
          <label className="row">
            <span>{_('Default units:')}</span>
            <Combo
              value={String(params.dxfUnits)}
              options={DXF_UNIT_CHOICES.map((u) => ({ value: String(u.value), label: u.label }))}
              disabled={!isDxf}
              className="ze-input"
              onChange={(aValue) =>
                setParams((p) => ({ ...p, dxfUnits: Number(aValue) as DXF_IMPORT_UNITS }))
              }
            />
          </label>
        </fieldset>
      </div>

      <div className="ze-modal-footer">
        <Button label={_('Cancel')} onClick={onCancel} />
        <Button
          label="OK"
          isDefault
          disabled={!imported || empty || !!imported.error}
          onClick={() => imported && onOk(imported.items, interactive)}
        />
      </div>
    </DialogShim>
  );
}
