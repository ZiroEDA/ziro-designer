// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text and Shape properties for board graphics, headless.
 * Counterparts: `pcbnew/dialogs/dialog_text_properties.cpp` and
 * `pcbnew/dialogs/dialog_shape_properties.cpp`.
 *
 * The two live together because they are the same item to the board: a graphic
 * on a layer, with a stroke, a lock, and optionally its own solder-mask
 * opening. Only the middle — glyphs versus geometry — differs.
 *
 * Single-item, so no three-state fold. Each applied field patches the item's
 * source node in step, since the writer emits a stored source verbatim.
 */

import { atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { dropChild, mm, parseBoardItemId, patchChild } from './edit-board.js';
import { effectiveTextPenWidth, isAutoThickness } from './global_edit_text_and_graphics.js';
import type { Board, PcbShape, PcbTextItem, StrokeType } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });
const xyNode = (name: string, p: Vec2): SList => list(atom(name), atom(mm(p.x)), atom(mm(p.y)));

/** The mask layer that pairs with a graphic's own layer, F.SilkS -> F.Mask. */
const maskSideOf = (layer: string): string | undefined =>
  layer.startsWith('F.') ? 'F.Mask' : layer.startsWith('B.') ? 'B.Mask' : undefined;

/**
 * `(layer …)` alone, or `(layers own mask)` when the graphic also opens the
 * solder mask. The two spellings are exclusive, so switching drops the other.
 */
function patchLayers(src: SList, layer: string, maskLayer: string | undefined): SList {
  if (!maskLayer)
    return patchChild(dropChild(src, 'layers'), 'layer', list(atom('layer'), str(layer)));
  return patchChild(dropChild(src, 'layer'), 'layers', {
    kind: 'list',
    items: [atom('layers'), str(layer), str(maskLayer)],
  });
}

const patchLocked = (src: SList, locked: boolean): SList =>
  locked ? patchChild(src, 'locked', list(atom('locked'), atom('yes'))) : dropChild(src, 'locked');

// ---------------------------------------------------------------------------
// Text

/** Every field DIALOG_TEXT_PROPERTIES edits, for a board text item. */
export interface TextValues {
  text: string;
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

/**
 * `(effects (font (size h w) [(thickness t)] [bold] [italic]) [(justify …)])`.
 *
 * KiCad writes the font size **height first**, which is the opposite order to
 * the `(size x y)` every other item uses — a detail that silently transposes a
 * text box if you assume otherwise.
 */
function effectsNode(v: TextValues): SList {
  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(v.height)), atom(mm(v.width)))];
  // `if( !GetAutoThickness() )` (eda_text.cpp:1079-1084), and auto IS a
  // thickness of zero — so this is the same test as the `v.thickness > 0` it
  // replaces, said the way upstream says it. What changed is that the flag is
  // now a cell of its own, and `v.thickness` carries the EFFECTIVE width while
  // it is on, which must not be written.
  if (!v.autoThickness) font.push(list(atom('thickness'), atom(mm(v.thickness))));
  if (v.bold) font.push(list(atom('bold'), atom('yes')));
  if (v.italic) font.push(list(atom('italic'), atom('yes')));

  const items: SNode[] = [atom('effects'), { kind: 'list', items: font }];

  // `(justify …)` in EDA_TEXT::Format's own order (eda_text.cpp:1100-1114):
  // horizontal word, then vertical, then `mirror`, each omitted at its default —
  // and the whole token omitted when all three are. It is built from the values
  // rather than patched into the old words, because the alignment IS these
  // words: keeping them and only editing `mirror` is what left a text whose
  // justification the panel could not change.
  const words = [
    ...(v.hJustify === 'center' ? [] : [v.hJustify]),
    ...(v.vJustify === 'center' ? [] : [v.vJustify]),
    ...(v.mirrored ? ['mirror'] : []),
  ];

  if (words.length > 0)
    items.push({ kind: 'list', items: [atom('justify'), ...words.map((w) => atom(w))] });

  return { kind: 'list', items };
}

/** The `(justify …)` words {@link effectsNode} writes, for the model to carry. */
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

  let src = t.source;

  // The text itself is the first positional argument of `(gr_text "…" …)`.
  if (v.text !== t.text) {
    const items = [...src.items];
    items[1] = str(v.text);
    src = { kind: 'list', items };
  }

  src = patchChild(
    src,
    'at',
    v.orientation
      ? list(atom('at'), atom(mm(v.x)), atom(mm(v.y)), atom(String(v.orientation)))
      : xyNode('at', { x: v.x, y: v.y }),
  );
  // Knockout is a modifier *inside* the layer token — `(layer "F.SilkS"
  // knockout)` — not a child of its own, so it has to be written there or it
  // reads back as false however faithfully a separate token round-trips.
  src = patchChild(
    src,
    'layer',
    v.knockout
      ? list(atom('layer'), str(v.layer), atom('knockout'))
      : list(atom('layer'), str(v.layer)),
  );
  src = patchChild(src, 'effects', effectsNode(v));
  src = v.hidden
    ? patchChild(src, 'hide', list(atom('hide'), atom('yes')))
    : dropChild(src, 'hide');
  src = patchLocked(src, v.locked);

  next.source = src;

  return { ...board, texts: board.texts.map((x, i) => (i === index ? next : x)) };
}

// ---------------------------------------------------------------------------
// Shape

/** Every field DIALOG_SHAPE_PROPERTIES edits, for a board graphic. */
export interface ShapeValues {
  /** The geometry points that apply to this shape kind. */
  start: Vec2;
  end: Vec2;
  mid: Vec2;
  center: Vec2;
  lineWidth: number;
  strokeType: StrokeType;
  filled: boolean;
  layer: string;
  /**
   * `(net …)`, the net a COPPER graphic belongs to — PCB_SHAPE is a
   * BOARD_CONNECTED_ITEM. Zero is `<no net>`, and the token is dropped for it,
   * the way the writer only emits one when `GetNetCode() > 0`.
   */
  net: number;
  hasMask: boolean;
  /** null is blank: use the Board Setup value. */
  maskMargin: number | null;
  locked: boolean;
}

/** Which of the four points a shape kind actually uses. */
export function shapePointsUsed(kind: PcbShape['kind']): {
  start: boolean;
  end: boolean;
  mid: boolean;
  center: boolean;
} {
  switch (kind) {
    case 'line':
    case 'rect':
      return { start: true, end: true, mid: false, center: false };
    case 'arc':
      return { start: true, end: true, mid: true, center: false };
    case 'circle':
      return { start: false, end: true, mid: false, center: true };
    default:
      // A polygon or bezier is edited by the point editor, not this dialog.
      return { start: false, end: false, mid: false, center: false };
  }
}

/** Resolve a `shape:N` id, or null when the selection is not one shape. */
export function shapeAt(board: Board, selection: Iterable<string>): number | null {
  let found: number | null = null;
  for (const id of selection) {
    const ref = parseBoardItemId(id);
    if (!ref || ref.kind !== 'shape') continue;
    if (found !== null) return null;
    if (board.shapes[ref.index]) found = ref.index;
  }
  return found;
}

const ZERO: Vec2 = { x: 0, y: 0 };

/** DIALOG_SHAPE_PROPERTIES::TransferDataToWindow. */
export function collectShapeValues(s: PcbShape): ShapeValues {
  return {
    start: s.start ?? ZERO,
    end: s.end ?? ZERO,
    mid: s.mid ?? ZERO,
    center: s.center ?? ZERO,
    net: s.net ?? 0,
    lineWidth: s.width,
    strokeType: s.strokeType ?? 'solid',
    filled: s.fill,
    layer: s.layer,
    hasMask: s.maskLayer !== undefined,
    maskMargin: s.solderMaskMargin ?? null,
    locked: s.locked ?? false,
  };
}

/** DIALOG_SHAPE_PROPERTIES::TransferDataFromWindow. */
export function applyShapeValues(board: Board, index: number, v: ShapeValues): Board {
  const s = board.shapes[index];
  if (!s) return board;

  const before = collectShapeValues(s);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  const used = shapePointsUsed(s.kind);
  const next: PcbShape = { ...s };
  let src = s.source;

  // Only write back the points this kind owns: a circle has no `mid`, and
  // inventing one would put a token in the file that KiCad never wrote.
  if (used.start) {
    next.start = v.start;
    src = patchChild(src, 'start', xyNode('start', v.start));
  }
  if (used.end) {
    next.end = v.end;
    src = patchChild(src, 'end', xyNode('end', v.end));
  }
  if (used.mid) {
    next.mid = v.mid;
    src = patchChild(src, 'mid', xyNode('mid', v.mid));
  }
  if (used.center) {
    next.center = v.center;
    src = patchChild(src, 'center', xyNode('center', v.center));
  }

  next.width = v.lineWidth;
  next.strokeType = v.strokeType;
  src = patchChild(
    src,
    'stroke',
    list(
      atom('stroke'),
      list(atom('width'), atom(mm(v.lineWidth))),
      list(atom('type'), atom(v.strokeType)),
    ),
  );

  next.fill = v.filled;
  src = v.filled
    ? patchChild(src, 'fill', list(atom('fill'), atom('solid')))
    : dropChild(src, 'fill');

  next.layer = v.layer;
  next.maskLayer = v.hasMask ? maskSideOf(v.layer) : undefined;
  src = patchLayers(src, v.layer, next.maskLayer);

  next.solderMaskMargin = v.maskMargin ?? undefined;
  src =
    v.maskMargin === null
      ? dropChild(src, 'solder_mask_margin')
      : patchChild(
          src,
          'solder_mask_margin',
          list(atom('solder_mask_margin'), atom(mm(v.maskMargin))),
        );

  // `(net …)` carries the NAME, not the code (`pcb_io_kicad_sexpr.cpp:1116`,
  // emitted only when `GetNetCode() > 0`), so the board's table is what names it
  // — and net 0 drops the token rather than writing an empty name.
  next.net = v.net > 0 ? v.net : undefined;
  next.netName = v.net > 0 ? (board.nets.get(v.net) ?? '') : undefined;
  src =
    next.net === undefined
      ? dropChild(src, 'net')
      : patchChild(src, 'net', list(atom('net'), str(next.netName ?? '')));

  next.locked = v.locked;
  src = patchLocked(src, v.locked);

  next.source = src;

  return { ...board, shapes: board.shapes.map((x, i) => (i === index ? next : x)) };
}
