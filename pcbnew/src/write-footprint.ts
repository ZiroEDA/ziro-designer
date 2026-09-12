// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `.kicad_mod` writing: `PCB_IO_KICAD_SEXPR::FootprintSave`
 * (pcb_io_kicad_sexpr.cpp:3362) — the footprint is cloned, turned upright and
 * onto the front, detached and cleared of nets, then `Format`ted with
 * `CTL_FOR_LIBRARY` — over the footprint's model.
 */
import { kfootprintFromView } from './pcb_io/kicad_sexpr/board_view.js';
import {
  FLIP_DIRECTION,
  type FlipBoard,
  footprintSaveClone,
} from './pcb_io/kicad_sexpr/kicad_footprint_ops.js';
import { FormatFootprintFile } from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
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
  board?: FlipBoard;
}

const HOLDER_BOARD: FlipBoard = { copperLayerCount: 2, layerDescrs: new Map() };

/** Serialize a footprint to `.kicad_mod` text, the bytes `FootprintSave` writes. */
export function serializeFootprint(fp: PcbFootprint, opts: SerializeFootprintOptions = {}): string {
  const board = opts.board ?? HOLDER_BOARD;
  const k = kfootprintFromView(fp, board.copperLayerCount);
  footprintSaveClone(k, board, opts.flipDirection ?? FLIP_DIRECTION.TOP_BOTTOM);
  return FormatFootprintFile(k);
}
