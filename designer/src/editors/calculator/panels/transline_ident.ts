// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The nine transmission-line types and, for each, the exact parameter list the
 * panel builds itself from.
 *
 * Counterpart: KiCad `pcb_calculator/transline_ident.cpp`. Every label, every
 * default and every result line here is transcribed from `TRANSLINE_IDENT`'s
 * constructor — this is a table upstream hardcodes, so it is DATA, and the rule
 * is to mirror *that* table rather than invent one.
 *
 * Two things about the shape are load-bearing, because the panel is built from
 * fixed slots and not from the list:
 *
 *  - `TRANSLINE_IDENT` adds εr, tan δ, ρ and Frequency to EVERY type before it
 *    switches on the type (transline_ident.cpp:88-110), so those four are
 *    common and the per-type substrate rows follow them.
 *  - `DUMMY_PRM` is a real entry that occupies an electrical slot with an empty
 *    label and a disabled, empty field (transline_dlg_funct.cpp:227-241). It is
 *    why Z0 and Ang_l are not adjacent rows.
 */

/** Which unit selector a parameter carries, if any. */
export type PrmUnits =
  /** UNIT_SELECTOR_LEN. `aConvUnit = true`. */
  | 'len'
  /** UNIT_SELECTOR_FREQUENCY. */
  | 'freq'
  /** UNIT_SELECTOR_RESISTOR. */
  | 'res'
  /** UNIT_SELECTOR_ANGLE. */
  | 'angle'
  /** `aConvUnit = false`: the selector exists in the .fbp but is hidden and
   *  disabled, because `data->unit->Show( prm->m_ConvUnit )`. */
  | 'none';

export interface TranslinePrm {
  /** `m_KeyWord`, the settings key — unique per type, and our state key. */
  key: string;
  /** `m_DlgLabel`. The panel appends the colon itself, so it is not stored. */
  label: string;
  /** `m_ToolTip`. */
  tip?: string;
  /** `m_DefaultValue`, in the default unit. */
  def: number;
  units: PrmUnits;
  /** A lone wxStaticText in the third column instead of a selector — only ρ
   *  has one (`m_substrate_prm3_labelUnit`, set to "Ω ∙ m"
   *  at panel_transline.cpp:50). */
  staticUnit?: string;
  /** The `...` material picker: only εr, tan δ and ρ have one
   *  (panel_transline_base.cpp:70,89,108). */
  pick?: 'epsilonR' | 'tanD' | 'rho';
  /** `DUMMY_PRM`: blank label, empty field, `Enable( false )`. */
  dummy?: boolean;
}

export interface TranslineIdent {
  name: string;
  /** `m_BitmapName`. */
  bitmap: string;
  /** `m_HasPrmSelection` — whether the two physical-row radio buttons show. */
  hasPrmSelection: boolean;
  /** `m_Messages`, in order; they fill the Results box's ten slots. */
  messages: string[];
  subs: TranslinePrm[];
  phys: TranslinePrm[];
  elec: TranslinePrm[];
}

export type LineType =
  | 'microstrip'
  | 'c_microstrip'
  | 'stripline'
  | 'c_stripline'
  | 'cpw'
  | 'gcpw'
  | 'rectwaveguide'
  | 'coax'
  | 'twistedpair';

/**
 * The four common parameters, added before the switch
 * (transline_ident.cpp:88-110). εr/tan δ/ρ are substrate rows 1-3; Frequency is
 * the whole of the Component Parameters box.
 */
const COMMON_SUBS: TranslinePrm[] = [
  {
    key: 'Er',
    label: 'εr',
    tip: 'Substrate relative permittivity (dielectric constant)',
    def: 4.5,
    units: 'none',
    pick: 'epsilonR',
  },
  {
    key: 'TanD',
    label: 'tan δ',
    tip: 'Dielectric loss (dissipation factor)',
    def: 2e-2,
    units: 'none',
    pick: 'tanD',
  },
  {
    key: 'Rho',
    label: 'ρ',
    tip: 'Electrical resistivity or specific electrical resistance of conductor (ohm*meter)',
    def: 1.72e-8,
    units: 'none',
    // panel_transline.cpp:50 overwrites the .fbp's "ohm-meter" with this.
    staticUnit: 'Ω ∙ m',
    pick: 'rho',
  },
];

export const FREQUENCY_PRM: TranslinePrm = {
  key: 'Frequency',
  label: 'Frequency',
  tip: 'Frequency of the input signal',
  def: 1.0,
  units: 'freq',
};

/** `AddPrm( new TRANSLINE_PRM( PRM_TYPE_ELEC, DUMMY_PRM ) )`. */
const DUMMY: TranslinePrm = { key: 'dummy', label: '', def: 0, units: 'none', dummy: true };

const Z0: TranslinePrm = {
  key: 'Z0',
  label: 'Z0',
  tip: 'Characteristic impedance',
  def: 50.0,
  units: 'res',
};
const ANG_L: TranslinePrm = {
  key: 'Ang_l',
  label: 'Ang_l',
  tip: 'Electrical length',
  def: 0.0,
  units: 'angle',
};
const ZEVEN: TranslinePrm = {
  key: 'Zeven',
  label: 'Zeven',
  tip: 'Even mode impedance (lines driven by common voltages)',
  def: 50.0,
  units: 'res',
};
const ZODD: TranslinePrm = {
  key: 'Zodd',
  label: 'Zodd',
  tip: 'Odd mode impedance (lines driven by opposite (differential) voltages)',
  def: 50.0,
  units: 'res',
};
const LEN_L: TranslinePrm = { key: 'L', label: 'L', tip: 'Line length', def: 50.0, units: 'len' };
const MURC: TranslinePrm = {
  key: 'mu Rel C',
  // wxString::Format( wxT( "μ(%s)" ), _( "conductor" ) ) — no `r`, no space.
  label: 'μ(conductor)',
  tip: 'Relative permeability (mu) of conductor',
  def: 1,
  units: 'none',
};
const MUR_INSULATOR: TranslinePrm = {
  key: 'mu Rel I',
  label: 'μ(insulator)',
  tip: 'Relative permeability (mu) of insulator',
  def: 1,
  units: 'none',
};
const T_PRM: TranslinePrm = {
  key: 'T',
  label: 'T',
  tip: 'Strip thickness',
  def: 0.035,
  units: 'len',
};
const H_PRM: TranslinePrm = {
  key: 'H',
  label: 'H',
  tip: 'Height of substrate',
  def: 0.2,
  units: 'len',
};
const ROUGH: TranslinePrm = {
  key: 'Rough',
  label: 'Roughness',
  tip: 'Conductor roughness',
  def: 0.0,
  units: 'len',
};
const W_PRM: TranslinePrm = { key: 'W', label: 'W', tip: 'Line width', def: 0.2, units: 'len' };
const S_PRM: TranslinePrm = { key: 'S', label: 'S', tip: 'Gap width', def: 0.2, units: 'len' };
const DIN: TranslinePrm = {
  key: 'Din',
  label: 'Din',
  tip: 'Inner diameter (conductor)',
  def: 1.0,
  units: 'len',
};
const DOUT: TranslinePrm = {
  key: 'Dout',
  label: 'Dout',
  tip: 'Outer diameter (insulator)',
  def: 8.0,
  units: 'len',
};

/** `wxString::Format( _( "Effective %s:" ), wxT( "εr" ) )`, minus the colon. */
const EFF_ER = 'Effective εr';

export const TRANSLINES: Record<LineType, TranslineIdent> = {
  // --- MICROSTRIP_TYPE (transline_ident.cpp:117-158) -----------------------
  microstrip: {
    name: 'Microstrip Line',
    bitmap: 'microstrip',
    hasPrmSelection: false,
    messages: [
      EFF_ER,
      'Unit propagation delay',
      'Conductor losses',
      'Dielectric losses',
      'Skin depth',
    ],
    subs: [
      ...COMMON_SUBS,
      H_PRM,
      // "H(top)", not "H_t" — the coupled microstrip is the one that says H_t.
      { key: 'H_t', label: 'H(top)', tip: 'Height of box top', def: 1e20, units: 'len' },
      T_PRM,
      ROUGH,
      // Only microstrip spells these "μr (substrate)" / "μr (conductor)"; every
      // other type uses the "μ(conductor)" form.
      {
        key: 'mu Rel S',
        label: 'μr (substrate)',
        tip: 'Relative permeability (mu) of substrate',
        def: 1,
        units: 'none',
      },
      {
        key: 'mu Rel C',
        label: 'μr (conductor)',
        tip: 'Relative permeability (mu) of conductor',
        def: 1,
        units: 'none',
      },
    ],
    phys: [W_PRM, LEN_L],
    elec: [Z0, DUMMY, ANG_L],
  },

  // --- CPW_TYPE (transline_ident.cpp:160-197) ------------------------------
  cpw: {
    name: 'Coplanar wave guide',
    bitmap: 'cpw',
    hasPrmSelection: true,
    messages: [
      EFF_ER,
      'Unit propagation delay',
      'Conductor losses',
      'Dielectric losses',
      'Skin depth',
    ],
    subs: [...COMMON_SUBS, H_PRM, T_PRM, MURC],
    phys: [W_PRM, S_PRM, LEN_L],
    elec: [Z0, DUMMY, ANG_L],
  },

  // --- GROUNDED_CPW_TYPE (transline_ident.cpp:199-229) ---------------------
  gcpw: {
    name: 'Coplanar wave guide w/ ground plane',
    bitmap: 'cpw_back',
    hasPrmSelection: true,
    messages: [
      EFF_ER,
      'Unit propagation delay',
      'Conductor losses',
      'Dielectric losses',
      'Skin depth',
    ],
    subs: [...COMMON_SUBS, H_PRM, T_PRM, MURC],
    phys: [W_PRM, S_PRM, LEN_L],
    elec: [Z0, DUMMY, ANG_L],
  },

  // --- RECTWAVEGUIDE_TYPE (transline_ident.cpp:232-265) --------------------
  rectwaveguide: {
    name: 'Rectangular Waveguide',
    bitmap: 'rectwaveguide',
    hasPrmSelection: true,
    messages: [
      'ZF(H10) = Ey / Hx',
      EFF_ER,
      'Conductor losses',
      'Dielectric losses',
      'TE-modes',
      'TM-modes',
    ],
    subs: [...COMMON_SUBS, MUR_INSULATOR, MURC],
    phys: [
      { key: 'a', label: 'a', tip: 'Width of waveguide', def: 10.0, units: 'len' },
      { key: 'b', label: 'b', tip: 'Height of waveguide', def: 5.0, units: 'len' },
      { ...LEN_L, tip: 'Waveguide length' },
    ],
    elec: [Z0, DUMMY, ANG_L],
  },

  // --- COAX_TYPE (transline_ident.cpp:267-300) -----------------------------
  coax: {
    name: 'Coaxial Line',
    bitmap: 'coax',
    hasPrmSelection: true,
    messages: [EFF_ER, 'Conductor losses', 'Dielectric losses', 'TE-modes', 'TM-modes'],
    subs: [...COMMON_SUBS, MUR_INSULATOR, MURC],
    phys: [DIN, DOUT, LEN_L],
    elec: [Z0, DUMMY, ANG_L],
  },

  // --- C_MICROSTRIP_TYPE (transline_ident.cpp:302-350) ---------------------
  c_microstrip: {
    name: 'Coupled Microstrip Line',
    bitmap: 'c_microstrip',
    hasPrmSelection: true,
    messages: [
      'Effective εr (even)',
      'Effective εr (odd)',
      'Unit propagation delay (even)',
      'Unit propagation delay (odd)',
      'Conductor losses (even)',
      'Conductor losses (odd)',
      'Dielectric losses (even)',
      'Dielectric losses (odd)',
      'Skin depth',
      'Differential Impedance (Zd)',
    ],
    subs: [
      ...COMMON_SUBS,
      H_PRM,
      { key: 'H_t', label: 'H_t', tip: 'Height of box top', def: 1e20, units: 'len' },
      T_PRM,
      ROUGH,
      MURC,
    ],
    phys: [W_PRM, S_PRM, LEN_L],
    elec: [ZEVEN, ZODD, ANG_L],
  },

  // --- C_STRIPLINE_TYPE (transline_ident.cpp:352-386) ----------------------
  c_stripline: {
    name: 'Coupled Stripline',
    bitmap: 'coupled_stripline',
    hasPrmSelection: true,
    messages: [
      'Effective εr (even)',
      'Effective εr (odd)',
      'Unit propagation delay (even)',
      'Unit propagation delay (odd)',
      'Skin depth',
      'Differential Impedance (Zd)',
    ],
    subs: [...COMMON_SUBS, H_PRM, T_PRM, MURC],
    phys: [W_PRM, S_PRM, LEN_L],
    elec: [ZEVEN, ZODD, ANG_L],
  },

  // --- STRIPLINE_TYPE (transline_ident.cpp:388-419) ------------------------
  stripline: {
    name: 'Stripline',
    bitmap: 'stripline',
    hasPrmSelection: false,
    messages: [
      EFF_ER,
      'Unit propagation delay',
      'Conductor losses',
      'Dielectric losses',
      'Skin depth',
    ],
    subs: [
      ...COMMON_SUBS,
      H_PRM,
      // STRIPLINE_A_PRM is a SUBSTRATE row here, not a physical one.
      {
        key: 'a',
        label: 'a',
        tip: 'Distance between strip and top metal',
        def: 0.2,
        units: 'len',
      },
      T_PRM,
      MURC,
    ],
    phys: [W_PRM, LEN_L],
    elec: [Z0, DUMMY, ANG_L],
  },

  // --- TWISTEDPAIR_TYPE (transline_ident.cpp:421-457) ----------------------
  twistedpair: {
    name: 'Twisted Pair',
    bitmap: 'twistedpair',
    hasPrmSelection: true,
    messages: [EFF_ER, 'Conductor losses', 'Dielectric losses', 'Skin depth'],
    subs: [
      ...COMMON_SUBS,
      {
        key: 'Twists',
        label: 'Twists',
        tip: 'Number of twists per length',
        def: 0.0,
        units: 'none',
      },
      MURC,
      {
        key: 'ErEnv',
        // wxString::Format( wxT( "εr(%s)" ), _( "environment" ) )
        label: 'εr(environment)',
        tip: 'Relative permittivity of environment',
        def: 1,
        units: 'none',
      },
    ],
    phys: [DIN, DOUT, { ...LEN_L, tip: 'Cable length' }],
    elec: [Z0, DUMMY, ANG_L],
  },
};

/**
 * The radio box's entries, in `m_TranslineSelectionChoices` order
 * (panel_transline_base.cpp:23-31) with `SetSelection( 0 )`.
 */
export const LINE_TYPE_ORDER: LineType[] = [
  'microstrip',
  'c_microstrip',
  'stripline',
  'c_stripline',
  'cpw',
  'gcpw',
  'rectwaveguide',
  'coax',
  'twistedpair',
];

/** The panel's fixed slot counts — the boxes are built once, not per type. */
export const SUBS_SLOTS = 9; // fgSizerSubstPrms( 9, 3, 3, 0 )
export const PHYS_SLOTS = 3; // fgSizerPhysPrms( 4, 4, 3, 0 ), three used
export const ELEC_SLOTS = 3; // fgSizerResults( 3, 3, 3, 0 )
export const RESULT_SLOTS = 10; // fgSizerTranslResults( 10, 2, 4, 0 )
