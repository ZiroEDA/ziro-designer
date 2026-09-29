// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/length_delay_calculation/tuning_profile_parameters_user_defined.h` / `.cpp`. */
import { PCB_IU_PER_MM } from '@ziroeda/common/eda_units.js';
import { IsCopperLayerLowerThan, type PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { NETCLASS } from '@ziroeda/common/netclass.js';
import type { TUNING_PROFILE } from '@ziroeda/common/project/tuning_profiles.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { BOARD } from '../board.js';
import {
  type LENGTH_DELAY_CALCULATION_ITEM,
  LENGTH_DELAY_CALCULATION_ITEM_TYPE,
  MERGE_STATUS,
} from './length_delay_calculation_item.js';
import type { LENGTH_DELAY_CALCULATION } from './length_delay_calculation.js';

/* `tuning_profile_parameters_iface.h`, held here (KiCad has no .cpp for it). */
/**
 * A data structure to contain basic geometry data which can affect signal propagation calculations.
 */
export class TUNING_PROFILE_GEOMETRY_CONTEXT {
  /// The net class this track belongs to
  NetClass: NETCLASS | null = null;

  /// The layer this track is on
  Layer: PCB_LAYER_ID = 0 as PCB_LAYER_ID;

  /// The width (in internal units) of the track
  Width = 0;

  /// Whether this track or via is a member of a coupled differential pair
  IsDiffPairCoupled = false;

  /// The gap between coupled tracks
  DiffPairCouplingGap = 0;
}

/**
 * Interface for providers of tuning profile parameter information. This interface is consumed by the
 * LENGTH_TIME_CALCULATOR object to convert space-domain physical layout information (e.g. track lengths) in to
 * time-domain propagation information.
 */
export abstract class TUNING_PROFILE_PARAMETERS_IFACE {
  /// The board all calculations are for
  protected m_board: BOARD;

  /// The parent length / delay calculation object
  protected m_lengthCalculation: LENGTH_DELAY_CALCULATION;

  constructor(aBoard: BOARD, aCalculation: LENGTH_DELAY_CALCULATION) {
    this.m_board = aBoard;
    this.m_lengthCalculation = aCalculation;
  }

  /**
   * Event called by the length and time calculation architecture if the board stackup has changed. This can be used
   * to invalidate any calculation / simulation caches.
   */
  OnStackupChanged(): void {}

  /**
   * Event called by the length and time calculation architecture if netclass definitions have changed. This can be
   * used to invalidate any calculation / simulation caches.
   */
  OnSettingsChanged(): void {}

  /**
   * Gets the propagation delays (in internal units) for the given items in the given geometry context
   */
  abstract GetPropagationDelays(
    aItems: readonly LENGTH_DELAY_CALCULATION_ITEM[],
    aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number[];

  /**
   * Gets the propagation delay (in internal units) for the given item in the given geometry context
   */
  abstract GetPropagationDelay(
    aItem: LENGTH_DELAY_CALCULATION_ITEM,
    aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number;

  /**
   * Gets the via propagation delay for the given via layer geometry
   */
  abstract GetViaPropagationDelay(
    aSignalStartLayer: PCB_LAYER_ID,
    aSignalEndLayer: PCB_LAYER_ID,
    aViaStartLayer: PCB_LAYER_ID,
    aViaEndLayer: PCB_LAYER_ID,
    aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number;

  /**
   * Gets the track length (in internal distance units) required for the given propagation delay (in internal time
   * units). The track length should be calculated with the given geometry context.
   */
  abstract GetTrackLengthForPropagationDelay(
    aDelay: number,
    aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number;

  /**
   * Gets the propagation delay for the given shape line chain
   */
  abstract CalculatePropagationDelayForShapeLineChain(
    aShape: SHAPE_LINE_CHAIN,
    aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number;
}

/** `VIA_OVERRIDE_CACHE_KEY` as a map key. */
const viaOverrideKey = (
  SignalStart: PCB_LAYER_ID,
  SignalEnd: PCB_LAYER_ID,
  ViaStart: PCB_LAYER_ID,
  ViaEnd: PCB_LAYER_ID,
): string => `${SignalStart}:${SignalEnd}:${ViaStart}:${ViaEnd}`;

export class TUNING_PROFILE_PARAMETERS_USER_DEFINED extends TUNING_PROFILE_PARAMETERS_IFACE {
  private readonly m_delayProfilesCache = new Map<string, TUNING_PROFILE>();
  private readonly m_viaOverridesCache = new Map<string, Map<string, number>>();

  override OnSettingsChanged(): void {
    this.rebuildCaches();
  }

  override GetPropagationDelays(
    aItems: readonly LENGTH_DELAY_CALCULATION_ITEM[],
    aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number[] {
    if (aItems.length === 0) return [];

    const delayProfileName = aItems[0]!.GetEffectiveNetClass()!.GetTuningProfile();
    const delayProfile = this.GetTuningProfile(delayProfileName);

    if (!delayProfile) return new Array<number>(aItems.length).fill(0);

    const propagationDelays: number[] = [];

    for (const item of aItems)
      propagationDelays.push(this.getPropagationDelay(item, aContext, delayProfile));

    return propagationDelays;
  }

  override GetPropagationDelay(
    aItem: LENGTH_DELAY_CALCULATION_ITEM,
    aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number {
    if (aItem.GetMergeStatus() === MERGE_STATUS.MERGED_RETIRED) return 0;

    const delayProfileName = aItem.GetEffectiveNetClass()!.GetTuningProfile();
    const delayProfile = this.GetTuningProfile(delayProfileName);

    if (!delayProfile) return 0;

    return this.getPropagationDelay(aItem, aContext, delayProfile);
  }

  private getPropagationDelay(
    aItem: LENGTH_DELAY_CALCULATION_ITEM,
    _aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
    aDelayProfile: TUNING_PROFILE,
  ): number {
    if (aItem.GetMergeStatus() === MERGE_STATUS.MERGED_RETIRED) return 0;

    const itemType = aItem.Type();

    if (itemType === LENGTH_DELAY_CALCULATION_ITEM_TYPE.LINE) {
      let delayUnit = 0.0;

      const entry = aDelayProfile.m_TrackPropagationEntriesMap.get(aItem.GetStartLayer());

      if (entry !== undefined) delayUnit = entry.GetDelay();

      return Math.trunc(delayUnit * (aItem.GetLine().Length() / PCB_IU_PER_MM));
    }

    if (itemType === LENGTH_DELAY_CALCULATION_ITEM_TYPE.VIA) {
      if (!aDelayProfile.m_EnableTimeDomainTuning) return 0;

      const signalStartLayer = aItem.GetStartLayer();
      const signalEndLayer = aItem.GetEndLayer();
      const viaStartLayer = aItem.GetVia()!.Padstack().StartLayer();
      const viaEndLayer = aItem.GetVia()!.Padstack().EndLayer();

      return this.getViaPropagationDelay(
        signalStartLayer,
        signalEndLayer,
        viaStartLayer,
        viaEndLayer,
        aDelayProfile,
      );
    }

    if (itemType === LENGTH_DELAY_CALCULATION_ITEM_TYPE.PAD) {
      return aItem.GetPad()!.GetPadToDieDelay();
    }

    return 0;
  }

  override GetViaPropagationDelay(
    aSignalStartLayer: PCB_LAYER_ID,
    aSignalEndLayer: PCB_LAYER_ID,
    aViaStartLayer: PCB_LAYER_ID,
    aViaEndLayer: PCB_LAYER_ID,
    aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number {
    const tuningProfileName = aContext.NetClass!.GetTuningProfile();
    const tuningProfile = this.GetTuningProfile(tuningProfileName);

    if (!tuningProfile) return 0;

    return this.getViaPropagationDelay(
      aSignalStartLayer,
      aSignalEndLayer,
      aViaStartLayer,
      aViaEndLayer,
      tuningProfile,
    );
  }

  private getViaPropagationDelay(
    aSignalStartLayer: PCB_LAYER_ID,
    aSignalEndLayer: PCB_LAYER_ID,
    aViaStartLayer: PCB_LAYER_ID,
    aViaEndLayer: PCB_LAYER_ID,
    aTuningProfile: TUNING_PROFILE,
  ): number {
    // Ensure ordering as per the via save order
    if (IsCopperLayerLowerThan(aSignalStartLayer, aSignalEndLayer)) {
      [aSignalStartLayer, aSignalEndLayer] = [aSignalEndLayer, aSignalStartLayer];
    }

    if (IsCopperLayerLowerThan(aViaStartLayer, aViaEndLayer))
      [aViaStartLayer, aViaEndLayer] = [aViaEndLayer, aViaStartLayer];

    // First check for a layer-to-layer override - this assumes that the layers are already in CuStack() order
    const viaOverrides = this.m_viaOverridesCache.get(aTuningProfile.m_ProfileName)!;
    const viaItr = viaOverrides.get(
      viaOverrideKey(aSignalStartLayer, aSignalEndLayer, aViaStartLayer, aViaEndLayer),
    );

    if (viaItr !== undefined) return viaItr;

    // Otherwise, return the tuning profile default
    const distance = this.m_lengthCalculation.StackupHeight(aSignalStartLayer, aSignalEndLayer);
    return Math.trunc(aTuningProfile.m_ViaPropagationDelay * (distance / PCB_IU_PER_MM));
  }

  private GetTuningProfile(aDelayProfileName: string): TUNING_PROFILE | null {
    const itr = this.m_delayProfilesCache.get(aDelayProfileName);

    if (itr !== undefined) return itr;

    return null;
  }

  override GetTrackLengthForPropagationDelay(
    aDelay: number,
    aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number {
    const delayProfileName = aContext.NetClass!.GetTuningProfile();
    const profile = this.GetTuningProfile(delayProfileName);

    if (!profile) return 0;

    let delayUnit = 0.0;

    const entry = profile.m_TrackPropagationEntriesMap.get(aContext.Layer);

    if (entry !== undefined) delayUnit = entry.GetDelay();

    const lengthInMM = aDelay / delayUnit; // MM
    return Math.trunc(lengthInMM * PCB_IU_PER_MM); // Length IU
  }

  override CalculatePropagationDelayForShapeLineChain(
    aShape: SHAPE_LINE_CHAIN,
    aContext: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number {
    const delayProfileName = aContext.NetClass!.GetTuningProfile();
    const profile = this.GetTuningProfile(delayProfileName);

    if (!profile) return 0;

    let delayUnit = 0.0;

    const entry = profile.m_TrackPropagationEntriesMap.get(aContext.Layer);

    if (entry !== undefined) delayUnit = entry.GetDelay();

    return Math.trunc(delayUnit * (aShape.Length() / PCB_IU_PER_MM));
  }

  private rebuildCaches(): void {
    this.m_delayProfilesCache.clear();
    this.m_viaOverridesCache.clear();

    // `if( const PROJECT* project = m_board->GetProject() )`: the board carries
    // the project file's TUNING_PROFILES here.
    const params = this.m_board.GetTuningProfiles();

    for (const profile of params.GetTuningProfiles()) {
      this.m_delayProfilesCache.set(profile.m_ProfileName, profile);
      const viaOverrides = new Map<string, number>();
      this.m_viaOverridesCache.set(profile.m_ProfileName, viaOverrides);

      for (const viaOverride of profile.m_ViaOverrides) {
        viaOverrides.set(
          viaOverrideKey(
            viaOverride.m_SignalLayerFrom,
            viaOverride.m_SignalLayerTo,
            viaOverride.m_ViaLayerFrom,
            viaOverride.m_ViaLayerTo,
          ),
          viaOverride.m_Delay,
        );
      }
    }
  }
}
