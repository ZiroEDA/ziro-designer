// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Update Schematic from PCB. Counterpart:
 * `eeschema/dialogs/dialog_update_from_pcb.cpp` (DIALOG_UPDATE_FROM_PCB) over
 * the BACK_ANNOTATE engine.
 *
 * The options box, a report panel, and two buttons. The dialog runs a **dry
 * run** on every change so the report always describes what Update Schematic
 * would do right now — upstream does the same in `updateData`, which is why the
 * preview is never stale and why the engine has a dryRun flag at all.
 *
 * "Re-link footprints to schematic symbols based on their reference
 * designators" is first and separate for a reason: it changes what is *matched*
 * rather than what is copied, and it is the only option that can attach a
 * footprint to the wrong symbol. Upstream warns that it needs a fully annotated
 * schematic; ours simply matches on the reference, which is the same bargain.
 *
 * Net-name back-annotation is not offered. It is a separate subsystem (pin
 * swaps, unit swaps, label placement) rather than another checkbox, and an
 * option that silently did nothing would be worse than its absence.
 */

import { useMemo, useState, type JSX } from 'react';
import {
  backAnnotate,
  defaultBackAnnotateOptions,
  type BackAnnotateMessage,
  type BackAnnotateOptions,
  type PcbFootprintData,
  type Schematic,
} from '@ziroeda/eeschema';
import type { EditCommand } from '@ziroeda/eeschema';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '../../../widgets/wx_html_report_panel.js';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_WARNING,
  type ReportLine,
} from '@ziroeda/common/src/reporter.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  doc: Schematic;
  /** The board's footprints, already read (`boardFootprintData`). */
  footprints: readonly PcbFootprintData[];
  /** The board file this came from, for the dialog's title line. */
  boardName?: string;
  onApply: (cmd: EditCommand) => void;
  onClose: () => void;
}

const SEVERITY: Record<BackAnnotateMessage['severity'], number> = {
  action: RPT_SEVERITY_ACTION,
  warning: RPT_SEVERITY_WARNING,
  error: RPT_SEVERITY_ERROR,
};

const toLines = (messages: readonly BackAnnotateMessage[]): ReportLine[] =>
  messages.map((m) => ({ message: m.text, severity: SEVERITY[m.severity], location: 'head' }));

/** The checkboxes, in upstream's order. */
const SWITCHES: { key: keyof BackAnnotateOptions; label: string }[] = [
  { key: 'processReferences', label: 'Update references' },
  { key: 'processFootprints', label: 'Update footprint assignments' },
  { key: 'processValues', label: 'Update values' },
  { key: 'processAttributes', label: 'Update symbol attributes' },
  { key: 'processOtherFields', label: 'Update other fields' },
];

export function DialogUpdateFromPcb({
  doc,
  footprints,
  boardName,
  onApply,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [opts, setOpts] = useState<BackAnnotateOptions>(() => defaultBackAnnotateOptions());
  const [severities, setSeverities] = useState(RPT_SEVERITY_ALL);

  // updateData(): the preview is a dry run, recomputed whenever an option
  // changes, so the report can never describe a different set than Update would.
  const preview = useMemo(
    () => backAnnotate(doc, footprints, { ...opts, dryRun: true }),
    [doc, footprints, opts],
  );

  const set = (key: keyof BackAnnotateOptions, value: boolean): void =>
    setOpts((o) => ({ ...o, [key]: value }));

  const run = (): void => {
    const result = backAnnotate(doc, footprints, { ...opts, dryRun: false });
    if (result.command) onApply(result.command);
    onClose();
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Update Schematic from PCB
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {boardName && <div className="ze-muted">Board: {boardName}</div>}

          <fieldset className="ze-props-group">
            <legend>Options</legend>
            <label className="row">
              <input
                type="checkbox"
                checked={opts.relinkFootprints}
                onChange={(e) => set('relinkFootprints', e.target.checked)}
              />
              <span>
                Re-link footprints to schematic symbols based on their reference designators
              </span>
            </label>
            {opts.relinkFootprints && (
              <div className="ze-muted" style={{ paddingLeft: 22 }}>
                Footprints are matched by reference rather than by the symbol they record. Needs a
                fully annotated schematic.
              </div>
            )}
            {SWITCHES.map((s) => (
              <label className="row" key={s.key}>
                <input
                  type="checkbox"
                  checked={Boolean(opts[s.key])}
                  onChange={(e) => set(s.key, e.target.checked)}
                />
                <span>{s.label}</span>
              </label>
            ))}
          </fieldset>

          <HtmlReportPanel
            label="Changes to be applied:"
            lines={toLines(preview.messages)}
            fileName="back-annotate.txt"
            visibleSeverities={severities}
            onVisibleSeveritiesChange={setSeverities}
            minHeight={180}
          />
        </div>
        <div className="ze-modal-footer">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="ze-btn primary"
            disabled={preview.changes === 0}
            onClick={run}
          >
            Update Schematic
          </button>
        </div>
      </div>
    </div>
  );
}
