// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Export Netlist dialog. Counterpart: `eeschema/dialogs/dialog_export_netlist.cpp`
 * (DIALOG_EXPORT_NETLIST), a notebook with one page per exporter. We ship the
 * two built-in formats KiCad generates natively (KiCad generic XML and
 * OrcadPCB2); each page has an Export Netlist button that downloads the file.
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
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '../../../widgets/wx_html_report_panel.js';
import {
  generateNetlist,
  netlistFiles,
  generateSpiceNetlist,
  type NetlistFormat,
  type Schematic,
  type LibSymbol,
} from '@ziroeda/eeschema';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  doc: Schematic;
  libById: Map<string, LibSymbol>;
  /** Suggested output base name (sheet/project name, no extension). */
  baseName: string;
  /** Folders that already exist in the project, for the output-path list. */
  projectFolders?: readonly string[];
  /**
   * Write the netlist into the project's file manager, as plotting does. When
   * absent the dialog streams a download instead, which is what it did before
   * there was anywhere else to put the file.
   */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  onClose: () => void;
}

type ExportTab = NetlistFormat | 'spice';

const TABS: { id: ExportTab; label: string; ext: string; note: string }[] = [
  {
    id: 'kicadxml',
    label: 'KiCad',
    ext: 'xml',
    note: 'The KiCad generic XML netlist (used by BOM tools and importers).',
  },
  {
    id: 'orcadpcb2',
    label: 'OrcadPCB2',
    ext: 'net',
    note: 'The classic OrcadPCB2 text netlist.',
  },
  {
    id: 'cadstar',
    label: 'CadStar',
    ext: 'frp',
    note: 'The CadStar netlist (NETLIST_EXPORTER_CADSTAR).',
  },
  {
    id: 'pads',
    label: 'PADS',
    ext: 'asc',
    note: 'The PADS-PCB netlist (NETLIST_EXPORTER_PADS).',
  },
  {
    id: 'allegro',
    label: 'Allegro',
    ext: 'txt',
    note:
      'The Cadence Allegro / Telesis netlist. Writes a netlist plus a devices/ ' +
      'folder of package definitions.',
  },
  {
    id: 'spice',
    label: 'Spice',
    ext: 'cir',
    note: 'SPICE circuit netlist for external simulators (NETLIST_EXPORTER_SPICE).',
  },
];

export function DialogExportNetlist({
  doc,
  libById,
  baseName,
  projectFolders = [],
  onOutputFile,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

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
  const [spiceErrors, setSpiceErrors] = useState<string[]>([]);
  const active = TABS.find((t) => t.id === tab)!;

  const doExport = (): void => {
    // Allegro is the one format that is not a single file: a netlist plus a
    // sibling devices/ directory of package definitions. With a project sink
    // each file lands in its own place, folder and all; without one a browser
    // download cannot create a folder, so the set goes out as a .zip rather
    // than as names with the slashes flattened out of them.
    if (tab === 'allegro') {
      const filename = `${baseName}.${active.ext}`;
      const files = netlistFiles('allegro', filename, doc, libById, {
        source: `${baseName}.kicad_sch`,
      });
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
    if (tab === 'spice') {
      const out = generateSpiceNetlist(doc, libById, null, {
        saveAllVoltages,
        saveAllCurrents,
        saveAllDissipations,
      });
      setSpiceErrors(out.errors);
      text = out.text;
    } else {
      text = generateNetlist(tab, doc, libById, { source: `${baseName}.kicad_sch` });
    }
    const mime = tab === 'kicadxml' ? 'application/xml' : 'text/plain';
    const filename = `${baseName}.${active.ext}`;
    // The netlist lands in the project's file manager, as a plot does. Without
    // a sink there is nowhere else to put it, so it streams out instead.
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
    for (const err of tab === 'spice' ? spiceErrors : []) report(err, RPT_SEVERITY_ERROR);
    if (tab !== 'spice' || spiceErrors.length === 0) onClose();
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Export Netlist
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-erc-tabs" style={{ padding: '6px 10px 0' }}>
          {TABS.map((t) => (
            <div
              key={t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </div>
          ))}
        </div>
        <div className="ze-modal-body" style={{ display: 'block', padding: '14px' }}>
          <p className="ze-muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
            {active.note}
          </p>
          <div style={{ fontSize: 12 }}>
            Output file:{' '}
            <code>
              {baseName}.{active.ext}
            </code>
          </div>
          {tab === 'spice' && (
            <div style={{ marginTop: 10, display: 'grid', gap: 4, fontSize: 12.5 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={saveAllVoltages}
                  onChange={(e) => setSaveAllVoltages(e.target.checked)}
                />
                Save all voltages
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={saveAllCurrents}
                  onChange={(e) => setSaveAllCurrents(e.target.checked)}
                />
                Save all currents
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={saveAllDissipations}
                  onChange={(e) => setSaveAllDissipations(e.target.checked)}
                />
                Save all power dissipations
              </label>
              {spiceErrors.length > 0 && (
                <div style={{ color: 'var(--ze-error, #c33)', marginTop: 4 }}>
                  {spiceErrors.map((e) => (
                    <div key={e}>{e}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Output directory, project-relative, as the Plot dialog has. */}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            Output directory:
            <input
              list="ze-netlist-folders"
              value={outputDir}
              placeholder="(project folder)"
              onChange={(e) => setOutputDir(e.target.value)}
              style={{ flex: 1 }}
            />
            <datalist id="ze-netlist-folders">
              {projectFolders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
        </div>
        {/* Output Messages (WX_HTML_REPORT_PANEL), as the other exporters have. */}
        <div style={{ padding: '0 10px 8px' }}>
          <HtmlReportPanel
            lines={messages}
            fileName="netlist-report.txt"
            minHeight={90}
            visibleSeverities={severities}
            onVisibleSeveritiesChange={setSeverities}
          />
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onClose}>
            Close
          </button>
          <button className="ze-btn primary" onClick={doExport}>
            Export Netlist
          </button>
        </div>
      </div>
    </div>
  );
}
