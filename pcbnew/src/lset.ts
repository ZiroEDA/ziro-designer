// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LSET` (common/lset.cpp, include/lset.h, include/base_set.h): a set of
 * `PCB_LAYER_ID`s as a 128-bit bitset, with the orderings the file format
 * depends on — `Seq()` is id order, `CuStack()` is front to back through the
 * inner layers, `TechAndUserUIOrder()` is the fixed technical order and then
 * the user layers — and `FmtHex`/`ParseHex`, the form `pcbplotparams` stores
 * a layer selection in.
 *
 * Also `LAYER_RANGE` (include/layer_range.h), the copper walk the pad and via
 * formatters take: F_Cu, In1_Cu … In(n-2)_Cu, B_Cu.
 */
import {
  B_Adhes,
  B_CrtYd,
  B_Cu,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  Cmts_User,
  Dwgs_User,
  Eco1_User,
  Eco2_User,
  Edge_Cuts,
  F_Adhes,
  F_CrtYd,
  F_Cu,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  In_Cu,
  LSET_Name,
  LSET_NameToLayer,
  Margin,
  MAX_CU_LAYERS,
  PCB_LAYER_ID_COUNT,
  UNDEFINED_LAYER,
  User_1,
} from './layer_ids.js';

/** `LSEQ`: an ordered list of layer ids. */
export type LSEQ = number[];

const SIZE = PCB_LAYER_ID_COUNT;
const ALL = (1n << BigInt(SIZE)) - 1n;

export class LSET {
  private bits: bigint;

  constructor(layers?: Iterable<number> | bigint) {
    if (typeof layers === 'bigint') this.bits = layers & ALL;
    else {
      this.bits = 0n;
      if (layers) for (const l of layers) this.set(l);
    }
  }

  /** The bit count, `BASE_SET::size()`. */
  size(): number {
    return SIZE;
  }

  clone(): LSET {
    return new LSET(this.bits);
  }

  set(layer?: number, value = true): this {
    if (layer === undefined) {
      this.bits = ALL;
      return this;
    }
    if (layer < 0 || layer >= SIZE) return this;
    const m = 1n << BigInt(layer);
    this.bits = value ? this.bits | m : this.bits & ~m;
    return this;
  }

  reset(layer?: number): this {
    if (layer === undefined) {
      this.bits = 0n;
      return this;
    }
    return this.set(layer, false);
  }

  test(layer: number): boolean {
    if (layer < 0 || layer >= SIZE) return false;
    return (this.bits & (1n << BigInt(layer))) !== 0n;
  }

  any(): boolean {
    return this.bits !== 0n;
  }

  none(): boolean {
    return this.bits === 0n;
  }

  count(): number {
    let n = 0;
    let b = this.bits;
    while (b) {
      b &= b - 1n;
      n++;
    }
    return n;
  }

  equals(other: LSET): boolean {
    return this.bits === other.bits;
  }

  and(other: LSET): LSET {
    return new LSET(this.bits & other.bits);
  }

  or(other: LSET): LSET {
    return new LSET(this.bits | other.bits);
  }

  xor(other: LSET): LSET {
    return new LSET(this.bits ^ other.bits);
  }

  not(): LSET {
    return new LSET(~this.bits & ALL);
  }

  /** `a &= ~b` */
  andNot(other: LSET): LSET {
    return new LSET(this.bits & ~other.bits);
  }

  /** `Seq()`: every set layer in id order. */
  Seq(): LSEQ;
  /** `Seq( aSequence )`: the given layers, in the given order, that are set. */
  Seq(sequence: readonly number[]): LSEQ;
  Seq(sequence?: readonly number[]): LSEQ {
    if (sequence) return sequence.filter((l) => this.test(l));
    const ret: LSEQ = [];
    for (let i = 0; i < SIZE; i++) if (this.test(i)) ret.push(i);
    return ret;
  }

  /** `CuStack()`: the set copper layers front to back — F_Cu, the inners in order, B_Cu. */
  CuStack(): LSEQ {
    const ret: LSEQ = [];
    if (this.test(F_Cu)) ret.push(F_Cu);
    for (let l = 4; l < SIZE; l += 2) if (this.test(l)) ret.push(l);
    if (this.test(B_Cu)) ret.push(B_Cu);
    return ret;
  }

  /** The set non-copper layers in id order (the odd ids). */
  NonCuSeq(): LSEQ {
    const ret: LSEQ = [];
    for (let i = 1; i < SIZE; i += 2) if (this.test(i)) ret.push(i);
    return ret;
  }

  /** `TechAndUserUIOrder()`. */
  TechAndUserUIOrder(): LSEQ {
    const ret = this.Seq([
      F_Adhes,
      B_Adhes,
      F_Paste,
      B_Paste,
      F_SilkS,
      B_SilkS,
      F_Mask,
      B_Mask,
      Dwgs_User,
      Cmts_User,
      Eco1_User,
      Eco2_User,
      Edge_Cuts,
      Margin,
      F_CrtYd,
      B_CrtYd,
      F_Fab,
      B_Fab,
    ]);
    for (const l of this.NonCuSeq()) if (l >= User_1) ret.push(l);
    return ret;
  }

  /** `UIOrder()`: the copper stack, then the technical and user layers. */
  UIOrder(): LSEQ {
    return [...this.CuStack(), ...this.TechAndUserUIOrder()];
  }

  /** `ExtractLayer()`: the one set layer, UNDEFINED_LAYER for none, UNSELECTED_LAYER (-2) for several. */
  ExtractLayer(): number {
    let found = UNDEFINED_LAYER;
    for (let i = 0; i < SIZE; i++) {
      if (!this.test(i)) continue;
      if (found !== UNDEFINED_LAYER) return -2;
      found = i;
    }
    return found;
  }

  /**
   * `BASE_SET::FmtHex()`: the bits as hex, least significant nibble last,
   * an underscore every eight nibbles from the right.
   */
  FmtHex(): string {
    const hex = '0123456789abcdef';
    let ret = '';
    const nibbleCount = (SIZE + 3) >> 2;
    for (let nibble = 0; nibble < nibbleCount; ++nibble) {
      let ndx = 0;
      for (let nibbleBit = 0; nibbleBit < 4; ++nibbleBit) {
        const pos = nibbleBit + nibble * 4;
        if (pos >= SIZE) break;
        if (this.test(pos)) ndx |= 1 << nibbleBit;
      }
      if (nibble && !(nibble % 8)) ret += '_';
      ret += hex[ndx];
    }
    return [...ret].reverse().join('');
  }

  /**
   * `BASE_SET::ParseHex()`: replaces this set's bits with the hex given, read
   * from the right; `_` markers are skipped, any other non-hex byte stops the
   * parse. Returns the number of bytes consumed.
   */
  ParseHex(str: string): number {
    let bits = 0n;
    let nibbleNdx = 0;
    let consumed = 0;
    for (let i = str.length - 1; i >= 0; i--) {
      const c = str[i]!;
      consumed++;
      if (c === '_') continue;
      let nibble: number;
      if (c >= '0' && c <= '9') nibble = c.charCodeAt(0) - 48;
      else if (c >= 'a' && c <= 'f') nibble = c.charCodeAt(0) - 97 + 10;
      else if (c >= 'A' && c <= 'F') nibble = c.charCodeAt(0) - 65 + 10;
      else {
        consumed--;
        break;
      }
      let bit = nibbleNdx * 4;
      for (let ndx = 0; bit < SIZE && ndx < 4; ++bit, ++ndx) {
        if (nibble & (1 << ndx)) bits |= 1n << BigInt(bit);
      }
      ++nibbleNdx;
    }
    this.bits = bits;
    return consumed;
  }

  static Name(layer: number): string {
    return LSET_Name(layer);
  }

  static NameToLayer(name: string): number {
    return LSET_NameToLayer(name);
  }

  /** `LSET::AllCuMask( aCuLayerCount )`. */
  static AllCuMask(cuLayerCount = MAX_CU_LAYERS): LSET {
    const ret = new LSET();
    for (const l of LAYER_RANGE(F_Cu, B_Cu, cuLayerCount)) ret.set(l);
    return ret;
  }

  static InternalCuMask(): LSET {
    const ret = new LSET();
    for (let n = 1; n <= 30; n++) ret.set(In_Cu(n));
    return ret;
  }

  static ExternalCuMask(): LSET {
    return new LSET([F_Cu, B_Cu]);
  }

  static AllNonCuMask(): LSET {
    const mask = new LSET().set();
    for (let l = 0; l < SIZE; l += 2) mask.reset(l);
    return mask;
  }

  static AllLayersMask(): LSET {
    return new LSET().set();
  }

  static BackTechMask(): LSET {
    return new LSET([B_SilkS, B_Mask, B_Adhes, B_Paste, B_CrtYd, B_Fab]);
  }

  static BackBoardTechMask(): LSET {
    return new LSET([B_SilkS, B_Mask, B_Adhes, B_Paste]);
  }

  static FrontTechMask(): LSET {
    return new LSET([F_SilkS, F_Mask, F_Adhes, F_Paste, F_CrtYd, F_Fab]);
  }

  static FrontBoardTechMask(): LSET {
    return new LSET([F_SilkS, F_Mask, F_Adhes, F_Paste]);
  }

  static AllTechMask(): LSET {
    return LSET.BackTechMask().or(LSET.FrontTechMask());
  }

  static AllBoardTechMask(): LSET {
    return LSET.BackBoardTechMask().or(LSET.FrontBoardTechMask());
  }

  static UserMask(): LSET {
    return new LSET([Dwgs_User, Cmts_User, Eco1_User, Eco2_User, Edge_Cuts, Margin]);
  }

  static PhysicalLayersMask(): LSET {
    return LSET.AllBoardTechMask().or(LSET.AllCuMask());
  }

  static UserDefinedLayersMask(userDefinedLayerCount: number): LSET {
    const ret = new LSET();
    let layer = User_1;
    for (let u = 1; u <= userDefinedLayerCount; u++) {
      if (layer > SIZE) break;
      ret.set(layer);
      layer += 2;
    }
    return ret;
  }

  static FrontMask(): LSET {
    return LSET.FrontTechMask().set(F_Cu);
  }

  static BackMask(): LSET {
    return LSET.BackTechMask().set(B_Cu);
  }

  static SideSpecificMask(): LSET {
    return LSET.BackTechMask().or(LSET.FrontTechMask()).or(LSET.AllCuMask());
  }
}

/**
 * `LAYER_RANGE( aStart, aStop, aLayerCount )` (include/layer_range.h): the
 * copper layers from `start` to `stop` through the stack of a board with
 * `layerCount` copper layers, in stack order.
 */
export function LAYER_RANGE(start: number, stop: number, layerCount: number): LSEQ {
  const lastInner = layerCount >= 3 ? F_Cu + 2 * (layerCount - 2) + 2 : UNDEFINED_LAYER;
  const forward = (l: number): number => {
    if (l === F_Cu && layerCount === 2) return B_Cu;
    if (l === stop || l === UNDEFINED_LAYER) return UNDEFINED_LAYER;
    if (l === lastInner) return B_Cu;
    if (l === F_Cu) return In_Cu(1);
    if (l === B_Cu) return UNDEFINED_LAYER;
    return l + 2;
  };
  const ret: LSEQ = [];
  for (let l = start; l !== UNDEFINED_LAYER; l = forward(l)) {
    ret.push(l);
    if (l === stop) break;
  }
  return ret;
}
