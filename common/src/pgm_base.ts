// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pgm_base.h`: the process-wide `PGM_BASE`, reached through `Pgm()` /
 * `PgmOrNull()`. Only the part the ported common code reads is here — the
 * common settings — and the application installs the object at start-up
 * (`SetPgm`), as `PGM_BASE::InitPgm` would; before that `PgmOrNull()` is
 * null, which the readers already handle.
 */

/** `COMMON_SETTINGS`, the slice the GAL reads. */
export interface COMMON_SETTINGS_LIKE {
  m_Appearance: {
    zoom_correction_factor: number;
  };
}

export class PGM_BASE {
  private m_settings: COMMON_SETTINGS_LIKE | null;

  constructor(aCommonSettings: COMMON_SETTINGS_LIKE | null = null) {
    this.m_settings = aCommonSettings;
  }

  GetCommonSettings(): COMMON_SETTINGS_LIKE | null {
    return this.m_settings;
  }

  SetCommonSettings(aCommonSettings: COMMON_SETTINGS_LIKE | null): void {
    this.m_settings = aCommonSettings;
  }
}

let g_pgm: PGM_BASE | null = null;

/** `PgmOrNull()`: the program object, or null before it is set up. */
export function PgmOrNull(): PGM_BASE | null {
  return g_pgm;
}

/** `Pgm()`: the program object; throws before it is set up, as the reference would. */
export function Pgm(): PGM_BASE {
  if (!g_pgm) throw new Error('Pgm() called before the PGM_BASE was set');
  return g_pgm;
}

/** `SetPgm( PGM_BASE* )`: the application installs its program object. */
export function SetPgm(aPgm: PGM_BASE | null): void {
  g_pgm = aPgm;
}
