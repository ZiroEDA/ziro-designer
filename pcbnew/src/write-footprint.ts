// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Writer: typed PcbFootprint model -> S-expression AST -> `.kicad_mod` text.
 *
 * The faithful counterpart to KiCad's `PCB_IO_KICAD_SEXPR::format( const
 * FOOTPRINT* )` and the per-item `format()` overloads for PAD / PCB_SHAPE /
 * PCB_TEXT (pcbnew/pcb_io/sexpr/pcb_io_sexpr.cpp), writing the
 * footprint in its own local frame (a library `.kicad_mod`).
 *
 * Lossless by patching, exactly like the schematic and symbol-library writers:
 * every footprint child keeps the `source` node it was read from, so an
 * untouched footprint round-trips byte-for-byte while only edited (or newly
 * created, source-less) pads/graphics/texts are rebuilt in canonical form.
 * Children the typed model does not represent (descr, tags, attr, models,
 * zones, groups, non-Reference/Value properties, …) pass straight through.
 *
 * Coordinate note: `.kicad_pcb`/`.kicad_mod` store +Y **down**, the same sign
 * as the typed model (unlike symbol libraries), so no Y inversion is applied.
 */

import { atom, str, isList, head, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { arg } from '@ziroeda/sexpr/src/query.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { pcbIuToMM as iuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/src/generator.js';
import type {
  PcbFootprint,
  PcbFootprintField,
  PcbPad,
  PcbShape,
  PcbTextItem,
  TeardropParams,
} from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** SEXPR board/footprint file version (KiCad 9.0; matches pcbnew's output). */
export const FOOTPRINT_FILE_VERSION = 20241229;

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** Internal units -> trimmed millimetre string, KiCad's formatInternalUnits. */
function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

const atNode = (p: Vec2, angle = 0): SList =>
  angle
    ? list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(angle)))
    : list(atom('at'), atom(mm(p.x)), atom(mm(p.y)));

/** `(yes)`/`(no)` the way KICAD_FORMAT::FormatBool writes it. */
const boolNode = (name: string, v: boolean): SList => list(atom(name), atom(v ? 'yes' : 'no'));

/** FormatDouble2Str: up to 10 significant digits, trailing zeros trimmed. */
function double2Str(v: number): string {
  const s = v.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  return s === '' || s === '-0' ? '0' : s;
}

/**
 * `(teardrops …)`, PCB_IO_KICAD_SEXPR::formatTeardropParameters.
 *
 * `prefer_zone_connections` is written inverted, matching the stored
 * `m_TdOnPadsInZones`. Callers should skip this entirely when the parameters
 * equal upstream's defaults ({@link isDefaultTeardropParams}) — writing the
 * block unconditionally would rewrite every pad on every board we touch.
 */
export function buildTeardropParamsNode(p: TeardropParams): SList {
  return list(
    atom('teardrops'),
    list(atom('best_length_ratio'), atom(double2Str(p.bestLengthRatio))),
    list(atom('max_length'), atom(mm(p.tdMaxLen))),
    list(atom('best_width_ratio'), atom(double2Str(p.bestWidthRatio))),
    list(atom('max_width'), atom(mm(p.tdMaxWidth))),
    boolNode('curved_edges', p.curvedEdges),
    list(atom('filter_ratio'), atom(double2Str(p.widthtoSizeFilterRatio))),
    boolNode('enabled', p.enabled),
    boolNode('allow_two_segments', p.allowUseTwoTracks),
    boolNode('prefer_zone_connections', !p.tdOnPadsInZones),
  );
}

/** isDefaultTeardropParameters: nothing to write when every field is stock. */
export function isDefaultTeardropParams(p: TeardropParams | undefined): boolean {
  if (!p) return true;
  return (
    p.enabled === false &&
    p.bestLengthRatio === 0.5 &&
    p.tdMaxLen === mmToIU(1.0) &&
    p.bestWidthRatio === 1.0 &&
    p.tdMaxWidth === mmToIU(2.0) &&
    p.curvedEdges === false &&
    p.widthtoSizeFilterRatio === 0.9 &&
    p.allowUseTwoTracks === true &&
    p.tdOnPadsInZones === false
  );
}

// ----- canonical item builders (used only for edited / new items) -------------

/** `(pad "n" <type> <shape> (at ..) (size ..) [(drill ..)] (layers ..) …)`. */
export function buildPadNode(pad: PcbPad): SList {
  const items: SNode[] = [
    atom('pad'),
    str(pad.number),
    atom(pad.type),
    atom(pad.shape),
    atNode(pad.at, pad.angle),
    list(atom('size'), atom(mm(pad.size.x)), atom(mm(pad.size.y))),
  ];
  if (pad.delta) items.push(list(atom('rect_delta'), atom(mm(pad.delta.x)), atom(mm(pad.delta.y))));
  if (pad.drill) {
    const d: SNode[] = [atom('drill')];
    if (pad.drill.oblong) d.push(atom('oval'));
    if (pad.drill.w > 0) d.push(atom(mm(pad.drill.w)));
    if (pad.drill.oblong && pad.drill.h > 0 && pad.drill.h !== pad.drill.w)
      d.push(atom(mm(pad.drill.h)));
    if (pad.drill.offset)
      d.push(list(atom('offset'), atom(mm(pad.drill.offset.x)), atom(mm(pad.drill.offset.y))));
    items.push({ kind: 'list', items: d });
  }
  items.push({ kind: 'list', items: [atom('layers'), ...pad.layers.map((l) => str(l))] });
  // `format( const PAD* )` writes the unconnected-layer tokens right after the
  // layer list, and for PAD_ATTRIB::PTH only. Upstream emits `no` on every PTH
  // pad; we emit nothing when the model never learnt a mode, so a pad rebuilt
  // from scratch does not sprout a token the source never had.
  if (pad.type === 'thru_hole' && pad.unconnectedLayerMode !== undefined) {
    const remove = pad.unconnectedLayerMode !== 'keep_all';
    items.push(list(atom('remove_unused_layers'), atom(remove ? 'yes' : 'no')));
    if (remove) {
      const keep = pad.unconnectedLayerMode === 'remove_except_start_and_end';
      items.push(list(atom('keep_end_layers'), atom(keep ? 'yes' : 'no')));
    }
  }
  if (pad.roundrectRatio !== undefined)
    items.push(list(atom('roundrect_rratio'), atom(mm(pad.roundrectRatio))));
  if (pad.chamferRatio !== undefined)
    items.push(list(atom('chamfer_ratio'), atom(mm(pad.chamferRatio))));
  if (pad.chamfer && pad.chamfer.length > 0)
    items.push({ kind: 'list', items: [atom('chamfer'), ...pad.chamfer.map((c) => atom(c))] });
  if (!isDefaultTeardropParams(pad.teardrops)) items.push(buildTeardropParamsNode(pad.teardrops!));
  if (pad.uuid) items.push(list(atom('uuid'), str(pad.uuid)));
  return { kind: 'list', items };
}

/** `(fp_line|fp_arc|… (start ..) … (stroke ..) [(fill ..)] (layer ..) [(uuid ..)])`. */
export function buildShapeNode(shape: PcbShape): SList {
  const tag = `fp_${shape.kind}`;
  const items: SNode[] = [atom(tag)];
  const pt = (name: string, p: Vec2 | undefined): void => {
    if (p) items.push(list(atom(name), atom(mm(p.x)), atom(mm(p.y))));
  };
  if (shape.kind === 'circle') {
    pt('center', shape.center);
    pt('end', shape.end);
  } else if (shape.kind === 'arc') {
    pt('start', shape.start);
    pt('mid', shape.mid);
    pt('end', shape.end);
  } else if (shape.kind === 'poly' || shape.kind === 'curve') {
    items.push({
      kind: 'list',
      items: [
        atom('pts'),
        ...(shape.pts ?? []).map((p) => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y)))),
      ],
    });
  } else {
    pt('start', shape.start);
    pt('end', shape.end);
  }
  items.push(
    list(
      atom('stroke'),
      list(atom('width'), atom(mm(shape.width))),
      list(atom('type'), atom('solid')),
    ),
  );
  if (shape.fill) items.push(list(atom('fill'), atom('solid')));
  items.push(list(atom('layer'), str(shape.layer)));
  if (shape.uuid) items.push(list(atom('uuid'), str(shape.uuid)));
  return { kind: 'list', items };
}

/** `(fp_text <kind> "text" (at ..) (layer ..) [(hide yes)] (effects (font (size h w) [(thickness t)]))) `. */
export function buildTextNode(text: PcbTextItem): SList {
  const items: SNode[] = [
    atom('fp_text'),
    atom(text.kind),
    str(text.text),
    atNode(text.at, text.angle),
    list(atom('layer'), str(text.layer)),
  ];
  if (text.hide) items.push(list(atom('hide'), atom('yes')));
  // (size h w): height first, matching the reader's {x: w, y: h} <-> file order.
  const font: SNode[] = [
    atom('font'),
    list(atom('size'), atom(mm(text.size.y)), atom(mm(text.size.x))),
  ];
  if (text.thickness !== undefined) font.push(list(atom('thickness'), atom(mm(text.thickness))));
  if (text.bold) font.push(list(atom('bold'), atom('yes')));
  if (text.italic) font.push(list(atom('italic'), atom('yes')));
  const effects: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  if (text.justify && text.justify.length > 0)
    effects.push({ kind: 'list', items: [atom('justify'), ...text.justify.map((j) => atom(j))] });
  items.push({ kind: 'list', items: effects });
  if (text.uuid) items.push(list(atom('uuid'), str(text.uuid)));
  return { kind: 'list', items };
}

/**
 * `(property "Name" "Value" (at 0 0 a) (layer "F.Fab") (hide yes) (uuid ..)
 *  (effects (font (size 1 1) (thickness 0.15))))`, a user field created from
 * scratch, styled as BOARD_NETLIST_UPDATER does it: invisible, on the fab layer of
 * the footprint's side, at the footprint anchor with the footprint's orientation,
 * and StyleFromSettings' defaults (DEFAULT_TEXT_SIZE / DEFAULT_TEXT_WIDTH).
 */
export function buildFieldNode(field: PcbFootprintField, fp: PcbFootprint): SList {
  const size = mmToIU(1.0); // DEFAULT_TEXT_SIZE
  const thickness = mmToIU(0.15); // DEFAULT_TEXT_WIDTH
  return list(
    atom('property'),
    str(field.name),
    str(field.value),
    atNode({ x: 0, y: 0 }, fp.angle),
    list(atom('layer'), str(fp.layer === 'B.Cu' ? 'B.Fab' : 'F.Fab')),
    list(atom('hide'), atom('yes')),
    list(
      atom('effects'),
      list(
        atom('font'),
        list(atom('size'), atom(mm(size)), atom(mm(size))),
        list(atom('thickness'), atom(mm(thickness))),
      ),
    ),
  );
}

// ----- footprint node ---------------------------------------------------------

/** A modelled child node: pass the untouched source through, rebuild when source-less. */
const padNode = (p: PcbPad): SList => (p.source.items.length > 0 ? p.source : buildPadNode(p));
const shapeNode = (s: PcbShape): SList =>
  s.source.items.length > 0 ? s.source : buildShapeNode(s);
const textNode = (t: PcbTextItem): SList =>
  t.source.items.length > 0 ? t.source : buildTextNode(t);
const fieldNode = (f: PcbFootprintField, fp: PcbFootprint): SList =>
  f.source.items.length > 0 ? f.source : buildFieldNode(f, fp);

const GRAPHIC_HEADS = new Set(['fp_line', 'fp_arc', 'fp_circle', 'fp_rect', 'fp_poly', 'fp_curve']);

/** Whether a source child is one the model owns as a text (Reference/Value or fp_text). */
function isTextSource(it: SList): boolean {
  const h = head(it);
  if (h === 'fp_text') return true;
  if (h === 'property') {
    const k = arg(it, 0);
    return k === 'Reference' || k === 'Value';
  }
  return false;
}

/** Whether a source child is one the model owns as a user field (see PcbFootprintField). */
function isFieldSource(it: SList): boolean {
  if (head(it) !== 'property') return false;
  const k = arg(it, 0);
  return k !== undefined && k !== 'Reference' && k !== 'Value' && k !== 'ki_fp_filters';
}

/**
 * Rebuild the `(footprint …)` node from the typed model. The modelled item
 * classes (pads, graphics, Reference/Value + fp_text) are emitted from the model
 * arrays, in model order, one per corresponding source child (so an edited
 * item's PATCHED source is used, deletions drop trailing source nodes, and
 * additions append after their group). Every unmodelled child (descr, tags,
 * attr, models, other properties, …) passes through in place, byte-faithful.
 */
export function writeFootprintNode(fp: PcbFootprint): SList {
  const src = fp.source;
  const fields = fp.fields ?? [];
  const out: SNode[] = [];
  let pi = 0,
    si = 0,
    ti = 0,
    di = 0; // next model pad / shape / text / user field to emit

  if (src.items.length > 0) {
    for (const it of src.items) {
      if (!isList(it)) {
        out.push(it);
        continue;
      }
      const h = head(it);
      if (h === 'pad') {
        if (pi < fp.pads.length) out.push(padNode(fp.pads[pi]!));
        pi++;
      } else if (GRAPHIC_HEADS.has(h ?? '')) {
        if (si < fp.shapes.length) out.push(shapeNode(fp.shapes[si]!));
        si++;
      } else if (isTextSource(it)) {
        if (ti < fp.texts.length) out.push(textNode(fp.texts[ti]!));
        ti++;
      } else if (isFieldSource(it)) {
        if (di < fields.length) out.push(fieldNode(fields[di]!, fp));
        di++;
      } else out.push(it);
    }
  } else {
    // No source (a footprint built from scratch): emit the canonical header.
    out.push(
      atom('footprint'),
      str(fp.lib),
      list(atom('version'), atom(String(FOOTPRINT_FILE_VERSION))),
      list(atom('generator'), str(GENERATOR)),
      list(atom('generator_version'), str(GENERATOR_VERSION)),
      list(atom('layer'), str(fp.layer || 'F.Cu')),
    );
  }

  // Append newly added items (model has more than the source held), by group.
  for (; ti < fp.texts.length; ti++) out.push(textNode(fp.texts[ti]!));
  for (; di < fields.length; di++) out.push(fieldNode(fields[di]!, fp));
  for (; si < fp.shapes.length; si++) out.push(shapeNode(fp.shapes[si]!));
  for (; pi < fp.pads.length; pi++) out.push(padNode(fp.pads[pi]!));

  return { kind: 'list', items: out };
}

/** Serialize a footprint to `.kicad_mod` text. */
export function serializeFootprint(fp: PcbFootprint): string {
  return serialize(writeFootprintNode(fp));
}
