// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerbview_settings.h` + `.cpp`: `GERBVIEW_SETTINGS`, the Gerber
 * Viewer's app settings (`gerbview.json`), every member at its PARAM default.
 *
 * As `pcbnew/pcbnew_settings.ts` is, this is the in-memory object the engine
 * reads (`gvconfig()`, gerbview_painter.ts). The JSON side is the app's
 * `GerbviewSettings` slice (`designer/src/prefs/settings.ts`), and the app
 * builds one of these from it and registers it with the settings manager, as
 * the PARAMs would load it. `MigrateFromLegacy` (wxConfig) is n/a;
 * `GetFileHistories` waits on the file histories.
 */
import { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { EXCELLON_DEFAULTS } from './excellon_defaults.js';
import { GBR_DISPLAY_OPTIONS } from './gbr_display_options.js';

/** "Update the schema version whenever a migration is required." [data] */
const gerbviewSchemaVersion = 0;

/** `GERBVIEW_SETTINGS::APPEARANCE`. */
export class GERBVIEW_APPEARANCE {
  /** `appearance.show_border_and_titleblock`, false. */
  show_border_and_titleblock = false;
  /** `appearance.show_dcodes`, false. */
  show_dcodes = false;
  /** `appearance.show_negative_objects`, false. */
  show_negative_objects = false;
  /** `appearance.page_type`, "GERBER". */
  page_type = 'GERBER';
}

export class GERBVIEW_SETTINGS extends APP_SETTINGS_BASE {
  m_Appearance = new GERBVIEW_APPEARANCE();
  /**
   * `appearance.show_page_limit` is `m_DisplayPageLimits` (false) and
   * `appearance.mode_opacity_value` is `m_OpacityModeAlphaValue` (0.6); the
   * other members are not PARAMs and keep the constructor's values.
   */
  m_Display = new GBR_DISPLAY_OPTIONS();
  /** `gerber_to_pcb_copperlayers_count`, 2. */
  m_BoardLayersCount = 2;
  /** `system.drill_file_history`. */
  m_DrillFileHistory: string[] = [];
  /** `system.zip_file_history`. */
  m_ZipFileHistory: string[] = [];
  /** `system.job_file_history`. */
  m_JobFileHistory: string[] = [];
  /**
   * `gerber_to_pcb_layers`: a GERBER_DRAWLAYERS_COUNT long mapping of gerber
   * layers to PCB layers, used when exporting gerbers to a PCB.
   */
  m_GerberToPcbLayerMapping: number[] = [];
  /** `excellon_defaults.*`. */
  m_ExcellonDefaults = new EXCELLON_DEFAULTS();

  constructor() {
    super('gerbview', gerbviewSchemaVersion);
  }

  /** The Excellon default values to read a drill file. */
  GetExcellonDefaults(aNCDefaults: EXCELLON_DEFAULTS): void {
    aNCDefaults.m_UnitsMM = this.m_ExcellonDefaults.m_UnitsMM;
    aNCDefaults.m_LeadingZero = this.m_ExcellonDefaults.m_LeadingZero;
    aNCDefaults.m_MmIntegerLen = this.m_ExcellonDefaults.m_MmIntegerLen;
    aNCDefaults.m_MmMantissaLen = this.m_ExcellonDefaults.m_MmMantissaLen;
    aNCDefaults.m_InchIntegerLen = this.m_ExcellonDefaults.m_InchIntegerLen;
    aNCDefaults.m_InchMantissaLen = this.m_ExcellonDefaults.m_InchMantissaLen;
  }
}
