// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/transline_calculations/transline_calculation_base.{h,cpp}`: the
 * parameter map every line calculation is driven through (`SetParameter`,
 * `Analyse`, `Synthesize`, `GetAnalysisResults`), the Newton root-finder
 * that synthesis uses (`MinimiseZ0Error1D`), and the shared physics helpers.
 *
 * The four line types keep their formulas in the per-line modules beside
 * this one (`microstrip.ts` and the rest, the `*.cpp` bodies); the classes
 * over them map the parameter map to and from those functions.
 */

export enum TRANSLINE_PARAMETERS {
  UNKNOWN_ID = -1,
  EPSILONR = 0, // Dielectric constant
  TAND, // Dielectric Loss Tangent
  RHO, // Conductivity of conductor
  H, // Height of substrate
  H_T, // Height of top surface
  T, // Height of top conductor
  PHYS_WIDTH, // Width of trace
  PHYS_DIAM_IN, // Inner diameter of cable
  PHYS_S, // width of gap between line and ground
  PHYS_DIAM_OUT, // Outer diameter of cable
  PHYS_LEN, // Length of cable
  ROUGH, // Surface roughness
  MUR, // Magnetic permeability of substrate
  MURC, // magnetic permeability of conductor
  FREQUENCY, // Frequency of operation
  STRIPLINE_A, // Stripline : distance from track to top plane
  TWISTEDPAIR_TWIST, // Twists per length
  TWISTEDPAIR_EPSILONR_ENV, // Dielectric constant of environment
  Z0, // Characteristic impedance
  Z0_E, // Even-mode characteristic impedance
  Z0_O, // Odd-mode characteristic impedance
  ANG_L, // Electrical length in angle
  DUMMY_PRM,
  SIGMA, // Conductivity of the metal
  SKIN_DEPTH, // Skin depth
  LOSS_DIELECTRIC, // Loss in dielectric (dB)
  LOSS_CONDUCTOR, // Loss in conductors (dB)
  CUTOFF_FREQUENCY, // Cutoff frequency for higher order modes
  EPSILON_EFF, // Effective dielectric constant
  EPSILON_EFF_EVEN, // Even mode effective dielectric constant
  EPSILON_EFF_ODD, // Odd mode effective dielectric constant
  UNIT_PROP_DELAY, // The unit propagation delay (ps/cm)
  UNIT_PROP_DELAY_ODD, // The odd mode unit propagation delay (ps/cm)
  UNIT_PROP_DELAY_EVEN, // The even mode unit propagation delay (ps/cm)
  ATTEN_COND, // The attenuation of the conductor
  ATTEN_COND_EVEN, // The even mode attenuation of the conductor
  ATTEN_COND_ODD, // The odd mode attenuation of the conductor
  ATTEN_DILECTRIC, // The attenuation of the dilectric
  ATTEN_DILECTRIC_EVEN, // The even mode attenuation of the dilectric
  ATTEN_DILECTRIC_ODD, // The odd mode attenuation of the dilectric
  Z_DIFF, // The differential impedance
  EXTRAS_COUNT,
}

export enum SYNTHESIZE_OPTS {
  DEFAULT = 0, // Use the default synthesis options for the calculation
  FIX_WIDTH, // Fixes the width of a differential pair
  FIX_SPACING, // Fixes the spacing of a differential pair
}

export enum TRANSLINE_STATUS {
  OK = 0,
  WARNING,
  TS_ERROR, // ERROR name is colliding with a define on Windows
}

/** `std::pair<double, TRANSLINE_STATUS>`. */
export type TRANSLINE_RESULT = [number, TRANSLINE_STATUS];

/** `TRANSLINE_CALCULATIONS::C0` and `MU0` (units.h). */
export const TC_C0 = 299792458.0;
export const TC_MU0 = 12.566370614e-7;

const TCP = TRANSLINE_PARAMETERS;

export abstract class TRANSLINE_CALCULATION_BASE {
  protected m_parameters = new Map<TRANSLINE_PARAMETERS, number>();
  protected m_analysisStatus = new Map<TRANSLINE_PARAMETERS, TRANSLINE_RESULT>();
  protected m_synthesisStatus = new Map<TRANSLINE_PARAMETERS, TRANSLINE_RESULT>();
  protected static readonly m_maxError = 0.000001;

  constructor(aParameters: readonly TRANSLINE_PARAMETERS[]) {
    this.InitProperties(aParameters);
  }

  /** Set a parameter value. */
  SetParameter(aParam: TRANSLINE_PARAMETERS, aValue: number): void {
    this.m_parameters.set(aParam, aValue);
  }

  /** Get a parameter value. `std::unordered_map::at`: an unknown one is 0 here, not a throw. */
  GetParameter(aParam: TRANSLINE_PARAMETERS): number {
    return this.m_parameters.get(aParam) ?? 0;
  }

  /** Get the analysis results and status. */
  GetAnalysisResults(): Map<TRANSLINE_PARAMETERS, TRANSLINE_RESULT> {
    this.SetAnalysisResults();
    return this.m_analysisStatus;
  }

  /** Get the synthesis results and status. */
  GetSynthesisResults(): Map<TRANSLINE_PARAMETERS, TRANSLINE_RESULT> {
    this.SetSynthesisResults();
    return this.m_synthesisStatus;
  }

  /** Analyse the transmission line: the outputs from the inputs. */
  abstract Analyse(): void;

  /** Synthesise the transmission line: the inputs that give the required outputs. */
  abstract Synthesize(aOpts: SYNTHESIZE_OPTS): boolean;

  /** Initialise the parameters map. */
  protected InitProperties(aParams: readonly TRANSLINE_PARAMETERS[]): void {
    for (const param of aParams) this.m_parameters.set(param, 0.0);
  }

  /** Set the analysis results and status. */
  protected abstract SetAnalysisResults(): void;

  /** Set the synthesis results and status. */
  protected abstract SetSynthesisResults(): void;

  protected SetAnalysisResult(
    aParam: TRANSLINE_PARAMETERS,
    aValue: number,
    aStatus: TRANSLINE_STATUS = TRANSLINE_STATUS.OK,
  ): void {
    this.m_analysisStatus.set(aParam, [aValue, aStatus]);
  }

  protected SetSynthesisResult(
    aParam: TRANSLINE_PARAMETERS,
    aValue: number,
    aStatus: TRANSLINE_STATUS = TRANSLINE_STATUS.OK,
  ): void {
    this.m_synthesisStatus.set(aParam, [aValue, aStatus]);
  }

  /**
   * Minimise the error in the measured Z0 parameter by varying the given
   * parameter — Newton's method over `Analyse()`, with the step of a hundredth.
   */
  protected MinimiseZ0Error1D(
    aOptimise: TRANSLINE_PARAMETERS,
    aMeasure: TRANSLINE_PARAMETERS,
    aRecalculateLength = false,
  ): boolean {
    let var_ = this.GetParameter(aOptimise);
    const Z0_param = this.GetParameter(aMeasure);
    const ANG_L_param = this.GetParameter(TCP.ANG_L);

    if (!Number.isFinite(Z0_param)) {
      this.SetParameter(aOptimise, Number.NaN);
      return false;
    }

    if (!Number.isFinite(var_) || var_ === 0) var_ = 0.001;

    /* required value of Z0 */
    const Z0_dest = Z0_param;

    /* required value of angl_l */
    const angl_l_dest = ANG_L_param;

    /* Newton's method */
    let iteration = 0;

    /* compute parameters */
    this.SetParameter(aOptimise, var_);
    this.Analyse();
    let Z0_current = this.GetParameter(aMeasure);

    let error = Math.abs(Z0_dest - Z0_current);

    while (error > TRANSLINE_CALCULATION_BASE.m_maxError) {
      iteration++;
      const increment = var_ / 100.0;
      var_ += increment;
      /* compute parameters */
      this.SetParameter(aOptimise, var_);
      this.Analyse();
      const Z0_result = this.GetParameter(aMeasure);
      // f(w(n)) = Z0 - Z0(w(n))
      // f'(w(n)) = -f'(Z0(w(n)))
      // f'(Z0(w(n))) = (Z0(w(n)) - Z0(w(n+delw))/delw
      // w(n+1) = w(n) - f(w(n))/f'(w(n))
      let slope = (Z0_result - Z0_current) / increment;
      slope = (Z0_dest - Z0_current) / slope - increment;
      var_ += slope;

      if (var_ <= 0.0) var_ = increment;

      /* find new error */
      /* compute parameters */
      this.SetParameter(aOptimise, var_);
      this.Analyse();
      Z0_current = this.GetParameter(aMeasure);
      error = Math.abs(Z0_dest - Z0_current);

      if (iteration > 250) break;
    }

    /* Compute one last time, but with correct length */
    if (aRecalculateLength) {
      this.SetParameter(aMeasure, Z0_dest);
      this.SetParameter(TCP.ANG_L, angl_l_dest);
      this.SetParameter(
        TCP.PHYS_LEN,
        ((TC_C0 /
          this.GetParameter(TCP.FREQUENCY) /
          Math.sqrt(this.GetParameter(TCP.EPSILON_EFF))) *
          angl_l_dest) /
          2.0 /
          Math.PI,
      ); /* in m */
      this.Analyse();
      /* Restore parameters */
      this.SetParameter(aMeasure, Z0_dest);
      this.SetParameter(TCP.ANG_L, angl_l_dest);
      this.SetParameter(
        TCP.PHYS_LEN,
        ((TC_C0 /
          this.GetParameter(TCP.FREQUENCY) /
          Math.sqrt(this.GetParameter(TCP.EPSILON_EFF))) *
          angl_l_dest) /
          2.0 /
          Math.PI,
      ); /* in m */
    }

    return error <= TRANSLINE_CALCULATION_BASE.m_maxError;
  }

  /** The skin depth from the frequency, the conductor permeability and its conductivity. */
  protected SkinDepth(): number {
    return (
      1.0 /
      Math.sqrt(
        Math.PI *
          this.GetParameter(TCP.FREQUENCY) *
          this.GetParameter(TCP.MURC) *
          TC_MU0 *
          this.GetParameter(TCP.SIGMA),
      )
    );
  }

  /** Calculate the unit propagation delay (ps/cm) of the given effective permittivity. */
  static UnitPropagationDelay(aEpsilonEff: number): number {
    return Math.sqrt(aEpsilonEff) * (1.0e10 / 2.99e8);
  }

  /** `coth`, `sech`. */
  protected static coth(x: number): number {
    return (Math.exp(2.0 * x) + 1.0) / (Math.exp(2.0 * x) - 1.0);
  }

  protected static sech(x: number): number {
    return 2.0 / (Math.exp(x) + Math.exp(-x));
  }
}
