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
import { arg, childNamed } from '@ziroeda/sexpr/src/query.js';
import { patchChild } from './edit-board.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { pcbIuToMM as iuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { rotatePcb } from './read-board.js';
import { formatDouble2Str, formatG } from '@ziroeda/common/src/plotters/fmt.js';
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/src/generator.js';
import type {
  PcbFootprint,
  PcbFootprintField,
  PcbPad,
  BarcodeKind,
  PcbBarcode,
  PcbPoint,
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

/**
 * `BOARD_ITEM::GetFPRelativePosition` (pcbnew/board_item.cpp:355-365):
 *
 *     VECTOR2I pos = GetPosition();
 *     if( FOOTPRINT* parentFP = GetParentFootprint() )
 *     {
 *         pos -= parentFP->GetPosition();
 *         RotatePoint( pos, -parentFP->GetOrientation() );
 *     }
 *     return pos;
 *
 * A footprint's children are held in **board** coordinates and written in the
 * footprint's own frame, and this is the one conversion between them. In the
 * footprint editor and in a library `.kicad_mod` the parent sits at the origin
 * with no orientation, so it is the identity there — the same single code path
 * upstream uses for both, rather than a board copy and a library copy.
 */
const fpRelativePos = (fp: PcbFootprint, p: Vec2): Vec2 =>
  rotatePcb({ x: p.x - fp.at.x, y: p.y - fp.at.y }, -fp.angle);

/**
 * The `(at …)` of a footprint child, as `PCB_IO_KICAD_SEXPR::format` writes it.
 *
 * Position is footprint-relative and **angle is absolute** — the pair is
 * genuinely mixed, and that is upstream, not an accident of ours:
 *
 *     // format( const PAD* ), pcb_io_kicad_sexpr.cpp:1695-1699
 *     m_out->Print( "(at %s %s)", formatInternalUnits( aPad->GetFPRelativePosition() ),
 *                   aPad->GetOrientation().IsZero() ? "" : FormatAngle( aPad->GetOrientation() ) );
 *
 *     // format( const PCB_TEXT* ), :2280-2302
 *     pos -= parentFP->GetPosition();
 *     RotatePoint( pos, -parentFP->GetOrientation() );
 *     m_out->Print( "(at %s %s)", formatInternalUnits( pos ),
 *                   FormatAngle( aText->GetTextAngle() ) );
 *
 * The parser is the mirror image: it reads the angle as absolute and says so —
 * "make PCB_TEXT rotation relative to the parent footprint. It was read as
 * absolute rotation from file" (pcb_io_kicad_sexpr_parser.cpp:3959-3968), and
 * `parsePAD` calls `SetOrientation( <file value> )` with no parent term at all
 * (:5904). (`fp_text_box` is the one exception, and its angle is a separate
 * `(angle …)` token that really is relative — writer:2369-2377. We do not model
 * those.)
 *
 * `omitZero` is per item type, exactly as above: a pad prints nothing for a zero
 * orientation, a text always prints its angle.
 *
 * Any trailing token of the source's own `(at)` is carried over — that is the
 * legacy positional `unlocked`, which the parser still accepts inside `(at)`
 * (:3870-3875) and which is a flag, not a coordinate.
 */
const fpChildAtNode = (
  fp: PcbFootprint,
  at: Vec2,
  angle: number,
  omitZero: boolean,
  src: SList | undefined,
): SList => {
  const p = fpRelativePos(fp, at);
  const items: SNode[] = [atom('at'), atom(mm(p.x)), atom(mm(p.y))];
  if (!(omitZero && angle === 0)) items.push(atom(String(angle)));
  // `(at x y [angle] unlocked)`: everything after the coordinates that is not
  // the angle itself.
  for (const extra of src?.items.slice(3) ?? []) {
    if (extra.kind === 'atom' && extra.value !== '' && !Number.isNaN(Number(extra.value))) continue;
    items.push(extra);
  }
  return { kind: 'list', items };
};

/** `(yes)`/`(no)` the way KICAD_FORMAT::FormatBool writes it. */
const boolNode = (name: string, v: boolean): SList => list(atom(name), atom(v ? 'yes' : 'no'));

/**
 * `FormatDouble2Str`, from the one module that ports it. This was `toFixed(10)`
 * — `%.10f`, ten digits after the point — where upstream is `%.10g`, ten
 * SIGNIFICANT digits, with a separate fixed-16 branch below 0.0001.
 */
const double2Str = formatDouble2Str;

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
export function buildPadNode(pad: PcbPad, fp?: PcbFootprint): SList {
  const items: SNode[] = [
    atom('pad'),
    str(pad.number),
    atom(pad.type),
    atom(pad.shape),
    fp ? fpChildAtNode(fp, pad.at, pad.angle, true, undefined) : atNode(pad.at, pad.angle),
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
  // `format( const PCB_SHAPE* )` (pcb_io_kicad_sexpr.cpp:1071-1097): the token
  // belongs to a POLY, a RECTANGLE or a CIRCLE — "the filled flag represents if
  // a solid fill is present on circles, rectangles and polygons" — and for those
  // three it is ALWAYS written, `(fill no)` included. A hatch mode writes its own
  // word; only FILLED_SHAPE writes the bool.
  if (shape.kind === 'poly' || shape.kind === 'rect' || shape.kind === 'circle')
    items.push(
      list(
        atom('fill'),
        atom(
          shape.fillMode === 'solid' ? 'yes' : shape.fillMode === 'none' ? 'no' : shape.fillMode,
        ),
      ),
    );
  items.push(list(atom('layer'), str(shape.layer)));
  if (shape.uuid) items.push(list(atom('uuid'), str(shape.uuid)));
  return { kind: 'list', items };
}

/** `(fp_text <kind> "text" (at ..) (layer ..) [(hide yes)] (effects (font (size h w) [(thickness t)]))) `. */
export function buildTextNode(text: PcbTextItem, fp?: PcbFootprint): SList {
  const items: SNode[] = [
    atom('fp_text'),
    atom(text.kind),
    str(text.text),
    fp ? fpChildAtNode(fp, text.at, text.angle, false, undefined) : atNode(text.at, text.angle),
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
/**
 * A pad's node: its own source, with the `(at …)` rewritten from the model.
 *
 * Upstream has no source to keep, so `format( const PAD* )` derives every field
 * it writes; here only the unmodelled children pass through and the placement
 * is derived the same way. That is not a detail — it is the difference between
 * one conversion and twenty. While the writer trusted a patched `(at)`, every
 * mutation had to remember to convert board coordinates back to the footprint's
 * frame, and two of them did not: a rotation left the child angles at their old
 * values (so a rotated part came back with upright text and unrotated pads the
 * next time the board was opened), and a flip wrote board-*absolute* pad
 * coordinates into the local slot (so the pads reloaded a hundred millimetres
 * from their footprint).
 */
const padNode = (p: PcbPad, fp: PcbFootprint): SList =>
  p.source.items.length > 0
    ? patchChild(p.source, 'at', fpChildAtNode(fp, p.at, p.angle, true, childNamed(p.source, 'at')))
    : buildPadNode(p, fp);
const shapeNode = (s: PcbShape): SList =>
  s.source.items.length > 0 ? s.source : buildShapeNode(s);
const textNode = (t: PcbTextItem, fp: PcbFootprint): SList =>
  t.source.items.length > 0
    ? patchChild(
        t.source,
        'at',
        fpChildAtNode(fp, t.at, t.angle, false, childNamed(t.source, 'at')),
      )
    : buildTextNode(t, fp);
const fieldNode = (f: PcbFootprintField, fp: PcbFootprint): SList =>
  f.source.items.length > 0 ? f.source : buildFieldNode(f, fp);

/**
 * A footprint's `(point …)`, `PCB_IO_KICAD_SEXPR::format( const PCB_POINT* )`
 * reached through `format( const FOOTPRINT* )`'s `sorted_points` loop.
 *
 * The same four tokens the board writes, and the same *absolute* `(at …)`:
 * `format( const PCB_POINT* )` prints `GetPosition()` through the one-argument
 * `formatInternalUnits` (`pcb_io_kicad_sexpr.cpp:1158`), not the `parentFP`
 * overload every other footprint child uses. So there is nothing to unbake —
 * see {@link readPoint}, whose parser has no parent either. `(at …)` is a
 * plain pair with no angle, a point having no orientation to write.
 */
const fpPointNode = (p: PcbPoint): SList =>
  p.source.items.length > 0
    ? patchChild(p.source, 'at', list(atom('at'), atom(mm(p.at.x)), atom(mm(p.at.y))))
    : {
        kind: 'list',
        items: [
          atom('point'),
          list(atom('at'), atom(mm(p.at.x)), atom(mm(p.at.y))),
          list(atom('size'), atom(mm(p.size))),
          list(atom('layer'), str(p.layer)),
          ...(p.uuid ? [list(atom('uuid'), str(p.uuid))] : []),
        ],
      };

/*
 * A `(barcode …)` is written identically at board level and inside a footprint
 * — no parent transform either way (see {@link fpPointNode}) — so there is one
 * builder, and it lives here because `write-board` already imports this module.
 */
/**
 * `(type …)` and `(ecc_level …)` spellings, `format( const PCB_BARCODE* )`
 * (`pcb_io_kicad_sexpr.cpp:2221-2246`).
 *
 * The parser accepts an alias for three of the five kinds; the writer emits
 * only these, so a file we save uses the canonical spelling whichever form it
 * was loaded from — which is what KiCad does too.
 */
const BARCODE_KIND_TOKEN: Readonly<Record<BarcodeKind, string>> = {
  code39: 'code39',
  code128: 'code128',
  datamatrix: 'datamatrix',
  qr: 'qr',
  microqr: 'microqr',
};

/**
 * `(barcode …)`, `PCB_IO_KICAD_SEXPR::format( const PCB_BARCODE* )`
 * (`pcb_io_kicad_sexpr.cpp:2198-2261`). Child order is upstream's.
 *
 * Three details that are not obvious:
 *
 * - **`(at …)` always carries the angle**, through `FormatAngle` — a plain
 *   `%.10g` of the degrees — where most items omit a zero rotation. The
 *   barcode's formatter has no such branch, so `0` is written out.
 * - **`(hide …)` and `(knockout …)` are written both ways.** They go through
 *   `FormatBool`, which always emits, so a `no` is not noise: dropping it would
 *   change what a reader defaults to.
 * - **`(ecc_level …)` only exists for QR and Micro QR**, the two symbologies
 *   whose error correction Zint takes as `option_1`. Writing one for a Code 39
 *   would be a token KiCad's own parser accepts but its writer never produces.
 *
 * `(margins …)` is the one token written conditionally, and on the *value*
 * rather than on a flag: only when either axis is non-zero.
 *
 * Nothing about the symbol's geometry is written, because none is stored — the
 * modules are recomputed from `(text …)`, `(type …)` and `(ecc_level …)` on
 * every load. See {@link PcbBarcode}.
 */
export function buildBarcodeNode(b: PcbBarcode): SList {
  const items: SNode[] = [atom('barcode')];
  if (b.locked) items.push(list(atom('locked'), atom('yes')));

  items.push(
    list(atom('at'), atom(mm(b.at.x)), atom(mm(b.at.y)), atom(formatG(b.angle, 10))),
    list(atom('layer'), str(b.layer)),
    list(atom('size'), atom(mm(b.width)), atom(mm(b.height))),
    list(atom('text'), str(b.text)),
    list(atom('text_height'), atom(mm(b.textHeight))),
    list(atom('type'), atom(BARCODE_KIND_TOKEN[b.kind])),
  );

  if (b.kind === 'qr' || b.kind === 'microqr') items.push(list(atom('ecc_level'), atom(b.ecc)));

  items.push(
    list(atom('hide'), atom(b.showText ? 'no' : 'yes')),
    list(atom('knockout'), atom(b.knockout ? 'yes' : 'no')),
  );

  if (b.margin.x !== 0 || b.margin.y !== 0)
    items.push(list(atom('margins'), atom(mm(b.margin.x)), atom(mm(b.margin.y))));

  if (b.uuid) items.push(list(atom('uuid'), str(b.uuid)));
  return { kind: 'list', items };
}
export const barcodeNode = (b: PcbBarcode): SNode =>
  b.source.items.length > 0 ? b.source : buildBarcodeNode(b);

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
    di = 0, // next model pad / shape / text / user field to emit
    oi = 0, // …and the next point
    bci = 0; // …and the next barcode

  if (src.items.length > 0) {
    for (const it of src.items) {
      if (!isList(it)) {
        out.push(it);
        continue;
      }
      const h = head(it);
      if (h === 'pad') {
        if (pi < fp.pads.length) out.push(padNode(fp.pads[pi]!, fp));
        pi++;
      } else if (GRAPHIC_HEADS.has(h ?? '')) {
        if (si < fp.shapes.length) out.push(shapeNode(fp.shapes[si]!));
        si++;
      } else if (isTextSource(it)) {
        if (ti < fp.texts.length) out.push(textNode(fp.texts[ti]!, fp));
        ti++;
      } else if (isFieldSource(it)) {
        if (di < fields.length) out.push(fieldNode(fields[di]!, fp));
        di++;
      } else if (h === 'barcode') {
        if (bci < fp.barcodes.length) out.push(barcodeNode(fp.barcodes[bci]!));
        bci++;
      } else if (h === 'point') {
        if (oi < fp.points.length) out.push(fpPointNode(fp.points[oi]!));
        oi++;
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
  for (; ti < fp.texts.length; ti++) out.push(textNode(fp.texts[ti]!, fp));
  for (; di < fields.length; di++) out.push(fieldNode(fields[di]!, fp));
  for (; si < fp.shapes.length; si++) out.push(shapeNode(fp.shapes[si]!));
  // A barcode is one of the footprint's `GraphicalItems()` (`footprint.cpp:1450`),
  // so it belongs to the `sorted_drawings` loop (:1447) — with the graphics, and
  // still ahead of the points.
  for (; bci < fp.barcodes.length; bci++) out.push(barcodeNode(fp.barcodes[bci]!));
  // After the graphics and before the pads, which is where
  // `format( const FOOTPRINT* )` puts its `sorted_points` loop (:1450-1451).
  for (; oi < fp.points.length; oi++) out.push(fpPointNode(fp.points[oi]!));
  for (; pi < fp.pads.length; pi++) out.push(padNode(fp.pads[pi]!, fp));

  return { kind: 'list', items: out };
}

/** Serialize a footprint to `.kicad_mod` text. */
export function serializeFootprint(fp: PcbFootprint): string {
  return serialize(writeFootprintNode(fp));
}
