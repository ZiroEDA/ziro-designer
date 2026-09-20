// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `(font …)`, written once.
 * Counterpart: the `(font` half of `EDA_TEXT::Format` (`common/eda_text.cpp`).
 *
 * Upstream every text-bearing item formats through that ONE function, which is
 * why a `gr_text`, an `fp_text`, a text box and a dimension's text all carry
 * the same tokens in the same order. Here it was six copies of the same four
 * lines — `write-board.ts` twice, `write-footprint.ts`, and the three property
 * patchers — and they had already drifted:
 *
 *   - `(face …)` was in none of them, so a font face could not be stored at
 *     all: our reader dropped it and our writer never wrote it. That is why the
 *     board's two text dialogs had no `Font:` control while eeschema's did.
 *   - the thickness test was spelled three ways: `!== undefined` in the two
 *     board writers, `(t.thickness ?? 0) !== 0` in the global editor, and a
 *     dedicated `autoThickness` flag in the graphics patcher. Upstream has one
 *     rule, `if( !GetAutoThickness() )` (`eda_text.cpp:1079-1084`), and auto IS
 *     a stored thickness of zero (`eda_text.h:150`) — so a `(thickness 0)` must
 *     not be written, which the `!== undefined` spelling did.
 *
 * The token ORDER is upstream's and it is not alphabetical: face, size,
 * line_spacing, thickness, bold, italic, colour. Only the ones we carry are
 * here; the two we do not are noted where they would go.
 */

import { atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { pcbIuToMM } from '@ziroeda/common/src/eda_units.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/**
 * `EDA_UNIT_UTILS::FormatInternalUnits` for board IU: millimetres, six decimals,
 * trailing zeros trimmed, and never `-0`.
 */
export function formatInternalUnits(iu: number): string {
  const s = pcbIuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s === '' || s === '-0' ? '0' : s;
}

/** The `EDA_TEXT` fields that reach `(font …)`. */
export interface FontFields {
  /**
   * `(face "…")`, the font family. Absent = KiCad's own stroke font, which is
   * what `GetFont()->GetName().IsEmpty()` tests before writing the token.
   */
  face?: string;
  /** The glyph box, IU. Written `(size h w)` — height first. */
  size: Vec2;
  thickness?: number;
  bold?: boolean;
  italic?: boolean;
}

/**
 * `(font (face …) (size h w) [(thickness …)] [bold] [italic])`.
 *
 * `line_spacing` and `(color …)` are the two tokens upstream can also write and
 * we do not carry: `GetLineSpacing() != 1.0` and a text colour that is not
 * `COLOR4D::UNSPECIFIED`. Neither is in `PcbTextItem`, so neither is emitted;
 * when one arrives it belongs between size and thickness, and after italic,
 * respectively.
 */
export function fontNode(t: FontFields): SList {
  const items: SNode[] = [atom('font')];
  // First, and only when there is one — an empty face is the stroke font.
  if (t.face) items.push(list(atom('face'), str(t.face)));
  items.push(
    list(atom('size'), atom(formatInternalUnits(t.size.y)), atom(formatInternalUnits(t.size.x))),
  );
  // `if( !GetAutoThickness() )`, and auto is a stored zero.
  if (t.thickness !== undefined && t.thickness !== 0)
    items.push(list(atom('thickness'), atom(formatInternalUnits(t.thickness))));
  if (t.bold) items.push(list(atom('bold'), atom('yes')));
  if (t.italic) items.push(list(atom('italic'), atom('yes')));
  return { kind: 'list', items };
}
