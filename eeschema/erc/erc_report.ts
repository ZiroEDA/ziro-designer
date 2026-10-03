// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/erc/erc_report.cpp` / `.h`: `ERC_REPORT`, the text and JSON ERC reports. The
 * `Write*Report` calls return the file's text; the caller writes it where it goes.
 */
import { GetMajorMinorPatchVersion } from '@ziroeda/common/build_version.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { type EdaUnits, pcbIUScale, schIUScale, unitLabel } from '@ziroeda/common/eda_units.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import type { RC_ITEMS_PROVIDER } from '@ziroeda/common/rc_item.js';
import {
  type ERC_REPORT as RC_JSON_ERC_REPORT,
  type ERC_SHEET,
  type IGNORED_CHECK,
  type VIOLATION,
  violationToJson,
} from '@ziroeda/common/rc_json_schema.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { GetISO8601CurrentDateTime } from '@ziroeda/common/string_utils.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { formatSeverities } from '@ziroeda/common/widgets/report_severity.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { SCHEMATIC } from '../schematic.js';
import { ERC_ITEM } from './erc_item.js';
import { SHEETLIST_ERC_ITEMS_PROVIDER } from './erc_settings.js';

const fullName = (aPath: string) => aPath.replace(/\\/g, '/').replace(/^.*\//, '');

/** nlohmann::json( reportHead ): an object is a std::map, so every level is in key order. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);

  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);

    return out;
  }

  return v;
}

export class ERC_REPORT {
  private m_sch: SCHEMATIC;
  private m_reportUnits: EdaUnits;
  private m_markersProvider: RC_ITEMS_PROVIDER;
  private m_reportedSeverities: number;

  constructor(
    aSchematic: SCHEMATIC,
    aReportUnits: EdaUnits,
    aMarkersProvider: RC_ITEMS_PROVIDER | null = null,
  ) {
    this.m_sch = aSchematic;
    this.m_reportUnits = aReportUnits;

    if (!aMarkersProvider) {
      // When no provider is supplied, fall back to creating one with default severities.
      // This allows test code to get a basic report without needing to set up a provider.
      aMarkersProvider = new SHEETLIST_ERC_ITEMS_PROVIDER(this.m_sch);
      aMarkersProvider.SetSeverities(RPT_SEVERITY_ERROR | RPT_SEVERITY_WARNING);
    }

    this.m_markersProvider = aMarkersProvider;
    this.m_reportedSeverities = this.m_markersProvider.GetSeverities();
  }

  /** The provider's items grouped by their main item's sheet (the first sheet when none). */
  private orderedItems(aFirstSheet: SCH_SHEET_PATH): Map<string, ERC_ITEM[]> {
    const orderedItems = new Map<string, ERC_ITEM[]>();

    for (let i = 0; i < this.m_markersProvider.GetCount(); ++i) {
      const item = this.m_markersProvider.GetItem(i);

      if (item instanceof ERC_ITEM) {
        const key = (
          item.MainItemHasSheetPath() ? item.GetMainItemSheetPath() : aFirstSheet
        ).PathAsString();
        orderedItems.set(key, [...(orderedItems.get(key) ?? []), item]);
      }
    }

    return orderedItems;
  }

  GetTextReport(): string {
    const unitsProvider = new UNITS_PROVIDER(schIUScale, this.m_reportUnits);

    let msg = `ERC report (${GetISO8601CurrentDateTime()}, Encoding UTF8)\n`;

    msg += `Report includes: ${formatSeverities(this.m_reportedSeverities)}\n`;

    const itemMap = new Map<KIID, SCH_ITEM>();
    let err_count = 0;
    let warn_count = 0;
    let total_count = 0;
    const sheetList = this.m_sch.BuildSheetListSortedByPageNumbers();

    sheetList.FillItemMap(itemMap);

    const settings = this.m_sch.ErcSettings();
    const orderedItems = this.orderedItems(sheetList[0]!);

    for (const sheet of sheetList) {
      msg += `\n***** Sheet ${sheet.PathHumanReadable()}\n`;

      for (const item of orderedItems.get(sheet.PathAsString()) ?? []) {
        const severity = settings.GetSeverity(item.GetErrorCode());
        total_count++;

        switch (severity) {
          case RPT_SEVERITY_ERROR:
            err_count++;
            break;
          case RPT_SEVERITY_WARNING:
            warn_count++;
            break;
          default:
            break;
        }

        msg += item.ShowReport(unitsProvider, severity, itemMap as ReadonlyMap<KIID, EDA_ITEM>);
      }
    }

    msg += `\n ** ERC messages: ${total_count}  Errors ${err_count}  Warnings ${warn_count}\n`;

    msg += '\n ** Ignored checks:\n';

    let hasIgnored = false;

    for (const item of ERC_ITEM.GetItemsWithSeverities()) {
      const code = item.GetErrorCode();

      if (code > 0 && settings.GetSeverity(code) === RPT_SEVERITY_IGNORE) {
        msg += `    - ${item.GetErrorMessage(false)}\n`;
        hasIgnored = true;
      }
    }

    if (!hasIgnored) msg += '    - None\n';

    return msg;
  }

  /** `WriteTextReport( aFullFileName )`: the file's text. */
  WriteTextReport(): string {
    return this.GetTextReport();
  }

  /** `WriteJsonReport( aFullFileName )`: the file's text (`std::setw( 4 )` + a newline). */
  WriteJsonReport(): string {
    // pcbIUScale, as upstream writes it: schematic positions come out a hundredth of their size.
    const unitsProvider = new UNITS_PROVIDER(pcbIUScale, this.m_reportUnits);
    const itemMap = new Map<KIID, SCH_ITEM>();

    const reportHead: RC_JSON_ERC_REPORT = {
      $schema: 'https://schemas.kicad.org/erc.v1.json',
      source: fullName(this.m_sch.GetFileName()),
      date: GetISO8601CurrentDateTime(),
      kicad_version: GetMajorMinorPatchVersion(),
      type: 'erc',
      coordinate_units: unitLabel(this.m_reportUnits),
      sheets: [],
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

    const sheetList = this.m_sch.Hierarchy();

    sheetList.FillItemMap(itemMap);

    const settings = this.m_sch.ErcSettings();
    const orderedItems = this.orderedItems(sheetList[0]!);

    for (const sheet of sheetList) {
      const jsonSheet: ERC_SHEET = {
        path: sheet.PathHumanReadable(),
        uuid_path: sheet.Path().AsString(),
        violations: [],
      };

      for (const item of orderedItems.get(sheet.PathAsString()) ?? []) {
        const severity = settings.GetSeverity(item.GetErrorCode());
        const violation: VIOLATION = {
          type: '',
          description: '',
          severity: '',
          items: [],
          excluded: false,
          comment: '',
        };
        item.GetJsonViolation(
          violation,
          unitsProvider,
          severity,
          itemMap as ReadonlyMap<KIID, EDA_ITEM>,
        );
        jsonSheet.violations.push(violation);
      }

      reportHead.sheets.push(jsonSheet);
    }

    for (const item of ERC_ITEM.GetItemsWithSeverities()) {
      const code = item.GetErrorCode();

      if (code > 0 && settings.GetSeverity(code) === RPT_SEVERITY_IGNORE) {
        const ignoredCheck: IGNORED_CHECK = {
          key: item.GetSettingsKey(),
          description: item.GetErrorMessage(false),
        };
        reportHead.ignored_checks.push(ignoredCheck);
      }
    }

    // `type` is not in ERC_REPORT's NLOHMANN list, so it is not written.
    const saveJson = sortKeys({
      $schema: reportHead.$schema,
      source: reportHead.source,
      date: reportHead.date,
      kicad_version: reportHead.kicad_version,
      coordinate_units: reportHead.coordinate_units,
      included_severities: reportHead.included_severities,
      ignored_checks: reportHead.ignored_checks,
      sheets: reportHead.sheets.map((s) => ({
        path: s.path,
        uuid_path: s.uuid_path,
        violations: s.violations.map(violationToJson),
      })),
    });

    return `${JSON.stringify(saveJson, null, 4)}\n`;
  }
}
