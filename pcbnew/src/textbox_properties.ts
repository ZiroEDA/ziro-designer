// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
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
import { atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { dropChild, mm, parseBoardItemId, patchChild } from './edit-board.js';
import type { Board, PcbTextBox, StrokeType } from './types.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

export type HorizJustify = 'left' | 'center' | 'right';
export type VertJustify = 'top' | 'center' | 'bottom';

/** Every control on the dialog, flattened. */
export interface TextBoxValues {
  text: string;
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
    textBoxes: board.textBoxes.map((cur, i) =>
      i === index ? { ...next, source: patchTextBoxSource(next, cur.source) } : cur,
    ),
  };
}

/** Rewrite the `(gr_text_box …)` node's children in place. */
function patchTextBoxSource(t: PcbTextBox, src: SList): SList {
  if (src.items.length === 0) return src; // built from scratch on save

  // The string is the node's first positional argument.
  const items = [...src.items];
  items[1] = str(t.text);
  let out: SList = { kind: 'list', items };

  out = patchChild(out, 'layer', list(atom('layer'), str(t.layer)));
  out = t.locked
    ? patchChild(out, 'locked', list(atom('locked'), atom('yes')))
    : dropChild(out, 'locked');
  out = t.angle
    ? patchChild(out, 'angle', list(atom('angle'), atom(String(t.angle))))
    : dropChild(out, 'angle');
  out = patchChild(
    out,
    'margins',
    list(
      atom('margins'),
      atom(mm(t.margins.left)),
      atom(mm(t.margins.top)),
      atom(mm(t.margins.right)),
      atom(mm(t.margins.bottom)),
    ),
  );

  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(t.size.y)), atom(mm(t.size.x)))];
  if (t.thickness !== undefined) font.push(list(atom('thickness'), atom(mm(t.thickness))));
  if (t.bold) font.push(list(atom('bold'), atom('yes')));
  if (t.italic) font.push(list(atom('italic'), atom('yes')));
  const effects: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  if (t.justify && t.justify.length > 0)
    effects.push({ kind: 'list', items: [atom('justify'), ...t.justify.map((j) => atom(j))] });
  out = patchChild(out, 'effects', { kind: 'list', items: effects });

  // Both are written explicitly either way — a missing `(border …)` reads back
  // as true, so `no` has to be on the page.
  out = patchChild(out, 'border', list(atom('border'), atom(t.border ? 'yes' : 'no')));
  out = patchChild(
    out,
    'stroke',
    list(
      atom('stroke'),
      list(atom('width'), atom(mm(t.strokeWidth ?? 0))),
      list(atom('type'), atom(t.strokeType ?? 'solid')),
    ),
  );
  out = patchChild(out, 'knockout', list(atom('knockout'), atom(t.knockout ? 'yes' : 'no')));
  return out;
}
