// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Galvanic-corrosion memo: corrosion potentials of common metals/finishes
 * (referenced to copper = 0 V, per KiCad's table sourced from NASA-STD-6012,
 * MIL-STD-889D and the CRC Handbook). The potential difference between a pair
 * indicates galvanic-corrosion risk of the more anodic metal; a difference
 * above the chosen threshold (default 0.3 V; harsher environments 0.15 V) is
 * flagged.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_galvanic_corrosion.cpp`.
 */

export interface CorrosionMetal {
  name: string;
  /** Chemical symbol / designation. */
  symbol: string;
  /** Corrosion potential, volts (copper = 0). */
  potentialV: number;
}

export const CORROSION_METALS: readonly CorrosionMetal[] = [
  { name: 'Rhodium', symbol: 'Rh', potentialV: -0.6 },
  { name: 'Platinum', symbol: 'Pt', potentialV: -0.57 },
  { name: 'Palladium', symbol: 'Pd', potentialV: -0.5 },
  { name: 'Gold', symbol: 'Au', potentialV: -0.44 },
  { name: 'Stainless steel 316L', symbol: 'X2CrNiMo17-12-2', potentialV: -0.35 },
  { name: 'Inconel', symbol: 'Inconel', potentialV: -0.35 },
  { name: 'Indium', symbol: 'In', potentialV: -0.34 },
  { name: 'Titanium, passive', symbol: 'Ti', potentialV: -0.32 },
  { name: 'Stainless steel 18-9', symbol: 'X8CrNiS18-9', potentialV: -0.32 },
  { name: 'Silver', symbol: 'Ag', potentialV: -0.22 },
  { name: 'Mercury', symbol: 'Hg', potentialV: -0.22 },
  { name: 'ENEPIG (Ni/Pd/Au)', symbol: 'ENEPIG', potentialV: -0.18 },
  { name: 'ENIG (Ni/Au)', symbol: 'ENIG', potentialV: -0.15 },
  { name: 'Nickel', symbol: 'Ni', potentialV: -0.14 },
  { name: 'Carbon (Graphitic)', symbol: 'C', potentialV: -0.1 },
  { name: 'Copper', symbol: 'Cu', potentialV: 0.0 },
  { name: 'Copper-Aluminium', symbol: 'CuAl10', potentialV: 0.03 },
  { name: 'Brass', symbol: 'CuZn39Pb', potentialV: 0.08 },
  { name: 'Beryllium copper', symbol: 'CuBe2', potentialV: 0.15 },
  { name: 'Lead-free Solder', symbol: 'SAC305', potentialV: 0.15 },
  { name: 'Phosphor bronze', symbol: 'CuSnP', potentialV: 0.15 },
  { name: 'Bronze', symbol: 'CuSn12', potentialV: 0.2 },
  { name: 'Tin-Nickel (Sn/Ni)', symbol: 'SnNi', potentialV: 0.21 },
  { name: 'Solder 63/37 (Eutectic)', symbol: 'Sn63Pb37', potentialV: 0.21 },
  { name: 'Solder 60/40 (Leaded)', symbol: 'Sn60Pb40', potentialV: 0.22 },
  { name: 'Tin', symbol: 'Sn', potentialV: 0.23 },
  { name: 'Lead', symbol: 'Pb', potentialV: 0.27 },
  { name: '2xxx series Al alloy', symbol: 'AlCu4Mg', potentialV: 0.37 },
  { name: 'Cast iron', symbol: 'Fe-C-Si', potentialV: 0.38 },
  { name: 'Carbon steel', symbol: 'Fe-C', potentialV: 0.43 },
  { name: 'Aluminium, chromated', symbol: 'Al-Chromate', potentialV: 0.5 },
  { name: 'Aluminium, pure, passive', symbol: 'Al', potentialV: 0.52 },
  { name: 'Cadmium', symbol: 'Cd', potentialV: 0.53 },
  { name: 'Iron', symbol: 'Fe', potentialV: 0.535 },
  { name: 'Chrome, passive', symbol: 'Cr', potentialV: 0.63 },
  { name: 'Zinc', symbol: 'Zn', potentialV: 0.83 },
  { name: 'Steel, zinc-plated', symbol: 'Fe-Zn', potentialV: 0.83 },
  { name: 'Manganese', symbol: 'Mn', potentialV: 0.9 },
  { name: 'Magnesium', symbol: 'Mg', potentialV: 1.38 },
];

/** |ΔV| between two metals of the table. */
export function corrosionDeltaV(a: number, b: number): number {
  const ma = CORROSION_METALS[a];
  const mb = CORROSION_METALS[b];
  if (!ma || !mb) return NaN;
  return Math.abs(ma.potentialV - mb.potentialV);
}

/**
 * The SIGNED difference `rowPotential - columnPotential`, which is what the
 * Galvanic Corrosion table prints (`diff = entryA.m_potential -
 * entryB.m_potential`, then `Format( "%.0f", diff * 1000 )`,
 * panel_galvanic_corrosion.cpp:361-364). The sign is not cosmetic: it decides
 * whether the cell takes the blue ramp or the orange one, i.e. which of the two
 * metals is the one at risk. `corrosionDeltaV` above stays absolute, because the
 * threshold test compares magnitudes.
 */
export function corrosionSignedDeltaV(a: number, b: number): number {
  const ma = CORROSION_METALS[a];
  const mb = CORROSION_METALS[b];
  if (!ma || !mb) return Number.NaN;
  return ma.potentialV - mb.potentialV;
}

/**
 * `getContrastingTextColour`, panel_galvanic_corrosion.cpp:29-38. The comment
 * above it in the C++ names the standard outright — "ITU-R BT.709 luminance" —
 * and the cut is at 140, WHITE below it.
 *
 * This lived in the panel as BT.601's 0.299 / 0.587 / 0.114 against a threshold
 * of 128, which is a different standard AND a different cut, and nothing tested
 * it. The two disagree over the dark end of both ramps: rgb(156,123,100), the
 * cell for a 1.0 V pair, is 130.1 by BT.601 and so took black ink, and 128.4 by
 * BT.709, which upstream paints white.
 */
export function corrosionInk(r: number, g: number, b: number): '#000000' | '#ffffff' {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140 ? '#ffffff' : '#000000';
}

/** [data] `color_ok`, panel_galvanic_corrosion.cpp:320. */
export const CORROSION_COLOR_OK: readonly [number, number, number] = [122, 166, 194];
/** [data] the equal-potential cell, panel_galvanic_corrosion.cpp:370. */
export const CORROSION_COLOR_SAME: readonly [number, number, number] = [193, 231, 255];

/**
 * The fill for one cell, `fillTable` (panel_galvanic_corrosion.cpp:366-388).
 *
 * A pair of equal potential takes a fixed light blue; a pair whose difference in
 * mV is at or below the threshold takes the flat `color_ok`; everything else
 * fades along a cold or a warm ramp by `226 - KiROUND( |diff| * 99 )`. The
 * threshold comparison is on `KiROUND( |diff| * 1000 )`, i.e. on whole
 * millivolts, and it is strictly greater-than.
 */
export function corrosionCellColour(
  diffV: number,
  thresholdMv: number,
): readonly [number, number, number] {
  if (Math.abs(diffV) === 0) return CORROSION_COLOR_SAME;
  if (Math.round(Math.abs(diffV * 1000)) > thresholdMv) {
    const t = Math.round(Math.abs(diffV * 99));
    return diffV > 0 ? [226 - t, 226 - t, 246 - t] : [255 - t, 222 - t, 199 - t];
  }
  return CORROSION_COLOR_OK;
}
