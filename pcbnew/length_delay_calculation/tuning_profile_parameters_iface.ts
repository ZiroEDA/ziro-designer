// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/length_delay_calculation/tuning_profile_parameters_iface.h`. */
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { NETCLASS } from '@ziroeda/common/netclass.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { BOARD } from '../board.js';
import type { LENGTH_DELAY_CALCULATION } from './length_delay_calculation.js';
import type { LENGTH_DELAY_CALCULATION_ITEM } from './length_delay_calculation_item.js';

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
