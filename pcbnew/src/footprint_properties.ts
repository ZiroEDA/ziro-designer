// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint Properties (board side), headless.
 * Counterpart: `pcbnew/dialogs/dialog_footprint_properties.cpp`.
 *
 * Single-footprint, so there is no three-state fold; every field carries a
 * value. What it shares with the other item dialogs is that each applied field
 * patches the footprint's source node in step — the writer emits a stored
 * source verbatim, so a model-only change never reaches the file.
 *
 * Moving and rotating go through edit-board's own helpers rather than writing
 * `(at …)` directly: a footprint's pads, texts and graphics are stored
 * board-absolute in this model, so its anchor cannot move on its own.
 */

import { atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import {
  boardItemId,
  dropChild,
  mm,
  moveBoardItems,
  parseBoardItemId,
  patchChild,
  setFootprintField,
  setFootprintOrientation,
} from './edit-board.js';
import type { Board, PcbFootprint } from './types.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

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

/** ZONE_CONNECTION's file numbering: 0 inherited, 1 thermal, 2 none, 3 full. */
const ZONE_CONNECT_CODE: Record<NonNullable<PcbFootprint['zoneConnection']>, number> = {
  inherited: 0,
  thermal: 1,
  none: 2,
  full: 3,
};

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

  // Geometry first, through the helpers that carry the children along.
  const id = boardItemId('footprint', index);
  if (v.x !== fp.at.x || v.y !== fp.at.y)
    next = moveBoardItems(next, new Set([id]), { x: v.x - fp.at.x, y: v.y - fp.at.y });

  if (v.orientation !== fp.angle) next = setFootprintOrientation(next, index, v.orientation);

  // Reference and Value live in their own text items, each with its own source
  // node — the writer emits those directly, so patching a copy inside the
  // footprint's source would be ignored. setFootprintField owns that pairing.
  if (v.reference !== (fp.reference ?? ''))
    next = setFootprintField(next, index, 'reference', v.reference);
  if (v.value !== (fp.value ?? '')) next = setFootprintField(next, index, 'value', v.value);

  const moved = next.footprints[index];
  if (!moved) return board;

  const patched: PcbFootprint = { ...moved };
  let src = moved.source;

  if (v.locked !== (moved.locked ?? false)) {
    patched.locked = v.locked;
    src = v.locked
      ? patchChild(src, 'locked', list(atom('locked'), atom('yes')))
      : dropChild(src, 'locked');
  }

  const attrs = attributesFor(v);
  patched.attributes = attrs.length > 0 ? attrs : undefined;
  src =
    attrs.length > 0
      ? patchChild(src, 'attr', {
          kind: 'list',
          items: [atom('attr'), ...attrs.map((a) => atom(a))],
        })
      : dropChild(src, 'attr');

  // Clearance overrides: a blank box drops the token, which is not the same as
  // writing zero — zero is a real override meaning "no clearance at all".
  const override = (
    key: 'localClearance' | 'localSolderMaskMargin' | 'localSolderPasteMargin',
    token: string,
    value: number | null,
  ): void => {
    patched[key] = value ?? undefined;
    src =
      value === null
        ? dropChild(src, token)
        : patchChild(src, token, list(atom(token), atom(mm(value))));
  };

  override('localClearance', 'clearance', v.localClearance);
  override('localSolderMaskMargin', 'solder_mask_margin', v.localSolderMaskMargin);
  override('localSolderPasteMargin', 'solder_paste_margin', v.localSolderPasteMargin);

  patched.localSolderPasteMarginRatio = v.localSolderPasteMarginRatio ?? undefined;
  src =
    v.localSolderPasteMarginRatio === null
      ? dropChild(src, 'solder_paste_margin_ratio')
      : patchChild(
          src,
          'solder_paste_margin_ratio',
          list(atom('solder_paste_margin_ratio'), atom(String(v.localSolderPasteMarginRatio))),
        );

  patched.zoneConnection = v.zoneConnection === 'inherited' ? undefined : v.zoneConnection;
  src =
    v.zoneConnection === 'inherited'
      ? dropChild(src, 'zone_connect')
      : patchChild(
          src,
          'zone_connect',
          list(atom('zone_connect'), atom(String(ZONE_CONNECT_CODE[v.zoneConnection]))),
        );

  patched.source = src;

  return {
    ...next,
    footprints: next.footprints.map((f, i) => (i === index ? patched : f)),
  };
}
