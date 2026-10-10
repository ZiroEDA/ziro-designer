// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/jobs/job_export_pcb_ipc2581.{h,cpp}`: `JOB_EXPORT_PCB_IPC2581`, the IPC-2581 export's
 * settings, shared by DIALOG_EXPORT_2581 and the jobset runner.
 *
 * The fields and their defaults; the JOB base (its JSON parameters, output-path templating and
 * the job registry) is not ported, as for JOB_EXPORT_PCB_POS.
 */

export enum IPC2581_UNITS {
  INCH,
  MM,
}

export enum IPC2581_VERSION {
  B,
  C,
}

export class JOB_EXPORT_PCB_IPC2581 {
  static readonly IPC2581_UNITS = IPC2581_UNITS;
  static readonly IPC2581_VERSION = IPC2581_VERSION;

  m_filename = '';
  m_drawingSheet = '';
  m_variant = '';
  m_units: IPC2581_UNITS = IPC2581_UNITS.MM;
  m_version: IPC2581_VERSION = IPC2581_VERSION.C;
  m_precision = 6;
  m_compress = false;
  m_colInternalId = '';
  m_colMfgPn = '';
  m_colMfg = '';
  m_colDistPn = '';
  m_colDist = '';
  m_bomRev = '';

  GetDefaultDescription(): string {
    return 'Export IPC-2581';
  }

  GetSettingsDialogTitle(): string {
    return 'Export IPC-2581 Job Settings';
  }
}
