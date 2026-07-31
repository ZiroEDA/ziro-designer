// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Coordinate units. Counterpart: KiCad `include/base_units.h` (EDA_IU_SCALE and
 * the per-application scales built from it).
 *
 * Internal units (IU) are integers, and each application has its own scale:
 * eeschema counts 100 nm steps, pcbnew counts nanometres. Files store
 * millimetres as decimals (`161.29`); KiCad converts on load with
 * `KiROUND(mm * IU_PER_MM)` and works in integer IU thereafter (`VECTOR2I`).
 *
 * ZiroEDA mirrors this exactly. We deliberately do NOT keep coordinates as
 * floating point millimetres: integer IU is what makes grid snapping,
 * hit-testing and point equality exact and drift-free. Floats here would be the
 * shortcut that breaks connectivity later.
 *
 * Using the *schematic* scale on the board would quantise every board
 * coordinate to 100 nm, so a pcbnew file's `166.963652` would come back as
 * `166.9637`. Board code must take {@link pcbIUScale}.
 */

/** Gerbview IU is 10 nanometres. */
export const GERB_IU_PER_MM = 1e5;
/** Pcbnew IU is 1 nanometre. */
export const PCB_IU_PER_MM = 1e6;
/** Drawing-sheet internal units are microns. */
export const PL_IU_PER_MM = 1e3;
/** Schematic internal units, 1 = 100 nm. */
export const SCH_IU_PER_MM = 1e4;

/** EDA_IU_SCALE: one application's internal-unit scale and its conversions. */
export class EdaIuScale {
  readonly IU_PER_MM: number;
  readonly IU_PER_MILS: number;
  readonly MM_PER_IU: number;

  constructor(iuPerMM: number) {
    this.IU_PER_MM = iuPerMM;
    this.IU_PER_MILS = iuPerMM * 0.0254;
    this.MM_PER_IU = 1 / iuPerMM;
  }

  /** EDA_IU_SCALE::mmToIU, KiROUND's round-half-away-from-zero. */
  mmToIU(mm: number): number {
    return mm < 0 ? Math.ceil(mm * this.IU_PER_MM - 0.5) : Math.floor(mm * this.IU_PER_MM + 0.5);
  }

  /** EDA_IU_SCALE::IUTomm. */
  iuToMM(iu: number): number {
    return iu / this.IU_PER_MM;
  }

  /** EDA_IU_SCALE::MilsToIU. */
  milsToIU(mils: number): number {
    const x = mils * this.IU_PER_MILS;
    return x < 0 ? Math.ceil(x - 0.5) : Math.floor(x + 0.5);
  }

  /** EDA_IU_SCALE::IUToMils. */
  iuToMils(iu: number): number {
    const mils = iu / this.IU_PER_MILS;
    return mils < 0 ? Math.ceil(mils - 0.5) : Math.floor(mils + 0.5);
  }
}

export const gerbIUScale = new EdaIuScale(GERB_IU_PER_MM);
export const pcbIUScale = new EdaIuScale(PCB_IU_PER_MM);
export const drawSheetIUScale = new EdaIuScale(PL_IU_PER_MM);
export const schIUScale = new EdaIuScale(SCH_IU_PER_MM);

/**
 * Schematic millimetres to IU. Board code wants {@link pcbIUScale} instead;
 * these two keep the schematic's scale so eeschema reads unchanged.
 */
export function mmToIU(mm: number): number {
  return schIUScale.mmToIU(mm);
}

/** Schematic IU back to millimetres. */
export function iuToMM(iu: number): number {
  return schIUScale.iuToMM(iu);
}

/** Board millimetres to IU (1 nm), the pcbnew scale. */
export function pcbMmToIU(mm: number): number {
  return pcbIUScale.mmToIU(mm);
}

/** Board IU back to millimetres. */
export function pcbIuToMM(iu: number): number {
  return pcbIUScale.iuToMM(iu);
}
