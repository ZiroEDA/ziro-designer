// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Export Netlist dialog. Counterpart: `eeschema/dialogs/dialog_export_netlist.cpp`
 * (DIALOG_EXPORT_NETLIST), a notebook with one page per exporter — the seven
 * built-in ones upstream installs, in its order; each page has an Export
 * Netlist button that writes the file.
 * Allegro is the exception to "one page, one file": it is a netlist plus a
 * sibling `devices/` directory of package definitions. With a project sink each
 * file lands in its own place; without one a browser download cannot create a
 * folder, so the set goes out as a `.zip` rather than as names with the slashes
 * flattened out of them.
 *
 * (Custom command-line generators are a desktop-only feature and omitted.)
 */

import { useState, type JSX } from 'react';
import { strToU8, zipSync } from 'fflate';
import { RPT_SEVERITY_ACTION, RPT_SEVERITY_ERROR, type ReportLine } from '@ziroeda/common';
import { RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import {
  generateSpiceNetlist,
  serializeSchematic,
  type NetlistFormat,
  type Schematic,
  type LibSymbol,
} from '../index.js';
import type { RawFile } from '@ziroeda/common/drawing_sheet/project_sheet.js';
import { loadProjectSchematic, symbolLibraryUri } from '../cross-probing.js';
import { WriteNetListText } from '../netlist_exporters/netlist_generator.js';
import { generateSpiceModelNetlist } from '../netlist_exporters/netlist_exporter_spice_model.js';
import type { SCHEMATIC } from '../schematic.js';
import { DIALOG_EXPORT_NETLIST_BASE } from './dialog_export_netlist_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

interface Props {
  doc: Schematic;
  libById: Map<string, LibSymbol>;
  /**
   * The project as files - every sheet, the `.kicad_pro`, the `sym-lib-table` - with the
   * root schematic's name, so the export covers the whole hierarchy the way
   * `WriteNetListFile` does. Without it the open sheet is exported on its own.
   */
  projectFiles?: () => { files: readonly RawFile[]; rootFile: string; rootPro?: string };
  /** Suggested output base name (sheet/project name, no extension). */
  baseName: string;
  /**
   * `Project().GetProjectName()`, which names the SPICE Model page's
   * `.subckt`. Falls back to `baseName` for a schematic with no project.
   */
  projectName?: string;
  /**
   * Hand the netlist to the App, which downloads it, as plotting does. When
   * absent the dialog streams the download itself.
   */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  onClose: () => void;
}

type ExportTab = NetlistFormat | 'spice' | 'spicemodel';

// The constructor's page order and titles, each with the label its Install* adds
// (dialog_export_netlist.cpp:270-297, 345-401).
const TABS: { id: ExportTab; label: string; ext: string; note: string }[] = [
  { id: 'kicadxml', label: 'KiCad', ext: 'xml', note: _HKI('Export netlist in KiCad format') },
  {
    id: 'orcadpcb2',
    label: 'OrcadPCB2',
    ext: 'net',
    note: _HKI('Export netlist in OrcadPCB2 format'),
  },
  // A netlist plus a devices/ folder of package definitions; see doExport.
  { id: 'allegro', label: 'Allegro', ext: 'txt', note: _HKI('Export netlist in Allegro format') },
  { id: 'cadstar', label: 'CadStar', ext: 'frp', note: _HKI('Export netlist in CadStar format') },
  { id: 'pads', label: 'PADS', ext: 'asc', note: _HKI('Export netlist in PADS format') },
  { id: 'spice', label: 'SPICE', ext: 'cir', note: _HKI('Export netlist in SPICE format') },
  {
    // `InstallPageSpiceModel`. Its type has no `FilenamePrms` case, so upstream's save dialog
    // proposes the bare project name under the all-files filter - no extension.
    id: 'spicemodel',
    label: 'SPICE Model',
    ext: '',
    note: _HKI('Export netlist as a SPICE .subckt model'),
  },
];

/**
 * m_CurSheetAsRoot: the record exporter walks the open sheet only, which is the option ticked,
 * so it shows ticked and greyed until the live switch can export the whole hierarchy.
 */
const CUR_SHEET_AS_ROOT = {
  label: _HKI('Use current sheet as root'),
  title: _HKI('Export netlist only for the current sheet'),
  value: true,
  enabled: false,
  onChange: () => {},
};

export function DialogExportNetlist({
  doc,
  libById,
  projectFiles,
  baseName,
  projectName = baseName,
  onOutputFile,
  onClose,
}: Props): JSX.Element {
  // Project-relative output folder; '' is the project's own folder, matching
  // the Plot dialog's "Output directory".
  const [outputDir, setOutputDir] = useState('');
  const [messages, setMessages] = useState<readonly ReportLine[]>([]);
  const [severities, setSeverities] = useState<number>(RPT_SEVERITY_ALL);
  const report = (message: string, severity: number): void =>
    setMessages((prev) => [...prev, { message, severity, location: 'body' }]);
  const [tab, setTab] = useState<ExportTab>('kicadxml');
  // The Spice page's options (DIALOG_EXPORT_NETLIST's spice checkboxes).
  const [saveAllVoltages, setSaveAllVoltages] = useState(false);
  const [saveAllCurrents, setSaveAllCurrents] = useState(false);
  const [saveAllDissipations, setSaveAllDissipations] = useState(false);
  const active = TABS.find((t) => t.id === tab)!;

  /**
   * The SCHEMATIC the exporters walk: the project loaded the way kicad-cli loads it, or
   * - with no project to read - the open sheet alone, saved and loaded back.
   */
  const liveSchematic = (): SCHEMATIC | null => {
    const project = projectFiles?.();
    if (project) return loadProjectSchematic(project.files, project.rootFile, project.rootPro);
    const file = `${baseName}.kicad_sch`;
    return loadProjectSchematic([{ name: file, text: serializeSchematic(doc) }], file);
  };

  const doExport = (): void => {
    // Allegro is the one format that is not a single file: a netlist plus a
    // sibling devices/ directory of package definitions. Through the App's sink
    // the set downloads as one zip with its folders (output_downloads.ts);
    // without one the dialog zips it itself, rather than flattening the slashes
    // out of the names.
    if (tab === 'allegro') {
      const filename = `${baseName}.${active.ext}`;
      const schematic = liveSchematic();
      if (!schematic) {
        report('Received an error while reading the schematic.', RPT_SEVERITY_ERROR);
        return;
      }
      const files = WriteNetListText('allegro', schematic, filename);
      if (onOutputFile) {
        for (const f of files) {
          const path = outputDir ? `${outputDir}/${f.path}` : f.path;
          onOutputFile(path, new TextEncoder().encode(f.text), 'text/plain');
          report(`Netlist written to '${path}'.`, RPT_SEVERITY_ACTION);
        }
      } else {
        const entries: Record<string, Uint8Array> = {};
        for (const f of files) entries[f.path] = strToU8(f.text);
        const zip = `${baseName}-allegro.zip`;
        const url = URL.createObjectURL(new Blob([zipSync(entries)], { type: 'application/zip' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = zip;
        a.click();
        URL.revokeObjectURL(url);
        report(`Netlist downloaded as '${zip}'.`, RPT_SEVERITY_ACTION);
      }
      onClose();
      return;
    }

    let text: string;
    let errors: string[] = [];
    if (tab === 'spice' || tab === 'spicemodel') {
      // NET_TYPE_SPICE_MODEL carries none of the save options (:523-526):
      // only the exporter changes, to NETLIST_EXPORTER_SPICE_MODEL.
      const out =
        tab === 'spice'
          ? generateSpiceNetlist(doc, libById, null, {
              saveAllVoltages,
              saveAllCurrents,
              saveAllDissipations,
            })
          : generateSpiceModelNetlist(doc, libById, projectName, null);
      errors = out.errors;
      text = out.text;
    } else {
      const schematic = liveSchematic();
      if (!schematic) {
        report('Received an error while reading the schematic.', RPT_SEVERITY_ERROR);
        return;
      }
      const libraryUri = symbolLibraryUri(projectFiles?.().files ?? []);
      text = WriteNetListText(tab, schematic, baseName, libraryUri)[0]!.text;
    }
    const mime = tab === 'kicadxml' ? 'application/xml' : 'text/plain';
    const filename = active.ext === '' ? baseName : `${baseName}.${active.ext}`;
    // The netlist is downloaded through the App's sink, as a plot is; without one, directly.
    if (onOutputFile) {
      const path = outputDir ? `${outputDir}/${filename}` : filename;
      onOutputFile(path, new TextEncoder().encode(text), mime);
      report(`Netlist written to '${path}'.`, RPT_SEVERITY_ACTION);
    } else {
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      report(`Netlist downloaded as '${filename}'.`, RPT_SEVERITY_ACTION);
    }
    // Spice errors are worth reading, so they go to the panel and the dialog
    // stays open to show them.
    for (const err of errors) report(err, RPT_SEVERITY_ERROR);
    if (errors.length === 0) onClose();
  };

  const check = (label: string, title: string, value: boolean, set: (v: boolean) => void) => ({
    label,
    title,
    value,
    onChange: set,
  });

  return (
    <DIALOG_EXPORT_NETLIST_BASE
      m_outputPath={outputDir}
      onOutputPath={setOutputDir}
      selection={TABS.findIndex((t) => t.id === tab)}
      onPageChanged={(i) => setTab(TABS[i]!.id)}
      pages={TABS.map((t) => ({
        title: t.label,
        label: t.note,
        checks:
          t.id === 'spice'
            ? [
                { ...CUR_SHEET_AS_ROOT, grow: true },
                check(
                  _('Save all voltages'),
                  _('Write a directive to save all voltages (.save all)'),
                  saveAllVoltages,
                  setSaveAllVoltages,
                ),
                check(
                  _('Save all currents'),
                  _('Write a directive to save all currents (.probe alli)'),
                  saveAllCurrents,
                  setSaveAllCurrents,
                ),
                check(
                  _('Save all power dissipations'),
                  _('Write directives to save power dissipation of all items (.probe p(<item>))'),
                  saveAllDissipations,
                  setSaveAllDissipations,
                ),
                {
                  // The exporter writes no `esave none`, which is this box ticked; greyed until
                  // the option is ported.
                  label: _('Save all digital event data'),
                  title:
                    'If not set, write a directive to prevent the saving of digital event data ' +
                    '(esave none)',
                  value: true,
                  enabled: false,
                  onChange: () => {},
                },
              ]
            : t.id === 'spicemodel'
              ? [{ ...CUR_SHEET_AS_ROOT, grow: true }]
              : [],
      }))}
      m_MessagesBox={{
        lines: messages,
        fileName: 'netlist-report.txt',
        visibleSeverities: severities,
        onVisibleSeveritiesChange: setSeverities,
      }}
      onOK={doExport}
      onCancel={onClose}
    />
  );
}
