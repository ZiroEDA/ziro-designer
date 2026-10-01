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

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { TEXT_MAX_SIZE_MM, TEXT_MIN_SIZE_MM } from '@ziroeda/common/eda_text.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { ClampTextPenSize } from '@ziroeda/common/gr_text.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { parseBoardItemId } from '../edit-board.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_FIELD } from '../pcb_field.js';
import type { PCB_TEXT } from '../pcb_text.js';
import { effectiveTextPenWidth, isAutoThickness } from '../types.js';
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

// ---------------------------------------------------------------------------
// DIALOG_TEXT_PROPERTIES over the live PCB_TEXT (#636 stage 6)

/** What OK reports: false keeps the dialog open; `message` is DisplayError's text. */
export interface TransferResult {
  ok: boolean;
  message?: string;
}

/**
 * `DIALOG_TEXT_PROPERTIES` (dialog_text_properties.cpp) on a live PCB_TEXT or
 * PCB_FIELD: `TransferDataToWindow` reads the item into the controls,
 * `TransferDataFromWindow` writes them back inside one BOARD_COMMIT pushed as
 * "Edit Text Properties".
 *
 * `m_Visible` is shown for a field only and `m_KeepUpright` for text inside a
 * footprint (the constructor, :150-170), so those two are written only then.
 */
export class DIALOG_TEXT_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_item: PCB_TEXT;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aItem: PCB_TEXT) {
    this.m_frame = aFrame;
    this.m_item = aItem;
  }

  private isField(): boolean {
    return this.m_item.Type() === KICAD_T.PCB_FIELD_T;
  }

  TransferDataToWindow(): TextValues {
    const board = this.m_frame.GetBoard()!;
    const item = this.m_item;

    // show text variable cross-references in a human-readable format
    const text = board.ConvertKIIDsToCrossReferences(unescapeString(item.GetText()));

    const font = item.GetFont();
    const pos = item.GetFPRelativePosition();

    return {
      text,
      face: font ? font.GetName() : '',
      x: pos.x,
      y: pos.y,
      orientation: new EDA_ANGLE(item.GetTextAngle().AsDegrees()).Normalize180().AsDegrees(),
      layer: LSET_Name(item.GetLayer()),
      width: item.GetTextSize().x,
      height: item.GetTextSize().y,
      autoThickness: item.GetAutoThickness(),
      thickness: item.GetAutoThickness()
        ? item.GetEffectiveTextPenWidth()
        : item.GetTextThickness(),
      bold: item.IsBold(),
      italic: item.IsItalic(),
      mirrored: item.IsMirrored(),
      hJustify:
        item.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
          ? 'left'
          : item.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
            ? 'right'
            : 'center',
      vJustify:
        item.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
          ? 'top'
          : item.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
            ? 'bottom'
            : 'center',
      hidden: !item.IsVisible(),
      knockout: item.IsKnockout(),
      locked: item.IsLocked(),
    };
  }

  TransferDataFromWindow(v: TextValues): TransferResult {
    const minSize = pcbIUScale.mmToIU(TEXT_MIN_SIZE_MM);
    const maxSize = pcbIUScale.mmToIU(TEXT_MAX_SIZE_MM);

    // m_textWidth.Validate( minSize, maxSize ) / m_textHeight.Validate( … )
    for (const size of [v.width, v.height]) {
      if (size < minSize || size > maxSize) return { ok: false };
    }

    const board = this.m_frame.GetBoard()!;
    const item = this.m_item;
    const commit = new BOARD_COMMIT(this.m_frame);
    commit.Modify(item);

    // If no other command in progress, prepare undo command
    const pushCommit = item.GetEditFlags() === 0;

    if (!pushCommit) item.SetFlags(IN_EDIT);

    let message: string | undefined;

    // Set the new text content. A field is the single-line control; any other
    // text the multi-line one, whose value is escaped for the file.
    if (v.text !== '') {
      // convert any text variable cross-references to their UUIDs
      const txt = board.ConvertCrossReferencesToKIIDs(v.text);

      if (this.isField()) item.SetText(txt);
      else item.SetText(EscapeString(txt.replace(/\r/g, ''), ESCAPE_CONTEXT.CTX_QUOTED_STR));
    }

    item.SetLocked(v.locked);

    item.SetLayer(LSET_NameToLayer(v.layer));
    item.SetIsKnockout(v.knockout);

    // m_fontCtrl->GetFontSelection( bold, italic )
    item.SetFont(v.face === '' ? null : FONT.GetFont(v.face, v.bold, v.italic));

    item.SetTextSize({ x: v.width, y: v.height });

    if (v.autoThickness) {
      item.SetAutoThickness(true);
    } else {
      item.SetTextThickness(v.thickness);

      // Test for acceptable values for thickness and size and clamp if fails
      const maxPenWidth = ClampTextPenSize(item.GetTextThickness(), item.GetTextSize());

      if (item.GetTextThickness() > maxPenWidth) {
        message = 'The text thickness is too large for the text size.\nIt will be clamped.';
        item.SetTextThickness(maxPenWidth);
      }
    }

    item.SetFPRelativePosition({ x: v.x, y: v.y });
    item.SetTextAngle(new EDA_ANGLE(v.orientation).Normalize());

    if (this.isField()) (item as PCB_FIELD).SetVisible(!v.hidden);

    // m_KeepUpright is shown for footprint text only, and TextValues (the
    // board-text form) carries no Keep Upright: the item's flag is left as is.

    item.SetBoldFlag(v.bold);
    item.SetItalicFlag(v.italic);

    item.SetHorizJustify(
      v.hJustify === 'left'
        ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
        : v.hJustify === 'center'
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT,
    );

    item.SetVertJustify(
      v.vJustify === 'bottom'
        ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
        : v.vJustify === 'center'
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP,
    );

    item.SetMirrored(v.mirrored);

    if (pushCommit) commit.Push('Edit Text Properties');

    return message ? { ok: true, message } : { ok: true };
  }
}
