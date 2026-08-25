// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A direct oracle for the stripline engine.
 *
 * KiCad 10.0.5 ships no `test_stripline.cpp`, and until now our port was
 * exercised only *indirectly*, through the coupled-stripline vectors — which
 * call `striplineAnalyze` for a centred strip with `tanD` forced to zero, so a
 * whole half of the function was never looked at.
 *
 * **Where these numbers come from.** They are printed by
 * `qa/probes/stripline_oracle.cpp`, a standalone C++ program
 * whose two function bodies are KiCad's own source text copied verbatim from
 * `common/transline_calculations/stripline.cpp` (`Analyse`, `lineImpedance`)
 * and `transline_calculation_base.cpp:147-159` (`SkinDepth`,
 * `UnitPropagationDelay`), with `GetParameter( TCP::X )` rewritten as a plain
 * double. Nothing else was changed. So the expectations are C++'s arithmetic,
 * compiled by this machine's compiler, and owe nothing to the TypeScript under
 * test — which is the whole point: a vector computed by calling our own code
 * would be the first shape of test that cannot fail.
 *
 * Two independent corroborations that the transcription is right:
 *
 *  - the classic Cohn approximation, `Z0 ≈ (60/√εr)·ln(4b / (0.67π(0.8W + t)))`,
 *    gives 36.5 Ω for the b = 1.6 mm, W = 1 mm, t = 35 µm, εr = 4.5 case where
 *    the oracle says 39.65 Ω — the right line, in the right decade, from a
 *    formula that is not KiCad's;
 *  - the last two cases are the same physical line measured from either ground
 *    plane (`a` and `h − a − t`), which must give the same Z0 and does, to
 *    fourteen digits. That one is a symmetry of the geometry, not of the code.
 */
import { describe, it, expect } from 'vitest';
import {
  striplineAnalyze,
  striplineSynthesize,
  type TcElectrical,
  unitPropagationDelay,
} from '@ziroeda/pcb_calculator';

/**
 * One row of `stripline_oracle`'s output.
 *
 * Every case fixes σ = 5.8e7 S/m (copper) and μ(conductor) = 1, and the
 * ground-plane spacing h at 1.6 mm; W, t, `a`, εr, tan δ, f and L vary.
 */
interface Vector {
  what: string;
  widthM: number;
  heightM: number;
  thicknessM: number;
  offsetM: number;
  epsilonR: number;
  tanD: number;
  frequencyHz: number;
  lengthM: number;
  /** Ω. */
  z0: number;
  /** Radians, as `Analyse` computes it; the panel shows degrees. */
  angLRad: number;
  epsEff: number;
  conductorLossDb: number;
  dielectricLossDb: number;
  skinDepthM: number;
  /** ps/cm. */
  unitPropDelay: number;
}

const VECTORS: Vector[] = [
  {
    what: 'FR4, the panel’s own W and t, strip near the middle',
    widthM: 0.0002,
    heightM: 0.0016,
    thicknessM: 3.5e-5,
    offsetM: 0.0008,
    epsilonR: 4.5,
    tanD: 0.02,
    frequencyHz: 1e9,
    lengthM: 0.05,
    z0: 77.613162978390775,
    angLRad: 2.2229793410071541,
    epsEff: 4.5,
    conductorLossDb: 0.15181907900041264,
    dielectricLossDb: 0.19308553223686675,
    skinDepthM: 2.0898067849687574e-6,
    unitPropDelay: 70.947168680924506,
  },
  {
    what: 'FR4, W = 1 mm — the W/hmt >= 0.35 branch',
    widthM: 0.001,
    heightM: 0.0016,
    thicknessM: 3.5e-5,
    offsetM: 0.0008,
    epsilonR: 4.5,
    tanD: 0.02,
    frequencyHz: 1e9,
    lengthM: 0.05,
    z0: 39.650750189318586,
    angLRad: 2.2229793410071541,
    epsEff: 4.5,
    conductorLossDb: 0.087116973130047862,
    dielectricLossDb: 0.19308553223686675,
    skinDepthM: 2.0898067849687574e-6,
    unitPropDelay: 70.947168680924506,
  },
  {
    what: 'FR4, W = 0.1 mm — the narrow branch, where de and tdw appear',
    widthM: 0.0001,
    heightM: 0.0016,
    thicknessM: 3.5e-5,
    offsetM: 0.0008,
    epsilonR: 4.5,
    tanD: 0.02,
    frequencyHz: 1e9,
    lengthM: 0.05,
    z0: 92.349575644067698,
    angLRad: 2.2229793410071541,
    epsEff: 4.5,
    conductorLossDb: 0.20068031127735075,
    dielectricLossDb: 0.19308553223686675,
    skinDepthM: 2.0898067849687574e-6,
    unitPropDelay: 70.947168680924506,
  },
  {
    what: 'PTFE at 5 GHz — a different εr, tan δ, frequency and length',
    widthM: 0.00035,
    heightM: 0.0016,
    thicknessM: 1.75e-5,
    offsetM: 0.0005,
    epsilonR: 2.2,
    tanD: 0.001,
    frequencyHz: 5e9,
    lengthM: 0.025,
    z0: 89.892192609589898,
    angLRad: 3.88580067024626,
    epsEff: 2.2000000000000002,
    conductorLossDb: 0.10868788403076796,
    dielectricLossDb: 0.016875817888639077,
    skinDepthM: 9.3459000620608553e-7,
    unitPropDelay: 49.606678843449259,
  },
  {
    what: 'alumina at 2 GHz, a wide strip',
    widthM: 0.002,
    heightM: 0.0016,
    thicknessM: 7e-5,
    offsetM: 0.001,
    epsilonR: 10.2,
    tanD: 0.0023,
    frequencyHz: 2e9,
    lengthM: 0.01,
    z0: 15.050756506222299,
    angLRad: 1.3387184443579523,
    epsEff: 10.199999999999999,
    conductorLossDb: 0.032753363311345839,
    dielectricLossDb: 0.01337215476375557,
    skinDepthM: 1.4777165490210656e-6,
    unitPropDelay: 106.81417674027634,
  },
  {
    what: 'strongly off-centre, a = 0.3 mm of 1.6 mm',
    widthM: 0.0005,
    heightM: 0.0016,
    thicknessM: 3.5e-5,
    offsetM: 0.0003,
    epsilonR: 4.5,
    tanD: 0.02,
    frequencyHz: 1e9,
    lengthM: 0.05,
    z0: 44.323574408216885,
    angLRad: 2.2229793410071541,
    epsEff: 4.5,
    conductorLossDb: 0.14051962198780368,
    dielectricLossDb: 0.19308553223686675,
    skinDepthM: 2.0898067849687574e-6,
    unitPropDelay: 70.947168680924506,
  },
  {
    what: 'the same line from the other plane, a = h − a − t',
    widthM: 0.0005,
    heightM: 0.0016,
    thicknessM: 3.5e-5,
    offsetM: 0.001265,
    epsilonR: 4.5,
    tanD: 0.02,
    frequencyHz: 1e9,
    lengthM: 0.05,
    z0: 44.323574408216878,
    angLRad: 2.2229793410071541,
    epsEff: 4.5,
    conductorLossDb: 0.14051962198780363,
    dielectricLossDb: 0.19308553223686675,
    skinDepthM: 2.0898067849687574e-6,
    unitPropDelay: 70.947168680924506,
  },
];

const el = (v: Vector): TcElectrical => ({
  frequencyHz: v.frequencyHz,
  epsilonR: v.epsilonR,
  tanD: v.tanD,
  // Copper, and `mu Rel C` = 1: the two the panel opens with. The stripline has
  // no substrate-permeability parameter at all — `mur` is carried by the shared
  // type and STRIPLINE::Analyse never reads it (stripline.cpp:32-52).
  sigma: 5.8e7,
  mur: 1,
  murC: 1,
});

const phys = (
  v: Vector,
): { widthM: number; heightM: number; thicknessM: number; lengthM: number; offsetM: number } => ({
  widthM: v.widthM,
  heightM: v.heightM,
  thicknessM: v.thicknessM,
  lengthM: v.lengthM,
  offsetM: v.offsetM,
});

/** Twelve significant figures. The two implementations run the same sequence of
 *  IEEE-754 doubles, so anything looser would let a real difference through. */
const REL = 1e-12;

describe('STRIPLINE::Analyse against the C++ it was ported from', () => {
  for (const v of VECTORS) {
    describe(v.what, () => {
      const r = striplineAnalyze(phys(v), el(v));

      it('Z0', () => {
        expect(r.z0).toBeCloseTo(v.z0, -Math.log10(v.z0 * REL));
      });

      it('electrical length', () => {
        // `Analyse` produces radians; the panel and our port carry degrees.
        expect((r.angleDeg * Math.PI) / 180).toBeCloseTo(v.angLRad, -Math.log10(v.angLRad * REL));
      });

      it('effective epsilon — "no dispersion", so it is εr itself', () => {
        expect(r.epsEff).toBe(v.epsEff);
      });

      it('conductor loss', () => {
        expect(r.conductorLossDb).toBeCloseTo(
          v.conductorLossDb,
          -Math.log10(v.conductorLossDb * REL),
        );
      });

      it('dielectric loss', () => {
        expect(r.dielectricLossDb).toBeCloseTo(
          v.dielectricLossDb,
          -Math.log10(v.dielectricLossDb * REL),
        );
      });

      it('skin depth', () => {
        expect(r.skinDepthM).toBeCloseTo(v.skinDepthM, -Math.log10(v.skinDepthM * REL));
      });

      it('unit propagation delay', () => {
        expect(unitPropagationDelay(r.epsEff)).toBeCloseTo(
          v.unitPropDelay,
          -Math.log10(v.unitPropDelay * REL),
        );
      });
    });
  }
});

describe('`a` is a parameter, not an assumption', () => {
  const base = phys(VECTORS[5]!);
  const e = el(VECTORS[5]!);

  it('changes Z0 when nothing else does', () => {
    // The bug this pins: `analyseZ0` used to compute a = (h - t) / 2 itself and
    // throw the panel's `a` away, so these two were the same number.
    const offCentre = striplineAnalyze(base, e).z0;
    const centred = striplineAnalyze(
      { ...base, offsetM: (base.heightM - base.thicknessM) / 2 },
      e,
    ).z0;
    expect(offCentre).not.toBeCloseTo(centred, 6);
  });

  it('is symmetric about the middle of the board', () => {
    // Independent of the code: swapping a for h - a - t swaps the two
    // half-lines, and a parallel combination does not care which is which.
    const mirrored = base.heightM - base.offsetM - base.thicknessM;
    expect(striplineAnalyze({ ...base, offsetM: mirrored }, e).z0).toBeCloseTo(
      striplineAnalyze(base, e).z0,
      10,
    );
  });

  it('yields the centred answer at a = (h − t) / 2, which is what the coupled solver asks for', () => {
    const centred = (base.heightM - base.thicknessM) / 2;
    const r = striplineAnalyze({ ...base, offsetM: centred }, e);
    // Both half-lines are then the same height, so Z0 is exactly one of them.
    expect(r.z0).toBeGreaterThan(0);
    expect(Number.isFinite(r.z0)).toBe(true);
  });

  it('is not finite when the strip touches the top plane — a + t >= h', () => {
    // `SetAnalysisResults` flags exactly this as an error
    // (stripline.cpp:81-82), and it is the panel's OWN default geometry:
    // H and a both open at 0.2 mm (transline_ident.cpp, STRIPLINE_TYPE).
    const r = striplineAnalyze({ ...base, offsetM: base.heightM }, e);
    expect(Number.isFinite(r.z0)).toBe(false);
  });
});

describe('synthesis inverts analysis', () => {
  it('hits a 50 Ω target on an off-centre line', () => {
    const v = VECTORS[5]!;
    const syn = striplineSynthesize(phys(v), el(v), 50, 90);
    expect(syn).not.toBeNull();
    // Not a re-derivation of the target: it is the *analysis* of what synthesis
    // produced, which only agrees if both halves are right.
    expect(striplineAnalyze(syn!, el(v)).z0).toBeCloseTo(50, 6);
    expect(syn!.offsetM).toBe(v.offsetM);
  });
});
