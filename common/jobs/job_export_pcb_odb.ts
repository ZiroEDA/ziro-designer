// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/jobs/job_export_pcb_odb.{h,cpp}`: `JOB_EXPORT_PCB_ODB`, the ODB++ export's settings.
 *
 * The fields and their defaults; the JOB base (JSON parameters, output-path templating, the job
 * registry) is not ported, as for JOB_EXPORT_PCB_POS.
 */

export enum ODB_UNITS {
  MM,
  INCH, // Do not use IN: it conflicts with a Windows header
}

export enum ODB_COMPRESSION {
  NONE,
  ZIP,
  TGZ,
}

export class JOB_EXPORT_PCB_ODB {
  static readonly ODB_UNITS = ODB_UNITS;
  static readonly ODB_COMPRESSION = ODB_COMPRESSION;

  m_filename = '';
  m_drawingSheet = '';
  m_variant = '';
  m_units: ODB_UNITS = ODB_UNITS.MM;
  m_precision = 4;
  m_compressionMode: ODB_COMPRESSION = ODB_COMPRESSION.ZIP;
  m_checkZonesBeforeExport = false;
  /** `SetConfiguredOutputPath` / `GetFullOutputPath`: project-relative here. */
  m_outputPath = '';

  GetDefaultDescription(): string {
    return 'Export ODB++';
  }

  GetSettingsDialogTitle(): string {
    return 'Export ODB++ Job Settings';
  }
}
