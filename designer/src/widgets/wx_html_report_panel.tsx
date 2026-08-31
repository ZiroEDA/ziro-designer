// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Output-messages panel. Counterpart: `common/widgets/wx_html_report_panel.cpp`
 * (WX_HTML_REPORT_PANEL), a titled box holding the report lines, the
 * "Show:" severity filters with their error/warning badges, and Save…
 *
 * The HTML window becomes a scrolling list of rows carrying the same colours
 * and "Error:"/"Warning:" prefixes generateHtml() writes.
 */

import { useMemo, type JSX } from 'react';
import {
  orderedReportLines,
  reportLineToPlainText,
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
  type ReportLine,
  type Severity,
} from '@ziroeda/common';

/** The panel's own definition of "all" (wx_html_report_panel.cpp). */
export const RPT_SEVERITY_ALL =
  RPT_SEVERITY_WARNING | RPT_SEVERITY_ERROR | RPT_SEVERITY_INFO | RPT_SEVERITY_ACTION;

interface Props {
  /** Static-box label (WX_HTML_REPORT_PANEL::SetLabel); "Output Messages" upstream. */
  label?: string;
  lines: readonly ReportLine[];
  /** Default name for the saved report (SetFileName). */
  fileName?: string;
  /** Visible-severity mask; the owner persists it (annotation.messages_filter). */
  visibleSeverities: Severity;
  onVisibleSeveritiesChange: (mask: Severity) => void;
  /** MsgPanelSetMinSize's height, in px. */
  minHeight?: number;
  /** Sort the body by severity, as Flush( true ) does. */
  sorted?: boolean;
}

/** NUMBER_BADGE: red/yellow when non-zero, green at zero, hidden when negative. */
function Badge({ count, severity }: { count: number; severity: Severity }): JSX.Element {
  const cls = count === 0 ? 'zero' : severity === RPT_SEVERITY_ERROR ? 'error' : 'warning';
  return <span className={`ze-badge ${cls}`}>{count}</span>;
}

export function HtmlReportPanel({
  label = 'Output Messages',
  lines,
  fileName = 'report.txt',
  visibleSeverities,
  onVisibleSeveritiesChange,
  minHeight = 120,
  sorted = false,
}: Props): JSX.Element {
  const shown = useMemo(
    () => orderedReportLines(lines, sorted).filter((l) => visibleSeverities & l.severity),
    [lines, sorted, visibleSeverities],
  );
  const count = (mask: Severity): number => lines.filter((l) => mask & l.severity).length;

  const has = (bit: Severity): boolean => (visibleSeverities & bit) !== 0;
  const toggle = (bit: Severity): void =>
    onVisibleSeveritiesChange(has(bit) ? visibleSeverities & ~bit : visibleSeverities | bit);

  // onCheckBox: "All" forces errors on and follows its own state elsewhere.
  const toggleAll = (): void =>
    onVisibleSeveritiesChange(
      visibleSeverities === RPT_SEVERITY_ALL ? RPT_SEVERITY_ERROR : RPT_SEVERITY_ALL,
    );

  const save = (): void => {
    const text = orderedReportLines(lines, sorted).map(reportLineToPlainText).join('');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * `generateHtml`'s dark-theme branch (wx_html_report_panel.cpp:176-196) reads
   *
   *     RPT_SEVERITY_INFO   -> <font color=#909090 size=3>
   *     RPT_SEVERITY_ACTION -> <font color=#60D060 size=3>
   *
   * and INFO does NOT come out grey in the shipped build. Measured off a
   * capture of this very dialog, whose "Processing symbol '…'" lines are
   * `Report( msg, RPT_SEVERITY_INFO )` (board_netlist_updater.cpp:2091): every
   * text pixel in KiCad's report box is 255, against 144 - exactly #909090 -
   * in ours. That is what "the KiCad text is more whiter" was.
   *
   * The likely cause is in the markup: `color=#909090` is written UNQUOTED, and
   * a `#`-prefixed value without quotes is not a colour wxHTML will parse, so
   * the tag contributes nothing and the line falls back to the window's own
   * foreground. `ACTION`'s `#60D060` is written the same way and presumably
   * fails the same way, but no capture here shows an ACTION line, so it is left
   * alone rather than changed on a theory.
   */
  const severityClass = (s: Severity): string =>
    s === RPT_SEVERITY_ERROR
      ? 'error'
      : s === RPT_SEVERITY_WARNING
        ? 'warning'
        : s === RPT_SEVERITY_ACTION
          ? 'action'
          : '';

  return (
    <fieldset className="ze-report-panel">
      <legend>{label}</legend>
      <div className="ze-report-view" style={{ minHeight }} data-testid="report-panel-view">
        {shown.map((line, i) => (
          <div
            key={`${i}:${line.message}`}
            className={`ze-report-line ${severityClass(line.severity)}`}
          >
            {line.severity === RPT_SEVERITY_ERROR && <span className="tag">Error: </span>}
            {line.severity === RPT_SEVERITY_WARNING && <span className="tag">Warning: </span>}
            {line.message}
          </div>
        ))}
      </div>
      <div className="ze-report-filters">
        <span className="ze-report-show">Show:</span>
        <label>
          <input
            type="checkbox"
            checked={visibleSeverities === RPT_SEVERITY_ALL}
            onChange={toggleAll}
          />
          All
        </label>
        <label>
          <input
            type="checkbox"
            checked={has(RPT_SEVERITY_ERROR)}
            onChange={() => toggle(RPT_SEVERITY_ERROR)}
          />
          Errors
        </label>
        <Badge count={count(RPT_SEVERITY_ERROR)} severity={RPT_SEVERITY_ERROR} />
        <label>
          <input
            type="checkbox"
            checked={has(RPT_SEVERITY_WARNING)}
            onChange={() => toggle(RPT_SEVERITY_WARNING)}
          />
          Warnings
        </label>
        <Badge count={count(RPT_SEVERITY_WARNING)} severity={RPT_SEVERITY_WARNING} />
        <label>
          <input
            type="checkbox"
            checked={has(RPT_SEVERITY_ACTION)}
            onChange={() => toggle(RPT_SEVERITY_ACTION)}
          />
          Actions
        </label>
        <label>
          <input
            type="checkbox"
            checked={has(RPT_SEVERITY_INFO)}
            onChange={() => toggle(RPT_SEVERITY_INFO)}
          />
          Infos
        </label>
        <span className="ze-report-spacer" />
        <button type="button" className="ze-btn" onClick={save}>
          Save...
        </button>
      </div>
    </fieldset>
  );
}
