// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `.kicad_mod` writing: `PCB_IO_KICAD_SEXPR::FootprintSave`
 * (pcb_io_kicad_sexpr.cpp:3362) — the footprint is cloned, turned upright and
 * onto the front, detached and cleared of nets, then `Format`ted with
 * `CTL_FOR_LIBRARY` — over the footprint's class.
 */
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import type { BOARD } from './board.js';
import type { FOOTPRINT } from './footprint.js';
import { footprintOfView } from './pcb_io/kicad_sexpr/board_view.js';
import { FormatFootprintForLibrary } from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PcbFootprint } from './types.js';

export { FLIP_DIRECTION };

export interface SerializeFootprintOptions {
  /**
   * `PCBNEW_SETTINGS::m_FlipDirection`, the "Flip board items L/R" editing
   * preference, which decides how a back-side footprint is brought to the
   * front for its library file. `TOP_BOTTOM` is the setting's own default.
   */
  flipDirection?: FLIP_DIRECTION;
  /**
   * The board the footprint is flipped against (`GetBoard()->FlipLayer`): its
   * copper count and layer table. The Footprint Editor's holder board is a
   * plain two-layer BOARD with no user-layer pairing.
   */
  board?: BOARD;
}

/**
 * What `FootprintSave` does to its clone before `Format` (:3449-3462):
 *
 *     footprint->SetOrientation( ANGLE_0 );
 *     if( footprint->GetLayer() != F_Cu )
 *         footprint->Flip( footprint->GetPosition(), cfg->m_FlipDirection );
 *     footprint->SetParent( nullptr ); footprint->SetParentGroup( nullptr );
 *     footprint->ClearAllNets();
 *
 * "It's orientation should be zero and it should be on the front layer."
 */
export function footprintSaveClone(
  footprint: FOOTPRINT,
  aFlipDirection: FLIP_DIRECTION = FLIP_DIRECTION.TOP_BOTTOM,
): void {
  footprint.SetOrientation(ANGLE_0);

  if (footprint.GetLayer() !== PCB_LAYER_ID.F_Cu)
    footprint.Flip(footprint.GetPosition(), aFlipDirection);

  // Detach it from the board and its group
  footprint.SetParent(null);
  footprint.SetParentGroup(null);

  // Now that the clone is detached from its parent board, any m_netinfo pointers its
  // descendants still carry reference NETINFO_ITEMs owned by that board and may dangle.
  // Force them all to the board-independent ORPHANED singleton before serialization.
  footprint.ClearAllNets();
}

/** Serialize a footprint to `.kicad_mod` text, the bytes `FootprintSave` writes. */
export function serializeFootprint(fp: PcbFootprint, opts: SerializeFootprintOptions = {}): string {
  // "I need my own copy for the cache": FOOTPRINT::Clone() with the view's edits over it.
  const footprint = footprintOfView(fp, opts.board);
  footprintSaveClone(footprint, opts.flipDirection ?? FLIP_DIRECTION.TOP_BOTTOM);
  return FormatFootprintForLibrary(footprint);
}
