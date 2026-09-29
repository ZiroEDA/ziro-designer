// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/autorouter/autoplace_tool.cpp`: AUTOPLACE_TOOL, the two Autoplace
 * actions (`PCB_ACTIONS::autoplaceSelectedComponents`,
 * `autoplaceOffboardComponents`) that drive AR_AUTOPLACER.
 *
 * The board here is a value, so the BOARD_COMMIT is the return: `board` is the
 * pushed result on completion, and the untouched input where KiCad calls
 * `commit.Revert()`. The view-refresh callback, the overlay and the progress
 * reporter have no counterpart in a synchronous call and are not ported.
 */
import { parseBoardItemId } from '../edit-board.js';
import type { Board } from '../types.js';
import {
  type AutoplaceOptions,
  autoplaceFootprints,
  boardEdgesBoundingBox,
  boardOutlineRings,
} from './ar_autoplacer.js';

export interface AutoplaceToolResult {
  board: Board;
  /** `AUTOPLACE_TOOL::autoplace` showed its infobar error, or the placer failed and reverted. */
  error?: string;
  /** True when the commit was pushed (`AR_COMPLETED`). */
  pushed: boolean;
}

/** `SHAPE_POLY_SET::Contains` over the outline rings: an even-odd crossing count. */
function ringsContain(rings: readonly { x: number; y: number }[][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
  }
  return inside;
}

export class AUTOPLACE_TOOL {
  /** `frame()->GetOverrideLocks()`. */
  constructor(
    private readonly m_overrideLocks: boolean,
    private readonly m_options: AutoplaceOptions,
  ) {}

  /** `AUTOPLACE_TOOL::autoplace`: `aFootprints` are footprint indices. */
  autoplace(aBoard: Board, aFootprints: number[]): AutoplaceToolResult {
    const bbox = boardEdgesBoundingBox(aBoard);

    if (!bbox || bbox.w === 0 || bbox.h === 0) {
      return {
        board: aBoard,
        pushed: false,
        error: 'Board edges must be defined on the Edge.Cuts layer.',
      };
    }

    let footprints = aFootprints;

    if (!this.m_overrideLocks) footprints = footprints.filter((i) => !aBoard.footprints[i]?.locked);

    const result = autoplaceFootprints(aBoard, footprints, this.m_options);

    if (result.status === 'completed') return { board: result.board, pushed: true };

    return { board: aBoard, pushed: false };
  }

  /** `AUTOPLACE_TOOL::autoplaceSelected`: `aSelection` is a set of board item ids. */
  autoplaceSelected(aBoard: Board, aSelection: Iterable<string>): AutoplaceToolResult {
    const footprints: number[] = [];

    for (const id of aSelection) {
      const ref = parseBoardItemId(id);
      if (ref?.kind === 'footprint') footprints.push(ref.index);
    }

    return this.autoplace(aBoard, footprints);
  }

  /** `AUTOPLACE_TOOL::autoplaceOffboard`: every footprint whose position is off the board outline. */
  autoplaceOffboard(aBoard: Board): AutoplaceToolResult {
    const rings = boardOutlineRings(aBoard);
    const footprints: number[] = [];

    aBoard.footprints.forEach((fp, i) => {
      if (!ringsContain(rings, fp.at.x, fp.at.y)) footprints.push(i);
    });

    return this.autoplace(aBoard, footprints);
  }
}
