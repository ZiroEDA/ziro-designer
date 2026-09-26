// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/lset.h` / `common/lset.cpp`: `LSET`, a set of PCB_LAYER_IDs. It is
 * a `BASE_SET` of `PCB_LAYER_ID_COUNT` bits, with the orderings the file
 * format and the UI depend on — `Seq()` is id order, `CuStack()` is front to
 * back through the inner layers, `TechAndUserUIOrder()` the fixed technical
 * order and then the user layers — and the named masks as statics.
 *
 * Iterating an `LSET` yields its set layers (`all_set_layers_iterator`);
 * `copperLayers()` and `nonCopperLayers()` are the two custom iterators.
 */

import { BASE_SET } from './base_set.js';
import { IsCopperLayer, MAX_CU_LAYERS, MAX_USER_DEFINED_LAYERS, PCB_LAYER_ID } from './layer_id.js';
import { LAYER_RANGE } from './layer_range.js';
import type { LSEQ } from './lseq.js';

export type { LSEQ } from './lseq.js';

export class LSET extends BASE_SET {
  constructor();
  constructor(aOther: BASE_SET);
  constructor(aList: readonly PCB_LAYER_ID[]);
  constructor(aRange: LAYER_RANGE);
  constructor(a?: BASE_SET | readonly PCB_LAYER_ID[] | LAYER_RANGE) {
    if (a instanceof BASE_SET) {
      super(a);
    } else if (a instanceof LAYER_RANGE) {
      // `LSET( const LAYER_RANGE& )` does not delegate to `LSET()`, so its BASE_SET is the
      // default 64-bit one. Every copper layer is below 64, so the range fits.
      super();

      for (const layer of a) {
        if (layer >= 0) this.set(layer);
      }
    } else {
      super(PCB_LAYER_ID.PCB_LAYER_ID_COUNT); // all bits are set to zero in BASE_SET()

      if (a) {
        for (const layer of a) {
          if (layer >= 0) this.set(layer);
        }
      }
    }
  }

  /**
   * See if the layer set contains a PCB layer.
   *
   * @param aLayer is the layer to check
   * @return true if the layer is included
   */
  Contains(aLayer: PCB_LAYER_ID): boolean {
    // At the moment, LSET cannot store negative layers, but PCB_LAYER_ID can contain them
    if (aLayer < 0) return false;

    try {
      return this.test(aLayer);
    } catch (e) {
      if (e instanceof RangeError) return false;

      throw e;
    }
  }

  /**
   * See if the layer set contains all the layers in another set.
   *
   * @param aLayers is the set of layers to check
   * @return true if all the layers are included
   */
  ContainsAll(aLayers: LSET): boolean {
    return aLayers.is_subset_of(this);
  }

  /**
   * Return the fixed name association with aLayerId.
   */
  static Name(aLayerId: PCB_LAYER_ID): string {
    let txt: string;

    // using a switch to explicitly show the mapping more clearly
    switch (aLayerId) {
      case PCB_LAYER_ID.F_Cu:
        txt = 'F.Cu';
        break;
      case PCB_LAYER_ID.B_Cu:
        txt = 'B.Cu';
        break;

      // Technicals
      case PCB_LAYER_ID.B_Adhes:
        txt = 'B.Adhes';
        break;
      case PCB_LAYER_ID.F_Adhes:
        txt = 'F.Adhes';
        break;
      case PCB_LAYER_ID.B_Paste:
        txt = 'B.Paste';
        break;
      case PCB_LAYER_ID.F_Paste:
        txt = 'F.Paste';
        break;
      case PCB_LAYER_ID.B_SilkS:
        txt = 'B.SilkS';
        break;
      case PCB_LAYER_ID.F_SilkS:
        txt = 'F.SilkS';
        break;
      case PCB_LAYER_ID.B_Mask:
        txt = 'B.Mask';
        break;
      case PCB_LAYER_ID.F_Mask:
        txt = 'F.Mask';
        break;

      // Users
      case PCB_LAYER_ID.Dwgs_User:
        txt = 'Dwgs.User';
        break;
      case PCB_LAYER_ID.Cmts_User:
        txt = 'Cmts.User';
        break;
      case PCB_LAYER_ID.Eco1_User:
        txt = 'Eco1.User';
        break;
      case PCB_LAYER_ID.Eco2_User:
        txt = 'Eco2.User';
        break;
      case PCB_LAYER_ID.Edge_Cuts:
        txt = 'Edge.Cuts';
        break;
      case PCB_LAYER_ID.Margin:
        txt = 'Margin';
        break;

      // Footprint
      case PCB_LAYER_ID.F_CrtYd:
        txt = 'F.CrtYd';
        break;
      case PCB_LAYER_ID.B_CrtYd:
        txt = 'B.CrtYd';
        break;
      case PCB_LAYER_ID.F_Fab:
        txt = 'F.Fab';
        break;
      case PCB_LAYER_ID.B_Fab:
        txt = 'B.Fab';
        break;

      // Rescue
      case PCB_LAYER_ID.Rescue:
        txt = 'Rescue';
        break;

      default:
        if (aLayerId < 0) {
          txt = 'UNDEFINED';
        } else if (aLayerId & 1) {
          const offset = Math.trunc((aLayerId - PCB_LAYER_ID.Rescue) / 2);

          txt = `User.${offset}`;
        } else {
          const offset = Math.trunc((aLayerId - PCB_LAYER_ID.B_Cu) / 2);

          txt = `In${offset}.Cu`;
        }
    }

    return txt;
  }

  /**
   * Return the layer number from a layer name.
   */
  static NameToLayer(aName: string): number {
    const layerMap = new Map<string, PCB_LAYER_ID>([
      ['F.Cu', PCB_LAYER_ID.F_Cu],
      ['B.Cu', PCB_LAYER_ID.B_Cu],
      ['F.Adhes', PCB_LAYER_ID.F_Adhes],
      ['B.Adhes', PCB_LAYER_ID.B_Adhes],
      ['F.Paste', PCB_LAYER_ID.F_Paste],
      ['B.Paste', PCB_LAYER_ID.B_Paste],
      ['F.SilkS', PCB_LAYER_ID.F_SilkS],
      ['B.SilkS', PCB_LAYER_ID.B_SilkS],
      ['F.Mask', PCB_LAYER_ID.F_Mask],
      ['B.Mask', PCB_LAYER_ID.B_Mask],
      ['Dwgs.User', PCB_LAYER_ID.Dwgs_User],
      ['Cmts.User', PCB_LAYER_ID.Cmts_User],
      ['Eco1.User', PCB_LAYER_ID.Eco1_User],
      ['Eco2.User', PCB_LAYER_ID.Eco2_User],
      ['Edge.Cuts', PCB_LAYER_ID.Edge_Cuts],
      ['Margin', PCB_LAYER_ID.Margin],
      ['F.CrtYd', PCB_LAYER_ID.F_CrtYd],
      ['B.CrtYd', PCB_LAYER_ID.B_CrtYd],
      ['F.Fab', PCB_LAYER_ID.F_Fab],
      ['B.Fab', PCB_LAYER_ID.B_Fab],
      ['Rescue', PCB_LAYER_ID.Rescue],
      ['B.Cu', PCB_LAYER_ID.B_Cu],
    ]);

    const hit = layerMap.get(aName);

    if (hit !== undefined) return hit;

    if (aName.startsWith('User.')) {
      const offset = wxToLong(aName.slice(5));

      if (offset !== null && offset > 0) return PCB_LAYER_ID.User_1 + (offset - 1) * 2;
    }

    if (aName.startsWith('In')) {
      let str_num = aName.slice(2);
      str_num = str_num.slice(0, Math.max(0, str_num.length - 3)); // Removes .Cu

      const offset = wxToLong(str_num);

      if (offset !== null && offset > 0) return PCB_LAYER_ID.In1_Cu + (offset - 1) * 2;
    }

    return -1;
  }

  /**
   * Check if a layer is between two other layers.
   */
  static IsBetween(aStart: PCB_LAYER_ID, aEnd: PCB_LAYER_ID, aLayer: PCB_LAYER_ID): boolean {
    if (aLayer === aStart || aLayer === aEnd) return true;

    const start = Math.min(aStart, aEnd);
    let end = Math.max(aStart, aEnd);
    const layer: number = aLayer;

    if (end === PCB_LAYER_ID.B_Cu) {
      //Reassign the end layer to the largest possible positive even number
      end = 2147483647 & ~1;
    }

    return !(layer & 1) && layer >= start && layer <= end;
  }

  /**
   * Return a complete set of internal copper layers which is all Cu layers
   * except F_Cu and B_Cu.
   */
  static InternalCuMask(): LSET {
    return s_internalCuMask;
  }

  /**
   * Return a complete set of all top assembly layers which is all F_SilkS and F_Mask
   */
  static FrontAssembly(): LSET {
    return s_frontAssembly;
  }

  /**
   * Return a complete set of all bottom assembly layers which is all B_SilkS and B_Mask
   */
  static BackAssembly(): LSET {
    return s_backAssembly;
  }

  /**
   * Return a mask holding the requested number of Cu PCB_LAYER_IDs.
   */
  static AllCuMask(aCuLayerCount?: number): LSET {
    if (aCuLayerCount === undefined) return s_savedMax;

    if (aCuLayerCount === MAX_CU_LAYERS) return s_savedMax;

    return allCuMask(aCuLayerCount);
  }

  /**
   * Return a mask holding the Front and Bottom layers.
   */
  static ExternalCuMask(): LSET {
    return s_externalCuMask;
  }

  /**
   * Return a mask holding all layer minus CU layers.
   */
  static AllNonCuMask(): LSET {
    return s_allNonCuMask;
  }

  static AllLayersMask(): LSET {
    return s_allLayersMask;
  }

  /**
   * Return a mask holding all technical layers (no CU layer) on front side.
   */
  static FrontTechMask(): LSET {
    return s_frontTechMask;
  }

  /**
   * Return a mask holding technical layers used in a board fabrication
   * (no CU layer) on front side.
   */
  static FrontBoardTechMask(): LSET {
    return s_frontBoardTechMask;
  }

  /**
   * Return a mask holding all technical layers (no CU layer) on back side.
   */
  static BackTechMask(): LSET {
    return s_backTechMask;
  }

  /**
   * Return a mask holding technical layers used in a board fabrication
   * (no CU layer) on Back side.
   */
  static BackBoardTechMask(): LSET {
    return s_backBoardTechMask;
  }

  /**
   * Return a mask holding all technical layers (no CU layer) on both side.
   */
  static AllTechMask(): LSET {
    return s_allTechMask;
  }

  /**
   * Return a mask holding board technical layers (no CU layer) on both side.
   */
  static AllBoardTechMask(): LSET {
    return s_allBoardTechMask;
  }

  /**
   * Return a mask holding all technical layers and the external CU layer on front side.
   */
  static FrontMask(): LSET {
    return s_frontMask;
  }

  /**
   * Return a mask holding all technical layers and the external CU layer on back side.
   */
  static BackMask(): LSET {
    return s_backMask;
  }

  static SideSpecificMask(): LSET {
    return s_sideSpecificMask;
  }

  static UserMask(): LSET {
    return s_userMask;
  }

  /**
   * Return a mask holding all layers which are physically realized.  Equivalent to the copper
   * layers + the board tech mask.
   */
  static PhysicalLayersMask(): LSET {
    return s_physicalLayersMask;
  }

  /**
   * Return a mask with the requested number of user defined layers.
   */
  static UserDefinedLayersMask(aUserDefinedLayerCount: number = MAX_USER_DEFINED_LAYERS): LSET {
    const ret = new LSET();
    let layer: number = PCB_LAYER_ID.User_1;

    for (let ulayer = 1; ulayer <= aUserDefinedLayerCount; ulayer++) {
      if (layer > ret.size()) break;

      ret.set(layer);
      layer += 2;
    }

    return ret;
  }

  /**
   * Return a sequence of copper layers in starting from the front/top
   * and extending to the back/bottom.  This specific sequence is depended upon
   * in numerous places.
   */
  CuStack(): LSEQ {
    const ret: LSEQ = [];

    for (const layer of this.copperLayers()) ret.push(layer);

    return ret;
  }

  /**
   * Returns the technical and user layers in the order shown in layer widget
   */
  TechAndUserUIOrder(): LSEQ {
    let ret: LSEQ = [];

    ret = this.Seq([
      PCB_LAYER_ID.F_Adhes,
      PCB_LAYER_ID.B_Adhes,
      PCB_LAYER_ID.F_Paste,
      PCB_LAYER_ID.B_Paste,
      PCB_LAYER_ID.F_SilkS,
      PCB_LAYER_ID.B_SilkS,
      PCB_LAYER_ID.F_Mask,
      PCB_LAYER_ID.B_Mask,
      PCB_LAYER_ID.Dwgs_User,
      PCB_LAYER_ID.Cmts_User,
      PCB_LAYER_ID.Eco1_User,
      PCB_LAYER_ID.Eco2_User,
      PCB_LAYER_ID.Edge_Cuts,
      PCB_LAYER_ID.Margin,
      PCB_LAYER_ID.F_CrtYd,
      PCB_LAYER_ID.B_CrtYd,
      PCB_LAYER_ID.F_Fab,
      PCB_LAYER_ID.B_Fab,
    ]);

    for (const layer of this.nonCopperLayers()) {
      if (layer >= PCB_LAYER_ID.User_1) ret.push(layer);
    }

    return ret;
  }

  /**
   * Returns the copper, technical and user layers in the order shown in layer widget
   */
  UIOrder(): LSEQ {
    const order = this.CuStack();
    const techuser = this.TechAndUserUIOrder();

    order.push(...techuser);
    return order;
  }

  /**
   * Return an LSEQ from the union of this LSET and a desired sequence.  The LSEQ
   * element will be in the same sequence as aWishListSequence if they are present.
   * @param aWishListSequence establishes the order of the returned LSEQ, and the LSEQ will only
   * contain PCB_LAYER_IDs which are present in this set.
   */
  Seq(aSequence?: readonly PCB_LAYER_ID[]): LSEQ {
    if (aSequence !== undefined) {
      const ret: LSEQ = [];

      for (const layer of aSequence) {
        if (this.test(layer)) ret.push(layer);
      }

      return ret;
    }

    const ret: LSEQ = [];

    for (let i = 0; i < this.size(); ++i) {
      if (this.test(i)) ret.push(i as PCB_LAYER_ID);
    }

    return ret;
  }

  /**
   * Generate a sequence of layers that represent a top to bottom stack of this set of layers.
   *
   * @param aSelectedLayer is the layer to put at the top of stack when defined.
   *
   * @return the top to bottom layer sequence.
   */
  SeqStackupTop2Bottom(aSelectedLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER): LSEQ {
    const base_sequence = this.Seq([
      PCB_LAYER_ID.Edge_Cuts,
      PCB_LAYER_ID.Margin,
      PCB_LAYER_ID.Dwgs_User,
      PCB_LAYER_ID.Cmts_User,
      PCB_LAYER_ID.Eco1_User,
      PCB_LAYER_ID.Eco2_User,
    ]);

    const top_tech_sequence = this.Seq([
      PCB_LAYER_ID.F_Fab,
      PCB_LAYER_ID.F_SilkS,
      PCB_LAYER_ID.F_Paste,
      PCB_LAYER_ID.F_Adhes,
      PCB_LAYER_ID.F_Mask,
      PCB_LAYER_ID.F_CrtYd,
    ]);

    const bottom_tech_sequence = this.Seq([
      PCB_LAYER_ID.B_CrtYd,
      PCB_LAYER_ID.B_Mask,
      PCB_LAYER_ID.B_Adhes,
      PCB_LAYER_ID.B_Paste,
      PCB_LAYER_ID.B_SilkS,
      PCB_LAYER_ID.B_Fab,
    ]);

    const seq = this.Seq(base_sequence);

    for (const layer of this.nonCopperLayers()) {
      if (layer >= PCB_LAYER_ID.User_1) seq.push(layer);
    }

    seq.push(...top_tech_sequence);

    for (const layer of this.copperLayers()) seq.push(layer);

    seq.push(...bottom_tech_sequence);

    if (aSelectedLayer !== PCB_LAYER_ID.UNDEFINED_LAYER) {
      const it = seq.indexOf(aSelectedLayer);

      if (it >= 0) {
        seq.splice(it, 1);
        seq.unshift(aSelectedLayer);
      }
    }

    return seq;
  }

  /**
   * Return the sequence that is typical for a bottom-to-top stack-up.
   * For instance, to plot multiple layers in a single image, the top layers output last.
   */
  SeqStackupForPlotting(): LSEQ {
    // bottom-to-top stack-up layers
    // Note that the bottom technical layers are flipped so that when plotting a bottom-side view,
    // they appear in the correct sequence.
    const bottom_tech_sequence = this.Seq([
      PCB_LAYER_ID.B_Cu,
      PCB_LAYER_ID.B_Mask,
      PCB_LAYER_ID.B_Paste,
      PCB_LAYER_ID.B_SilkS,
      PCB_LAYER_ID.B_Adhes,
      PCB_LAYER_ID.B_CrtYd,
      PCB_LAYER_ID.B_Fab,
    ]);

    // Copper layers go here

    const top_tech_sequence = this.Seq([
      PCB_LAYER_ID.F_Mask,
      PCB_LAYER_ID.F_Paste,
      PCB_LAYER_ID.F_SilkS,
      PCB_LAYER_ID.F_Adhes,
      PCB_LAYER_ID.F_CrtYd,
      PCB_LAYER_ID.F_Fab,
    ]);

    const user_sequence = this.Seq([
      PCB_LAYER_ID.Dwgs_User,
      PCB_LAYER_ID.Cmts_User,
      PCB_LAYER_ID.Eco1_User,
      PCB_LAYER_ID.Eco2_User,
    ]);

    // User layers go here

    const base_sequence = this.Seq([PCB_LAYER_ID.Margin, PCB_LAYER_ID.Edge_Cuts]);

    const seq = this.Seq(bottom_tech_sequence);

    let temp_layers: PCB_LAYER_ID[] = [];

    // We are going to reverse the copper layers and then add them to the sequence
    // because the plotting order is bottom-to-top
    for (const layer of this.copperLayers()) {
      // Skip B_Cu because it is already in the sequence (if it exists)
      if (layer !== PCB_LAYER_ID.B_Cu) temp_layers.push(layer);
    }

    for (let ii = temp_layers.length - 1; ii >= 0; --ii) seq.push(temp_layers[ii]!);

    seq.push(...top_tech_sequence);
    seq.push(...user_sequence);

    temp_layers = [];

    for (const layer of this.nonCopperLayers()) {
      if (layer >= PCB_LAYER_ID.User_1) temp_layers.push(layer);
    }

    for (let ii = temp_layers.length - 1; ii >= 0; --ii) seq.push(temp_layers[ii]!);

    seq.push(...base_sequence);

    return seq;
  }

  /**
   * Execute a function on each layer of the LSET.
   */
  RunOnLayers(aFunction: (aLayer: PCB_LAYER_ID) => void): void {
    for (let ii = 0; ii < this.size(); ++ii) {
      if (this.test(ii)) aFunction(ii as PCB_LAYER_ID);
    }
  }

  /**
   * Find the first set PCB_LAYER_ID. Returns UNDEFINED_LAYER if more
   * than one is set or UNSELECTED_LAYER if none is set.
   */
  ExtractLayer(): PCB_LAYER_ID {
    const set_count = this.count();

    if (!set_count) return PCB_LAYER_ID.UNSELECTED_LAYER;
    else if (set_count > 1) return PCB_LAYER_ID.UNDEFINED_LAYER;

    for (let i = 0; i < this.size(); ++i) {
      if (this.test(i)) return i as PCB_LAYER_ID;
    }

    console.assert(false); // set_count was verified as 1 above, what did you break?

    return PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  /**
   * Flip the layers in this set.
   *
   * BACK and FRONT copper layers, mask, paste, solder layers are swapped
   * internal layers are flipped only if the copper layers count is known
   * @param aMask = the LSET to flip
   * @param aCopperLayersCount = the number of copper layers. if 0 (in fact if < 4 )
   *  internal layers will be not flipped because the layer count is not known
   */
  FlipStandardLayers(aCopperLayersCount = 0): this {
    const oldMask = new LSET(this);

    this.reset();

    // Mapping for Copper and Non-Copper layers
    const flip_map: [PCB_LAYER_ID, PCB_LAYER_ID][] = [
      [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu],
      [PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.F_Cu],
      [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.B_SilkS],
      [PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.F_SilkS],
      [PCB_LAYER_ID.F_Adhes, PCB_LAYER_ID.B_Adhes],
      [PCB_LAYER_ID.B_Adhes, PCB_LAYER_ID.F_Adhes],
      [PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask],
      [PCB_LAYER_ID.B_Mask, PCB_LAYER_ID.F_Mask],
      [PCB_LAYER_ID.F_Paste, PCB_LAYER_ID.B_Paste],
      [PCB_LAYER_ID.B_Paste, PCB_LAYER_ID.F_Paste],
      [PCB_LAYER_ID.F_CrtYd, PCB_LAYER_ID.B_CrtYd],
      [PCB_LAYER_ID.B_CrtYd, PCB_LAYER_ID.F_CrtYd],
      [PCB_LAYER_ID.F_Fab, PCB_LAYER_ID.B_Fab],
      [PCB_LAYER_ID.B_Fab, PCB_LAYER_ID.F_Fab],
    ];

    for (const [first, second] of flip_map) {
      if (oldMask.test(first)) this.set(second);

      oldMask.set(first, false);
    }

    if (aCopperLayersCount >= 4) {
      const internalMask = oldMask.and(LSET.InternalCuMask());
      const innerLayerCount = aCopperLayersCount - 2;

      for (let ii = 1; ii <= innerLayerCount; ii++) {
        if (internalMask.test((innerLayerCount - ii + 1) * 2 + PCB_LAYER_ID.B_Cu)) {
          this.set(ii * 2 + PCB_LAYER_ID.B_Cu);
        }
      }
    }

    oldMask.ClearCopperLayers();

    // Copy across any remaining, non-side-specific layers
    for (const layer of oldMask) this.set(layer);

    return this;
  }

  /**
   * Return the number of layers between aStart and aEnd, inclusive.
   */
  static LayerCount(aStart: PCB_LAYER_ID, aEnd: PCB_LAYER_ID, aCopperLayerCount: number): number {
    let start: number = aStart;
    let end: number = aEnd;

    // Both layers need to be copper
    if (!(IsCopperLayer(aStart) && IsCopperLayer(aEnd))) return aCopperLayerCount;

    if (aStart === PCB_LAYER_ID.B_Cu) [start, end] = [end, start];

    if (aStart === aEnd) return 1;

    if (aStart === PCB_LAYER_ID.F_Cu) {
      if (aEnd === PCB_LAYER_ID.B_Cu) return aCopperLayerCount;
      else return Math.trunc((end - start) / 2) - 1;
    } else if (aEnd === PCB_LAYER_ID.B_Cu) {
      // Add 1 for the B_Cu layer
      return aCopperLayerCount - Math.trunc(start / 2) + 1;
    }

    return Math.trunc((end - start) / 2);
  }

  /**
   * Clear the copper layers in this set.
   */
  ClearCopperLayers(): this {
    for (let ii = 0; ii < this.size(); ii += 2) this.reset(ii);

    return this;
  }

  /**
   * Clear the non-copper layers in this set.
   */
  ClearNonCopperLayers(): this {
    for (let ii = 1; ii < this.size(); ii += 2) this.reset(ii);

    return this;
  }

  /**
   * Clear the user-defined layers in this set.
   */
  ClearUserDefinedLayers(): this {
    for (let ii: number = PCB_LAYER_ID.User_1; ii < this.size(); ii += 2) this.reset(ii);

    return this;
  }

  /** `all_set_layers_iterator`: every set layer, ascending. */
  *[Symbol.iterator](): IterableIterator<PCB_LAYER_ID> {
    for (const i of this.setBits()) yield i as PCB_LAYER_ID;
  }

  /**
   * `copper_layers_iterator`: the set copper layers in stack order — F_Cu, then the inner
   * layers ascending, and B_Cu last, because `next_copper_layer` steps 0 → 4 → 6 → … and only
   * wraps to B_Cu when it runs off the end of the bitset.
   */
  *copperLayers(): IterableIterator<PCB_LAYER_ID> {
    const size = this.size();
    let m_index = (0 + 1) & ~1;

    const next_copper_layer = (): void => {
      if (m_index === PCB_LAYER_ID.F_Cu) {
        m_index += 4;
      } else if (m_index === PCB_LAYER_ID.B_Cu) {
        m_index = size;
        return;
      } else {
        m_index += 2;

        if (m_index >= size) m_index = PCB_LAYER_ID.B_Cu;
      }
    };

    const advance_to_next_set_copper_bit = (): void => {
      while (m_index < size && !this.test(m_index)) next_copper_layer();
    };

    advance_to_next_set_copper_bit();

    while (m_index < size) {
      yield m_index as PCB_LAYER_ID;
      next_copper_layer();
      advance_to_next_set_copper_bit();
    }
  }

  /** `non_copper_layers_iterator`: the set odd (non-copper) layers, ascending. */
  *nonCopperLayers(): IterableIterator<PCB_LAYER_ID> {
    const size = this.size();
    let m_index = 0;

    const advance_to_next_set_non_copper_bit = (): void => {
      while (m_index < size && (m_index % 2 !== 1 || !this.test(m_index))) ++m_index;
    };

    advance_to_next_set_non_copper_bit();

    while (m_index < size) {
      yield m_index as PCB_LAYER_ID;
      ++m_index;
      advance_to_next_set_non_copper_bit();
    }
  }
}

/** `wxString::ToLong`: the whole string must be a (signed) decimal integer. */
function wxToLong(aStr: string): number | null {
  if (!/^[+-]?\d+$/.test(aStr)) return null;

  return Number.parseInt(aStr, 10);
}

function allCuMask(aCuLayerCount: number): LSET {
  const ret = new LSET();

  for (const layer of new LAYER_RANGE(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, aCuLayerCount))
    ret.set(layer);

  return ret;
}

function allNonCuMask(): LSET {
  const mask = new LSET().set();

  for (const layer of [...mask.copperLayers()]) mask.reset(layer);

  return mask;
}

// The `static LSET saved` of each mask accessor.
const s_frontAssembly = new LSET([
  PCB_LAYER_ID.F_SilkS,
  PCB_LAYER_ID.F_Mask,
  PCB_LAYER_ID.F_Fab,
  PCB_LAYER_ID.F_CrtYd,
]);
const s_backAssembly = new LSET([
  PCB_LAYER_ID.B_SilkS,
  PCB_LAYER_ID.B_Mask,
  PCB_LAYER_ID.B_Fab,
  PCB_LAYER_ID.B_CrtYd,
]);
const s_internalCuMask = new LSET([
  PCB_LAYER_ID.In1_Cu,
  PCB_LAYER_ID.In2_Cu,
  PCB_LAYER_ID.In3_Cu,
  PCB_LAYER_ID.In4_Cu,
  PCB_LAYER_ID.In5_Cu,
  PCB_LAYER_ID.In6_Cu,
  PCB_LAYER_ID.In7_Cu,
  PCB_LAYER_ID.In8_Cu,
  PCB_LAYER_ID.In9_Cu,
  PCB_LAYER_ID.In10_Cu,
  PCB_LAYER_ID.In11_Cu,
  PCB_LAYER_ID.In12_Cu,
  PCB_LAYER_ID.In13_Cu,
  PCB_LAYER_ID.In14_Cu,
  PCB_LAYER_ID.In15_Cu,
  PCB_LAYER_ID.In16_Cu,
  PCB_LAYER_ID.In17_Cu,
  PCB_LAYER_ID.In18_Cu,
  PCB_LAYER_ID.In19_Cu,
  PCB_LAYER_ID.In20_Cu,
  PCB_LAYER_ID.In21_Cu,
  PCB_LAYER_ID.In22_Cu,
  PCB_LAYER_ID.In23_Cu,
  PCB_LAYER_ID.In24_Cu,
  PCB_LAYER_ID.In25_Cu,
  PCB_LAYER_ID.In26_Cu,
  PCB_LAYER_ID.In27_Cu,
  PCB_LAYER_ID.In28_Cu,
  PCB_LAYER_ID.In29_Cu,
  PCB_LAYER_ID.In30_Cu,
]);
const s_savedMax = allCuMask(MAX_CU_LAYERS);
const s_allNonCuMask = allNonCuMask();
const s_externalCuMask = new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]);
const s_allLayersMask = new LSET().set();
const s_backTechMask = new LSET([
  PCB_LAYER_ID.B_SilkS,
  PCB_LAYER_ID.B_Mask,
  PCB_LAYER_ID.B_Adhes,
  PCB_LAYER_ID.B_Paste,
  PCB_LAYER_ID.B_CrtYd,
  PCB_LAYER_ID.B_Fab,
]);
const s_backBoardTechMask = new LSET([
  PCB_LAYER_ID.B_SilkS,
  PCB_LAYER_ID.B_Mask,
  PCB_LAYER_ID.B_Adhes,
  PCB_LAYER_ID.B_Paste,
]);
const s_frontTechMask = new LSET([
  PCB_LAYER_ID.F_SilkS,
  PCB_LAYER_ID.F_Mask,
  PCB_LAYER_ID.F_Adhes,
  PCB_LAYER_ID.F_Paste,
  PCB_LAYER_ID.F_CrtYd,
  PCB_LAYER_ID.F_Fab,
]);
const s_frontBoardTechMask = new LSET([
  PCB_LAYER_ID.F_SilkS,
  PCB_LAYER_ID.F_Mask,
  PCB_LAYER_ID.F_Adhes,
  PCB_LAYER_ID.F_Paste,
]);
const s_allTechMask = s_backTechMask.or(s_frontTechMask);
const s_allBoardTechMask = s_backBoardTechMask.or(s_frontBoardTechMask);
const s_userMask = new LSET([
  PCB_LAYER_ID.Dwgs_User,
  PCB_LAYER_ID.Cmts_User,
  PCB_LAYER_ID.Eco1_User,
  PCB_LAYER_ID.Eco2_User,
  PCB_LAYER_ID.Edge_Cuts,
  PCB_LAYER_ID.Margin,
]);
const s_physicalLayersMask = s_allBoardTechMask.or(s_savedMax);
const s_frontMask = new LSET(s_frontTechMask).set(PCB_LAYER_ID.F_Cu);
const s_backMask = new LSET(s_backTechMask).set(PCB_LAYER_ID.B_Cu);
const s_sideSpecificMask = s_backTechMask.or(s_frontTechMask).or(s_savedMax);
