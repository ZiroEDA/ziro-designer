// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The "SIMULATION / ANALYSIS PLUMBING" half of
 * `pcbnew/dialogs/panel_setup_tuning_profile_info.cpp` (`:614-1362`): the
 * calculator button in a Track Propagation cell. From the board's stackup it
 * takes the copper thickness and the dielectrics between the signal layer and
 * its reference(s), and asks the transmission-line calculators for the width
 * (or gap) that meets the target impedance, or the delay of the width given.
 *
 * The calculators are pcb_calculator's port of `common/transline_calculations`
 * (the same code the Calculator Tools use). Upstream drives them as
 * `TRANSLINE_CALCULATION_BASE` objects through `SetParameter` / `Synthesize` /
 * `Analyse`; ours are functions, so the parameter plumbing below is theirs,
 * one table per line type.
 */
import { FromUserUnit, pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import {
  IsBackLayer,
  IsFrontLayer,
  IsCopperLayerLowerThan,
  PCB_LAYER_ID,
} from '@ziroeda/common/src/layer_ids.js';
import {
  coupledMicrostripAnalyze,
  coupledStriplineAnalyze,
  microstripAnalyze,
  microstripSynthesize,
  striplineAnalyze,
  striplineSynthesize,
  unitPropagationDelay,
} from '@ziroeda/pcb_calculator';
import type { TcElectrical } from '@ziroeda/pcb_calculator/src/transline/tc_common.js';
import {
  type BOARD_STACKUP,
  type BOARD_STACKUP_ITEM,
  BOARD_STACKUP_ITEM_TYPE,
} from '@ziroeda/pcbnew/board_stackup_manager/board_stackup.js';

/** [data] `PANEL_SETUP_TUNING_PROFILE_INFO::RHO`: copper resistivity, ohm·m. */
export const RHO = 1.72e-8;

export enum CalculationType {
  WIDTH = 0,
  GAP,
  DELAY,
}

/** `CALCULATION_RESULT`: widths and gap in IU, delay in IU length-delay. */
export interface CalculationResult {
  OK: boolean;
  ErrorMsg: string;
  Width: number;
  DiffPairGap: number;
  Delay: number;
}

const fail = (aMsg: string): CalculationResult => ({
  OK: false,
  ErrorMsg: aMsg,
  Width: 0,
  DiffPairGap: 0,
  Delay: 0,
});

/** `CALCULATION_BOARD_PARAMETERS`, all lengths in metres. */
export interface CalculationBoardParameters {
  DielectricConstant: number;
  TopDielectricLayerThickness: number;
  BottomDielectricLayerThickness: number;
  SignalLayerThickness: number;
  LossTangent: number;
}

/** `DIELECTRIC_INFO`: height in metres, the thickness-weighted εr and tanδ. */
interface DielectricInfo {
  Height: number;
  E_r: number;
  Loss_Tangent: number;
}

/** What a cell calculation reads from the row: layers by id, the two lengths in IU (or unset). */
export interface TrackRowInput {
  signalLayer: PCB_LAYER_ID | undefined;
  topReference: PCB_LAYER_ID | undefined;
  bottomReference: PCB_LAYER_ID | undefined;
  width: number | undefined;
  gap: number | undefined;
}

/** `calculateSkinDepth( aFreq, aMurc, aSigma )`. */
export function calculateSkinDepth(aFreq: number, aMurc: number, aSigma: number): number {
  const MU0 = 4e-7 * Math.PI;
  return 1.0 / Math.sqrt(Math.PI * aFreq * aMurc * MU0 * aSigma);
}

/** `getStackupLayerId`: the stackup index of a board layer, or -1. */
export function getStackupLayerId(
  aLayerList: readonly BOARD_STACKUP_ITEM[],
  aPcbLayerId: PCB_LAYER_ID,
): number {
  let layerFound = false;
  let layerStackupId = 0;

  while (layerStackupId < aLayerList.length && !layerFound) {
    if (aLayerList[layerStackupId]!.GetBrdLayerId() !== aPcbLayerId) ++layerStackupId;
    else layerFound = true;
  }

  if (!layerFound) return -1;

  return layerStackupId;
}

/** `calculateAverageDielectricConstants`: thickness-weighted over every sublayer. */
function calculateAverageDielectricConstants(
  aStackupLayerList: readonly BOARD_STACKUP_ITEM[],
  dielectricLayerStackupIds: readonly number[],
): DielectricInfo {
  let totalHeight = 0.0;
  let e_r = 0.0;
  let lossTangent = 0.0;

  for (const i of dielectricLayerStackupIds) {
    const layer = aStackupLayerList[i]!;

    for (let subLayerIdx = 0; subLayerIdx < layer.GetSublayersCount(); ++subLayerIdx) {
      const t = pcbIUScale.iuToMM(layer.GetThickness(subLayerIdx));
      totalHeight += t;
      e_r += layer.GetEpsilonR(subLayerIdx) * t;
      lossTangent += layer.GetLossTangent(subLayerIdx) * t;
    }
  }

  e_r = e_r / totalHeight;
  lossTangent = lossTangent / totalHeight;
  totalHeight /= 1000.0; // Convert from mm to m

  return { Height: totalHeight, E_r: e_r, Loss_Tangent: lossTangent };
}

/** `getDielectricLayers`: the dielectrics with an εr strictly between the two stackup indices. */
function getDielectricLayers(
  aStackupLayerList: readonly BOARD_STACKUP_ITEM[],
  aSignalLayerId: number,
  aReferenceLayerId: number,
): number[] {
  const out: number[] = [];

  for (
    let i = Math.min(aSignalLayerId, aReferenceLayerId) + 1;
    i < Math.max(aSignalLayerId, aReferenceLayerId);
    ++i
  ) {
    const layer = aStackupLayerList[i]!;

    if (layer.GetType() !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) continue;

    if (!layer.HasEpsilonRValue()) continue;

    out.push(i);
  }

  return out;
}

/** `getMicrostripBoardParameters`. */
export function getMicrostripBoardParameters(
  aStackup: BOARD_STACKUP,
  aRow: TrackRowInput,
): [CalculationBoardParameters | null, CalculationResult] {
  const stackupLayerList = aStackup.GetList();

  if (aRow.signalLayer === undefined) return [null, fail('Signal layer not found in stackup')];

  const signalLayer = aRow.signalLayer;

  // Microstrip can only be on an outer copper layer
  if (signalLayer !== PCB_LAYER_ID.F_Cu && signalLayer !== PCB_LAYER_ID.B_Cu)
    return [null, fail('Internal error: Microstrip can only be on an outer copper layer')];

  const signalLayerStackupId = getStackupLayerId(stackupLayerList, signalLayer);

  if (signalLayerStackupId === -1) return [null, fail('Signal layer not found in stackup')];

  const signalLayerThickness =
    pcbIUScale.iuToMM(stackupLayerList[signalLayerStackupId]!.GetThickness()) / 1000.0;

  if (signalLayerThickness <= 0)
    return [null, fail('Signal layer thickness must be greater than 0')];

  // Get reference layer
  const referenceLayer =
    signalLayer === PCB_LAYER_ID.F_Cu ? aRow.bottomReference : aRow.topReference;

  if (referenceLayer === undefined) return [null, fail('Reference layer not found in stackup')];

  const referenceLayerStackupId = getStackupLayerId(stackupLayerList, referenceLayer);

  if (signalLayerStackupId === referenceLayerStackupId)
    return [null, fail('Reference layer must be different to signal layer')];

  // Get the dielectric layers between signal and reference layers
  const dielectricLayerStackupIds = getDielectricLayers(
    stackupLayerList,
    signalLayerStackupId,
    referenceLayerStackupId,
  );

  // Calculate geometric average of the dielectric materials
  const dielectricInfo = calculateAverageDielectricConstants(
    stackupLayerList,
    dielectricLayerStackupIds,
  );

  if (!(dielectricInfo.Height > 0.0))
    return [null, fail('Dielectric height must be greater than 0')];

  return [
    {
      DielectricConstant: dielectricInfo.E_r,
      TopDielectricLayerThickness: dielectricInfo.Height,
      BottomDielectricLayerThickness: 0.0,
      SignalLayerThickness: signalLayerThickness,
      LossTangent: dielectricInfo.Loss_Tangent,
    },
    { OK: true, ErrorMsg: '', Width: 0, DiffPairGap: 0, Delay: 0 },
  ];
}

/** `getStriplineBoardParameters`. */
export function getStriplineBoardParameters(
  aStackup: BOARD_STACKUP,
  aRow: TrackRowInput,
): [CalculationBoardParameters | null, CalculationResult] {
  const stackupLayerList = aStackup.GetList();

  if (aRow.signalLayer === undefined) return [null, fail('Signal layer not found in stackup')];

  const signalLayer = aRow.signalLayer;
  const signalLayerStackupId = getStackupLayerId(stackupLayerList, signalLayer);

  if (signalLayerStackupId === -1) return [null, fail('Signal layer not found in stackup')];

  const signalLayerThickness =
    pcbIUScale.iuToMM(stackupLayerList[signalLayerStackupId]!.GetThickness()) / 1000.0;

  if (signalLayerThickness <= 0)
    return [null, fail('Signal layer thickness must be greater than 0')];

  // Get top reference layer
  if (aRow.topReference === undefined)
    return [null, fail('Top reference layer not found in stackup')];

  const topReferenceLayer = aRow.topReference;
  const topReferenceLayerStackupId = getStackupLayerId(stackupLayerList, topReferenceLayer);

  if (!IsCopperLayerLowerThan(signalLayer, topReferenceLayer))
    return [null, fail('Top reference layer must be above signal layer in board stackup')];

  // Get bottom reference layer
  if (aRow.bottomReference === undefined)
    return [null, fail('Bottom reference layer not found in stackup')];

  const bottomReferenceLayer = aRow.bottomReference;
  const bottomReferenceLayerStackupId = getStackupLayerId(stackupLayerList, bottomReferenceLayer);

  if (!IsCopperLayerLowerThan(bottomReferenceLayer, signalLayer))
    return [null, fail('Bottom reference layer must be below signal layer in board stackup')];

  // Get the dielectric layers between signal and reference layers
  const topDielectricLayerStackupIds = getDielectricLayers(
    stackupLayerList,
    signalLayerStackupId,
    topReferenceLayerStackupId,
  );
  const bottomDielectricLayerStackupIds = getDielectricLayers(
    stackupLayerList,
    signalLayerStackupId,
    bottomReferenceLayerStackupId,
  );

  // Calculate geometric average of the dielectric materials
  const allDielectricLayerStackupIds = [
    ...topDielectricLayerStackupIds,
    ...bottomDielectricLayerStackupIds,
  ];

  const topDielectricInfo = calculateAverageDielectricConstants(
    stackupLayerList,
    topDielectricLayerStackupIds,
  );
  const bottomDielectricInfo = calculateAverageDielectricConstants(
    stackupLayerList,
    bottomDielectricLayerStackupIds,
  );
  const allDielectricInfo = calculateAverageDielectricConstants(
    stackupLayerList,
    allDielectricLayerStackupIds,
  );

  if (!(topDielectricInfo.Height > 0.0) && !(bottomDielectricInfo.Height > 0.0))
    return [null, fail('Dielectric heights must be greater than 0')];

  return [
    {
      DielectricConstant: allDielectricInfo.E_r,
      TopDielectricLayerThickness: topDielectricInfo.Height,
      BottomDielectricLayerThickness: bottomDielectricInfo.Height,
      SignalLayerThickness: signalLayerThickness,
      LossTangent: allDielectricInfo.Loss_Tangent,
    },
    { OK: true, ErrorMsg: '', Width: 0, DiffPairGap: 0, Delay: 0 },
  ];
}

/** The `SetParameter` block every calculation shares: 1 GHz, copper, no roughness. */
function electrical(aBoard: CalculationBoardParameters): TcElectrical {
  return {
    frequencyHz: 1000000000.0,
    epsilonR: aBoard.DielectricConstant,
    tanD: aBoard.LossTangent,
    sigma: 1.0 / RHO,
    mur: 1,
    murC: 1,
  };
}

const widthIU = (aWidthM: number): number =>
  Math.trunc(FromUserUnit(pcbIUScale, 'mm', aWidthM * 1000.0));
const delayIU = (aPsPerCm: number): number =>
  Math.trunc(FromUserUnit(pcbIUScale, 'ps/cm', aPsPerCm));

/** `calculateSingleMicrostrip`. */
export function calculateSingleMicrostrip(
  aStackup: BOARD_STACKUP,
  aRow: TrackRowInput,
  aTargetZ: number,
  aCalculationType: CalculationType,
): CalculationResult {
  if (!(aTargetZ > 0)) return fail('Target impedance must be greater than 0');

  const [boardParameters, result] = getMicrostripBoardParameters(aStackup, aRow);

  if (!result.OK || !boardParameters) return result;

  const el = electrical(boardParameters);
  const phys = {
    widthM: 0.001,
    heightM: boardParameters.TopDielectricLayerThickness,
    thicknessM: boardParameters.SignalLayerThickness,
    lengthM: 10,
  };

  if (aCalculationType === CalculationType.DELAY)
    phys.widthM = pcbIUScale.iuToMM(aRow.width ?? 0) / 1000.0;

  let width: number;

  if (aCalculationType === CalculationType.WIDTH) {
    const synth = microstripSynthesize(phys, el, aTargetZ, 1);

    if (!synth || !Number.isFinite(synth.widthM)) return fail('Width calculation failed');

    width = synth.widthM;
  } else {
    width = phys.widthM;
  }

  const analysis = microstripAnalyze({ ...phys, widthM: width }, el);

  if (!Number.isFinite(analysis.epsEff)) return fail('Delay calculation failed');

  return {
    OK: true,
    ErrorMsg: '',
    Width: widthIU(width),
    DiffPairGap: 0,
    Delay: delayIU(unitPropagationDelay(analysis.epsEff)),
  };
}

/** `calculateSingleStripline`. */
export function calculateSingleStripline(
  aStackup: BOARD_STACKUP,
  aRow: TrackRowInput,
  aTargetZ: number,
  aCalculationType: CalculationType,
): CalculationResult {
  if (!(aTargetZ > 0)) return fail('Target impedance must be greater than 0');

  const [boardParameters, result] = getStriplineBoardParameters(aStackup, aRow);

  if (!result.OK || !boardParameters) return result;

  const el = electrical(boardParameters);
  const phys = {
    widthM: 0.001,
    heightM:
      boardParameters.TopDielectricLayerThickness +
      boardParameters.SignalLayerThickness +
      boardParameters.BottomDielectricLayerThickness,
    thicknessM: boardParameters.SignalLayerThickness,
    lengthM: 1.0,
    offsetM: boardParameters.TopDielectricLayerThickness,
  };

  if (aCalculationType === CalculationType.DELAY)
    phys.widthM = pcbIUScale.iuToMM(aRow.width ?? 0) / 1000.0;

  let width: number;

  if (aCalculationType === CalculationType.WIDTH) {
    const synth = striplineSynthesize(phys, el, aTargetZ, 1.0);

    if (!synth || !Number.isFinite(synth.widthM)) return fail('Width calculation failed');

    width = synth.widthM;
  } else {
    width = phys.widthM;
  }

  const analysis = striplineAnalyze({ ...phys, widthM: width }, el);

  if (!Number.isFinite(analysis.epsEff)) return fail('Delay calculation failed');

  return {
    OK: true,
    ErrorMsg: '',
    Width: widthIU(width),
    DiffPairGap: 0,
    Delay: delayIU(unitPropagationDelay(analysis.epsEff)),
  };
}

/**
 * The coupled synthesis with one dimension fixed (`SYNTHESIZE_OPTS::FIX_SPACING`
 * solves the width, `FIX_WIDTH` the gap): the differential impedance is
 * monotonic in either, so a bisection over the free one.
 */
function solveCoupled(
  aZDiffOf: (aFree: number) => number,
  aTarget: number,
  aLo: number,
  aHi: number,
  aRising: boolean,
): number | null {
  let lo = aLo;
  let hi = aHi;
  const zLo = aZDiffOf(lo);
  const zHi = aZDiffOf(hi);

  if (!Number.isFinite(zLo) || !Number.isFinite(zHi)) return null;
  if ((zLo - aTarget) * (zHi - aTarget) > 0) return null;

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const below = aZDiffOf(mid) < aTarget;
    if (below === aRising) lo = mid;
    else hi = mid;
  }

  return (lo + hi) / 2;
}

/** The three inputs of a coupled calculation, checked as upstream checks them. */
function coupledInputs(
  aRow: TrackRowInput,
  aCalculationType: CalculationType,
): [number, number] | CalculationResult {
  let width = 0.0;
  let gap = 0.0;
  const widthOpt = aRow.width;
  const gapOpt = aRow.gap;

  if (aCalculationType === CalculationType.WIDTH) {
    if (gapOpt === undefined || gapOpt <= 0)
      return fail('Diff pair gap must be greater than 0 to calculate width');

    gap = pcbIUScale.iuToMM(gapOpt) / 1000.0;
  } else if (aCalculationType === CalculationType.GAP) {
    if (widthOpt === undefined || widthOpt <= 0)
      return fail('Width must be greater than 0 to calculate diff pair gap');

    width = pcbIUScale.iuToMM(widthOpt) / 1000.0;
  } else {
    if (widthOpt === undefined || gapOpt === undefined || widthOpt <= 0 || gapOpt <= 0)
      return fail('Width and diff pair gap must be greater than 0 to calculate delay');

    width = pcbIUScale.iuToMM(widthOpt) / 1000.0;
    gap = pcbIUScale.iuToMM(gapOpt) / 1000.0;
  }

  return [width, gap];
}

/** `calculateDifferentialMicrostrip`. */
export function calculateDifferentialMicrostrip(
  aStackup: BOARD_STACKUP,
  aRow: TrackRowInput,
  aTargetZ: number,
  aCalculationType: CalculationType,
): CalculationResult {
  if (!(aTargetZ > 0)) return fail('Target impedance must be greater than 0');

  const [boardParameters, result] = getMicrostripBoardParameters(aStackup, aRow);

  if (!result.OK || !boardParameters) return result;

  const inputs = coupledInputs(aRow, aCalculationType);

  if (!Array.isArray(inputs)) return inputs;

  let [width, gap] = inputs;
  const el = electrical(boardParameters);
  const h = boardParameters.TopDielectricLayerThickness;
  const physOf = (w: number, s: number) => ({
    widthM: w,
    gapM: s,
    heightM: h,
    thicknessM: boardParameters.SignalLayerThickness,
    lengthM: 10,
  });
  const zDiffOf = (w: number, s: number): number =>
    coupledMicrostripAnalyze(physOf(w, s), el).extra.zDiff;

  if (aCalculationType === CalculationType.WIDTH) {
    // Zdiff falls as the lines widen.
    const w = solveCoupled((x) => zDiffOf(x, gap), aTargetZ, h * 1e-4, h * 100, false);

    if (w === null) return fail('Width calculation failed');

    width = w;
  } else if (aCalculationType === CalculationType.GAP) {
    // Zdiff rises with the gap.
    const s = solveCoupled((x) => zDiffOf(width, x), aTargetZ, h * 1e-3, h * 50, true);

    if (s === null) return fail('Diff pair gap calculation failed');

    gap = s;
  }

  const analysis = coupledMicrostripAnalyze(physOf(width, gap), el);

  if (!Number.isFinite(analysis.extra.epsEffOdd)) return fail('Delay calculation failed');

  return {
    OK: true,
    ErrorMsg: '',
    Width: widthIU(width),
    DiffPairGap: widthIU(gap),
    Delay: delayIU(unitPropagationDelay(analysis.extra.epsEffOdd)),
  };
}

/** `calculateDifferentialStripline`. */
export function calculateDifferentialStripline(
  aStackup: BOARD_STACKUP,
  aRow: TrackRowInput,
  aTargetZ: number,
  aCalculationType: CalculationType,
): CalculationResult {
  if (!(aTargetZ > 0)) return fail('Target impedance must be greater than 0');

  const [boardParameters, result] = getStriplineBoardParameters(aStackup, aRow);

  if (!result.OK || !boardParameters) return result;

  const inputs = coupledInputs(aRow, aCalculationType);

  if (!Array.isArray(inputs)) return inputs;

  let [width, gap] = inputs;
  const el = electrical(boardParameters);
  const h =
    boardParameters.TopDielectricLayerThickness +
    boardParameters.SignalLayerThickness +
    boardParameters.BottomDielectricLayerThickness;
  const physOf = (w: number, s: number) => ({
    widthM: w,
    gapM: s,
    heightM: h,
    thicknessM: boardParameters.SignalLayerThickness,
    lengthM: 1.0,
  });
  const zDiffOf = (w: number, s: number): number => coupledStriplineAnalyze(physOf(w, s), el).zDiff;

  if (aCalculationType === CalculationType.WIDTH) {
    const w = solveCoupled((x) => zDiffOf(x, gap), aTargetZ, h * 1e-4, h * 50, false);

    if (w === null) return fail('Width calculation failed');

    width = w;
  } else if (aCalculationType === CalculationType.GAP) {
    const s = solveCoupled((x) => zDiffOf(width, x), aTargetZ, h * 1e-3, h * 50, true);

    if (s === null) return fail('Diff pair gap calculation failed');

    gap = s;
  }

  const analysis = coupledStriplineAnalyze(physOf(width, gap), el);

  if (!Number.isFinite(analysis.unitPropDelayOdd)) return fail('Delay calculation failed');

  return {
    OK: true,
    ErrorMsg: '',
    Width: widthIU(width),
    DiffPairGap: widthIU(gap),
    Delay: delayIU(analysis.unitPropDelayOdd),
  };
}

/** Whether a signal layer is a microstrip (outer) or a stripline (inner) geometry. */
export function isMicrostripLayer(aLayer: PCB_LAYER_ID): boolean {
  return IsFrontLayer(aLayer) || IsBackLayer(aLayer);
}

/**
 * `calculateTrackParametersForCell`, the decision half: which calculator, and
 * which of its results the cell takes. The `DisplayErrorMessage` half is the
 * caller's.
 */
export function calculateTrackParameters(
  aStackup: BOARD_STACKUP,
  aRow: TrackRowInput,
  aDifferential: boolean,
  aTargetZ: number,
  aCalculationType: CalculationType,
): CalculationResult {
  if (aRow.signalLayer === undefined) return fail('Signal layer not found in stackup');

  const isMicrostrip = isMicrostripLayer(aRow.signalLayer);

  if (aDifferential) {
    const result = isMicrostrip
      ? calculateDifferentialMicrostrip(aStackup, aRow, aTargetZ, aCalculationType)
      : calculateDifferentialStripline(aStackup, aRow, aTargetZ, aCalculationType);

    if (!result.OK) return fail(`Error: ${result.ErrorMsg}`);

    if (!(result.Width > 0)) return fail('Could not compute track width');
    if (!(result.DiffPairGap > 0)) return fail('Could not compute differential pair gap');
    if (!(result.Delay > 0)) return fail('Could not compute track propagation delay');

    return result;
  }

  const result = isMicrostrip
    ? calculateSingleMicrostrip(aStackup, aRow, aTargetZ, aCalculationType)
    : calculateSingleStripline(aStackup, aRow, aTargetZ, aCalculationType);

  if (!result.OK) return fail(`Error: ${result.ErrorMsg}`);

  if (!(result.Width > 0)) return fail('Could not compute track width');
  if (!(result.Delay > 0)) return fail('Could not compute track propagation delay');

  // Single track mode never touches the gap.
  return { ...result, DiffPairGap: 0 };
}
