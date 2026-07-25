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

  const severityClass = (s: Severity): string =>
    s === RPT_SEVERITY_ERROR
      ? 'error'
      : s === RPT_SEVERITY_WARNING
        ? 'warning'
        : s === RPT_SEVERITY_ACTION
          ? 'action'
          : s === RPT_SEVERITY_INFO
            ? 'info'
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
