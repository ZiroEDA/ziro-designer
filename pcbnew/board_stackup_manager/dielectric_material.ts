// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_stackup_manager/dielectric_material.h` + `.cpp`: the
 * substrates a stackup row can name, with their εr and tanδ, for the gerber
 * job file and the Physical Stackup page.
 */
import { UIDouble2Str } from '@ziroeda/common/string_utils.js';
import {
  DEFAULT_EPSILON_R_SILKSCREEN,
  DEFAULT_EPSILON_R_SOLDERMASK,
  NotSpecifiedPrm,
} from './board_stackup.js';

/** A class to handle substrates prms in gerber job file and dialog. */
export class DIELECTRIC_SUBSTRATE {
  m_Name: string; // the name (in job file) of material
  m_EpsilonR: number; // the epsilon r of this material
  m_LossTangent: number; // the loss tangent (tanD) of this material

  constructor(aName: string, aEpsilonR: number, aLossTangent: number) {
    this.m_Name = aName;
    this.m_EpsilonR = aEpsilonR;
    this.m_LossTangent = aLossTangent;
  }

  /** return a string to print/display Epsilon R */
  FormatEpsilonR(): string {
    // note: we do not want scientific notation
    return UIDouble2Str(this.m_EpsilonR);
  }

  /** return a string to print/display Loss Tangent */
  FormatLossTangent(): string {
    // note: we do not want scientific notation
    return UIDouble2Str(this.m_LossTangent);
  }
}

export enum DL_MATERIAL_LIST_TYPE {
  DL_MATERIAL_DIELECTRIC = 0,
  DL_MATERIAL_SOLDERMASK,
  DL_MATERIAL_SILKSCREEN,
}

// A list of available substrate material
// These names are used in .gbrjob file, so they are not fully free.
// So do not change name with "used in .gbrjob file" comment.
// These names are in fact usual substrate names.
// However one can add and use other names for material name.
// DO NOT translate them, as they are proper noun
// [data] dielectric_material.cpp:33-46
const substrateMaterial = (): DIELECTRIC_SUBSTRATE[] => [
  new DIELECTRIC_SUBSTRATE(NotSpecifiedPrm(), 0.0, 0.0), // Not specified, not in .gbrjob
  new DIELECTRIC_SUBSTRATE('FR4', 4.5, 0.02), // used in .gbrjob file
  new DIELECTRIC_SUBSTRATE('FR408-HR', 3.69, 0.0091), // used in .gbrjob file
  new DIELECTRIC_SUBSTRATE('Polyimide', 3.2, 0.004), // used in .gbrjob file
  new DIELECTRIC_SUBSTRATE('Kapton', 3.2, 0.004), // used in .gbrjob file
  new DIELECTRIC_SUBSTRATE('Polyolefin', 1.0, 0.0), // used in .gbrjob file
  new DIELECTRIC_SUBSTRATE('Al', 8.7, 0.001), // used in .gbrjob file
  new DIELECTRIC_SUBSTRATE('PTFE', 2.1, 0.0002), // used in .gbrjob file
  new DIELECTRIC_SUBSTRATE('Teflon', 2.1, 0.0002), // used in .gbrjob file
  new DIELECTRIC_SUBSTRATE('Ceramic', 1.0, 0.0), // used in .gbrjob file
  // Other names are free
];

// [data] dielectric_material.cpp:49-55
const solderMaskMaterial = (): DIELECTRIC_SUBSTRATE[] => [
  new DIELECTRIC_SUBSTRATE(NotSpecifiedPrm(), DEFAULT_EPSILON_R_SOLDERMASK, 0.0), // Not specified, not in .gbrjob
  new DIELECTRIC_SUBSTRATE('Epoxy', DEFAULT_EPSILON_R_SOLDERMASK, 0.0), // Epoxy Liquid material (usual)
  new DIELECTRIC_SUBSTRATE('Liquid Ink', DEFAULT_EPSILON_R_SOLDERMASK, 0.0), // Liquid Ink Photoimageable
  new DIELECTRIC_SUBSTRATE('Dry Film', DEFAULT_EPSILON_R_SOLDERMASK, 0.0), // Dry Film Photoimageable
];

// [data] dielectric_material.cpp:58-63
const silkscreenMaterial = (): DIELECTRIC_SUBSTRATE[] => [
  new DIELECTRIC_SUBSTRATE(NotSpecifiedPrm(), DEFAULT_EPSILON_R_SILKSCREEN, 0.0), // Not specified, not in .gbrjob
  new DIELECTRIC_SUBSTRATE('Liquid Photo', DEFAULT_EPSILON_R_SILKSCREEN, 0.0), // Liquid Ink Photoimageable
  new DIELECTRIC_SUBSTRATE('Direct Printing', DEFAULT_EPSILON_R_SILKSCREEN, 0.0), // Direct Legend Printing
];

/** Handle a list of substrates prms in gerber job file and dialogs. */
export class DIELECTRIC_SUBSTRATE_LIST {
  ///< The list of available substrates. It contains at least predefined substrates
  private m_substrateList: DIELECTRIC_SUBSTRATE[] = [];

  /**
   * @param aListType set to #DL_MATERIAL_DIELECTRIC to build a dielectric material list
   *                  or #DL_MATERIAL_SOLDERMASK to build a solder mask material list.
   */
  constructor(aListType: DL_MATERIAL_LIST_TYPE) {
    // Fills the m_substrateList with predefined params:
    switch (aListType) {
      case DL_MATERIAL_LIST_TYPE.DL_MATERIAL_DIELECTRIC:
        this.m_substrateList = substrateMaterial();
        break;
      case DL_MATERIAL_LIST_TYPE.DL_MATERIAL_SOLDERMASK:
        this.m_substrateList = solderMaskMaterial();
        break;
      case DL_MATERIAL_LIST_TYPE.DL_MATERIAL_SILKSCREEN:
        this.m_substrateList = silkscreenMaterial();
        break;
    }
  }

  /** @return the number of substrates in list */
  GetCount(): number {
    return this.m_substrateList.length;
  }

  /**
   * @return the substrate in list of index aIdx if incorrect return null.
   * @param aIdx is the index in substrate list.
   */
  GetSubstrateAt(aIdx: number): DIELECTRIC_SUBSTRATE | null {
    if (aIdx >= 0 && aIdx < this.GetCount()) return this.m_substrateList[aIdx]!;

    return null;
  }

  /**
   * The comparison is case insensitive.
   * @param aName is the name of the substrate in substrate list.
   * @return the substrate in list of name aName if not found return null.
   */
  GetSubstrate(aName: string): DIELECTRIC_SUBSTRATE | null {
    for (const item of this.m_substrateList)
      if (item.m_Name.toLowerCase() === aName.toLowerCase()) return item;

    return null;
  }

  /**
   * Find a item in list similar to aItem, or having the same parameters.
   * The comparison is for the name case insensitive, and EpsilonR and LossTg must match.
   * @return the index of similar item in list or -1 if not found.
   */
  FindSubstrate(aItem: DIELECTRIC_SUBSTRATE): number;
  FindSubstrate(aName: string, aEpsilonR: number, aLossTg: number): number;
  FindSubstrate(
    aItemOrName: DIELECTRIC_SUBSTRATE | string,
    aEpsilonR?: number,
    aLossTg?: number,
  ): number {
    const name = typeof aItemOrName === 'string' ? aItemOrName : aItemOrName.m_Name;
    const epsilonR = typeof aItemOrName === 'string' ? aEpsilonR : aItemOrName.m_EpsilonR;
    const lossTg = typeof aItemOrName === 'string' ? aLossTg : aItemOrName.m_LossTangent;

    // Find a item matching parameters
    let idx = 0;

    for (const item of this.m_substrateList) {
      if (
        item.m_EpsilonR === epsilonR &&
        item.m_LossTangent === lossTg &&
        item.m_Name.toLowerCase() === name.toLowerCase()
      )
        return idx;

      ++idx;
    }

    return -1;
  }

  /**
   * Append a item in list similar to aItem.
   * @return the index of the new item in list.
   */
  AppendSubstrate(aItem: DIELECTRIC_SUBSTRATE): number {
    this.m_substrateList.push(aItem);
    return this.GetCount() - 1;
  }

  /**
   * Delete the specified item in the substrate list. `wxCHECK( aIdx > 0 ...)`:
   * index 0 is "Not specified" and is never deleted.
   * @param aIdx is the index in the substrate list to delete
   */
  DeleteSubstrate(aIdx: number): void {
    if (!(aIdx > 0 && aIdx < this.m_substrateList.length)) return;

    this.m_substrateList.splice(aIdx, 1);
  }
}
