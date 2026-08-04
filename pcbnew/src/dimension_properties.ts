// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading and writing a dimension's properties.
 * Counterpart: `DIALOG_DIMENSION_PROPERTIES::TransferDataToWindow` and
 * `updateDimensionFromDialog` (pcbnew/dialogs/dialog_dimension_properties.cpp).
 *
 * Headless, like the other properties modules: the dialog is layout, this is
 * the part with decisions in it, and it patches the item's source node so a
 * saved file keeps everything the model does not represent.
 *
 * ## Override text is a mode, not a string
 *
 * `GetOverrideTextEnabled()` is what decides whether the dimension shows the
 * measurement it computes or a string you typed. Upstream keys it off a radio
 * choice for the measuring kinds and *preserves the existing state* for centre
 * and leader, which have no such choice. In the file the flag has no token of
 * its own — the presence of `(override_value …)` **is** the flag — so an
 * override of the empty string still has to be written, or the dimension
 * silently reverts to its measured value on reload. `overrideValue: undefined`
 * means "show the measurement"; `''` means "show nothing".
 *
 * ## Which fields exist depends on the kind
 *
 * Extension overshoot is aligned/orthogonal only, the text frame is leader
 * only, and a centre dimension has neither a format block nor text. Writing one
 * to the wrong kind produces a file KiCad reads back differently from what was
 * saved.
 */
import { atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { dropChild, mm, parseBoardItemId, patchChild } from './edit-board.js';
import { isAlignedKind } from './types.js';
import type {
  Board,
  DimPrecision,
  DimTextBorder,
  DimTextPosition,
  DimUnitsFormat,
  DimUnitsMode,
  PcbDimension,
} from './types.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** Every control on the dialog, flattened. */
export interface DimensionValues {
  layer: string;
  /** The measured value's prefix and suffix (`R `, ` typ.`). */
  prefix: string;
  suffix: string;
  /**
   * The text shown instead of the measurement, or undefined to show the
   * measurement. An empty string is a *set* override, not an absent one.
   */
  overrideValue: string | undefined;
  units: DimUnitsMode;
  unitsFormat: DimUnitsFormat;
  precision: DimPrecision;
  suppressZeroes: boolean;
  textPositionMode: DimTextPosition;
  keepTextAligned: boolean;
  arrowDirection: 'inward' | 'outward';
  lineThickness: number;
  arrowLength: number;
  extensionOffset: number;
  /** Aligned and orthogonal only. */
  extensionOvershoot: number;
  /** Leader only. */
  textFrame: DimTextBorder;
  // --- the text item ---
  textWidth: number;
  textHeight: number;
  textThickness: number;
  textOrientation: number;
  bold: boolean;
  italic: boolean;
  mirrored: boolean;
  /** Only meaningful when textPositionMode is MANUAL (2). */
  textX: number;
  textY: number;
  locked: boolean;
}

/** The single selected dimension's index, or null. */
export function dimensionAt(board: Board, selection: Iterable<string>): number | null {
  const ids = [...selection];
  if (ids.length !== 1) return null;
  const ref = parseBoardItemId(ids[0]!);
  if (!ref || ref.kind !== 'dimension') return null;
  return board.dimensions[ref.index] ? ref.index : null;
}

/** `TransferDataToWindow`: the dialog's starting values. */
export function collectDimensionValues(d: PcbDimension): DimensionValues {
  const f = d.format;
  const t = d.text;
  return {
    layer: d.layer,
    prefix: f?.prefix ?? '',
    suffix: f?.suffix ?? '',
    overrideValue: f?.overrideValue,
    units: f?.units ?? 3,
    unitsFormat: f?.unitsFormat ?? 1,
    precision: f?.precision ?? 4,
    suppressZeroes: f?.suppressZeroes ?? false,
    textPositionMode: d.style.textPositionMode,
    keepTextAligned: d.style.keepTextAligned ?? false,
    arrowDirection: d.style.arrowDirection ?? 'outward',
    lineThickness: d.style.thickness,
    arrowLength: d.style.arrowLength,
    extensionOffset: d.style.extensionOffset,
    extensionOvershoot: d.style.extensionHeight ?? 0,
    textFrame: d.style.textFrame ?? 0,
    textWidth: t?.size.x ?? 0,
    textHeight: t?.size.y ?? 0,
    textThickness: t?.thickness ?? 0,
    textOrientation: t?.angle ?? 0,
    bold: t?.bold ?? false,
    italic: t?.italic ?? false,
    mirrored: t?.mirror ?? false,
    textX: t?.at.x ?? 0,
    textY: t?.at.y ?? 0,
    locked: d.locked ?? false,
  };
}

/**
 * `updateDimensionFromDialog`, plus the source patching that makes it survive a
 * save. Returns the board unchanged when nothing moved.
 */
export function applyDimensionValues(board: Board, index: number, v: DimensionValues): Board {
  const d = board.dimensions[index];
  if (!d) return board;

  const before = collectDimensionValues(d);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  const aligned = isAlignedKind(d.kind);
  const hasFormat = d.kind !== 'center';

  const next: PcbDimension = {
    ...d,
    layer: v.layer,
    locked: v.locked,
    style: {
      ...d.style,
      thickness: v.lineThickness,
      arrowLength: v.arrowLength,
      extensionOffset: v.extensionOffset,
      textPositionMode: v.textPositionMode,
      keepTextAligned: v.keepTextAligned,
      // Kind-gated, exactly as the serializer gates them.
      ...(aligned
        ? { arrowDirection: v.arrowDirection, extensionHeight: v.extensionOvershoot }
        : {}),
      ...(d.kind === 'leader' ? { textFrame: v.textFrame } : {}),
    },
    ...(hasFormat
      ? {
          format: {
            prefix: v.prefix,
            suffix: v.suffix,
            units: v.units,
            unitsFormat: v.unitsFormat,
            precision: v.precision,
            suppressZeroes: v.suppressZeroes,
            // Assigned straight through, undefined included: an absent key and
            // an undefined one are indistinguishable to the serializer's
            // `!== undefined` check, to the reader, and to the no-op compare.
            overrideValue: v.overrideValue,
          },
        }
      : {}),
    ...(d.text
      ? {
          text: {
            ...d.text,
            layer: v.layer,
            size: { x: v.textWidth, y: v.textHeight },
            thickness: v.textThickness,
            angle: v.textOrientation,
            bold: v.bold,
            italic: v.italic,
            mirror: v.mirrored,
            // Upstream only writes the position back in MANUAL mode; in the
            // other two the geometry places it and a stale value would fight
            // the layout on the next redraw.
            ...(v.textPositionMode === 2 ? { at: { x: v.textX, y: v.textY } } : {}),
          },
        }
      : {}),
  };

  return {
    ...board,
    dimensions: board.dimensions.map((cur, i) =>
      i === index ? { ...next, source: patchDimensionSource(next, cur.source) } : cur,
    ),
  };
}

/** Rewrite the `(dimension …)` node's children in place. */
function patchDimensionSource(d: PcbDimension, src: SList): SList {
  if (src.items.length === 0) return src; // built from scratch on save

  let out = patchChild(src, 'layer', list(atom('layer'), str(d.layer)));
  out = d.locked
    ? patchChild(out, 'locked', list(atom('locked'), atom('yes')))
    : dropChild(out, 'locked');

  out = {
    kind: 'list',
    items: out.items.map((it) => {
      if (it.kind !== 'list') return it;
      const head = it.items[0];
      const name = head && head.kind === 'atom' ? head.value : '';
      if (name === 'format' && d.format) return formatNode(d.format);
      if (name === 'style') return styleNode(d);
      if (name === 'gr_text' && d.text) return patchTextNode(it, d);
      return it;
    }),
  };
  return out;
}

function formatNode(f: NonNullable<PcbDimension['format']>): SList {
  const items: SNode[] = [
    atom('format'),
    list(atom('prefix'), str(f.prefix)),
    list(atom('suffix'), str(f.suffix)),
    list(atom('units'), atom(String(f.units))),
    list(atom('units_format'), atom(String(f.unitsFormat))),
    list(atom('precision'), atom(String(f.precision))),
  ];
  // Presence is the enable flag, so an empty override is still written.
  if (f.overrideValue !== undefined) items.push(list(atom('override_value'), str(f.overrideValue)));
  if (f.suppressZeroes) items.push(list(atom('suppress_zeroes'), atom('yes')));
  return { kind: 'list', items };
}

function styleNode(d: PcbDimension): SList {
  const s = d.style;
  const aligned = isAlignedKind(d.kind);
  const items: SNode[] = [
    atom('style'),
    list(atom('thickness'), atom(mm(s.thickness))),
    list(atom('arrow_length'), atom(mm(s.arrowLength))),
    list(atom('text_position_mode'), atom(String(s.textPositionMode))),
  ];
  if (aligned && s.arrowDirection)
    items.push(list(atom('arrow_direction'), atom(s.arrowDirection)));
  if (aligned) items.push(list(atom('extension_height'), atom(mm(s.extensionHeight ?? 0))));
  if (d.kind === 'leader') items.push(list(atom('text_frame'), atom(String(s.textFrame ?? 0))));
  items.push(list(atom('extension_offset'), atom(mm(s.extensionOffset))));
  if (s.keepTextAligned) items.push(list(atom('keep_text_aligned'), atom('yes')));
  return { kind: 'list', items };
}

/** Patch the `(gr_text …)` child: its string, position, layer and effects. */
function patchTextNode(node: SList, d: PcbDimension): SList {
  const t = d.text!;
  const items = [...node.items];
  items[1] = str(t.text);
  let out: SList = { kind: 'list', items };

  out = patchChild(
    out,
    'at',
    t.angle
      ? list(atom('at'), atom(mm(t.at.x)), atom(mm(t.at.y)), atom(String(t.angle)))
      : list(atom('at'), atom(mm(t.at.x)), atom(mm(t.at.y))),
  );
  out = patchChild(out, 'layer', list(atom('layer'), str(t.layer)));

  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(t.size.y)), atom(mm(t.size.x)))];
  if (t.thickness !== undefined) font.push(list(atom('thickness'), atom(mm(t.thickness))));
  if (t.bold) font.push(list(atom('bold'), atom('yes')));
  if (t.italic) font.push(list(atom('italic'), atom('yes')));
  const effects: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  if (t.mirror) effects.push(list(atom('justify'), atom('mirror')));
  return patchChild(out, 'effects', { kind: 'list', items: effects });
}
