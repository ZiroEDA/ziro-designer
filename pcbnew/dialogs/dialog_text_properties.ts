// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text properties for a board graphic text, headless.
 * Counterpart: `pcbnew/dialogs/dialog_text_properties.cpp`. Shape properties,
 * which shared this file until they were split along KiCad's own dialog
 * boundary, are `dialog_shape_properties.ts`.
 *
 * Single-item, so no three-state fold. Each applied field patches the item's
 * source node in step, since the writer emits a stored source verbatim.
 */

import { parseBoardItemId } from '../edit-board.js';
import { effectiveTextPenWidth, isAutoThickness } from './dialog_global_edit_text_and_graphics.js';
import type { Board, PcbTextItem } from '../types.js';

/** Every field DIALOG_TEXT_PROPERTIES edits, for a board text item. */
export interface TextValues {
  text: string;
  /**
   * `(font (face "…"))`, bound to the dialog's FONT_CHOICE. '' is "Default
   * Font", i.e. no `(face …)` in the file, which is what
   * `GetFont()->GetName().IsEmpty()` means upstream.
   */
  face: string;
  x: number;
  y: number;
  /** Degrees. */
  orientation: number;
  layer: string;
  /** Glyph box, IU. */
  width: number;
  height: number;
  /**
   * `EDA_TEXT::GetAutoThickness()`, which is `GetTextThickness() == 0`
   * (eda_text.h:150) — the pen width is derived from the glyph size rather than
   * stored. `EDA_TEXT::Format` then writes `(thickness …)` only
   * `if( !GetAutoThickness() )` (eda_text.cpp:1079-1084), so the token's absence
   * and a stored zero are the same thing and both mean automatic.
   */
  autoThickness: boolean;
  /**
   * `GetTextThicknessProperty()` (eda_text.h:141-147): the stored thickness, or
   * the width the text is actually drawn with when that is automatic — which is
   * what DIALOG_TEXT_PROPERTIES puts in the (disabled) box too (:328-333). So
   * turning Auto Thickness off writes the pen the text already had, rather than
   * dropping it to zero.
   */
  thickness: number;
  bold: boolean;
  italic: boolean;
  mirrored: boolean;
  /**
   * `GR_TEXT_H_ALIGN_T` / `GR_TEXT_V_ALIGN_T`, the `(justify …)` words. CENTER
   * is the default in both axes and writes no word, which is why the token is
   * absent on most text.
   */
  hJustify: 'left' | 'center' | 'right';
  vJustify: 'top' | 'center' | 'bottom';
  /** `(hide yes)` — the item is kept but not drawn or plotted. */
  hidden: boolean;
  /** `(knockout)`: the glyphs are cut out of a filled box. */
  knockout: boolean;
  locked: boolean;
}

/** Resolve a `text:N` id, or null when the selection is not one board text. */
export function textAt(board: Board, selection: Iterable<string>): number | null {
  let found: number | null = null;
  for (const id of selection) {
    const ref = parseBoardItemId(id);
    if (!ref || ref.kind !== 'text') continue;
    if (found !== null) return null;
    if (board.texts[ref.index]) found = ref.index;
  }
  return found;
}

/** DIALOG_TEXT_PROPERTIES::TransferDataToWindow. */
export function collectTextValues(t: PcbTextItem): TextValues {
  return {
    text: t.text,
    face: t.face ?? '',
    x: t.at.x,
    y: t.at.y,
    orientation: t.angle,
    layer: t.layer,
    width: t.size.x,
    height: t.size.y,
    autoThickness: isAutoThickness(t),
    thickness: isAutoThickness(t) ? effectiveTextPenWidth(t) : (t.thickness ?? 0),
    bold: t.bold ?? false,
    italic: t.italic ?? false,
    mirrored: t.mirror ?? false,
    hJustify: t.justify?.includes('left')
      ? 'left'
      : t.justify?.includes('right')
        ? 'right'
        : 'center',
    vJustify: t.justify?.includes('top')
      ? 'top'
      : t.justify?.includes('bottom')
        ? 'bottom'
        : 'center',
    hidden: t.hide ?? false,
    knockout: t.knockout ?? false,
    locked: t.locked ?? false,
  };
}

/** The `(justify …)` words `EDA_TEXT::Format` writes, for the model to carry. */
const justifyWords = (v: TextValues): string[] | undefined => {
  const words = [
    ...(v.hJustify === 'center' ? [] : [v.hJustify]),
    ...(v.vJustify === 'center' ? [] : [v.vJustify]),
    ...(v.mirrored ? ['mirror'] : []),
  ];
  return words.length > 0 ? words : undefined;
};

/** DIALOG_TEXT_PROPERTIES::TransferDataFromWindow. */
export function applyTextValues(board: Board, index: number, v: TextValues): Board {
  const t = board.texts[index];
  if (!t) return board;

  const before = collectTextValues(t);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  const next: PcbTextItem = {
    ...t,
    text: v.text,
    face: v.face || undefined,
    at: { x: v.x, y: v.y },
    angle: v.orientation,
    layer: v.layer,
    size: { x: v.width, y: v.height },
    // `SetAutoThickness( true )` is `SetTextThickness( 0 )` (eda_text.cpp:276-280);
    // our reader spells a stored zero as the token's absence, so it is undefined.
    thickness: v.autoThickness ? undefined : v.thickness,
    bold: v.bold,
    italic: v.italic,
    mirror: v.mirrored,
    justify: justifyWords(v),
    hide: v.hidden,
    knockout: v.knockout,
    locked: v.locked,
  };

  return { ...board, texts: board.texts.map((x, i) => (i === index ? next : x)) };
}
