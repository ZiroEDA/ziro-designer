// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board footprint versus its library original.
 * Counterpart: `FOOTPRINT::FootprintNeedsUpdate` in
 * `pcbnew/drc/drc_test_provider_library_parity.cpp`.
 *
 * Two callers want this: the Diff Footprint report, which shows every
 * difference, and the `lib_footprint_mismatch` DRC check, which reports only
 * the ones that mean the footprint is genuinely stale. `DiffMode` is that
 * distinction, and it is upstream's `COMPARE_FLAGS::DRC`.
 *
 * The split matters. Clearance overrides and flags like "do not populate" are
 * as likely to be set deliberately on the board as in the library, so DRC
 * ignores them — reporting them would make every board with a local override
 * noisy, and a noisy check gets switched off. The diff report still shows
 * them, because there the user is asking what differs, not what is wrong.
 *
 * **Coordinates.** Our model stores footprint children board-absolute, with the
 * parent transform already applied. A library footprint sits at the origin
 * with no rotation, so comparing stored positions directly would report every
 * placed footprint as different. Everything here is compared in the parent's
 * frame, which is what the library actually defines.
 */

import { rotatePcb } from './read-board.js';
import type { PcbFootprint, PcbPad, PcbShape } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

export type DiffMode = 'report' | 'drc';

/** Attributes DRC ignores because they describe a design, not a footprint. */
const DESIGN_ATTRIBUTES = ['board_only', 'exclude_from_pos_files', 'exclude_from_bom', 'dnp'];

/** A board child's position in its footprint's own frame. */
function localPos(fp: PcbFootprint, p: Vec2): Vec2 {
  return rotatePcb({ x: p.x - fp.at.x, y: p.y - fp.at.y }, -fp.angle);
}

/** A board child's angle relative to its footprint. */
function localAngle(fp: PcbFootprint, angle: number): number {
  const a = (angle - fp.angle) % 360;
  return a < 0 ? a + 360 : a;
}

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** One pad, described in its footprint's frame, for comparison. */
function padSignature(fp: PcbFootprint, pad: PcbPad): string {
  const at = localPos(fp, pad.at);

  return JSON.stringify([
    pad.number,
    pad.type,
    pad.shape,
    at.x,
    at.y,
    Math.round(localAngle(fp, pad.angle)),
    pad.size.x,
    pad.size.y,
    pad.drill ? [pad.drill.oblong, pad.drill.w, pad.drill.h] : null,
    [...pad.layers].sort(),
    pad.roundrectRatio ?? null,
    pad.chamferRatio ?? null,
    pad.padProperty ?? null,
  ]);
}

/** One graphic, in its footprint's frame. */
function shapeSignature(fp: PcbFootprint, s: PcbShape): string {
  const pt = (p: Vec2 | undefined): [number, number] | null => {
    if (!p) return null;
    const q = localPos(fp, p);
    return [q.x, q.y];
  };

  return JSON.stringify([
    s.kind,
    s.layer,
    s.width,
    s.fill,
    pt(s.start),
    pt(s.end),
    pt(s.mid),
    pt(s.center),
    (s.pts ?? []).map((p) => pt(p)),
  ]);
}

/**
 * Every way the board footprint differs from the library one.
 *
 * Empty means "no relevant differences detected", which is the phrase upstream
 * reports when the diff finds nothing.
 */
export function footprintDifferences(
  board: PcbFootprint,
  lib: PcbFootprint,
  mode: DiffMode = 'report',
): string[] {
  const out: string[] = [];
  const attrs = (fp: PcbFootprint): Set<string> => new Set(fp.attributes ?? []);
  const a = attrs(board);
  const b = attrs(lib);

  // The footprint type is a property of the footprint itself, so it is
  // compared in both modes.
  for (const t of ['smd', 'through_hole'])
    if (a.has(t) !== b.has(t)) {
      out.push('Footprint types differ.');
      break;
    }

  if (a.has('allow_soldermask_bridges') !== b.has('allow_soldermask_bridges'))
    out.push("'Allow bridged solder mask apertures between pads' settings differ.");

  if (mode === 'report') {
    // Skipped for DRC: "presumed to relate to a given design".
    for (const attr of DESIGN_ATTRIBUTES)
      if (a.has(attr) !== b.has(attr)) out.push(`'${attr}' settings differ.`);

    // Likewise the local overrides — as likely set on the board as in the
    // library. Only a value actually set on the board counts, which is why
    // each is checked for presence before being compared.
    if (board.localClearance !== undefined && board.localClearance !== lib.localClearance)
      out.push('Pad clearance overridden.');

    if (
      board.localSolderMaskMargin !== undefined &&
      board.localSolderMaskMargin !== lib.localSolderMaskMargin
    )
      out.push('Solder mask expansion overridden.');

    if (
      board.localSolderPasteMargin !== undefined &&
      board.localSolderPasteMargin !== lib.localSolderPasteMargin
    )
      out.push('Solder paste absolute clearance overridden.');

    if (
      board.localSolderPasteMarginRatio !== undefined &&
      board.localSolderPasteMarginRatio !== lib.localSolderPasteMarginRatio
    )
      out.push('Solder paste relative clearance overridden.');

    if (
      board.zoneConnection !== undefined &&
      board.zoneConnection !== 'inherited' &&
      board.zoneConnection !== lib.zoneConnection
    )
      out.push('Zone connection overridden.');
  }

  // Pads, matched by their signature rather than by index: a library that
  // reorders its pads has not changed the footprint.
  const padsA = board.pads.map((p) => padSignature(board, p)).sort();
  const padsB = lib.pads.map((p) => padSignature(lib, p)).sort();

  if (padsA.length !== padsB.length) out.push('Pad count differs.');
  else if (padsA.some((sig, i) => sig !== padsB[i])) out.push('Pad properties differ.');

  const shapesA = board.shapes.map((s) => shapeSignature(board, s)).sort();
  const shapesB = lib.shapes.map((s) => shapeSignature(lib, s)).sort();

  if (shapesA.length !== shapesB.length) out.push('Graphic item count differs.');
  else if (shapesA.some((sig, i) => sig !== shapesB[i])) out.push('Graphic items differ.');

  // Reference and Value carry the *instance's* text — "R1", "10k" — so only
  // their placement and style can meaningfully differ from the library.
  const textPlacement = (fp: PcbFootprint): string[] =>
    fp.texts
      .map((t) => {
        const at = localPos(fp, t.at);
        return JSON.stringify([
          t.kind,
          t.layer,
          at.x,
          at.y,
          Math.round(localAngle(fp, t.angle)),
          t.size.x,
          t.size.y,
          t.thickness ?? null,
          t.hide ?? false,
        ]);
      })
      .sort();

  const textsA = textPlacement(board);
  const textsB = textPlacement(lib);

  if (textsA.length !== textsB.length) out.push('Text item count differs.');
  else if (textsA.some((sig, i) => sig !== textsB[i])) out.push('Text items differ.');

  return out;
}

/** Does the board footprint need updating from its library original? */
export function footprintNeedsUpdate(
  board: PcbFootprint,
  lib: PcbFootprint,
  mode: DiffMode = 'report',
): boolean {
  return footprintDifferences(board, lib, mode).length > 0;
}

export { localPos as footprintLocalPos, samePoint as footprintSamePoint };
