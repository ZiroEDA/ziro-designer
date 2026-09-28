// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @deprecated The plain-object (`PcbTextBox`) form, kept for the properties
 * dialog until it moves onto `PCB_TEXTBOX` (#636 stage 6). The class port is
 * `pcb_textbox.ts`; new code uses that one.
 *
 * Reading and writing a text box's properties.
 * Counterpart: `DIALOG_TEXTBOX_PROPERTIES::TransferDataToWindow` /
 * `TransferDataFromWindow` (pcbnew/dialogs/dialog_textbox_properties.cpp).
 *
 * Headless, like the other properties modules: the dialog is layout, this is
 * the part with decisions in it, and it patches the item's source node so a
 * saved file keeps everything the model does not represent.
 *
 * ## Justification is two independent axes
 *
 * `(justify …)` is one token holding up to three words — a horizontal one
 * (`left`/`right`, centre being the unwritten default), a vertical one
 * (`top`/`bottom`, likewise), and `mirror`. Upstream sets them through separate
 * `SetHorizJustify` / `SetVertJustify` / `SetMirrored` calls, so the dialog
 * edits three things that share one token. Round-tripping means rebuilding the
 * whole list from all three rather than patching a word, and it means the
 * *defaults must not be written*: emitting `center` where the file had nothing
 * changes the token every save.
 *
 * ## The border is a mode
 *
 * `border no` is a real setting — text with invisible margins — not the absence
 * of one, and the stroke stays in the file either way so the width survives
 * being toggled off and on.
 */
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { TEXT_MAX_SIZE_MM, TEXT_MIN_SIZE_MM } from '@ziroeda/common/eda_text.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { ClampTextPenSize } from '@ziroeda/common/gr_text.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { LINE_STYLE, LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { parseBoardItemId } from '../edit-board.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_TEXTBOX } from '../pcb_textbox.js';
import type { Board, PcbTextBox, StrokeType } from '../types.js';
import type { TransferResult } from './dialog_text_properties.js';

export type HorizJustify = 'left' | 'center' | 'right';
export type VertJustify = 'top' | 'center' | 'bottom';

/** Every control on the dialog, flattened. */
export interface TextBoxValues {
  text: string;
  /** `(font (face "…"))`; '' is "Default Font", the stroke font. */
  face: string;
  layer: string;
  locked: boolean;
  width: number;
  height: number;
  thickness: number;
  orientation: number;
  bold: boolean;
  italic: boolean;
  mirrored: boolean;
  horizJustify: HorizJustify;
  vertJustify: VertJustify;
  border: boolean;
  borderWidth: number;
  borderStyle: StrokeType;
  knockout: boolean;
  marginLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
}

/** The single selected text box's index, or null. */
export function textBoxAt(board: Board, selection: Iterable<string>): number | null {
  const ids = [...selection];
  if (ids.length !== 1) return null;
  const ref = parseBoardItemId(ids[0]!);
  if (!ref || ref.kind !== 'textbox') return null;
  return board.textBoxes[ref.index] ? ref.index : null;
}

/**
 * Split a `(justify …)` word list into its three independent parts.
 *
 * Centre is what the file means by *saying nothing*, on both axes, which is why
 * neither `center` word appears in a KiCad file.
 */
export function splitJustify(words: readonly string[] | undefined): {
  horiz: HorizJustify;
  vert: VertJustify;
  mirrored: boolean;
} {
  const w = words ?? [];
  return {
    horiz: w.includes('left') ? 'left' : w.includes('right') ? 'right' : 'center',
    vert: w.includes('top') ? 'top' : w.includes('bottom') ? 'bottom' : 'center',
    mirrored: w.includes('mirror'),
  };
}

/**
 * Rebuild a `(justify …)` word list, omitting the defaults.
 *
 * Writing `center` back would add a word KiCad never writes, changing the file
 * on every save even when nothing was edited.
 */
export function joinJustify(horiz: HorizJustify, vert: VertJustify, mirrored: boolean): string[] {
  const out: string[] = [];
  if (horiz !== 'center') out.push(horiz);
  if (vert !== 'center') out.push(vert);
  if (mirrored) out.push('mirror');
  return out;
}

/** `TransferDataToWindow`: the dialog's starting values. */
export function collectTextBoxValues(t: PcbTextBox): TextBoxValues {
  const j = splitJustify(t.justify);
  return {
    text: t.text,
    face: t.face ?? '',
    layer: t.layer,
    locked: t.locked ?? false,
    width: t.size.x,
    height: t.size.y,
    thickness: t.thickness ?? 0,
    orientation: t.angle ?? 0,
    bold: t.bold ?? false,
    italic: t.italic ?? false,
    mirrored: j.mirrored,
    horizJustify: j.horiz,
    vertJustify: j.vert,
    border: t.border,
    borderWidth: t.strokeWidth ?? 0,
    borderStyle: t.strokeType ?? 'solid',
    knockout: t.knockout ?? false,
    marginLeft: t.margins.left,
    marginTop: t.margins.top,
    marginRight: t.margins.right,
    marginBottom: t.margins.bottom,
  };
}

/** `TransferDataFromWindow`, plus the source patching that makes it stick. */
export function applyTextBoxValues(board: Board, index: number, v: TextBoxValues): Board {
  const t = board.textBoxes[index];
  if (!t) return board;

  const before = collectTextBoxValues(t);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  const justify = joinJustify(v.horizJustify, v.vertJustify, v.mirrored);
  const next: PcbTextBox = {
    ...t,
    text: v.text,
    face: v.face || undefined,
    layer: v.layer,
    locked: v.locked,
    size: { x: v.width, y: v.height },
    thickness: v.thickness,
    // Plain assignment: 0 and undefined are indistinguishable to every reader
    // of this field (`t.angle ?? 0`, `if (t.angle)`), and it is `dropChild`
    // below that actually keeps `(angle 0)` out of the file.
    angle: v.orientation,
    bold: v.bold,
    italic: v.italic,
    justify: justify.length > 0 ? justify : undefined,
    border: v.border,
    strokeWidth: v.borderWidth,
    strokeType: v.borderStyle,
    knockout: v.knockout,
    margins: {
      left: v.marginLeft,
      top: v.marginTop,
      right: v.marginRight,
      bottom: v.marginBottom,
    },
  };

  return {
    ...board,
    textBoxes: board.textBoxes.map((cur, i) => (i === index ? next : cur)),
  };
}

// ---------------------------------------------------------------------------
// DIALOG_TEXTBOX_PROPERTIES over the live PCB_TEXTBOX (#636 stage 6)

/**
 * `DIALOG_TEXTBOX_PROPERTIES` (dialog_textbox_properties.cpp) on a live
 * PCB_TEXTBOX, OK being one BOARD_COMMIT pushed as "Edit Text Box Properties".
 *
 * The C++ dialog has no margin or knockout controls: those two fields are
 * reported (the React dialog shows them) but not written back.
 */
export class DIALOG_TEXTBOX_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_textBox: PCB_TEXTBOX;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aTextBox: PCB_TEXTBOX) {
    this.m_frame = aFrame;
    this.m_textBox = aTextBox;
  }

  TransferDataToWindow(): TextBoxValues {
    const board = this.m_frame.GetBoard()!;
    const tb = this.m_textBox;
    const stroke = tb.GetStroke();

    let style = stroke.GetLineStyle();

    if (style === LINE_STYLE.DEFAULT) style = LINE_STYLE.SOLID;

    const font = tb.GetFont();

    return {
      text: board.ConvertKIIDsToCrossReferences(unescapeString(tb.GetText())),
      face: font ? font.GetName() : '',
      layer: LSET_Name(tb.GetLayer()),
      locked: tb.IsLocked(),
      width: tb.GetTextSize().x,
      height: tb.GetTextSize().y,
      // The React dialog has no m_autoTextThickness yet, so the stored value
      // is shown: 0 is automatic, and stays automatic through OK. Upstream
      // shows the effective pen in a disabled box instead.
      thickness: tb.GetTextThickness(),
      orientation: new EDA_ANGLE(tb.GetTextAngle().AsDegrees()).Normalize180().AsDegrees(),
      bold: tb.IsBold(),
      italic: tb.IsItalic(),
      mirrored: tb.IsMirrored(),
      horizJustify:
        tb.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
          ? 'left'
          : tb.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
            ? 'right'
            : 'center',
      vertJustify:
        tb.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
          ? 'top'
          : tb.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
            ? 'bottom'
            : 'center',
      border: tb.IsBorderEnabled(),
      borderWidth: stroke.GetWidth(),
      borderStyle: (LINE_STYLE_NAMES.find((d) => d.style === style)?.value ??
        'solid') as StrokeType,
      knockout: tb.IsKnockout(),
      marginLeft: tb.GetMarginLeft(),
      marginTop: tb.GetMarginTop(),
      marginRight: tb.GetMarginRight(),
      marginBottom: tb.GetMarginBottom(),
    };
  }

  TransferDataFromWindow(v: TextBoxValues): TransferResult {
    const minSize = pcbIUScale.mmToIU(TEXT_MIN_SIZE_MM);
    const maxSize = pcbIUScale.mmToIU(TEXT_MAX_SIZE_MM);

    for (const size of [v.width, v.height]) {
      if (size < minSize || size > maxSize) return { ok: false };
    }

    const tb = this.m_textBox;
    const commit = new BOARD_COMMIT(this.m_frame);
    commit.Modify(tb);

    // If no other command in progress, prepare undo command
    const pushCommit = tb.GetEditFlags() === 0;

    if (!pushCommit) tb.SetFlags(IN_EDIT);

    let message: string | undefined;

    const board = this.m_frame.GetBoard()!;
    const txt = board.ConvertCrossReferencesToKIIDs(v.text).replace(/\r/g, '');

    tb.SetText(EscapeString(txt, ESCAPE_CONTEXT.CTX_QUOTED_STR));
    tb.SetLocked(v.locked);
    tb.SetLayer(LSET_NameToLayer(v.layer));

    tb.SetFont(v.face === '' ? null : FONT.GetFont(v.face, v.bold, v.italic));

    tb.SetTextSize({ x: v.width, y: v.height });

    // The React dialog's thickness box has no Auto check: a zero is automatic,
    // `SetAutoThickness( true )` being `SetTextThickness( 0 )`.
    if (v.thickness === 0) {
      tb.SetAutoThickness(true);
    } else {
      tb.SetTextThickness(v.thickness);

      // Test for acceptable values for thickness and size and clamp if fails
      const maxPenWidth = ClampTextPenSize(tb.GetTextThickness(), tb.GetTextSize());

      if (tb.GetTextThickness() > maxPenWidth) {
        message = 'The text thickness is too large for the text size.\nIt will be clamped.';
        tb.SetTextThickness(maxPenWidth);
      }
    }

    tb.SetTextAngle(new EDA_ANGLE(v.orientation).Normalize());
    tb.SetBoldFlag(v.bold);
    tb.SetItalicFlag(v.italic);

    tb.SetHorizJustify(
      v.horizJustify === 'left'
        ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
        : v.horizJustify === 'center'
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT,
    );

    tb.SetVertJustify(
      v.vertJustify === 'top'
        ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
        : v.vertJustify === 'center'
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM,
    );

    tb.SetMirrored(v.mirrored);

    tb.SetBorderEnabled(v.border);
    const stroke = tb.GetStroke().clone();

    stroke.SetWidth(v.borderWidth);

    const desc = LINE_STYLE_NAMES.find((d) => d.value === v.borderStyle);
    stroke.SetLineStyle(desc ? desc.style : LINE_STYLE.SOLID);

    tb.SetStroke(stroke);

    tb.ClearBoundingBoxCache();
    tb.ClearRenderCache();

    const minBoxSize = tb.GetMinSize();
    const start = tb.GetStart();
    const end = { x: tb.GetEnd().x, y: tb.GetEnd().y };
    let expanded = false;

    if (minBoxSize.x > 0 && Math.abs(end.x - start.x) < minBoxSize.x) {
      end.x = end.x >= start.x ? start.x + minBoxSize.x : start.x - minBoxSize.x;
      expanded = true;
    }

    if (minBoxSize.y > 0 && Math.abs(end.y - start.y) < minBoxSize.y) {
      end.y = end.y >= start.y ? start.y + minBoxSize.y : start.y - minBoxSize.y;
      expanded = true;
    }

    if (expanded) tb.SetEnd(end);

    if (pushCommit) commit.Push('Edit Text Box Properties');

    return message ? { ok: true, message } : { ok: true };
  }
}
