// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Simulation model identification. Counterpart: `eeschema/sim/sim_model.cpp`
 * (`SIM_MODEL::DeviceInfo` / `TypeInfo` / `ReadTypeFromFields` /
 * `InferSimModel`) and `sim/sim_lib_mgr.cpp` (`SIM_LIB_MGR::CreateModel`),
 * restricted to what ERC's TestSimModelIssues needs: deciding whether a
 * symbol's `Sim.*` fields name a model KiCad can build, and producing the same
 * diagnostics when they do not.
 */

/** SIM_MODEL::DEVICE_T -> DeviceInfo().fieldValue. */
export const SIM_DEVICE_FIELD_VALUES: Readonly<Record<string, string>> = {
  NONE: '',
  R: 'R',
  C: 'C',
  L: 'L',
  K: 'K',
  TLINE: 'TLINE',
  SW: 'SW',
  D: 'D',
  NPN: 'NPN',
  PNP: 'PNP',
  NJFET: 'NJFET',
  PJFET: 'PJFET',
  NMOS: 'NMOS',
  PMOS: 'PMOS',
  NMES: 'NMES',
  PMES: 'PMES',
  V: 'V',
  I: 'I',
  E: 'E',
  F: 'F',
  G: 'G',
  H: 'H',
  KIBIS: 'IBIS',
  SUBCKT: 'SUBCKT',
  XSPICE: 'XSPICE',
  SPICE: 'SPICE',
};

/**
 * SIM_MODEL::TypeInfo, every TYPE as the pair ReadTypeFromFields matches on:
 * the owning device and the `Sim.Type` field value.
 */
export const SIM_TYPES: readonly (readonly [string, string])[] = [
  ['NONE', ''], // TYPE::NONE
  ['R', ''], // TYPE::R
  ['R', 'POT'], // TYPE::R_POT
  ['R', '='], // TYPE::R_BEHAVIORAL
  ['C', ''], // TYPE::C
  ['C', '='], // TYPE::C_BEHAVIORAL
  ['L', ''], // TYPE::L
  ['L', '='], // TYPE::L_BEHAVIORAL
  ['K', ''], // TYPE::K
  ['TLINE', ''], // TYPE::TLINE_Z0
  ['TLINE', 'RLGC'], // TYPE::TLINE_RLGC
  ['SW', 'V'], // TYPE::SW_V
  ['SW', 'I'], // TYPE::SW_I
  ['D', ''], // TYPE::D
  ['NPN', 'VBIC'], // TYPE::NPN_VBIC
  ['PNP', 'VBIC'], // TYPE::PNP_VBIC
  ['NPN', 'GUMMELPOON'], // TYPE::NPN_GUMMELPOON
  ['PNP', 'GUMMELPOON'], // TYPE::PNP_GUMMELPOON
  ['NPN', 'HICUML2'], // TYPE::NPN_HICUM2
  ['PNP', 'HICUML2'], // TYPE::PNP_HICUM2
  ['NJFET', 'SHICHMANHODGES'], // TYPE::NJFET_SHICHMANHODGES
  ['PJFET', 'SHICHMANHODGES'], // TYPE::PJFET_SHICHMANHODGES
  ['NJFET', 'PARKERSKELLERN'], // TYPE::NJFET_PARKERSKELLERN
  ['PJFET', 'PARKERSKELLERN'], // TYPE::PJFET_PARKERSKELLERN
  ['NMES', 'STATZ'], // TYPE::NMES_STATZ
  ['PMES', 'STATZ'], // TYPE::PMES_STATZ
  ['NMES', 'YTTERDAL'], // TYPE::NMES_YTTERDAL
  ['PMES', 'YTTERDAL'], // TYPE::PMES_YTTERDAL
  ['NMES', 'HFET1'], // TYPE::NMES_HFET1
  ['PMES', 'HFET1'], // TYPE::PMES_HFET1
  ['NMES', 'HFET2'], // TYPE::NMES_HFET2
  ['PMES', 'HFET2'], // TYPE::PMES_HFET2
  ['NMOS', 'VDMOS'], // TYPE::NMOS_VDMOS
  ['PMOS', 'VDMOS'], // TYPE::PMOS_VDMOS
  ['NMOS', 'MOS1'], // TYPE::NMOS_MOS1
  ['PMOS', 'MOS1'], // TYPE::PMOS_MOS1
  ['NMOS', 'MOS2'], // TYPE::NMOS_MOS2
  ['PMOS', 'MOS2'], // TYPE::PMOS_MOS2
  ['NMOS', 'MOS3'], // TYPE::NMOS_MOS3
  ['PMOS', 'MOS3'], // TYPE::PMOS_MOS3
  ['NMOS', 'BSIM1'], // TYPE::NMOS_BSIM1
  ['PMOS', 'BSIM1'], // TYPE::PMOS_BSIM1
  ['NMOS', 'BSIM2'], // TYPE::NMOS_BSIM2
  ['PMOS', 'BSIM2'], // TYPE::PMOS_BSIM2
  ['NMOS', 'MOS6'], // TYPE::NMOS_MOS6
  ['PMOS', 'MOS6'], // TYPE::PMOS_MOS6
  ['NMOS', 'BSIM3'], // TYPE::NMOS_BSIM3
  ['PMOS', 'BSIM3'], // TYPE::PMOS_BSIM3
  ['NMOS', 'MOS9'], // TYPE::NMOS_MOS9
  ['PMOS', 'MOS9'], // TYPE::PMOS_MOS9
  ['NMOS', 'B4SOI'], // TYPE::NMOS_B4SOI
  ['PMOS', 'B4SOI'], // TYPE::PMOS_B4SOI
  ['NMOS', 'BSIM4'], // TYPE::NMOS_BSIM4
  ['PMOS', 'BSIM4'], // TYPE::PMOS_BSIM4
  ['NMOS', 'B3SOIFD'], // TYPE::NMOS_B3SOIFD
  ['PMOS', 'B3SOIFD'], // TYPE::PMOS_B3SOIFD
  ['NMOS', 'B3SOIDD'], // TYPE::NMOS_B3SOIDD
  ['PMOS', 'B3SOIDD'], // TYPE::PMOS_B3SOIDD
  ['NMOS', 'B3SOIPD'], // TYPE::NMOS_B3SOIPD
  ['PMOS', 'B3SOIPD'], // TYPE::PMOS_B3SOIPD
  ['NMOS', 'HISIM2'], // TYPE::NMOS_HISIM2
  ['PMOS', 'HISIM2'], // TYPE::PMOS_HISIM2
  ['NMOS', 'HISIMHV1'], // TYPE::NMOS_HISIMHV1
  ['PMOS', 'HISIMHV1'], // TYPE::PMOS_HISIMHV1
  ['NMOS', 'HISIMHV2'], // TYPE::NMOS_HISIMHV2
  ['PMOS', 'HISIMHV2'], // TYPE::PMOS_HISIMHV2
  ['V', 'DC'], // TYPE::V
  ['V', 'SIN'], // TYPE::V_SIN
  ['V', 'PULSE'], // TYPE::V_PULSE
  ['V', 'EXP'], // TYPE::V_EXP
  ['V', 'AM'], // TYPE::V_AM
  ['V', 'SFFM'], // TYPE::V_SFFM
  ['E', ''], // TYPE::V_VCL
  ['H', ''], // TYPE::V_CCL
  ['V', 'PWL'], // TYPE::V_PWL
  ['V', 'WHITENOISE'], // TYPE::V_WHITENOISE
  ['V', 'PINKNOISE'], // TYPE::V_PINKNOISE
  ['V', 'BURSTNOISE'], // TYPE::V_BURSTNOISE
  ['V', 'RANDUNIFORM'], // TYPE::V_RANDUNIFORM
  ['V', 'RANDGAUSSIAN'], // TYPE::V_RANDGAUSSIAN
  ['V', 'RANDEXP'], // TYPE::V_RANDEXP
  ['V', 'RANDPOISSON'], // TYPE::V_RANDPOISSON
  ['V', '='], // TYPE::V_BEHAVIORAL
  ['I', 'DC'], // TYPE::I
  ['I', 'SIN'], // TYPE::I_SIN
  ['I', 'PULSE'], // TYPE::I_PULSE
  ['I', 'EXP'], // TYPE::I_EXP
  ['I', 'AM'], // TYPE::I_AM
  ['I', 'SFFM'], // TYPE::I_SFFM
  ['G', ''], // TYPE::I_VCL
  ['F', ''], // TYPE::I_CCL
  ['I', 'PWL'], // TYPE::I_PWL
  ['I', 'WHITENOISE'], // TYPE::I_WHITENOISE
  ['I', 'PINKNOISE'], // TYPE::I_PINKNOISE
  ['I', 'BURSTNOISE'], // TYPE::I_BURSTNOISE
  ['I', 'RANDUNIFORM'], // TYPE::I_RANDUNIFORM
  ['I', 'RANDGAUSSIAN'], // TYPE::I_RANDGAUSSIAN
  ['I', 'RANDEXP'], // TYPE::I_RANDEXP
  ['I', 'RANDPOISSON'], // TYPE::I_RANDPOISSON
  ['I', '='], // TYPE::I_BEHAVIORAL
  ['SUBCKT', ''], // TYPE::SUBCKT
  ['XSPICE', ''], // TYPE::XSPICE
  ['KIBIS', 'DEVICE'], // TYPE::KIBIS_DEVICE
  ['KIBIS', 'DCDRIVER'], // TYPE::KIBIS_DRIVER_DC
  ['KIBIS', 'RECTDRIVER'], // TYPE::KIBIS_DRIVER_RECT
  ['KIBIS', 'PRBSDRIVER'], // TYPE::KIBIS_DRIVER_PRBS
  ['SPICE', ''], // TYPE::RAWSPICE
];

/** The Sim.* field names (sim_model.h). */
export const SIM_DEVICE_FIELD = 'Sim.Device';
export const SIM_TYPE_FIELD = 'Sim.Type';
export const SIM_PINS_FIELD = 'Sim.Pins';
export const SIM_PARAMS_FIELD = 'Sim.Params';
export const SIM_LIBRARY_FIELD = 'Sim.Library';
export const SIM_NAME_FIELD = 'Sim.Name';
