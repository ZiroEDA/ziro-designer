// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reporting. Counterpart: `include/reporter.h` (REPORTER) and
 * `include/widgets/report_severity.h` (SEVERITY).
 *
 * A REPORTER is the write end of a message stream; the widget that displays it
 * (WX_HTML_REPORT_PANEL) is the read end. Lines carry a severity and a location
 * - head lines print first, tail lines last, everything else in report order.
 */

/** SEVERITY, a bit flag, so a filter is a mask (report_severity.h). */
export const RPT_SEVERITY_UNDEFINED = 0x01;
export const RPT_SEVERITY_INFO = 0x02;
export const RPT_SEVERITY_EXCLUSION = 0x04;
export const RPT_SEVERITY_ACTION = 0x08;
export const RPT_SEVERITY_WARNING = 0x10;
export const RPT_SEVERITY_ERROR = 0x20;
export const RPT_SEVERITY_IGNORE = 0x40;
export const RPT_SEVERITY_DEBUG = 0x80;

export type Severity = number;

/** REPORTER::LOCATION. */
export type ReportLocation = 'head' | 'body' | 'tail';

/** WX_HTML_REPORT_PANEL::REPORT_LINE. */
export interface ReportLine {
  message: string;
  severity: Severity;
  location: ReportLocation;
}

/** REPORTER, Report()/ReportTail()/ReportHead() onto a message sink. */
export class Reporter {
  readonly lines: ReportLine[] = [];

  report(message: string, severity: Severity = RPT_SEVERITY_UNDEFINED): this {
    this.lines.push({ message, severity, location: 'body' });
    return this;
  }

  reportHead(message: string, severity: Severity = RPT_SEVERITY_UNDEFINED): this {
    this.lines.push({ message, severity, location: 'head' });
    return this;
  }

  reportTail(message: string, severity: Severity = RPT_SEVERITY_UNDEFINED): this {
    this.lines.push({ message, severity, location: 'tail' });
    return this;
  }

  clear(): void {
    this.lines.length = 0;
  }

  /** REPORTER::HasMessage. */
  hasMessage(): boolean {
    return this.lines.length > 0;
  }

  /** WX_HTML_REPORT_PANEL::Count, lines matching a severity mask. */
  count(severityMask: Severity): number {
    return this.lines.filter((l) => severityMask & l.severity).length;
  }
}

/**
 * The panel's display order: head lines, then the body (optionally sorted by
 * severity, as Flush( true ) does), then tail lines.
 */
export function orderedReportLines(lines: readonly ReportLine[], sort = false): ReportLine[] {
  const head = lines.filter((l) => l.location === 'head');
  const body = lines.filter((l) => l.location === 'body');
  const tail = lines.filter((l) => l.location === 'tail');
  if (sort) body.sort((a, b) => a.severity - b.severity);
  return [...head, ...body, ...tail];
}

/** WX_HTML_REPORT_PANEL::generatePlainText, the text a saved report holds. */
export function reportLineToPlainText(line: ReportLine): string {
  switch (line.severity) {
    case RPT_SEVERITY_ERROR:
      return `Error: ${line.message}\n`;
    case RPT_SEVERITY_WARNING:
      return `Warning: ${line.message}\n`;
    case RPT_SEVERITY_INFO:
      return `Info: ${line.message}\n`;
    default:
      return `${line.message}\n`;
  }
}
