// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Wrap a single library footprint as a one-item BOARD so the existing
 * PCB_PAINTER pipeline (renderBoard.ts) can draw it unchanged.
 *
 * This mirrors KiCad exactly: `FOOTPRINT_EDIT_FRAME` is a `PCB_BASE_EDIT_FRAME`
 * that owns a `BOARD` holding the one footprint being edited (see
 * `footprint_edit_frame.cpp`, `GetBoard()->Add( footprint )`). The footprint is
 * placed at the board origin (0,0, 0°), so its stored local coordinates are also
 * its board coordinates and no transform is applied.
 */

import { parse } from '@ziroeda/sexpr';
import { EMPTY_SOURCE } from '@ziroeda/eeschema';
import { settings, type FpEditSettings } from '../../prefs/settings.js';
import {
  readFootprintFile,
  type Board,
  type PcbFootprint,
  type PcbLayerDef,
} from '@ziroeda/pcbnew';

/**
 * The footprint-editor layer table — `FOOTPRINT_EDIT_FRAME::updateEnabledLayers`
 * (`pcbnew/footprint_edit_frame.cpp:538-619`), which is the one place this
 * frame decides which layers exist:
 *
 *     LSET enabledLayers = LSET::AllTechMask() | LSET::UserMask();
 *     …
 *     case FOOTPRINT_STACKUP::EXPAND_INNER_LAYERS:
 *         enabledLayers |= LSET{ F_Cu, In1_Cu, B_Cu };
 *         board.SetLayerName( In1_Cu, _( "Inner layers" ) );
 *     …
 *     enabledLayers |= LSET::UserDefinedLayersMask( userLayerCount );
 *
 * Three groups, and ours was missing two of them:
 *
 *   - **`In1_Cu`, shown as "Inner layers"** (:558-561). The default stackup mode
 *     with no footprint loaded is EXPAND_INNER_LAYERS (:582), so the row is
 *     always there. It is one row standing for all inner copper — the name is
 *     set on the board, which is why `GetLayerName` and not `LayerName` is what
 *     puts it on screen.
 *   - **`User.1` … `User.4`** — `LSET::UserDefinedLayersMask( GetUserDefined-
 *     LayerCount() )`, and that count defaults to 4
 *     (`board_design_settings.cpp:66`).
 *
 * `LSET::UserMask()` (`common/lset.cpp:690-694`) is
 * `{ Dwgs_User, Cmts_User, Eco1_User, Eco2_User, Edge_Cuts, Margin }` — the six
 * we already had — and `AllTechMask()` the twelve F/B adhesive, paste,
 * silkscreen, mask, courtyard and fab layers.
 *
 * buildScene reads copper names off this for `*.Cu` pad expansion; the
 * Appearance panel lists the rest, in `appearanceLayerRows`' order.
 */
export const FOOTPRINT_LAYERS: PcbLayerDef[] = [
  { id: 0, name: 'F.Cu', kind: 'signal' },
  // `updateEnabledLayers` calls `board.SetLayerName( In1_Cu, _( "Inner layers" ) )`
  // (`footprint_edit_frame.cpp:560`) — and the call FAILS, so the row keeps its
  // standard name. `BOARD::SetLayerName` stores nothing unless
  // `IsLayerEnabled( aLayer )` already holds (`board.cpp:755-778`), and at that
  // point in the lambda the board's enabled set has just been cleared of all
  // copper by `SetCopperLayerCount( cuLayers.count() )` with a count of 0
  // (`board_design_settings.cpp:1607-1616`); `board.SetEnabledLayers(
  // enabledLayers )` only runs 55 lines later. A live KiCad 10.0.5 footprint
  // editor with no footprint loaded agrees: the row reads "In1.Cu".
  { id: 4, name: 'In1.Cu', kind: 'signal' },
  { id: 2, name: 'B.Cu', kind: 'signal' },
  { id: 9, name: 'F.Adhes', kind: 'user', userName: 'F.Adhesive' },
  { id: 11, name: 'B.Adhes', kind: 'user', userName: 'B.Adhesive' },
  { id: 13, name: 'F.Paste', kind: 'user' },
  { id: 15, name: 'B.Paste', kind: 'user' },
  { id: 5, name: 'F.SilkS', kind: 'user', userName: 'F.Silkscreen' },
  { id: 7, name: 'B.SilkS', kind: 'user', userName: 'B.Silkscreen' },
  { id: 1, name: 'F.Mask', kind: 'user' },
  { id: 3, name: 'B.Mask', kind: 'user' },
  { id: 17, name: 'Dwgs.User', kind: 'user', userName: 'User.Drawings' },
  { id: 19, name: 'Cmts.User', kind: 'user', userName: 'User.Comments' },
  { id: 21, name: 'Eco1.User', kind: 'user', userName: 'User.Eco1' },
  { id: 23, name: 'Eco2.User', kind: 'user', userName: 'User.Eco2' },
  { id: 25, name: 'Edge.Cuts', kind: 'user' },
  { id: 27, name: 'Margin', kind: 'user' },
  { id: 31, name: 'F.CrtYd', kind: 'user', userName: 'F.Courtyard' },
  { id: 29, name: 'B.CrtYd', kind: 'user', userName: 'B.Courtyard' },
  { id: 35, name: 'F.Fab', kind: 'user' },
  { id: 33, name: 'B.Fab', kind: 'user' },
  // LSET::UserDefinedLayersMask( 4 ) — User_1 and every second id after it
  // (`common/lset.cpp:704-719`), against a default count of 4.
  { id: 39, name: 'User.1', kind: 'user' },
  { id: 41, name: 'User.2', kind: 'user' },
  { id: 43, name: 'User.3', kind: 'user' },
  { id: 45, name: 'User.4', kind: 'user' },
];

/**
 * `LSET::UserDefinedLayersMask( n )` and `BOARD::GetLayerName` — the layer set
 * a footprint editor frame actually has, which is {@link FOOTPRINT_LAYERS} with
 * its `User.n` rows re-cut from **Preferences > Footprint Editor > User Layer
 * Names**.
 *
 * Two settings, two effects, both upstream's:
 *
 *   - `design_settings.user_layer_count` decides HOW MANY `User.n` rows there
 *     are. `BOARD_DESIGN_SETTINGS::SetUserDefinedLayerCount` feeds
 *     `LSET::UserDefinedLayersMask` (`common/lset.cpp:704-719`), which is
 *     `User_1` and every second id after it, and
 *     `FOOTPRINT_EDIT_FRAME::updateEnabledLayers` enables exactly that mask.
 *   - `design_settings.default_footprint_layer_names` decides what each of them
 *     is CALLED. That map is `BOARD_DESIGN_SETTINGS::m_UserLayerNames`, keyed
 *     by the canonical name, and `BOARD::GetLayerName` returns the user name
 *     where one is set — which is why the Appearance panel, the layer selector
 *     and the layer combo in every dialog all show it.
 *
 * {@link FOOTPRINT_LAYERS} stays as it was and is still the right answer for
 * the two VIEWER frames — CVPCB's and the schematic's footprint preview — which
 * have no such preference and open on the default count of 4.
 */
export function footprintLayers(cfg: FpEditSettings = settings.fpEdit): PcbLayerDef[] {
  const count = Math.max(0, Math.min(9, cfg.design_settings.user_layer_count));
  const names = cfg.design_settings.default_footprint_layer_names;
  const out: PcbLayerDef[] = [];
  for (const l of FOOTPRINT_LAYERS) {
    const numbered = /^User\.(\d+)$/.exec(l.name);
    // A numbered user layer beyond the count is not enabled on this board.
    if (numbered && Number(numbered[1]) > count) continue;
    const userName = names[l.name];
    out.push(userName ? { ...l, userName } : l);
  }
  // ...and a count above the four this table declares needs the rest built.
  // `User_1` is id 39 and the ids step by 2 (`include/layer_ids.h:124`).
  for (let n = USER_LAYERS_IN_TABLE + 1; n <= count; n++) {
    const name = `User.${n}`;
    const userName = names[name];
    out.push({
      id: USER_1_LAYER_ID + (n - 1) * 2,
      name,
      kind: 'user',
      ...(userName ? { userName } : {}),
    });
  }
  return out;
}

/** [data] `User_1` (`include/layer_ids.h:124`), which `pcbnew/src/layer_ids.ts` also names. */
const USER_1_LAYER_ID = 39;

/** How many `User.n` rows {@link FOOTPRINT_LAYERS} spells out — the default count. */
const USER_LAYERS_IN_TABLE = 4;

/**
 * `enabled.CuStack()` for this frame (`appearance_controls.cpp:1859-1860`):
 * "show all coppers first, with front on top, back on bottom". F.Cu, then the
 * inner layers in number order, then B.Cu — the board's declaration order is
 * NOT that, since ids run F_Cu=0, B_Cu=2, In1_Cu=4.
 */
export const FOOTPRINT_COPPER_STACK: readonly string[] = [
  'F.Cu',
  ...FOOTPRINT_LAYERS.map((l) => l.name).filter((n) => /^In\d+\.Cu$/.test(n)),
  'B.Cu',
];

/**
 * Board holding just the given footprint (or empty), for the footprint canvas.
 *
 * `layers` defaults to the module table, which is what the two VIEWER frames
 * want; the EDITOR passes {@link footprintLayers} so its board carries the user
 * layers Preferences was told to give it.
 */
export function footprintToBoard(
  fp: PcbFootprint | null,
  layers: PcbLayerDef[] = FOOTPRINT_LAYERS,
): Board {
  return {
    version: 20241229,
    layers,
    nets: new Map([[0, '']]),
    footprints: fp ? [fp] : [],
    textBoxes: [],
    tables: [],
    images: [],
    dimensions: [],
    // The frame's board owns no points of its own: a footprint's snap points
    // are `FOOTPRINT::Points()` and travel inside `fp`, exactly as its pads and
    // graphics do.
    points: [],
    barcodes: [],
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    shapes: [],
    texts: [],
    groups: [],
    source: EMPTY_SOURCE,
  };
}

/** Parse `.kicad_mod` text into a footprint, or null if it isn't one. */
export function parseFootprint(text: string): PcbFootprint | null {
  try {
    return readFootprintFile(parse(text));
  } catch {
    return null;
  }
}

/**
 * `SetActiveLayer( F_SilkS )` (`pcbnew/footprint_edit_frame.cpp:191`) — the
 * layer the frame opens on. Ours opened on F.Cu, so the layer selector, the
 * status bar and any graphic drawn before the user touched the combo were all
 * on the wrong layer.
 */
export const FP_DEFAULT_ACTIVE_LAYER = 'F.SilkS';
