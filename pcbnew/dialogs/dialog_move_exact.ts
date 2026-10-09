// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Move Exactly: translate and rotate a selection by typed values.
 * Counterparts: `EDIT_TOOL::MoveExact` and `DIALOG_MOVE_EXACT`.
 *
 * The order is translate-then-rotate, and the rotation centre moves with the
 * translation. Doing it the other way round gives a different answer for any
 * non-zero rotation, which is why upstream advances `selCenter` by the
 * translation before rotating and why this does the same.
 *
 * One thing deliberately not ported: `MoveExact` contains
 *
 *     EDA_ANGLE angle = rotation;
 *     if( !…m_DisplayInvertYAxis ) rotation = -rotation;
 *     … boardItem->Rotate( …, angle );
 *
 * The negation lands on `rotation`, but every `Rotate` call uses `angle`, the
 * copy taken before it, and `rotation` is never read again — so the flip has no
 * effect on the result. The dialog's angle is applied as typed. This is noted
 * because the line looks load-bearing and is not.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `ROTATION_ANCHOR` (dialog_move_exact.h). */
export type RotationAnchor = 'itemAnchor' | 'selectionCenter' | 'userOrigin' | 'auxOrigin';

/**
 * `DIALOG_MOVE_EXACT::GetTranslationInIU` with the polar checkbox ticked: a
 * distance and a bearing become a vector.
 *
 * The y sign is *not* flipped. The dialog reads its angle in the same y-down
 * frame the board is stored in, so the plain sine is what upstream stores.
 */
export function polarTranslation(distance: number, angleDeg: number): Vec2 {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.round(distance * Math.cos(rad)),
    y: Math.round(distance * Math.sin(rad)),
  };
}

/**
 * The furthest a coordinate may sit from the origin: `INT_MAX * M_SQRT1_2`,
 * about 1518 mm. The √½ is there so that a point at the corner of the legal
 * square still has a magnitude an int can hold.
 */
export const MAX_BOARD_COORD = Math.floor(2147483647 * Math.SQRT1_2);

/**
 * `DIALOG_MOVE_EXACT::OnTextChanged`: whether the typed translation would push
 * the selection outside the largest representable board area. Upstream greys
 * out OK and reddens the two entries when this is false.
 *
 * Only the translation is checked, not the rotation — same as upstream, which
 * validates the numbers the user typed into the X and Y boxes.
 */
export function moveKeepsSelectionInBounds(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  translation: Vec2,
): boolean {
  return (
    bbox.minX + translation.x >= -MAX_BOARD_COORD &&
    bbox.maxX + translation.x <= MAX_BOARD_COORD &&
    bbox.minY + translation.y >= -MAX_BOARD_COORD &&
    bbox.maxY + translation.y <= MAX_BOARD_COORD
  );
}

// ---------------------------------------------------------------------------
// The live apply: EDIT_TOOL::MoveExact's OK branch on a PCB_SELECTION
// (#636 stage 6)
// ---------------------------------------------------------------------------
