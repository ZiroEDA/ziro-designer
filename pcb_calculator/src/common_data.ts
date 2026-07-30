// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Standard material preset lists for the transline substrate parameters.
 * Counterpart: KiCad `pcb_calculator/common_data.cpp` (the "..." picker
 * buttons next to εr, tan δ and ρ in the Transmission Lines panel).
 */

export interface MaterialPreset {
  value: number;
  name: string;
}

/** εr presets (StandardRelativeDielectricConstantList). */
export const RELATIVE_DIELECTRIC_CONSTANTS: readonly MaterialPreset[] = [
  { value: 4.5, name: 'FR4' },
  { value: 3.67, name: 'Isola FR408' },
  { value: 4.04, name: 'Isola 370HR' },
  { value: 3.55, name: 'Rogers RO4003C' },
  { value: 3.66, name: 'Rogers R4350B' },
  { value: 9.8, name: 'alumina (Al2O3)' },
  { value: 3.78, name: 'fused quartz' },
  { value: 3.38, name: 'RO4003' },
  { value: 2.2, name: 'RT/duroid 5880' },
  { value: 10.2, name: 'RT/duroid 6010LM' },
  { value: 2.1, name: 'teflon (PTFE)' },
  { value: 4.0, name: 'PVC' },
  { value: 2.3, name: 'PE' },
  { value: 6.6, name: 'beryllia (BeO)' },
  { value: 8.7, name: 'aluminum nitride' },
  { value: 11.9, name: 'silicon' },
  { value: 12.9, name: 'GaAs' },
];

/** tan δ presets (StandardLossTangentList). */
export const LOSS_TANGENTS: readonly MaterialPreset[] = [
  { value: 0.02, name: 'FR4 @ 1GHz' },
  { value: 0.012, name: 'Isola FR408 @ 2 GHz' },
  { value: 0.021, name: 'Isola 370HR @ 2 GHz' },
  { value: 0.0027, name: 'Rogers RO4003C @ 10 GHz' },
  { value: 0.0021, name: 'Rogers RO4003C @ 2.5 GHz' },
  { value: 0.0037, name: 'Rogers RO4350B @ 10 GHz' },
  { value: 0.0031, name: 'Rogers RO4350B @ 2.5 GHz' },
  { value: 3e-4, name: 'beryllia @ 10GHz' },
  { value: 2e-4, name: 'aluminia (Al2O3) @ 10GHz' },
  { value: 1e-4, name: 'fused quartz @ 10GHz' },
  { value: 0.002, name: 'RO4003 @ 10GHz' },
  { value: 9e-4, name: 'RT/duroid 5880 @ 10GHz' },
  { value: 2e-4, name: 'teflon (PTFE) @ 1MHz' },
  { value: 0.05, name: 'PVC @ 1MHz' },
  { value: 2e-4, name: 'PE @ 1MHz' },
  { value: 0.001, name: 'aluminum nitride @ 10GHz' },
  { value: 0.015, name: 'silicon @ 10GHz' },
  { value: 0.002, name: 'GaAs @ 10GHz' },
];

/** Conductor resistivity presets in Ω·m (StandardResistivityList). */
export const CONDUCTOR_RESISTIVITIES: readonly MaterialPreset[] = [
  { value: 2.4e-8, name: 'gold' },
  { value: 1.72e-8, name: 'copper' },
  { value: 1.62e-8, name: 'silver' },
  { value: 12.4e-8, name: 'tin' },
  { value: 10.5e-8, name: 'platinum' },
  { value: 2.62e-8, name: 'aluminum' },
  { value: 6.9e-8, name: 'nickel' },
  { value: 3.9e-8, name: 'brass (66Cu 34Zn)' },
  { value: 9.71e-8, name: 'iron' },
  { value: 6.0e-8, name: 'zinc' },
];
