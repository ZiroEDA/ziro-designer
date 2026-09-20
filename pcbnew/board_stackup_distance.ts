// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_STACKUP::GetLayerDistance`
 * (`pcbnew/board_stackup_manager/board_stackup.cpp`), the vertical distance a
 * via travels between two copper layers.
 *
 * It exists for one caller: `PNS_KICAD_IFACE_BASE::StackupHeight`, which the
 * router adds to a routed length when Board Setup > Constraints has "Include
 * stackup height in track length calculations" ticked. Without it a four-layer
 * board's length-tuned pair is short by the thickness of the board, once per
 * via.
 *
 * Three details of the walk are load-bearing and none is obvious:
 *
 *  - **B.Cu sorts last, not by number.** `B_Cu` is 2 in KiCad's enum and every
 *    inner layer is higher, so the swap that puts the layers in stack order has
 *    to special-case it: `if( aSecondLayer != B_Cu && ( aSecondLayer <
 *    aFirstLayer || aFirstLayer == B_Cu ) ) std::swap( … )`. Here the layers
 *    are named, so "stack order" is the order of the stackup list itself and
 *    the swap is a comparison of positions in it — which is the same answer
 *    without the enum trap.
 *  - **An internal copper layer counts HALF.** A via entering In1.Cu stops in
 *    the middle of that copper, not at its far face, so the endpoints
 *    contribute half their thickness — but only when they are internal. F.Cu
 *    and B.Cu are the outside faces and count in full.
 *  - **Silk, mask and paste are skipped**, dielectrics are not: the test is
 *    `layer != UNDEFINED_LAYER && !IsCopperLayer( layer )`, and a dielectric's
 *    layer id IS `UNDEFINED_LAYER`, so it falls through the `continue` and is
 *    counted.
 */

/** One row of `BOARD_STACKUP::GetList()`, as the Physical Stackup page holds it. */
export interface StackupDistanceItem {
  /**
   * `BOARD_STACKUP_ITEM::GetBrdLayerId()`, or undefined for a dielectric —
   * which is upstream's `UNDEFINED_LAYER` and the reason dielectrics are
   * counted rather than skipped.
   */
  layer?: string;
  /** `GetTypeName()`, so silk and paste can be told from copper and dielectric. */
  type: string;
  /** `GetThickness( sublayer )` summed over `GetSublayersCount()`, in mm. */
  thicknessMM: number;
}

/** `IsCopperLayer( aLayer )` over a canonical layer name. */
function isCopper(aLayer: string | undefined): boolean {
  return aLayer !== undefined && aLayer.endsWith('.Cu');
}

/**
 * The distance between two copper layers, in millimetres.
 *
 * @param aStack the stackup front to back, as the page lists it.
 * @param aFirst / @param aSecond canonical copper layer names. Order does not
 *   matter; a layer that is not in the stack, or a pair on the same layer,
 *   gives 0 — `if( aFirstLayer == aSecondLayer ) return 0`.
 */
export function stackupLayerDistanceMM(
  aStack: readonly StackupDistanceItem[],
  aFirst: string,
  aSecond: string,
): number {
  if (aFirst === aSecond) return 0;

  const posOf = (name: string): number => aStack.findIndex((it) => it.layer === name);
  const firstPos = posOf(aFirst);
  const secondPos = posOf(aSecond);

  if (firstPos < 0 || secondPos < 0) return 0;

  // The `std::swap` that puts them in stack order, without the B_Cu enum trap:
  // a named stack is already in order, so "earlier" is "earlier in the list".
  const [start, stop] = firstPos <= secondPos ? [aFirst, aSecond] : [aSecond, aFirst];

  // `if( aFirstLayer != F_Cu && aFirstLayer != B_Cu ) half = true` — an
  // internal endpoint contributes half its own copper.
  const isInternal = (name: string): boolean => name !== 'F.Cu' && name !== 'B.Cu';

  let total = 0;
  let started = false;
  let half = false;

  for (const item of aStack) {
    const layer = item.layer;

    // Silk / mask / paste. A dielectric has no layer id and falls through.
    if (layer !== undefined && !isCopper(layer)) continue;

    if (!started && layer === start) {
      started = true;
      if (isInternal(start)) half = true;
    } else if (!started) {
      continue;
    }

    if (started && layer === stop && isInternal(stop)) half = true;

    total += half ? item.thicknessMM / 2 : item.thicknessMM;
    half = false;

    if (layer === stop) break;
  }

  return total;
}
