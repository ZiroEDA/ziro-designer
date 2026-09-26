// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The pcbnew-side layer helpers over `include/layer_ids.h` / `lset.h`, which
 * live in `common/layer_ids.ts` and `common/lset.ts`. What is left
 * here is the canonical-name (`'F.Cu'`) form the plain-object board model
 * still speaks, each a delegate over the numeric one.
 */

import {
  FlipLayer as FlipLayerId,
  LayerName as LayerNameId,
  PCB_LAYER_ID,
} from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';

/**
 * The canonical layer token (`F.Cu`, `B.SilkS`, …) the plain-object board
 * model carries as its layer id.
 *
 * @deprecated KiCad's `PCB_LAYER_ID` is the numeric enum in
 * `@ziroeda/common/layer_ids.js`; the items on it use that. This alias
 * goes with the plain-object model (#636 stage 2).
 */
export type PCB_LAYER_NAME = string;

// `include/layer_ids.h` is `common`; the ids, counts and predicates come from there.
export {
  B_Adhes,
  B_CrtYd,
  B_Cu,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  Cmts_User,
  CopperLayerToOrdinal,
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
  IsCopperLayer,
  IsExternalCopperLayer,
  IsInnerCopperLayer,
  IsPcbLayer,
  Margin,
  MAX_CU_LAYERS,
  PCB_LAYER_ID_COUNT,
  Rescue,
  UNDEFINED_LAYER,
  UNSELECTED_LAYER,
  User_1,
} from '@ziroeda/common/layer_ids.js';

/**
 * `In1_Cu = 4 … In30_Cu = 62`, which the enum spells out one line at a time.
 * The relation is `In<n>_Cu == B_Cu + 2n`, and `LSET::Name` inverts it with
 * `(aLayerId - B_Cu) / 2` — so generating the rows is reading the same table,
 * not inventing a different one.
 */
export function In_Cu(n: number): number {
  return PCB_LAYER_ID.B_Cu + 2 * n;
}

/** @deprecated `LSET.Name`; this delegates. */
export function LSET_Name(aLayerId: number): PCB_LAYER_NAME {
  return LSET.Name(aLayerId as PCB_LAYER_ID);
}

/** @deprecated `LSET.NameToLayer`; this delegates. */
export function LSET_NameToLayer(aName: PCB_LAYER_NAME): number {
  return LSET.NameToLayer(aName);
}

/** @deprecated `LSET.AllCuMask( n ).CuStack()`; this delegates. */
export function AllCuMask(aCuLayerCount: number): number[] {
  return LSET.AllCuMask(aCuLayerCount).CuStack();
}

/** @deprecated `LSET.AllTechMask().Seq()`; this delegates. */
export const AllTechMask: readonly number[] = LSET.AllTechMask().Seq();

/** @deprecated the fixed head of `LSET::TechAndUserUIOrder()`; this delegates. */
export const TECH_AND_USER_UI_ORDER: readonly number[] = LSET.AllNonCuMask()
  .TechAndUserUIOrder()
  .slice(0, 18);

/** @deprecated `LSET.UserDefinedLayersMask().Seq()`; this delegates. */
export const USER_DEFINED_LAYERS: readonly number[] = LSET.UserDefinedLayersMask().Seq();

/**
 * The layers a `PCB_LAYER_BOX_SELECTOR` lists, in the order it lists them —
 * `Resync()` (`pcbnew/pcb_layer_box_selector.cpp:57-101`):
 *
 *     LSET show = ( LSET::AllCuMask() | LSET::AllNonCuMask() ) & ~m_layerMaskDisable;
 *     for( PCB_LAYER_ID layerid : show.UIOrder() )
 *
 * @param aNotAllowed `SetNotAllowedLayerSet( m_mask )` — the layers to leave out.
 */
export function LayerSelectorUIOrder(aNotAllowed: Iterable<number> = []): number[] {
  const m_layerMaskDisable = new LSET([...aNotAllowed] as PCB_LAYER_ID[]);
  const show = LSET.AllCuMask().or(LSET.AllNonCuMask()).and(m_layerMaskDisable.not());

  return show.UIOrder();
}

/** @deprecated `LSET.UserMask().Seq()`; this delegates. */
export const UserMask: readonly number[] = LSET.UserMask().Seq();

/**
 * @deprecated `FlipLayer( PCB_LAYER_ID )` in `@ziroeda/common/layer_ids.js`;
 * this is the canonical-name form over it.
 */
export function FlipLayer(aLayer: PCB_LAYER_NAME): PCB_LAYER_NAME {
  const id = LSET.NameToLayer(aLayer);

  return id < 0 ? aLayer : LSET.Name(FlipLayerId(id as PCB_LAYER_ID));
}

/**
 * @deprecated `LayerName( int )` in `@ziroeda/common/layer_ids.js`; this is
 * the canonical-name form over it (a name it does not know is its own name).
 */
export function LayerName(aLayer: PCB_LAYER_NAME): string {
  const id = LSET.NameToLayer(aLayer);

  return id < 0 ? aLayer : LayerNameId(id);
}

/** The layer half of what `GetLayerName` needs: a `PcbLayerDef`, loosely. */
export interface NamedLayer {
  name: string;
  userName?: string;
}

/**
 * The name a BOARD shows for one of its layers, KiCad `BOARD::GetLayerName()`
 * (`pcbnew/board.cpp:737`).
 *
 * "Standard names were set in BOARD::BOARD() but they may be over-ridden by
 * BOARD::SetLayerName(). For copper layers, return the user defined layer
 * name, if it was set. Otherwise return the Standard English layer name."
 *
 * The user name is the fourth token of a `(layers …)` entry, and a stock KiCad
 * board carries one on most layers — the demo boards ship `(0 "F.Cu" signal
 * "top_cu")`, which is why real pcbnew's layer list and layer selector open on
 * `top_cu` rather than `F.Cu`. Every place that puts a layer in front of the
 * user goes through here.
 */
export function GetLayerName(aLayers: readonly NamedLayer[], aLayer: PCB_LAYER_NAME): string {
  const def = aLayers.find((l) => l.name === aLayer);
  if (def && def.userName !== undefined && def.userName !== '') return def.userName;
  return LayerName(aLayer);
}
