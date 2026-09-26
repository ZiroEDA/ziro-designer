// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `bitmap2component/bitmap2cmp_settings.h` + `.cpp`: `BITMAP2CMP_SETTINGS`,
 * the Image Converter's app settings (`bitmap2component.json`).
 *
 * As `gerbview/gerbview_settings.ts` is, this is the in-memory object the
 * frame and panel read. The JSON side is the app's `bitmap2component` slice
 * (`designer/src/prefs/settings.ts`), keyed by the PARAM paths below; the
 * frame builds one of these from it (`FromJson`) and writes it back
 * (`ToJson`), as the PARAMs load and store it.
 *
 * `MigrateFromLegacy` reads a KiCad 5 wxConfig, which a browser has never had:
 * n/a. The schema migration 0 → 1 is ported (`migrateLastModLayer`) for the
 * same file KiCad would migrate, a version-0 `bitmap2component.json`.
 */
import { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';

/** "Update the schema version whenever a migration is required" [data] */
export const bitmap2cmpSchemaVersion = 1;

/** The JSON shape the seven PARAMs read and write. */
export interface BITMAP2CMP_SETTINGS_JSON {
  bitmap_file_name: string;
  converted_file_name: string;
  units: number;
  threshold: number;
  negative: boolean;
  last_format: number;
  last_mod_layer: number;
}

export class BITMAP2CMP_SETTINGS extends APP_SETTINGS_BASE {
  /** `bitmap_file_name`, "". */
  m_BitmapFileName = '';
  /** `converted_file_name`, "". */
  m_ConvertedFileName = '';
  /** `units`, 0. */
  m_Units = 0;
  /** `threshold`, 50. */
  m_Threshold = 50;
  /** `negative`, false. */
  m_Negative = false;
  /** `last_format`, 0 (`SYMBOL_FMT`). */
  m_LastFormat = 0;
  /** `last_mod_layer`, 0. */
  m_LastLayer = 0;

  constructor() {
    super('bitmap2component', bitmap2cmpSchemaVersion);
  }

  /** `getLegacyFrameName()`: the KiCad 5 wxConfig prefix. [data] */
  getLegacyFrameName(): string {
    return 'Bmconverter_';
  }

  /** The PARAMs' load: each member from its JSON path, its default when absent. */
  FromJson(aJson: Partial<BITMAP2CMP_SETTINGS_JSON>): this {
    const d = new BITMAP2CMP_SETTINGS();

    this.m_BitmapFileName = aJson.bitmap_file_name ?? d.m_BitmapFileName;
    this.m_ConvertedFileName = aJson.converted_file_name ?? d.m_ConvertedFileName;
    this.m_Units = aJson.units ?? d.m_Units;
    this.m_Threshold = aJson.threshold ?? d.m_Threshold;
    this.m_Negative = aJson.negative ?? d.m_Negative;
    this.m_LastFormat = aJson.last_format ?? d.m_LastFormat;
    this.m_LastLayer = aJson.last_mod_layer ?? d.m_LastLayer;
    return this;
  }

  /** The PARAMs' store. */
  ToJson(): BITMAP2CMP_SETTINGS_JSON {
    return {
      bitmap_file_name: this.m_BitmapFileName,
      converted_file_name: this.m_ConvertedFileName,
      units: this.m_Units,
      threshold: this.m_Threshold,
      negative: this.m_Negative,
      last_format: this.m_LastFormat,
      last_mod_layer: this.m_LastLayer,
    };
  }
}

/**
 * `registerMigration( 0, 1, ... )`: "Version 1 introduced a new layer (F.Cu),
 * and changed the ordering to be consistent with PCBNew." The old
 * `last_mod_layer` in, the new one out; an unknown value is `default: case 0`.
 */
export function migrateLastModLayer(aOld: number): number {
  switch (aOld) {
    case 1:
      return 2;
    case 2:
      return 7;
    case 3:
      return 3;
    case 4:
      return 4;
    case 5:
      return 5;
    case 6:
      return 6;
    default:
      return 1;
  }
}
