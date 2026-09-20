// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_report.h` + `.cpp`: the DRC report writers. Both return
 * the report text - the file is the caller's (the designer's file manager)
 * where the C++ writes to `aFullFileName`.
 */
import { GetMajorMinorPatchVersion } from '@ziroeda/common/src/build_version.js';
import { type EdaUnits, pcbIUScale, unitLabel } from '@ziroeda/common/src/eda_units.js';
import type { RC_ITEMS_PROVIDER } from '@ziroeda/common/src/rc_item.js';
import type {
  DRC_REPORT as RC_JSON_DRC_REPORT,
  IGNORED_CHECK,
  VIOLATION,
} from '@ziroeda/common/src/rc_json_schema.js';
import { violationToJson } from '@ziroeda/common/src/rc_json_schema.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/src/reporter.js';
import { GetISO8601CurrentDateTime } from '@ziroeda/common/src/string_utils.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { formatSeverities } from '@ziroeda/common/src/widgets/report_severity.js';
import type { BOARD } from '../board.js';
import { DRC_ITEM } from './drc_item.js';

/** `wxFileName( path ).GetFullName()`: the name with its extension. */
const fullName = (aPath: string): string =>
  aPath.slice(Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\')) + 1);

export class DRC_REPORT {
  private m_board: BOARD;
  private m_reportUnits: EdaUnits;
  private m_markersProvider: RC_ITEMS_PROVIDER | null;
  private m_ratsnestProvider: RC_ITEMS_PROVIDER | null;
  private m_fpWarningsProvider: RC_ITEMS_PROVIDER | null;
  private m_reportedSeverities: number;

  constructor(
    aBoard: BOARD,
    aReportUnits: EdaUnits,
    aMarkersProvider: RC_ITEMS_PROVIDER | null,
    aRatsnestProvider: RC_ITEMS_PROVIDER | null,
    aFpWarningsProvider: RC_ITEMS_PROVIDER | null,
  ) {
    this.m_board = aBoard;
    this.m_reportUnits = aReportUnits;
    this.m_markersProvider = aMarkersProvider;
    this.m_ratsnestProvider = aRatsnestProvider;
    this.m_fpWarningsProvider = aFpWarningsProvider;
    this.m_reportedSeverities = 0;

    if (this.m_markersProvider) this.m_reportedSeverities = this.m_markersProvider.GetSeverities();
  }

  /** `WriteTextReport( aFullFileName )`: the file's text. */
  WriteTextReport(): string {
    // LOCALE_IO locale: numbers are written in the C locale here already
    let fp = '';

    const itemMap = this.m_board.FillItemMap();

    const unitsProvider = new UNITS_PROVIDER(pcbIUScale, this.m_reportUnits);
    const bds = this.m_board.GetDesignSettings();
    let count: number;

    fp += `** Drc report for ${fullName(this.m_board.GetFileName())} **\n`;

    fp += `** Created on ${GetISO8601CurrentDateTime()} **\n`;

    fp += `** Report includes: ${formatSeverities(this.m_reportedSeverities)} **\n`;

    count = this.m_markersProvider!.GetCount();

    fp += `\n** Found ${count} DRC violations **\n`;

    for (let i = 0; i < count; ++i) {
      const item = this.m_markersProvider!.GetItem(i)!;
      let severity: Severity = item.GetParent()!.GetSeverity();

      if (severity === RPT_SEVERITY_EXCLUSION) severity = bds.GetSeverity(item.GetErrorCode());

      fp += item.ShowReport(unitsProvider, severity, itemMap);
    }

    count = this.m_ratsnestProvider!.GetCount();

    fp += `\n** Found ${count} unconnected pads **\n`;

    for (let i = 0; i < count; ++i) {
      const item = this.m_ratsnestProvider!.GetItem(i)!;
      const severity = bds.GetSeverity(item.GetErrorCode());

      fp += item.ShowReport(unitsProvider, severity, itemMap);
    }

    count = this.m_fpWarningsProvider!.GetCount();

    fp += `\n** Found ${count} Footprint errors **\n`;

    for (let i = 0; i < count; ++i) {
      const item = this.m_fpWarningsProvider!.GetItem(i)!;
      const severity = bds.GetSeverity(item.GetErrorCode());

      fp += item.ShowReport(unitsProvider, severity, itemMap);
    }

    fp += '\n** Ignored checks **\n';

    let hasIgnored = false;

    for (const item of DRC_ITEM.GetItemsWithSeverities()) {
      const code = item.GetErrorCode();

      if (code > 0 && bds.Ignore(code)) {
        fp += `    - ${item.GetErrorMessage(false)}\n`;
        hasIgnored = true;
      }
    }

    if (!hasIgnored) fp += '    - None\n';

    fp += '\n** End of Report **\n';

    return fp;
  }

  /** `WriteJsonReport( aFullFileName )`: the file's text (`std::setw( 4 )` + a newline). */
  WriteJsonReport(): string {
    const unitsProvider = new UNITS_PROVIDER(pcbIUScale, this.m_reportUnits);
    const bds = this.m_board.GetDesignSettings();
    const itemMap = this.m_board.FillItemMap();

    const reportHead: RC_JSON_DRC_REPORT = {
      $schema: 'https://schemas.kicad.org/drc.v1.json',
      source: fullName(this.m_board.GetFileName()),
      date: GetISO8601CurrentDateTime(),
      kicad_version: GetMajorMinorPatchVersion(),
      type: 'drc',
      coordinate_units: unitLabel(this.m_reportUnits),
      violations: [],
      unconnected_items: [],
      schematic_parity: [],
      included_severities: [],
      ignored_checks: [],
    };

    // Document which severities are included in this report
    if (this.m_reportedSeverities & RPT_SEVERITY_ERROR)
      reportHead.included_severities.push('error');

    if (this.m_reportedSeverities & RPT_SEVERITY_WARNING)
      reportHead.included_severities.push('warning');

    if (this.m_reportedSeverities & RPT_SEVERITY_EXCLUSION)
      reportHead.included_severities.push('exclusion');

    const newViolation = (): VIOLATION => ({
      type: '',
      description: '',
      severity: '',
      items: [],
      excluded: false,
      comment: '',
    });

    for (let i = 0; i < this.m_markersProvider!.GetCount(); ++i) {
      const item = this.m_markersProvider!.GetItem(i)!;
      let severity: Severity = item.GetParent()!.GetSeverity();

      if (severity === RPT_SEVERITY_EXCLUSION) severity = bds.GetSeverity(item.GetErrorCode());

      const violation = newViolation();
      item.GetJsonViolation(violation, unitsProvider, severity, itemMap);

      reportHead.violations.push(violation);
    }

    for (let i = 0; i < this.m_ratsnestProvider!.GetCount(); ++i) {
      const item = this.m_ratsnestProvider!.GetItem(i)!;
      const severity = bds.GetSeverity(item.GetErrorCode());

      const violation = newViolation();
      item.GetJsonViolation(violation, unitsProvider, severity, itemMap);

      reportHead.unconnected_items.push(violation);
    }

    for (let i = 0; i < this.m_fpWarningsProvider!.GetCount(); ++i) {
      const item = this.m_fpWarningsProvider!.GetItem(i)!;
      const severity = bds.GetSeverity(item.GetErrorCode());

      const violation = newViolation();
      item.GetJsonViolation(violation, unitsProvider, severity, itemMap);

      reportHead.schematic_parity.push(violation);
    }

    for (const item of DRC_ITEM.GetItemsWithSeverities()) {
      const code = item.GetErrorCode();

      if (code > 0 && bds.Ignore(code)) {
        const ignoredCheck: IGNORED_CHECK = {
          key: item.GetSettingsKey(),
          description: item.GetErrorMessage(false),
        };
        reportHead.ignored_checks.push(ignoredCheck);
      }
    }

    // nlohmann::json( reportHead ): an object is a std::map, so every level
    // serialises in key order; `type` is not in DRC_REPORT's NLOHMANN list.
    const sortKeys = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(sortKeys);

      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const out: Record<string, unknown> = {};

        for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);

        return out;
      }

      return v;
    };

    const saveJson = sortKeys({
      $schema: reportHead.$schema,
      source: reportHead.source,
      date: reportHead.date,
      kicad_version: reportHead.kicad_version,
      violations: reportHead.violations.map(violationToJson),
      unconnected_items: reportHead.unconnected_items.map(violationToJson),
      schematic_parity: reportHead.schematic_parity.map(violationToJson),
      coordinate_units: reportHead.coordinate_units,
      included_severities: reportHead.included_severities,
      ignored_checks: reportHead.ignored_checks,
    });

    return `${JSON.stringify(saveJson, null, 4)}\n`;
  }
}
