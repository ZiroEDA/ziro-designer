// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * JOB_EXPORT_PCB_POS (`common/jobs/job_export_pcb_pos.h/.cpp`): the part the
 * Component Placement dialog reads — the format and filter enums and
 * `FormatSupportsFilter`. The job itself (its JSON parameters and the
 * output-path handling) belongs to the jobset runner, which is not ported.
 */

export class JOB_EXPORT_PCB_POS {
  static readonly FORMAT = {
    ASCII: 0,
    CSV: 1,
    GERBER: 2,
  } as const;

  static readonly FILTER = {
    SMD_ONLY: 0,
    EXCLUDE_TH: 1,
    EXCLUDE_DNP: 2,
    EXCLUDE_BOM: 3,
  } as const;

  /**
   * Whether a footprint filter applies to an output format.
   *
   * Gerber X3 records each footprint's mount type, so the pad technology
   * filters are left to the consumer of the file.
   */
  static FormatSupportsFilter(
    aFormat: JOB_EXPORT_PCB_POS_FORMAT,
    aFilter: JOB_EXPORT_PCB_POS_FILTER,
  ): boolean {
    if (aFormat !== JOB_EXPORT_PCB_POS.FORMAT.GERBER) return true;

    // Gerber X3 records each footprint's mount type, so the pad technology filters are left to
    // the consumer of the file
    switch (aFilter) {
      case JOB_EXPORT_PCB_POS.FILTER.SMD_ONLY:
      case JOB_EXPORT_PCB_POS.FILTER.EXCLUDE_TH:
        return false;
      case JOB_EXPORT_PCB_POS.FILTER.EXCLUDE_DNP:
      case JOB_EXPORT_PCB_POS.FILTER.EXCLUDE_BOM:
        return true;
    }

    return true;
  }
}

export type JOB_EXPORT_PCB_POS_FORMAT =
  (typeof JOB_EXPORT_PCB_POS.FORMAT)[keyof typeof JOB_EXPORT_PCB_POS.FORMAT];
export type JOB_EXPORT_PCB_POS_FILTER =
  (typeof JOB_EXPORT_PCB_POS.FILTER)[keyof typeof JOB_EXPORT_PCB_POS.FILTER];
