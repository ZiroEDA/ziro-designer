// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board layer identifiers, the pcbnew layer model (pcbnew/layer_ids.h / lset).
 * KiCad's PCB_LAYER_ID is an enum of int ids; this port keeps the canonical
 * string layer names (`F.Cu`, `B.SilkS`, …) that appear in the file as the id,
 * which is what our board model already uses.
 */

export type PCB_LAYER_ID = string;

// ---------------------------------------------------------------------------
// The numeric ids
//
// The string name above is the id our board model uses, but the *file* stores
// both: `(layers (0 "F.Cu" signal) …)` is a numeric id, a name and a kind, and
// anything that writes a `(layers …)` block from scratch needs the numbers.
// They also carry the arithmetic KiCad leans on — copper is even, non-copper is
// odd, inner copper is `B_Cu + 2n` — which no string can.

/** `PCB_LAYER_ID::UNDEFINED_LAYER` (`include/layer_ids.h:61`). */
export const UNDEFINED_LAYER = -1;
/** `PCB_LAYER_ID::UNSELECTED_LAYER` (`include/layer_ids.h:62`). */
export const UNSELECTED_LAYER = -2;
/** `PCB_LAYER_ID_COUNT` (`include/layer_ids.h:171`). */
export const PCB_LAYER_ID_COUNT = 128;
/** `MAX_CU_LAYERS` (`include/layer_ids.h:175`). */
export const MAX_CU_LAYERS = 32;

/**
 * `enum PCB_LAYER_ID` (`include/layer_ids.h:59-171`), verbatim.
 *
 * [data] KiCad's own numbering, and the one it has used since the v9 layer-id
 * change: copper on the even ids and everything else on the odd ones. It is
 * NOT the pre-v9 numbering (F.Cu = 0, B.Cu = 31, B.Adhes = 32 …) that older
 * files carry — a 20240928-or-later board uses these.
 */
export const F_Cu = 0;
export const B_Cu = 2;
export const F_Mask = 1;
export const B_Mask = 3;
export const F_SilkS = 5;
export const B_SilkS = 7;
export const F_Adhes = 9;
export const B_Adhes = 11;
export const F_Paste = 13;
export const B_Paste = 15;
export const Dwgs_User = 17;
export const Cmts_User = 19;
export const Eco1_User = 21;
export const Eco2_User = 23;
export const Edge_Cuts = 25;
export const Margin = 27;
export const B_CrtYd = 29;
export const F_CrtYd = 31;
export const B_Fab = 33;
export const F_Fab = 35;
export const Rescue = 37;
/** The first user-definable layer, `User_1` (`include/layer_ids.h:124`). */
export const User_1 = 39;

/**
 * `In1_Cu = 4 … In30_Cu = 62`, which the enum spells out one line at a time.
 * The relation is `In<n>_Cu == B_Cu + 2n`, and `LSET::Name` inverts it with
 * `(aLayerId - B_Cu) / 2` — so generating the rows is reading the same table,
 * not inventing a different one.
 */
export function In_Cu(n: number): number {
  return B_Cu + 2 * n;
}

/**
 * `IsPcbLayer` (`include/layer_ids.h:666`).
 */
export function IsPcbLayer(aLayer: number): boolean {
  return aLayer >= F_Cu && aLayer < PCB_LAYER_ID_COUNT;
}

/**
 * `IsCopperLayer` (`include/layer_ids.h:677`) — the even ids, which is the
 * whole test upstream makes.
 */
export function IsCopperLayer(aLayerId: number): boolean {
  return !(aLayerId & 1) && aLayerId < PCB_LAYER_ID_COUNT && aLayerId >= 0;
}

/** `IsExternalCopperLayer` (`include/layer_ids.h:687`). */
export function IsExternalCopperLayer(aLayerId: number): boolean {
  return aLayerId === F_Cu || aLayerId === B_Cu;
}

/** `IsInnerCopperLayer` (`include/layer_ids.h:699`). */
export function IsInnerCopperLayer(aLayerId: number): boolean {
  return IsCopperLayer(aLayerId) && !IsExternalCopperLayer(aLayerId);
}

/**
 * `CopperLayerToOrdinal` (`include/layer_ids.h:913`) — the position of a
 * copper layer in the stack, counting from the front.
 */
export function CopperLayerToOrdinal(aLayer: number): number {
  if (aLayer === F_Cu) return 0;
  if (aLayer === B_Cu) return MAX_CU_LAYERS - 1;
  return (aLayer - B_Cu) / 2;
}

/**
 * `LSET::Name( PCB_LAYER_ID )` (`common/lset.cpp:435-505`), the canonical token
 * a layer is written as. The explicit cases are a switch upstream; the two
 * computed defaults — `In%d.Cu` for an unnamed even id and `User.%d` for an
 * unnamed odd one — are the same arithmetic it does.
 */
export function LSET_Name(aLayerId: number): PCB_LAYER_ID {
  const named: Readonly<Record<number, string>> = {
    [F_Cu]: 'F.Cu',
    [B_Cu]: 'B.Cu',
    [B_Adhes]: 'B.Adhes',
    [F_Adhes]: 'F.Adhes',
    [B_Paste]: 'B.Paste',
    [F_Paste]: 'F.Paste',
    [B_SilkS]: 'B.SilkS',
    [F_SilkS]: 'F.SilkS',
    [B_Mask]: 'B.Mask',
    [F_Mask]: 'F.Mask',
    [Dwgs_User]: 'Dwgs.User',
    [Cmts_User]: 'Cmts.User',
    [Eco1_User]: 'Eco1.User',
    [Eco2_User]: 'Eco2.User',
    [Edge_Cuts]: 'Edge.Cuts',
    [Margin]: 'Margin',
    [F_CrtYd]: 'F.CrtYd',
    [B_CrtYd]: 'B.CrtYd',
    [F_Fab]: 'F.Fab',
    [B_Fab]: 'B.Fab',
    [Rescue]: 'Rescue',
  };
  const hit = named[aLayerId];
  if (hit !== undefined) return hit;
  if (aLayerId < 0) return 'UNDEFINED';
  if (aLayerId & 1) return `User.${(aLayerId - Rescue) / 2}`;
  return `In${(aLayerId - B_Cu) / 2}.Cu`;
}

/**
 * `LSET::AllCuMask( int aCuLayerCount )` (`common/lset.cpp:599`) as the LSET's
 * own copper iteration order, which is what a caller printing the set wants.
 *
 * Two things upstream folds together here. `allCuMask` fills the set from
 * `LAYER_RANGE( F_Cu, B_Cu, aCuLayerCount )` — F.Cu, then the inner layers,
 * then B.Cu — and `LSET::copper_layers_iterator` (`common/lset.cpp:838-885`)
 * then walks it F.Cu → In1 → In2 → … and reaches **B.Cu last**, because
 * `next_copper_layer` steps 0 → 4 → 6 → … and only wraps to `B_Cu` when it
 * runs off the end of the bitset. So B.Cu is the final `(N B.Cu signal)` row,
 * not the second one, on any board with inner layers.
 */
export function AllCuMask(aCuLayerCount: number): number[] {
  const out = [F_Cu];
  for (let n = 1; n <= aCuLayerCount - 2; n++) out.push(In_Cu(n));
  if (aCuLayerCount >= 2) out.push(B_Cu);
  return out;
}

/**
 * `LSET::AllTechMask()` = `BackTechMask() | FrontTechMask()`
 * (`common/lset.cpp:646-681`), in the ascending order the non-copper iterator
 * (`common/lset.cpp:909-915`, `++m_index` over the odd bits) yields.
 */
export const AllTechMask: readonly number[] = [
  F_Mask,
  B_Mask,
  F_SilkS,
  B_SilkS,
  F_Adhes,
  B_Adhes,
  F_Paste,
  B_Paste,
  B_CrtYd,
  F_CrtYd,
  B_Fab,
  F_Fab,
];

/**
 * `LSET::TechAndUserUIOrder()`'s explicit head (`common/lset.cpp:276-300`) —
 * an `LSEQ::Seq()` over a written-out list, so this order is the file's own and
 * not the ascending id order the tech mask above is in. B before F on adhesive,
 * paste and silkscreen; F before B on courtyard and fab.
 */
export const TECH_AND_USER_UI_ORDER: readonly number[] = [
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
];

/**
 * `User_1 … User_45` — the tail `TechAndUserUIOrder` appends by walking the
 * non-copper (odd) ids and keeping every one `>= User_1` (`:303-307`).
 *
 * Forty-five of them, because `User_45` is 127 and `PCB_LAYER_ID_COUNT` is 128
 * (`include/layer_ids.h:124-171`). `Rescue` is 37 and so falls below the test,
 * which is why it is in the set a selector shows and never in its list.
 */
export const USER_DEFINED_LAYERS: readonly number[] = Array.from(
  { length: (PCB_LAYER_ID_COUNT - 1 - User_1) / 2 + 1 },
  (_, i) => User_1 + i * 2,
);

/**
 * The layers a `PCB_LAYER_BOX_SELECTOR` lists, in the order it lists them —
 * `Resync()` (`pcbnew/pcb_layer_box_selector.cpp:57-101`):
 *
 *     LSET show = ( LSET::AllCuMask() | LSET::AllNonCuMask() ) & ~m_layerMaskDisable;
 *     for( PCB_LAYER_ID layerid : show.UIOrder() )
 *
 * with `UIOrder()` being `CuStack()` then `TechAndUserUIOrder()`
 * (`common/lset.cpp:743-751`). `AllNonCuMask()` is every ODD id, so the set is
 * the 32 copper layers plus all 64 odd ones, and what survives `UIOrder` is 95
 * rows: F.Cu, In1…In30, B.Cu, the eighteen tech/user layers, then User.1…45.
 *
 * The rows are NOT filtered to a board's enabled layers here. That is
 * `getEnabledLayers()`, which returns `LSET::AllLayersMask()` whenever the
 * selector has no board frame (`:129-136`) — and every layer cell on the
 * footprint editor's Preferences pages is built with `nullptr` for the frame
 * (`panel_fp_editor_field_defaults.cpp:189-201`), so those show the lot.
 *
 * @param aNotAllowed `SetNotAllowedLayerSet( m_mask )` — the layers to leave
 *   out, which is the only thing that differs between two such selectors.
 */
export function LayerSelectorUIOrder(aNotAllowed: Iterable<number> = []): number[] {
  const off = new Set(aNotAllowed);
  return [...AllCuMask(MAX_CU_LAYERS), ...TECH_AND_USER_UI_ORDER, ...USER_DEFINED_LAYERS].filter(
    (id) => !off.has(id),
  );
}

/** `LSET::UserMask()` (`common/lset.cpp:690-694`), ascending as above. */
export const UserMask: readonly number[] = [
  Dwgs_User,
  Cmts_User,
  Eco1_User,
  Eco2_User,
  Edge_Cuts,
  Margin,
];

/**
 * The layer on the opposite board side, KiCad BOARD::FlipLayer (board.cpp:958),
 * whose front/back opposites all swap the `F.`/`B.` prefix for a standard stack
 * (common/lset.cpp). Inner and single-sided user layers are their own opposite.
 */
export function FlipLayer(aLayer: PCB_LAYER_ID): PCB_LAYER_ID {
  if (aLayer.startsWith('F.')) return `B.${aLayer.slice(2)}`;
  if (aLayer.startsWith('B.')) return `F.${aLayer.slice(2)}`;
  return aLayer;
}

/**
 * The "English Standard" display name of a board layer, KiCad `LayerName()`
 * (`common/layer_id.cpp:24`). It is NOT the canonical token the file stores:
 * ten layers spell out in the UI what the file abbreviates — `F.SilkS` shows
 * as `F.Silkscreen`, `Dwgs.User` as `User.Drawings` — while inner copper
 * (`In%d.Cu`) and user layers (`User.%d`) render exactly as their token does.
 *
 * [data] Transcribed from that switch, not invented. Only the entries that
 * differ from the token are listed; anything absent is its own name.
 */
const STANDARD_LAYER_NAMES: Readonly<Record<string, string>> = {
  'B.Adhes': 'B.Adhesive',
  'F.Adhes': 'F.Adhesive',
  'B.SilkS': 'B.Silkscreen',
  'F.SilkS': 'F.Silkscreen',
  'Dwgs.User': 'User.Drawings',
  'Cmts.User': 'User.Comments',
  'Eco1.User': 'User.Eco1',
  'Eco2.User': 'User.Eco2',
  'F.CrtYd': 'F.Courtyard',
  'B.CrtYd': 'B.Courtyard',
};

/**
 * KiCad `LayerName()` / `BOARD::GetStandardLayerName()` (`pcbnew/board.h:909`,
 * which is just a call through to the former).
 */
export function LayerName(aLayer: PCB_LAYER_ID): string {
  return STANDARD_LAYER_NAMES[aLayer] ?? aLayer;
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
export function GetLayerName(aLayers: readonly NamedLayer[], aLayer: PCB_LAYER_ID): string {
  const def = aLayers.find((l) => l.name === aLayer);
  if (def && def.userName !== undefined && def.userName !== '') return def.userName;
  return LayerName(aLayer);
}
