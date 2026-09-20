// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PAD::GetSolderMaskExpansion()` and `PAD::GetSolderPasteMargin()`
 * (`pcbnew/pad.cpp:1679-1740` and `:1742-1848`) — how big a pad's aperture is
 * on the solder-mask and solder-paste layers.
 *
 * This is what makes the Board Setup > Solder Mask/Paste page do anything. Both
 * functions are a three-level fallback, and `std::optional` carries the whole
 * meaning of it: **absent is "inherit", which is not the same as zero.**
 *
 *     margin = pad's own
 *           ?? parent footprint's local
 *           ?? board design settings
 *
 * so a pad with `(solder_mask_margin 0)` is pinned to zero and a pad with no
 * token at all follows the board. Collapsing the two — reading a missing value
 * as 0 — silently pins every pad on the board and is exactly how the page ends
 * up looking wired while changing nothing.
 *
 * Not ported: the DRC-rule override at the head of each function
 * (`SOLDER_MASK_EXPANSION_CONSTRAINT`, `SOLDER_PASTE_ABS_MARGIN_CONSTRAINT`,
 * `SOLDER_PASTE_REL_MARGIN_CONSTRAINT`). Those come from custom rules, which is
 * a separate engine; when it lands it slots in ahead of the pad's own value,
 * where upstream has it.
 */

import type { PcbFootprint, PcbPad } from './types.js';

/** The Board Setup > Solder Mask/Paste values, in IU (the ratio is a fraction). */
export interface BoardMaskPasteDefaults {
  /** `BOARD_DESIGN_SETTINGS::m_SolderMaskExpansion`. */
  solderMaskExpansion?: number;
  /** `m_SolderPasteMargin`. */
  solderPasteMargin?: number;
  /** `m_SolderPasteMarginRatio`, a fraction of the pad size, not a percent. */
  solderPasteMarginRatio?: number;
}

/** `IsFrontLayer` / `IsBackLayer` as this module needs them. */
const isFront = (aLayer: string): boolean => aLayer.startsWith('F.');
const isBack = (aLayer: string): boolean => aLayer.startsWith('B.');

/** The copper layer a mask/paste layer takes the pad SIZE from. */
const copperSideOf = (aLayer: string): 'F.Cu' | 'B.Cu' => (isBack(aLayer) ? 'B.Cu' : 'F.Cu');

/**
 * "Pads defined only on mask layers (and perhaps on other tech layers) use the
 * shape defined by the pad settings only. ALL other pads, even those that don't
 * actually have any copper (such as NPTH pads with holes the same size as the
 * pad) get mask expansion." — `pad.cpp:1681-1685`.
 */
const hasCopper = (aPad: PcbPad): boolean => aPad.layers.some((l) => /(^|\.)Cu$/.test(l));

/**
 * `PAD::GetSolderMaskExpansion( aLayer )` — a single value, applied to both
 * axes, and clamped so a negative margin can never shrink the aperture past
 * nothing.
 */
export function solderMaskExpansionFor(
  aPad: PcbPad,
  aFootprint: PcbFootprint | undefined,
  aBoard: BoardMaskPasteDefaults | undefined,
  aLayer: string,
): number {
  if (!hasCopper(aPad)) return 0;
  // Only a front or back layer resolves to a mask layer at all; anything else
  // returns 0 (`:1687-1692`).
  if (!isFront(aLayer) && !isBack(aLayer)) return 0;

  const margin =
    aPad.localSolderMaskMargin ??
    aFootprint?.localSolderMaskMargin ??
    aBoard?.solderMaskExpansion ??
    0;

  // "ensure mask have a size always >= 0": a negative margin is floored at half
  // the SMALLER pad dimension (`:1727-1735`).
  if (margin < 0) {
    const minsize = -Math.min(aPad.size.x, aPad.size.y) / 2;
    if (margin < minsize) return minsize;
  }
  return margin;
}

/**
 * `PAD::GetSolderPasteMargin( aLayer )` — a VECTOR2I, because the ratio term is
 * a fraction of the pad size and the pad need not be square:
 *
 *     pad_margin.x = margin + KiROUND( padSize.x * mratio );
 *     pad_margin.y = margin + KiROUND( padSize.y * mratio );
 *
 * The absolute and ratio terms fall back INDEPENDENTLY — a pad may pin the
 * absolute margin and still inherit the board's ratio (`:1793-1824`).
 */
export function solderPasteMarginFor(
  aPad: PcbPad,
  aFootprint: PcbFootprint | undefined,
  aBoard: BoardMaskPasteDefaults | undefined,
  aLayer: string,
): { x: number; y: number } {
  if (!hasCopper(aPad)) return { x: 0, y: 0 };
  if (!isFront(aLayer) && !isBack(aLayer)) return { x: 0, y: 0 };

  const margin =
    aPad.localSolderPasteMargin ??
    aFootprint?.localSolderPasteMargin ??
    aBoard?.solderPasteMargin ??
    0;

  const ratio =
    aPad.localSolderPasteMarginRatio ??
    aFootprint?.localSolderPasteMarginRatio ??
    aBoard?.solderPasteMarginRatio ??
    0;

  const size = aPad.size;
  let x = margin + Math.round(size.x * ratio);
  let y = margin + Math.round(size.y * ratio);

  // "ensure paste have a size always >= 0", per axis and skipped for a custom
  // shape, whose size is not the aperture (`:1834-1846`).
  if (aPad.shape !== 'custom') {
    if (x < -size.x / 2) x = -size.x / 2;
    if (y < -size.y / 2) y = -size.y / 2;
  }
  return { x, y };
}

/**
 * The pad size to flash on `aLayer`: the copper size, plus the mask expansion
 * on a mask layer or the paste margin on a paste layer, and unchanged anywhere
 * else. The margin grows the aperture on BOTH sides, hence the doubling.
 */
export function padApertureSize(
  aPad: PcbPad,
  aFootprint: PcbFootprint | undefined,
  aBoard: BoardMaskPasteDefaults | undefined,
  aLayer: string,
): { x: number; y: number } {
  if (/\.Mask$/.test(aLayer)) {
    const m = solderMaskExpansionFor(aPad, aFootprint, aBoard, aLayer);
    return { x: aPad.size.x + 2 * m, y: aPad.size.y + 2 * m };
  }
  if (/\.Paste$/.test(aLayer)) {
    const m = solderPasteMarginFor(aPad, aFootprint, aBoard, aLayer);
    return { x: aPad.size.x + 2 * m.x, y: aPad.size.y + 2 * m.y };
  }
  return { x: aPad.size.x, y: aPad.size.y };
}

export { copperSideOf };
