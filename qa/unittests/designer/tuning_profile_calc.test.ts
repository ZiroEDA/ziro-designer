// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Tuning Profiles page's calculator button
 * (`panel_setup_tuning_profile_info.cpp:614-1362`): the board parameters it
 * reads off the stackup, and the four line calculations.
 */
import { describe, expect, it } from 'vitest';
import { FromUserUnit, pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  CalculationType,
  RHO,
  calculateTrackParameters,
  getMicrostripBoardParameters,
  getStackupLayerId,
  getStriplineBoardParameters,
} from '@ziroeda/designer/src/editors/pcb/dialogs/tuning_profile_calc.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  coupledMicrostripAnalyze,
  coupledStriplineAnalyze,
  microstripAnalyze,
  striplineAnalyze,
  unitPropagationDelay,
} from '@ziroeda/pcb_calculator';

/** A 4-layer default stackup: 0.035 mm copper, FR4 dielectrics at εr 4.5, tanδ 0.02. */
function fourLayer(): BOARD {
  const b = new BOARD();
  b.SetCopperLayerCount(4);
  return b;
}

const { F_Cu, In1_Cu, In2_Cu, B_Cu } = PCB_LAYER_ID;

describe('board parameters off the stackup', () => {
  it('a microstrip on F.Cu takes the dielectric down to its bottom reference', () => {
    const stackup = fourLayer().GetStackupOrDefault();
    const [p, r] = getMicrostripBoardParameters(stackup, {
      signalLayer: F_Cu,
      topReference: undefined,
      bottomReference: In1_Cu,
      width: undefined,
      gap: undefined,
    });
    expect(r.OK).toBe(true);
    expect(p!.SignalLayerThickness).toBeCloseTo(0.035e-3, 12);
    expect(p!.DielectricConstant).toBeCloseTo(4.5, 9);
    expect(p!.LossTangent).toBeCloseTo(0.02, 9);
    expect(p!.BottomDielectricLayerThickness).toBe(0);
    // The one dielectric between F.Cu and In1.Cu, in metres.
    const list = stackup.GetList();
    const diel = list[getStackupLayerId(list, F_Cu) + 1]!;
    expect(p!.TopDielectricLayerThickness).toBeCloseTo(
      pcbIUScale.iuToMM(diel.GetThickness()) / 1000,
      12,
    );
  });

  it('a microstrip on B.Cu reads the TOP reference, and an inner layer is refused', () => {
    const stackup = fourLayer().GetStackupOrDefault();
    expect(
      getMicrostripBoardParameters(stackup, {
        signalLayer: B_Cu,
        topReference: In2_Cu,
        bottomReference: undefined,
        width: undefined,
        gap: undefined,
      })[1].OK,
    ).toBe(true);
    expect(
      getMicrostripBoardParameters(stackup, {
        signalLayer: In1_Cu,
        topReference: F_Cu,
        bottomReference: In2_Cu,
        width: undefined,
        gap: undefined,
      })[1].ErrorMsg,
    ).toBe('Internal error: Microstrip can only be on an outer copper layer');
    expect(
      getMicrostripBoardParameters(stackup, {
        signalLayer: F_Cu,
        topReference: undefined,
        bottomReference: undefined,
        width: undefined,
        gap: undefined,
      })[1].ErrorMsg,
    ).toBe('Reference layer not found in stackup');
  });

  it('a stripline needs a reference above and one below, in stackup order', () => {
    const stackup = fourLayer().GetStackupOrDefault();
    const [p, r] = getStriplineBoardParameters(stackup, {
      signalLayer: In1_Cu,
      topReference: F_Cu,
      bottomReference: In2_Cu,
      width: undefined,
      gap: undefined,
    });
    expect(r.OK).toBe(true);
    expect(p!.TopDielectricLayerThickness).toBeGreaterThan(0);
    expect(p!.BottomDielectricLayerThickness).toBeGreaterThan(0);

    expect(
      getStriplineBoardParameters(stackup, {
        signalLayer: In1_Cu,
        topReference: In2_Cu,
        bottomReference: B_Cu,
        width: undefined,
        gap: undefined,
      })[1].ErrorMsg,
    ).toBe('Top reference layer must be above signal layer in board stackup');
    expect(
      getStriplineBoardParameters(stackup, {
        signalLayer: In2_Cu,
        topReference: F_Cu,
        bottomReference: In1_Cu,
        width: undefined,
        gap: undefined,
      })[1].ErrorMsg,
    ).toBe('Bottom reference layer must be below signal layer in board stackup');
  });
});

describe('the cell calculations', () => {
  const row = (
    signal: PCB_LAYER_ID,
    top: PCB_LAYER_ID | undefined,
    bottom: PCB_LAYER_ID | undefined,
    width?: number,
    gap?: number,
  ) => ({
    signalLayer: signal,
    topReference: top,
    bottomReference: bottom,
    width,
    gap,
  });

  it('single microstrip WIDTH: the width that meets the impedance, and its delay', () => {
    const stackup = fourLayer().GetStackupOrDefault();
    const r = calculateTrackParameters(
      stackup,
      row(F_Cu, undefined, In1_Cu),
      false,
      50,
      CalculationType.WIDTH,
    );
    expect(r.OK).toBe(true);
    expect(r.Width).toBeGreaterThan(0);
    expect(r.DiffPairGap).toBe(0);

    // The width it found analyses back to 50 ohms on the same geometry.
    const [p] = getMicrostripBoardParameters(stackup, row(F_Cu, undefined, In1_Cu));
    const a = microstripAnalyze(
      {
        widthM: pcbIUScale.iuToMM(r.Width) / 1000,
        heightM: p!.TopDielectricLayerThickness,
        thicknessM: p!.SignalLayerThickness,
        lengthM: 10,
      },
      {
        frequencyHz: 1e9,
        epsilonR: p!.DielectricConstant,
        tanD: p!.LossTangent,
        sigma: 1 / 1.72e-8,
        mur: 1,
        murC: 1,
      },
    );
    expect(a.z0).toBeCloseTo(50, 2);
    // ps/cm from εeff, as the calculator's UNIT_PROP_DELAY, stored in IU.
    expect(r.Delay).toBe(
      Math.trunc(FromUserUnit(pcbIUScale, 'ps/cm', unitPropagationDelay(a.epsEff))),
    );
  });

  it('single microstrip DELAY: the width given, only the delay moves', () => {
    const stackup = fourLayer().GetStackupOrDefault();
    const w = pcbIUScale.mmToIU(0.3);
    const r = calculateTrackParameters(
      stackup,
      row(F_Cu, undefined, In1_Cu, w),
      false,
      50,
      CalculationType.DELAY,
    );
    expect(r.OK).toBe(true);
    expect(r.Width).toBe(w);
    expect(r.Delay).toBeGreaterThan(0);
  });

  it('single stripline WIDTH analyses back to the target', () => {
    const stackup = fourLayer().GetStackupOrDefault();
    const r = calculateTrackParameters(
      stackup,
      row(In1_Cu, F_Cu, In2_Cu),
      false,
      50,
      CalculationType.WIDTH,
    );
    expect(r.OK).toBe(true);
    const [p] = getStriplineBoardParameters(stackup, row(In1_Cu, F_Cu, In2_Cu));
    const a = striplineAnalyze(
      {
        widthM: pcbIUScale.iuToMM(r.Width) / 1000,
        heightM:
          p!.TopDielectricLayerThickness +
          p!.SignalLayerThickness +
          p!.BottomDielectricLayerThickness,
        thicknessM: p!.SignalLayerThickness,
        lengthM: 1,
        offsetM: p!.TopDielectricLayerThickness,
      },
      {
        frequencyHz: 1e9,
        epsilonR: p!.DielectricConstant,
        tanD: p!.LossTangent,
        sigma: 1 / 1.72e-8,
        mur: 1,
        murC: 1,
      },
    );
    expect(a.z0).toBeCloseTo(50, 1);
  });

  it('differential: WIDTH needs a gap, GAP needs a width, DELAY needs both', () => {
    const stackup = fourLayer().GetStackupOrDefault();
    const w = pcbIUScale.mmToIU(0.2);
    const g = pcbIUScale.mmToIU(0.15);
    expect(
      calculateTrackParameters(
        stackup,
        row(F_Cu, undefined, In1_Cu),
        true,
        90,
        CalculationType.WIDTH,
      ).ErrorMsg,
    ).toBe('Error: Diff pair gap must be greater than 0 to calculate width');
    expect(
      calculateTrackParameters(stackup, row(F_Cu, undefined, In1_Cu), true, 90, CalculationType.GAP)
        .ErrorMsg,
    ).toBe('Error: Width must be greater than 0 to calculate diff pair gap');
    expect(
      calculateTrackParameters(
        stackup,
        row(F_Cu, undefined, In1_Cu, w),
        true,
        90,
        CalculationType.DELAY,
      ).ErrorMsg,
    ).toBe('Error: Width and diff pair gap must be greater than 0 to calculate delay');

    const width = calculateTrackParameters(
      stackup,
      row(F_Cu, undefined, In1_Cu, undefined, g),
      true,
      90,
      CalculationType.WIDTH,
    );
    expect(width.OK).toBe(true);
    expect(width.Width).toBeGreaterThan(0);
    expect(width.DiffPairGap).toBe(g);

    const gap = calculateTrackParameters(
      stackup,
      row(F_Cu, undefined, In1_Cu, w),
      true,
      90,
      CalculationType.GAP,
    );
    expect(gap.OK).toBe(true);
    expect(gap.Width).toBe(w);
    expect(gap.DiffPairGap).toBeGreaterThan(0);

    const strip = calculateTrackParameters(
      stackup,
      row(In1_Cu, F_Cu, In2_Cu, w, g),
      true,
      90,
      CalculationType.DELAY,
    );
    expect(strip.OK).toBe(true);
    expect(strip.Delay).toBeGreaterThan(0);
  });

  /**
   * `COUPLED_*::Synthesize(FIX_SPACING | FIX_WIDTH)` is `MinimiseZ0Error1D`
   * on the ODD-mode impedance, and the panel sets `Z0_O = targetZ / 2`: the
   * width (or gap) it returns is the one whose odd-mode impedance is 45 Ω for
   * a 90 Ω target, to the base class's `m_maxError` (1e-6 relative). Read the
   * result back through the analyser to check that, rather than a number
   * printed by the code under test.
   */
  it('differential WIDTH / GAP land Z0_O on targetZ/2, to MinimiseZ0Error1D’s tolerance', () => {
    const stackup = fourLayer().GetStackupOrDefault();
    const w = pcbIUScale.mmToIU(0.2);
    const g = pcbIUScale.mmToIU(0.15);
    const targetZ = 90;

    const el = {
      frequencyHz: 1e9,
      epsilonR: 4.5,
      tanD: 0.02,
      sigma: 1 / RHO,
      mur: 1,
      murC: 1,
    };

    const [ms] = getMicrostripBoardParameters(stackup, row(F_Cu, undefined, In1_Cu));
    const physMs = (aW: number, aS: number) => ({
      widthM: aW,
      gapM: aS,
      heightM: ms!.TopDielectricLayerThickness,
      thicknessM: ms!.SignalLayerThickness,
      lengthM: 10,
    });

    const width = calculateTrackParameters(
      stackup,
      row(F_Cu, undefined, In1_Cu, undefined, g),
      true,
      targetZ,
      CalculationType.WIDTH,
    );
    expect(width.OK).toBe(true);
    const wM = pcbIUScale.iuToMM(width.Width) / 1000;
    const gM = pcbIUScale.iuToMM(g) / 1000;
    const zOddW = coupledMicrostripAnalyze(physMs(wM, gM), el).extra.z0Odd;
    // The IU truncation of the width is ~1e-9 m; well inside 1e-6 relative on Z.
    expect(Math.abs(zOddW - targetZ / 2) / (targetZ / 2)).toBeLessThan(1e-5);
    // Upstream targets the ODD-mode impedance, not the differential one, and
    // for a microstrip pair `Z_DIFF` is 2·Z0_O less a coupling term: the pair
    // it returns is ~0.1 Ω off the 90 Ω typed in. A solver on Z_DIFF (what the
    // bisection before this port did) lands 90.000 and so is not KiCad's.
    const zDiff = coupledMicrostripAnalyze(physMs(wM, gM), el).extra.zDiff;
    expect(zDiff).toBeGreaterThan(targetZ + 0.05);
    expect(zDiff).toBeLessThan(targetZ + 0.2);

    const gap = calculateTrackParameters(
      stackup,
      row(F_Cu, undefined, In1_Cu, w),
      true,
      targetZ,
      CalculationType.GAP,
    );
    expect(gap.OK).toBe(true);
    const wM2 = pcbIUScale.iuToMM(w) / 1000;
    const gM2 = pcbIUScale.iuToMM(gap.DiffPairGap) / 1000;
    const zOddG = coupledMicrostripAnalyze(physMs(wM2, gM2), el).extra.z0Odd;
    expect(Math.abs(zOddG - targetZ / 2) / (targetZ / 2)).toBeLessThan(1e-5);
    // The delay is the ODD mode's (`UNIT_PROP_DELAY_ODD`); on a microstrip the
    // two modes differ, so this cannot pass with the even one.
    const modes = coupledMicrostripAnalyze(physMs(wM2, gM2), el).extra;
    expect(modes.epsEffEven).not.toBeCloseTo(modes.epsEffOdd, 4);
    expect(gap.Delay).toBe(
      Math.trunc(FromUserUnit(pcbIUScale, 'ps/cm', unitPropagationDelay(modes.epsEffOdd))),
    );

    // The stripline pair, the same way.
    const [sl] = getStriplineBoardParameters(stackup, row(In1_Cu, F_Cu, In2_Cu));
    const physSl = (aW: number, aS: number) => ({
      widthM: aW,
      gapM: aS,
      heightM:
        sl!.TopDielectricLayerThickness +
        sl!.SignalLayerThickness +
        sl!.BottomDielectricLayerThickness,
      thicknessM: sl!.SignalLayerThickness,
      lengthM: 1,
    });
    const sw = calculateTrackParameters(
      stackup,
      row(In1_Cu, F_Cu, In2_Cu, undefined, g),
      true,
      targetZ,
      CalculationType.WIDTH,
    );
    expect(sw.OK).toBe(true);
    const zOddS = coupledStriplineAnalyze(physSl(pcbIUScale.iuToMM(sw.Width) / 1000, gM), el).z0Odd;
    expect(Math.abs(zOddS - targetZ / 2) / (targetZ / 2)).toBeLessThan(1e-5);
    // And the delay is the odd-mode one, as `UNIT_PROP_DELAY_ODD` says.
    expect(sw.Delay).toBe(
      Math.trunc(
        FromUserUnit(
          pcbIUScale,
          'ps/cm',
          coupledStriplineAnalyze(physSl(pcbIUScale.iuToMM(sw.Width) / 1000, gM), el)
            .unitPropDelayOdd,
        ),
      ),
    );
  });

  it('a target impedance of 0 is refused before anything else', () => {
    const stackup = fourLayer().GetStackupOrDefault();
    expect(
      calculateTrackParameters(
        stackup,
        row(F_Cu, undefined, In1_Cu),
        false,
        0,
        CalculationType.WIDTH,
      ).ErrorMsg,
    ).toBe('Error: Target impedance must be greater than 0');
  });
});
