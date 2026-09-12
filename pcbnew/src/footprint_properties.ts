// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint Properties (board side), headless.
 * Counterpart: `pcbnew/dialogs/dialog_footprint_properties.cpp`.
 *
 * Single-footprint, so there is no three-state fold; every field carries a
 * value. Every applied field lands on the model; the writer formats the model.
 *
 * Moving and rotating go through edit-board's own helpers rather than writing
 * `(at …)` directly: a footprint's pads, texts and graphics are stored
 * board-absolute in this model, so its anchor cannot move on its own.
 */

import {
  boardItemId,
  flipBoardItems,
  moveBoardItems,
  parseBoardItemId,
  setFootprintField,
  setFootprintOrientation,
} from './edit-board.js';
import type { Board, PcbFootprint } from './types.js';

/** FOOTPRINT_ATTR_T, in the order PCB_IO_KICAD_SEXPR writes them. */
export const FOOTPRINT_ATTRIBUTES = [
  'smd',
  'through_hole',
  'board_only',
  'exclude_from_pos_files',
  'exclude_from_bom',
  'allow_missing_courtyard',
  'dnp',
  'allow_soldermask_bridges',
] as const;

export type FootprintAttribute = (typeof FOOTPRINT_ATTRIBUTES)[number];

/** Every field the dialog edits. */
export interface FootprintValues {
  reference: string;
  value: string;
  /** Board-absolute anchor, IU. */
  x: number;
  y: number;
  /** Degrees. */
  orientation: number;
  /** Which side the footprint sits on; changing it is FOOTPRINT::Flip. */
  side: 'front' | 'back';
  locked: boolean;
  /**
   * Footprint type. `through_hole` and `smd` are mutually exclusive here, as
   * the dialog's three-way choice makes them; `unspecified` writes neither.
   */
  footprintType: 'through_hole' | 'smd' | 'unspecified';
  notInSchematic: boolean;
  doNotPopulate: boolean;
  excludeFromBom: boolean;
  excludeFromPosFiles: boolean;
  allowMissingCourtyard: boolean;
  allowSolderMaskBridges: boolean;
  /** Clearance overrides; null is "blank", meaning use the Board Setup value. */
  localClearance: number | null;
  localSolderMaskMargin: number | null;
  localSolderPasteMargin: number | null;
  localSolderPasteMarginRatio: number | null;
  zoneConnection: NonNullable<PcbFootprint['zoneConnection']>;
}

/** Resolve a `footprint:N` id, or null when the selection is not one footprint. */
export function footprintAt(board: Board, selection: Iterable<string>): number | null {
  let found: number | null = null;

  for (const id of selection) {
    const ref = parseBoardItemId(id);
    if (!ref || ref.kind !== 'footprint') continue;
    if (found !== null) return null;
    if (board.footprints[ref.index]) found = ref.index;
  }

  return found;
}

const has = (fp: PcbFootprint, attr: FootprintAttribute): boolean =>
  (fp.attributes ?? []).includes(attr);

/** DIALOG_FOOTPRINT_PROPERTIES::TransferDataToWindow. */
export function collectFootprintValues(fp: PcbFootprint): FootprintValues {
  return {
    reference: fp.reference ?? '',
    value: fp.value ?? '',
    x: fp.at.x,
    y: fp.at.y,
    orientation: fp.angle,
    side: fp.layer === 'B.Cu' ? 'back' : 'front',
    locked: fp.locked ?? false,
    footprintType: has(fp, 'smd')
      ? 'smd'
      : has(fp, 'through_hole')
        ? 'through_hole'
        : 'unspecified',
    notInSchematic: has(fp, 'board_only'),
    doNotPopulate: has(fp, 'dnp'),
    excludeFromBom: has(fp, 'exclude_from_bom'),
    excludeFromPosFiles: has(fp, 'exclude_from_pos_files'),
    allowMissingCourtyard: has(fp, 'allow_missing_courtyard'),
    allowSolderMaskBridges: has(fp, 'allow_soldermask_bridges'),
    localClearance: fp.localClearance ?? null,
    localSolderMaskMargin: fp.localSolderMaskMargin ?? null,
    localSolderPasteMargin: fp.localSolderPasteMargin ?? null,
    localSolderPasteMarginRatio: fp.localSolderPasteMarginRatio ?? null,
    zoneConnection: fp.zoneConnection ?? 'inherited',
  };
}

/** The `(attr …)` flag list a value set implies, in upstream's write order. */
export function attributesFor(v: FootprintValues): FootprintAttribute[] {
  const out: FootprintAttribute[] = [];
  if (v.footprintType === 'smd') out.push('smd');
  if (v.footprintType === 'through_hole') out.push('through_hole');
  if (v.notInSchematic) out.push('board_only');
  if (v.excludeFromPosFiles) out.push('exclude_from_pos_files');
  if (v.excludeFromBom) out.push('exclude_from_bom');
  if (v.allowMissingCourtyard) out.push('allow_missing_courtyard');
  if (v.doNotPopulate) out.push('dnp');
  if (v.allowSolderMaskBridges) out.push('allow_soldermask_bridges');
  return out;
}

/**
 * DIALOG_FOOTPRINT_PROPERTIES::TransferDataFromWindow.
 *
 * Position and orientation are applied through the board-level helpers, because
 * a footprint's children are stored board-absolute here: moving the anchor
 * alone would leave its pads behind.
 */
export function applyFootprintValues(board: Board, index: number, v: FootprintValues): Board {
  const fp = board.footprints[index];
  if (!fp) return board;

  const before = collectFootprintValues(fp);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  let next = board;
  const id = boardItemId('footprint', index);

  // Upstream's order, and it matters: position, then rotate to the orientation
  // box, then flip last. Flipping first would have the rotate undo the angle
  // negation that flipping just applied, so a footprint changed to the back
  // would come out facing the wrong way.
  if (v.x !== fp.at.x || v.y !== fp.at.y)
    next = moveBoardItems(next, new Set([id]), { x: v.x - fp.at.x, y: v.y - fp.at.y });

  if (v.orientation !== fp.angle) next = setFootprintOrientation(next, index, v.orientation);

  // FOOTPRINT::Flip about the footprint's own anchor, so it flips in place.
  if (v.side !== (fp.layer === 'B.Cu' ? 'back' : 'front')) {
    const placed = next.footprints[index];
    if (placed) next = flipBoardItems(next, new Set([id]), placed.at);
  }

  // Reference and Value live in their own text items; setFootprintField owns
  // that pairing.
  if (v.reference !== (fp.reference ?? ''))
    next = setFootprintField(next, index, 'reference', v.reference);
  if (v.value !== (fp.value ?? '')) next = setFootprintField(next, index, 'value', v.value);

  const moved = next.footprints[index];
  if (!moved) return board;

  const patched: PcbFootprint = { ...moved };

  if (v.locked !== (moved.locked ?? false)) patched.locked = v.locked;

  const attrs = attributesFor(v);
  patched.attributes = attrs.length > 0 ? attrs : undefined;

  // Clearance overrides: a blank box clears the override, which is not the same
  // as writing zero — zero is a real override meaning "no clearance at all".
  patched.localClearance = v.localClearance ?? undefined;
  patched.localSolderMaskMargin = v.localSolderMaskMargin ?? undefined;
  patched.localSolderPasteMargin = v.localSolderPasteMargin ?? undefined;
  patched.localSolderPasteMarginRatio = v.localSolderPasteMarginRatio ?? undefined;
  patched.zoneConnection = v.zoneConnection === 'inherited' ? undefined : v.zoneConnection;

  return {
    ...next,
    footprints: next.footprints.map((f, i) => (i === index ? patched : f)),
  };
}
