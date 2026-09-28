// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/teardrop/teardrop_parameters.h` / `.cpp`: the parameters needed to
 * build teardrops for a board, and the list of the three sets (round, rect,
 * track ends).
 */

import { pcbIUScale } from '@ziroeda/common/eda_units.js';

// IDs for targets when creating teardrops
export enum TARGET_TD {
  TARGET_UNKNOWN = -1,
  TARGET_ROUND = 0,
  TARGET_RECT = 1,
  TARGET_TRACK = 2,
  TARGET_COUNT = 3,
}

export const { TARGET_UNKNOWN, TARGET_ROUND, TARGET_RECT, TARGET_TRACK, TARGET_COUNT } = TARGET_TD;

/**
 * TEARDROP_PARAMETARS is a helper class to handle parameters needed to build teardrops
 * for a board
 * these parameters are sizes and filters
 */
export class TEARDROP_PARAMETERS {
  /// max allowed length for teardrops in IU. <= 0 to disable
  m_TdMaxLen: number;
  /// max allowed height for teardrops in IU. <= 0 to disable
  m_TdMaxWidth: number;
  /// The length of a teardrop as ratio between length and size of pad/via
  m_BestLengthRatio: number;
  /// The height of a teardrop as ratio between height and size of pad/via
  m_BestWidthRatio: number;
  /// The ratio (H/D) between the via/pad size and the track width max value to create a teardrop
  /// 1.0 (100 %) always creates a teardrop, 0.0 (0%) never create a teardrop
  m_WidthtoSizeFilterRatio: number;
  /// True if the teardrop should be curved
  m_CurvedEdges: boolean;
  /// Flag to enable teardrops
  m_Enabled: boolean;
  /// True to create teardrops using 2 track segments if the first in too small
  m_AllowUseTwoTracks: boolean;
  /// A filter to exclude pads inside zone fills
  m_TdOnPadsInZones: boolean;

  constructor() {
    this.m_TdMaxLen = pcbIUScale.mmToIU(1.0);
    this.m_TdMaxWidth = pcbIUScale.mmToIU(2.0);
    this.m_BestLengthRatio = 0.5;
    this.m_BestWidthRatio = 1.0;
    this.m_WidthtoSizeFilterRatio = 0.9;
    this.m_CurvedEdges = false;
    this.m_Enabled = false;
    this.m_AllowUseTwoTracks = true;
    this.m_TdOnPadsInZones = false;
  }

  /** The copy the C++ value semantics give. */
  clone(): TEARDROP_PARAMETERS {
    const c = new TEARDROP_PARAMETERS();
    c.assign(this);
    return c;
  }

  assign(aOther: TEARDROP_PARAMETERS): this {
    this.m_TdMaxLen = aOther.m_TdMaxLen;
    this.m_TdMaxWidth = aOther.m_TdMaxWidth;
    this.m_BestLengthRatio = aOther.m_BestLengthRatio;
    this.m_BestWidthRatio = aOther.m_BestWidthRatio;
    this.m_WidthtoSizeFilterRatio = aOther.m_WidthtoSizeFilterRatio;
    this.m_CurvedEdges = aOther.m_CurvedEdges;
    this.m_Enabled = aOther.m_Enabled;
    this.m_AllowUseTwoTracks = aOther.m_AllowUseTwoTracks;
    this.m_TdOnPadsInZones = aOther.m_TdOnPadsInZones;
    return this;
  }

  /**
   * Set max allowed length and height for teardrops in IU.
   * a value <= 0 disable the constraint
   */
  SetTeardropMaxSize(aMaxLen: number, aMaxHeight: number): void {
    this.m_TdMaxLen = aMaxLen;
    this.m_TdMaxWidth = aMaxHeight;
  }

  /**
   * Set prefered length and height ratio for teardrops
   * the prefered length and height are VIAPAD width * aLenghtRatio and
   * VIAPAD width * aHeightRatio
   */
  SetTeardropSizeRatio(aLenghtRatio = 0.5, aHeightRatio = 1.0): void {
    this.m_BestLengthRatio = aLenghtRatio;
    this.m_BestWidthRatio = aHeightRatio;
  }

  equals(aOther: TEARDROP_PARAMETERS): boolean {
    return (
      this.m_Enabled === aOther.m_Enabled &&
      this.m_AllowUseTwoTracks === aOther.m_AllowUseTwoTracks &&
      this.m_TdMaxLen === aOther.m_TdMaxLen &&
      this.m_TdMaxWidth === aOther.m_TdMaxWidth &&
      this.m_BestLengthRatio === aOther.m_BestLengthRatio &&
      this.m_BestWidthRatio === aOther.m_BestWidthRatio &&
      this.m_CurvedEdges === aOther.m_CurvedEdges &&
      this.m_WidthtoSizeFilterRatio === aOther.m_WidthtoSizeFilterRatio &&
      this.m_TdOnPadsInZones === aOther.m_TdOnPadsInZones
    );
  }
}

/**
 * TEARDROP_PARAMETERS_LIST is a helper class to handle the list of TEARDROP_PARAMETERS
 * needed  to build teardrops of different shapes (round, rect, tracks)
 */
export class TEARDROP_PARAMETERS_LIST {
  private m_params_list: TEARDROP_PARAMETERS[] = [];

  /// True to create teardrops for vias
  m_TargetVias: boolean;
  /// True to create teardrops for pads with holes
  m_TargetPTHPads: boolean;
  /// True to create teardrops for pads SMD, edge connectors,
  m_TargetSMDPads: boolean;
  /// True to create teardrops at the end of a track connected to the end of
  /// another track having a different width
  m_TargetTrack2Track: boolean;
  /// True to create teardrops for round shapes only
  m_UseRoundShapesOnly: boolean;

  constructor() {
    this.m_TargetVias = true;
    this.m_TargetPTHPads = true;
    this.m_TargetSMDPads = true;
    this.m_TargetTrack2Track = false;
    this.m_UseRoundShapesOnly = false;

    this.m_params_list.push(new TEARDROP_PARAMETERS()); // parameters for TARGET_ROUND
    this.m_params_list.push(new TEARDROP_PARAMETERS()); // parameters for TARGET_RECT
    this.m_params_list.push(new TEARDROP_PARAMETERS()); // parameters for TARGET_TRACK
  }

  /**
   * @return the TEARDROP_PARAMETERS for aTdType target item
   */
  GetParameters(aTdType: TARGET_TD): TEARDROP_PARAMETERS {
    const p = this.m_params_list[aTdType];

    if (!p) throw new RangeError('out_of_range'); // std::vector::at

    return p;
  }

  /**
   * @return the number of TEARDROP_PARAMETERS item. Should be 3
   */
  GetParametersCount(): number {
    return this.m_params_list.length;
  }
}

const TARGET_NAME_ROUND = 'td_round_shape';
const TARGET_NAME_RECT = 'td_rect_shape';
const TARGET_NAME_TRACK = 'td_track_end';

/**
 * @return the canonical name of a target type of a TEARDROP_PARAMETERS
 * @param aTdType is the target type
 */
export function GetTeardropTargetCanonicalName(aTdType: TARGET_TD): string {
  // return the canonical name of the target aTdType
  let name = '';

  switch (aTdType) {
    case TARGET_TD.TARGET_ROUND:
      name = TARGET_NAME_ROUND;
      break;
    case TARGET_TD.TARGET_RECT:
      name = TARGET_NAME_RECT;
      break;
    case TARGET_TD.TARGET_TRACK:
      name = TARGET_NAME_TRACK;
      break;
    default:
      break;
  }

  return name;
}

/**
 * @return the target type from a canonical name of a TEARDROP_PARAMETERS
 * @param aTargetName is the canonical name
 */
export function GetTeardropTargetTypeFromCanonicalName(aTargetName: string): TARGET_TD {
  // return the target type from the canonical name
  if (aTargetName === TARGET_NAME_ROUND) return TARGET_TD.TARGET_ROUND;

  if (aTargetName === TARGET_NAME_RECT) return TARGET_TD.TARGET_RECT;

  if (aTargetName === TARGET_NAME_TRACK) return TARGET_TD.TARGET_TRACK;

  return TARGET_TD.TARGET_UNKNOWN;
}
