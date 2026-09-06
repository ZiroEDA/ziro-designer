// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Writer: typed `Board` model -> S-expression AST -> `.kicad_pcb` text.
 *
 * The board counterpart to write-footprint.ts and KiCad's
 * `PCB_IO_KICAD_SEXPR::format( const BOARD* )`
 * (pcbnew/pcb_io/sexpr/pcb_io_sexpr.cpp). Lossless by the same
 * patch-in-place strategy: the top-level `(kicad_pcb …)` node is rebuilt by
 * walking the *source* children in order, and for each child the model owns
 * (footprints, tracks/arcs, vias, zones, gr_* graphics, gr_text) the item's
 * `source` node, which board edits PATCH in place, is emitted. Everything the
 * typed model does not represent (general, paper, layers, setup, net decls,
 * embedded files, …) passes straight through, byte-faithful.
 *
 * Items are matched to the model positionally by node head, exactly the reader's
 * order (mirroring write-footprint.ts). Deletions drop trailing source children
 * of a kind; additions (source-less items built from scratch, or duplicated
 * items carrying a copied source) are appended after the walk, each emitted from
 * its source or a canonical builder.
 */

import { atom, str, isList, head, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { pcbIuToMM as iuToMM } from '@ziroeda/common/src/eda_units.js';
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/src/generator.js';
import {
  buildTeardropParamsNode,
  isDefaultTeardropParams,
  writeFootprintNode,
  barcodeNode,
} from './write-footprint.js';
import { isAlignedKind } from './types.js';
import type {
  Board,
  PcbDimension,
  PcbImage,
  PcbTable,
  PcbTableCell,
  PcbTextBox,
  PcbTrack,
  PcbArcTrack,
  PcbVia,
  FrontBackOptBool,
  PcbBarcode,
  PcbPoint,
  PcbShape,
  PcbTextItem,
  PcbZone,
  PcbGroup,
  StrokeType,
} from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** Internal units -> trimmed millimetre string, KiCad's formatInternalUnits. */
function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

/** Millimetres to board IU, for the defaults the builders fall back to. */
const PCB_MM = (v: number): number => Math.round(v * 1e6);

const xy = (name: string, p: Vec2): SList => list(atom(name), atom(mm(p.x)), atom(mm(p.y)));
const atNode = (p: Vec2, angle = 0): SList =>
  angle
    ? list(atom('at'), atom(mm(p.x)), atom(mm(p.y)), atom(String(angle)))
    : list(atom('at'), atom(mm(p.x)), atom(mm(p.y)));

// ----- canonical builders (used only for source-less / freshly-built items) ---

/** `(segment (start ..) (end ..) (width ..) (layer ..) (net ..) [(uuid ..)])`. */
export function buildTrackNode(t: PcbTrack): SList {
  const items: SNode[] = [
    atom('segment'),
    xy('start', t.start),
    xy('end', t.end),
    list(atom('width'), atom(mm(t.width))),
    ...copperLayerNodes(t),
    list(atom('net'), atom(String(t.net))),
  ];
  if (t.uuid) items.push(list(atom('uuid'), str(t.uuid)));
  return { kind: 'list', items };
}

/**
 * `(layer …)`, or `(layers "F.Cu" "F.Mask") (solder_mask_margin …)` when the
 * track also opens the solder mask. Upstream writes the margin only alongside
 * a mask layer and only on an outer copper layer.
 */
function copperLayerNodes(t: PcbTrack | PcbArcTrack): SNode[] {
  if (!t.maskLayer) return [list(atom('layer'), str(t.layer))];

  const out: SNode[] = [{ kind: 'list', items: [atom('layers'), str(t.layer), str(t.maskLayer)] }];

  if (t.solderMaskMargin !== undefined)
    out.push(list(atom('solder_mask_margin'), atom(mm(t.solderMaskMargin))));

  return out;
}

/** `(arc (start ..) (mid ..) (end ..) (width ..) (layer ..) (net ..) [(uuid ..)])`. */
export function buildArcTrackNode(a: PcbArcTrack): SList {
  const items: SNode[] = [
    atom('arc'),
    xy('start', a.start),
    xy('mid', a.mid),
    xy('end', a.end),
    list(atom('width'), atom(mm(a.width))),
    ...copperLayerNodes(a),
    list(atom('net'), atom(String(a.net))),
  ];
  if (a.uuid) items.push(list(atom('uuid'), str(a.uuid)));
  return { kind: 'list', items };
}

/** `(via [micro|blind] (at ..) (size ..) (drill ..) (layers ..) (net ..) [(uuid ..)])`. */
export function buildViaNode(v: PcbVia): SList {
  const items: SNode[] = [atom('via')];
  if (v.kind === 'micro') items.push(atom('micro'));
  else if (v.kind === 'blind') items.push(atom('blind'));
  items.push(
    atNode(v.at),
    list(atom('size'), atom(mm(v.size))),
    list(atom('drill'), atom(mm(v.drill))),
    { kind: 'list', items: [atom('layers'), str(v.layers[0]), str(v.layers[1])] },
    list(atom('net'), atom(String(v.net))),
  );
  // `format( const PCB_TRACK* )` for a via spells UNCONNECTED_LAYER_MODE right
  // after the layer pair, and writes nothing at all for KEEP_ALL. `remove_all`
  // still emits an explicit `(keep_end_layers no)`, which the via parser then
  // ignores — reproduced so a file we write matches one KiCad writes.
  if (v.unconnectedLayerMode === 'start_end_only') {
    items.push(list(atom('start_end_only'), atom('yes')));
  } else if (v.unconnectedLayerMode !== undefined && v.unconnectedLayerMode !== 'keep_all') {
    items.push(list(atom('remove_unused_layers'), atom('yes')));
    const keep = v.unconnectedLayerMode === 'remove_except_start_and_end';
    items.push(list(atom('keep_end_layers'), atom(keep ? 'yes' : 'no')));
  }
  if (!isDefaultTeardropParams(v.teardrops)) items.push(buildTeardropParamsNode(v.teardrops!));
  items.push(...viaOuterLayerNodes(v));
  if (v.uuid) items.push(list(atom('uuid'), str(v.uuid)));
  return { kind: 'list', items };
}

/** `FormatOptBool`: `yes`, `no`, or `none` for the empty optional. */
const optBoolNode = (name: string, v: boolean | undefined): SList =>
  list(atom(name), atom(v === undefined ? 'none' : v ? 'yes' : 'no'));

/**
 * A via's PADSTACK outer-layer and drill flags, in the order and on the
 * conditions `format( const PCB_TRACK* )` writes them
 * (pcb_io_kicad_sexpr.cpp:2738-2778): tenting, capping, covering, plugging,
 * filling — each written only when it has something to say, so a via that
 * follows the board stackup for all of them gains no tokens at all.
 */
export function viaOuterLayerNodes(v: PcbVia): SList[] {
  const out: SList[] = [];
  const pair = (name: string, fb: FrontBackOptBool | undefined): void => {
    if (!fb || (fb.front === undefined && fb.back === undefined)) return;
    out.push({
      kind: 'list',
      items: [atom(name), optBoolNode('front', fb.front), optBoolNode('back', fb.back)],
    });
  };

  pair('tenting', v.tenting);
  if (v.capping !== undefined) out.push(optBoolNode('capping', v.capping));
  pair('covering', v.covering);
  pair('plugging', v.plugging);
  if (v.filling !== undefined) out.push(optBoolNode('filling', v.filling));
  return out;
}

/** `(gr_line|gr_arc|… (start ..) … (stroke ..) [(fill ..)] (layer ..) [(uuid ..)])`. */
export function buildBoardShapeNode(s: PcbShape): SList {
  const items: SNode[] = [atom(`gr_${s.kind}`)];
  const pt = (name: string, p: Vec2 | undefined): void => {
    if (p) items.push(xy(name, p));
  };
  if (s.kind === 'circle') {
    pt('center', s.center);
    pt('end', s.end);
  } else if (s.kind === 'arc') {
    pt('start', s.start);
    pt('mid', s.mid);
    pt('end', s.end);
  } else if (s.kind === 'poly' || s.kind === 'curve') {
    items.push({ kind: 'list', items: [atom('pts'), ...(s.pts ?? []).map((p) => xy('xy', p))] });
  } else {
    pt('start', s.start);
    pt('end', s.end);
    // `if( aShape->GetCornerRadius() > 0 )` on the RECTANGLE branch alone
    // (pcb_io_kicad_sexpr.cpp:1014-1021), right after the two corners.
    if (s.kind === 'rect' && (s.cornerRadius ?? 0) > 0)
      items.push(list(atom('radius'), atom(mm(s.cornerRadius as number))));
  }
  items.push(
    list(
      atom('stroke'),
      list(atom('width'), atom(mm(s.width))),
      // The shape's OWN dash type. Hardcoding `solid` here meant a newly drawn
      // dashed graphic — one with no source node to copy — came back solid.
      list(atom('type'), atom(s.strokeType ?? 'solid')),
    ),
  );
  // `format( const PCB_SHAPE* )` (pcb_io_kicad_sexpr.cpp:1071-1097): the token
  // belongs to a POLY, a RECTANGLE or a CIRCLE — "the filled flag represents if
  // a solid fill is present on circles, rectangles and polygons" — and for those
  // three it is ALWAYS written, `(fill no)` included. A hatch mode writes its own
  // word; only FILLED_SHAPE writes the bool.
  if (s.kind === 'poly' || s.kind === 'rect' || s.kind === 'circle')
    items.push(
      list(
        atom('fill'),
        atom(s.fillMode === 'solid' ? 'yes' : s.fillMode === 'none' ? 'no' : s.fillMode),
      ),
    );
  // `if( aShape->IsLocked() )`, before the layer (:1100-1101).
  if (s.locked) items.push(list(atom('locked'), atom('yes')));
  // `GetLayerSet().count() > 1` picks `(layers …)` over `(layer …)`: a graphic
  // that also opens the solder mask names both.
  items.push(
    s.maskLayer
      ? { kind: 'list', items: [atom('layers'), str(s.layer), str(s.maskLayer)] }
      : list(atom('layer'), str(s.layer)),
  );
  // `HasSolderMask() && margin.has_value() && IsExternalCopperLayer()` — all
  // three, so an inner-layer graphic writes no margin even when it carries one.
  if (s.maskLayer && s.solderMaskMargin !== undefined && (s.layer === 'F.Cu' || s.layer === 'B.Cu'))
    items.push(list(atom('solder_mask_margin'), atom(mm(s.solderMaskMargin))));
  // `if( !( m_ctl & CTL_OMIT_PAD_NETS ) && aShape->GetNetCode() > 0 )`
  // (pcb_io_kicad_sexpr.cpp:1116). Written by NAME, and only for a real net:
  // code 0 is the unconnected one and upstream omits the token entirely.
  //
  // Between the layer and the uuid, where the writer puts it. A builder that
  // dropped it would round-trip a copper graphic into an unconnected one, which
  // is the load-side bug of #631 arriving from the other direction.
  if ((s.net ?? 0) > 0) items.push(list(atom('net'), str(s.netName ?? '')));
  if (s.uuid) items.push(list(atom('uuid'), str(s.uuid)));
  return { kind: 'list', items };
}

/**
 * `(zone (net ..) (net_name ..) (layer[s] ..) (hatch ..) … (polygon (pts …))
 * (filled_polygon …))`, PCB_IO_KICAD_SEXPR::format( const ZONE* ).
 *
 * Model-driven, falling back to KiCad's zone defaults (ZONE_SETTINGS:
 * clearance 0.5, min thickness 0.25, thermal 0.5/0.5) for the fields a
 * freshly-drawn zone leaves unset. Generated zones — teardrops — set those
 * fields and carry their own fill, so a builder that hardcoded the defaults
 * would write copper KiCad then re-poured into something else.
 */
export function buildZoneNode(z: PcbZone): SList {
  const items: SNode[] = [
    atom('zone'),
    list(atom('net'), atom(String(z.net))),
    list(atom('net_name'), str(z.netName ?? '')),
  ];
  if (z.layers.length === 1) items.push(list(atom('layer'), str(z.layers[0]!)));
  else items.push({ kind: 'list', items: [atom('layers'), ...z.layers.map((l) => str(l))] });
  if (z.uuid) items.push(list(atom('uuid'), str(z.uuid)));
  // INVISIBLE_BORDER has no token of its own; upstream's switch falls through
  // to `none`, so the style is lost on save and the reader restores it.
  const hatchStyle = z.hatchStyle === 'invisible' ? 'none' : (z.hatchStyle ?? 'edge');
  items.push(list(atom('hatch'), atom(hatchStyle), atom(z.hatchPitch ? mm(z.hatchPitch) : '0.5')));

  if (z.priority) items.push(list(atom('priority'), atom(String(z.priority))));

  // `(attr (teardrop (type …)))` marks generated copper, so a re-run of the
  // teardrop generator knows which zones are its own to replace.
  if (z.teardropType) {
    items.push(
      list(
        atom('attr'),
        list(
          atom('teardrop'),
          list(atom('type'), atom(z.teardropType === 'viapad' ? 'padvia' : 'track_end')),
        ),
      ),
    );
  }

  const connect: SNode[] = [atom('connect_pads')];
  if (z.padConnection === 'none') connect.push(atom('no'));
  else if (z.padConnection === 'full') connect.push(atom('yes'));
  else if (z.padConnection === 'thru_hole_only') connect.push(atom('thru_hole_only'));
  connect.push(list(atom('clearance'), atom(mm(z.clearance ?? PCB_MM(0.5)))));
  items.push({ kind: 'list', items: connect });

  items.push(list(atom('min_thickness'), atom(mm(z.minThickness ?? PCB_MM(0.25)))));

  // A rule area writes its keepout flags here, immediately after min_thickness,
  // and the token's presence is what marks the zone as a rule area on read.
  if (z.ruleArea) {
    const allow = (v: boolean): SNode => atom(v ? 'not_allowed' : 'allowed');
    items.push(
      list(
        atom('keepout'),
        list(atom('tracks'), allow(z.ruleArea.tracks)),
        list(atom('vias'), allow(z.ruleArea.vias)),
        list(atom('pads'), allow(z.ruleArea.pads)),
        list(atom('copperpour'), allow(z.ruleArea.copperPour)),
        list(atom('footprints'), allow(z.ruleArea.footprints)),
      ),
    );

    // `(placement …)` follows unconditionally for a rule area, source type and
    // name included even when it is disabled — upstream writes the last-chosen
    // source so re-enabling the area does not lose it.
    const placement = z.placementArea;
    items.push(
      list(
        atom('placement'),
        list(atom('enabled'), atom(placement?.enabled ? 'yes' : 'no')),
        list(atom(placement?.sourceType ?? 'sheetname'), str(placement?.source ?? '')),
      ),
    );
  }

  items.push(list(atom('filled_areas_thickness'), atom('no')));
  const fill: SNode[] = [
    atom('fill'),
    atom(z.filled === false ? 'no' : 'yes'),
    list(atom('thermal_gap'), atom(mm(z.thermalGap ?? PCB_MM(0.5)))),
    list(atom('thermal_bridge_width'), atom(mm(z.thermalBridgeWidth ?? PCB_MM(0.5)))),
  ];
  const islandMode = z.islandRemovalMode ?? 'always';
  if (islandMode !== 'always') {
    fill.push(
      list(atom('island_removal_mode'), atom(islandMode === 'never' ? '1' : '2')),
      // island_area_min is millimetres squared, not IU.
      ...(islandMode === 'area'
        ? [list(atom('island_area_min'), atom(String(z.islandAreaMin ?? 10)))]
        : []),
    );
  }
  items.push({ kind: 'list', items: fill });
  items.push(
    list(atom('polygon'), {
      kind: 'list',
      items: [atom('pts'), ...(z.outline ?? []).map((p) => xy('xy', p))],
    }),
  );

  // The filled copper, one node per outline per layer.
  for (const fill of z.fills) {
    for (const poly of fill.polys) {
      if (poly.length === 0) continue;
      items.push(
        list(atom('filled_polygon'), list(atom('layer'), str(fill.layer)), {
          kind: 'list',
          items: [atom('pts'), ...poly.map((p) => xy('xy', p))],
        }),
      );
    }
  }

  return { kind: 'list', items };
}

/** `(gr_text "text" (at ..) (layer ..) (effects (font (size h w) [(thickness ..)])))`. */
export function buildBoardTextNode(t: PcbTextItem): SList {
  const items: SNode[] = [
    atom('gr_text'),
    str(t.text),
    atNode(t.at, t.angle),
    list(atom('layer'), str(t.layer)),
  ];
  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(t.size.y)), atom(mm(t.size.x)))];
  if (t.thickness !== undefined) font.push(list(atom('thickness'), atom(mm(t.thickness))));
  if (t.bold) font.push(list(atom('bold'), atom('yes')));
  if (t.italic) font.push(list(atom('italic'), atom('yes')));
  const effects: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  if (t.justify && t.justify.length > 0)
    effects.push({ kind: 'list', items: [atom('justify'), ...t.justify.map((j) => atom(j))] });
  items.push({ kind: 'list', items: effects });
  if (t.uuid) items.push(list(atom('uuid'), str(t.uuid)));
  return { kind: 'list', items };
}

// A modelled item's node: its (patched) source, or a canonical build if source-less.
const trackNode = (t: PcbTrack): SNode =>
  t.source.items.length > 0 ? t.source : buildTrackNode(t);
const arcTrackNode = (a: PcbArcTrack): SNode =>
  a.source.items.length > 0 ? a.source : buildArcTrackNode(a);
const viaNode = (v: PcbVia): SNode => (v.source.items.length > 0 ? v.source : buildViaNode(v));
const shapeNode = (s: PcbShape): SNode =>
  s.source.items.length > 0 ? s.source : buildBoardShapeNode(s);
const textNode = (t: PcbTextItem): SNode =>
  t.source.items.length > 0 ? t.source : buildBoardTextNode(t);
const zoneNode = (z: PcbZone): SNode => (z.source.items.length > 0 ? z.source : buildZoneNode(z));

/**
 * `(gr_text_box "…" …)`, PCB_IO_KICAD_SEXPR::format(PCB_TEXTBOX*).
 *
 * Child order is upstream's. Two details that are not obvious:
 *
 * - The shape is `(start …) (end …)` **or** `(pts …)`, never both. Upstream
 *   switches on `GetLibraryShape()`, and a box only becomes a polygon once a
 *   non-cardinal rotation has made it one.
 * - `(border …)` and `(knockout …)` are written **explicitly both ways** —
 *   `FormatBool` always emits — unlike the many flags that are omitted when
 *   false. Dropping a `no` here changes what a reader defaults to.
 */
export function buildTextBoxNode(t: PcbTextBox): SList {
  const items: SNode[] = [atom('gr_text_box'), str(t.text)];
  if (t.locked) items.push(list(atom('locked'), atom('yes')));

  if (t.pts && t.pts.length > 0) {
    items.push({ kind: 'list', items: [atom('pts'), ...t.pts.map((p) => xy('xy', p))] });
  } else {
    items.push(xy('start', t.start ?? { x: 0, y: 0 }), xy('end', t.end ?? { x: 0, y: 0 }));
  }

  items.push(
    list(
      atom('margins'),
      atom(mm(t.margins.left)),
      atom(mm(t.margins.top)),
      atom(mm(t.margins.right)),
      atom(mm(t.margins.bottom)),
    ),
  );
  if (t.angle) items.push(list(atom('angle'), atom(String(t.angle))));
  items.push(list(atom('layer'), str(t.layer)));
  if (t.uuid) items.push(list(atom('uuid'), str(t.uuid)));

  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(t.size.y)), atom(mm(t.size.x)))];
  if (t.thickness !== undefined) font.push(list(atom('thickness'), atom(mm(t.thickness))));
  if (t.bold) font.push(list(atom('bold'), atom('yes')));
  if (t.italic) font.push(list(atom('italic'), atom('yes')));
  const effects: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  if (t.justify && t.justify.length > 0)
    effects.push({ kind: 'list', items: [atom('justify'), ...t.justify.map((j) => atom(j))] });
  items.push({ kind: 'list', items: effects });

  items.push(list(atom('border'), atom(t.border ? 'yes' : 'no')));
  items.push(
    list(
      atom('stroke'),
      list(atom('width'), atom(mm(t.strokeWidth ?? 0))),
      list(atom('type'), atom(t.strokeType ?? 'solid')),
    ),
  );
  items.push(list(atom('knockout'), atom(t.knockout ? 'yes' : 'no')));
  return { kind: 'list', items };
}
const textBoxNode = (t: PcbTextBox): SNode =>
  t.source.items.length > 0 ? t.source : buildTextBoxNode(t);

/** The MIME base64 line width upstream splits `(data …)` at. */
export const BASE64_LINE_WIDTH = 76;

/**
 * `(image …)`, PCB_IO_KICAD_SEXPR::format(PCB_REFERENCE_IMAGE*).
 *
 * `(scale …)` is written **only when it is not 1** and `(locked …)` only when
 * set, both matching upstream — writing either unconditionally adds a token
 * KiCad never produces, so an untouched file would change on every save.
 *
 * The base64 goes back out in 76-character pieces, the width
 * `KICAD_FORMAT::FormatStreamData` uses.
 */
export function buildImageNode(img: PcbImage): SList {
  const items: SNode[] = [atom('image'), xy('at', img.at), list(atom('layer'), str(img.layer))];
  if (img.scale !== undefined && img.scale !== 1)
    items.push(list(atom('scale'), atom(String(img.scale))));
  if (img.locked) items.push(list(atom('locked'), atom('yes')));

  const chunks: SNode[] = [atom('data')];
  for (let i = 0; i < img.data.length; i += BASE64_LINE_WIDTH)
    chunks.push(str(img.data.slice(i, i + BASE64_LINE_WIDTH)));
  items.push({ kind: 'list', items: chunks });

  if (img.uuid) items.push(list(atom('uuid'), str(img.uuid)));
  return { kind: 'list', items };
}
const imageNode = (img: PcbImage): SNode =>
  img.source.items.length > 0 ? img.source : buildImageNode(img);

/**
 * `(table …)`, PCB_IO_KICAD_SEXPR::format(PCB_TABLE*).
 *
 * The one rule that is not obvious: **the stroke inside `(border …)` and
 * `(separators …)` is written only when at least one of that pair's flags is
 * set.** A table with both border flags off has no border stroke in the file at
 * all, so emitting one unconditionally would add a token KiCad never writes.
 *
 * Cells go through `buildTextBoxNode` because a `PCB_TABLECELL` *is* a
 * `PCB_TEXTBOX` upstream, with `(span …)` inserted and the border/stroke pair
 * withheld — a cell draws no border of its own.
 */
export function buildTableNode(t: PcbTable): SList {
  const items: SNode[] = [atom('table'), list(atom('column_count'), atom(String(t.columnCount)))];
  if (t.uuid) items.push(list(atom('uuid'), str(t.uuid)));
  if (t.locked) items.push(list(atom('locked'), atom('yes')));
  items.push(list(atom('layer'), str(t.layer)));

  const strokeNode = (w: number | undefined, style: StrokeType | undefined): SList =>
    list(
      atom('stroke'),
      list(atom('width'), atom(mm(w ?? 0))),
      list(atom('type'), atom(style ?? 'solid')),
    );

  const border: SNode[] = [
    atom('border'),
    list(atom('external'), atom(t.borderExternal ? 'yes' : 'no')),
    list(atom('header'), atom(t.borderHeader ? 'yes' : 'no')),
  ];
  if (t.borderExternal || t.borderHeader) border.push(strokeNode(t.borderWidth, t.borderStyle));
  items.push({ kind: 'list', items: border });

  const seps: SNode[] = [
    atom('separators'),
    list(atom('rows'), atom(t.separatorRows ? 'yes' : 'no')),
    list(atom('cols'), atom(t.separatorCols ? 'yes' : 'no')),
  ];
  if (t.separatorRows || t.separatorCols) seps.push(strokeNode(t.separatorWidth, t.separatorStyle));
  items.push({ kind: 'list', items: seps });

  items.push({
    kind: 'list',
    items: [atom('column_widths'), ...t.columnWidths.map((w) => atom(mm(w)))],
  });
  items.push({
    kind: 'list',
    items: [atom('row_heights'), ...t.rowHeights.map((h) => atom(mm(h)))],
  });

  items.push({
    kind: 'list',
    items: [atom('cells'), ...t.cells.map((c) => buildTableCellNode(c))],
  });
  return { kind: 'list', items };
}

/**
 * One `(table_cell …)`: the text box node, renamed, with `(span …)` after the
 * margins and without the border/stroke pair the shared formatter skips for a
 * cell.
 */
export function buildTableCellNode(c: PcbTableCell): SList {
  const box = buildTextBoxNode(c);
  const out: SNode[] = [];
  for (const it of box.items) {
    if (it.kind === 'atom' && it.value === 'gr_text_box') {
      out.push(atom('table_cell'));
      continue;
    }
    if (isList(it)) {
      const h = head(it);
      // A cell has no border of its own; the table draws every line.
      if (h === 'border' || h === 'stroke') continue;
      out.push(it);
      if (h === 'margins')
        out.push(list(atom('span'), atom(String(c.colSpan)), atom(String(c.rowSpan))));
      continue;
    }
    out.push(it);
  }
  return { kind: 'list', items: out };
}
const tableNode = (t: PcbTable): SNode =>
  t.source.items.length > 0 ? t.source : buildTableNode(t);

/**
 * `(dimension (type …) …)`, PCB_IO_KICAD_SEXPR::format(PCB_DIMENSION_BASE).
 *
 * Child order is upstream's, and which children appear is decided by the kind
 * rather than by whether the model happens to hold a value. Two rules are worth
 * stating because they do not follow from the names:
 *
 * - **An orthogonal dimension writes every aligned field.** Upstream reaches
 *   them through `dynamic_cast<PCB_DIM_ALIGNED*>`, which succeeds for
 *   orthogonal too, since `PCB_DIM_ORTHOGONAL` derives from it. So `(height …)`
 *   and `(extension_height …)` are *not* aligned-only, despite the `(type)`
 *   test putting orthogonal first.
 * - **A centre dimension has no `(format …)` and no text.** It marks a point;
 *   there is no measurement to render, so there is nothing to format.
 */
export function buildDimensionNode(d: PcbDimension): SList {
  const aligned = isAlignedKind(d.kind);
  const items: SNode[] = [atom('dimension'), list(atom('type'), atom(d.kind))];
  if (d.locked) items.push(list(atom('locked'), atom('yes')));
  items.push(list(atom('layer'), str(d.layer)));
  if (d.uuid) items.push(list(atom('uuid'), str(d.uuid)));
  items.push(list(atom('pts'), xy('xy', d.start), xy('xy', d.end)));

  if (aligned) items.push(list(atom('height'), atom(mm(d.height ?? 0))));
  if (d.kind === 'radial') items.push(list(atom('leader_length'), atom(mm(d.leaderLength ?? 0))));
  if (d.kind === 'orthogonal')
    items.push(list(atom('orientation'), atom(String(d.orientation ?? 0))));

  if (d.kind !== 'center') {
    const f = d.format;
    const fmt: SNode[] = [
      atom('format'),
      list(atom('prefix'), str(f?.prefix ?? '')),
      list(atom('suffix'), str(f?.suffix ?? '')),
      list(atom('units'), atom(String(f?.units ?? 3))),
      list(atom('units_format'), atom(String(f?.unitsFormat ?? 1))),
      list(atom('precision'), atom(String(f?.precision ?? 4))),
    ];
    // Written only when the override is enabled — an empty override is not the
    // same as no override, so the presence of the token is the flag.
    if (f?.overrideValue !== undefined)
      fmt.push(list(atom('override_value'), str(f.overrideValue)));
    if (f?.suppressZeroes) fmt.push(list(atom('suppress_zeroes'), atom('yes')));
    items.push({ kind: 'list', items: fmt });
  }

  const style: SNode[] = [
    atom('style'),
    list(atom('thickness'), atom(mm(d.style.thickness))),
    list(atom('arrow_length'), atom(mm(d.style.arrowLength))),
    list(atom('text_position_mode'), atom(String(d.style.textPositionMode))),
  ];
  if (aligned && d.style.arrowDirection)
    style.push(list(atom('arrow_direction'), atom(d.style.arrowDirection)));
  if (aligned) style.push(list(atom('extension_height'), atom(mm(d.style.extensionHeight ?? 0))));
  if (d.kind === 'leader')
    style.push(list(atom('text_frame'), atom(String(d.style.textFrame ?? 0))));
  style.push(list(atom('extension_offset'), atom(mm(d.style.extensionOffset))));
  if (d.style.keepTextAligned) style.push(list(atom('keep_text_aligned'), atom('yes')));
  items.push({ kind: 'list', items: style });

  // Upstream writes the text last "to be sure the text options are known when
  // reading the file".
  if (d.kind !== 'center' && d.text) items.push(buildBoardTextNode(d.text));

  return { kind: 'list', items };
}
const dimensionNode = (d: PcbDimension): SNode =>
  d.source.items.length > 0 ? d.source : buildDimensionNode(d);

/** `(group "name" (uuid …) [(locked yes)] (members …))`, PCB_IO_KICAD_SEXPR::
 *  format(PCB_GROUP): members sorted alphabetically; empty groups not written
 *  (the walk drops a group whose model entry has no members). */
export function buildGroupNode(g: PcbGroup): SList {
  const items: SNode[] = [atom('group'), str(g.name)];
  if (g.uuid) items.push(list(atom('uuid'), str(g.uuid)));
  if (g.locked) items.push(list(atom('locked'), atom('yes')));
  items.push(list(atom('members'), ...[...g.members].sort().map((m) => str(m))));
  return { kind: 'list', items };
}
const groupNode = (g: PcbGroup): SNode =>
  g.source.items.length > 0 ? g.source : buildGroupNode(g);

/**
 * `(point (at …) (size …) (layer …) (uuid …))`, PCB_IO_KICAD_SEXPR::
 * format(PCB_POINT) (`pcb_io_kicad_sexpr.cpp:1156-1167`).
 *
 * Four tokens and no fifth: no `(locked …)`, because the formatter has none —
 * see {@link PcbPoint}. The order is the formatter's, and `(at …)` is a plain
 * pair with no angle, a point having no orientation to write.
 */
export function buildPointNode(p: PcbPoint): SList {
  const items: SNode[] = [
    atom('point'),
    list(atom('at'), atom(mm(p.at.x)), atom(mm(p.at.y))),
    list(atom('size'), atom(mm(p.size))),
    list(atom('layer'), str(p.layer)),
  ];
  if (p.uuid) items.push(list(atom('uuid'), str(p.uuid)));
  return { kind: 'list', items };
}
const pointNode = (p: PcbPoint): SNode =>
  p.source.items.length > 0 ? p.source : buildPointNode(p);

/** A source child the reader parsed by these top-level heads. */
const GRAPHIC_HEADS = new Set(['gr_line', 'gr_arc', 'gr_circle', 'gr_rect', 'gr_poly', 'gr_curve']);

/**
 * Rebuild the `(kicad_pcb …)` node from the typed model, emitting each modelled
 * child from the model arrays (in source order), dropping deleted items and
 * appending newly-added ones after the walk.
 */
export function writeBoardNode(board: Board): SList {
  const src = board.source;
  if (src.items.length === 0) return src; // nothing to rebuild from
  const out: SNode[] = [];
  let ti = 0,
    ai = 0,
    vi = 0,
    zi = 0,
    si = 0,
    xi = 0,
    fi = 0,
    di = 0,
    bi = 0,
    tbi = 0,
    ii = 0,
    pi = 0,
    bci = 0,
    gi = 0;

  for (const it of src.items) {
    if (!isList(it)) {
      out.push(it);
      continue;
    }
    const h = head(it) ?? '';
    if (h === 'footprint' || h === 'module') {
      if (fi < board.footprints.length) out.push(writeFootprintNode(board.footprints[fi]!));
      fi++;
    } else if (h === 'segment') {
      if (ti < board.tracks.length) out.push(trackNode(board.tracks[ti]!));
      ti++;
    } else if (h === 'arc') {
      if (ai < board.arcs.length) out.push(arcTrackNode(board.arcs[ai]!));
      ai++;
    } else if (h === 'via') {
      if (vi < board.vias.length) out.push(viaNode(board.vias[vi]!));
      vi++;
    } else if (h === 'zone') {
      if (zi < board.zones.length) out.push(zoneNode(board.zones[zi]!));
      zi++;
    } else if (GRAPHIC_HEADS.has(h)) {
      if (si < board.shapes.length) out.push(shapeNode(board.shapes[si]!));
      si++;
    } else if (h === 'gr_text') {
      if (xi < board.texts.length) out.push(textNode(board.texts[xi]!));
      xi++;
    } else if (h === 'gr_text_box') {
      if (bi < board.textBoxes.length) out.push(textBoxNode(board.textBoxes[bi]!));
      bi++;
    } else if (h === 'image') {
      if (ii < board.images.length) out.push(imageNode(board.images[ii]!));
      ii++;
    } else if (h === 'table') {
      if (tbi < board.tables.length) out.push(tableNode(board.tables[tbi]!));
      tbi++;
    } else if (h === 'dimension') {
      if (di < board.dimensions.length) out.push(dimensionNode(board.dimensions[di]!));
      di++;
    } else if (h === 'point') {
      if (pi < board.points.length) out.push(pointNode(board.points[pi]!));
      pi++;
    } else if (h === 'barcode') {
      if (bci < board.barcodes.length) out.push(barcodeNode(board.barcodes[bci]!));
      bci++;
    } else if (h === 'group') {
      // Empty groups are never written (PCB_IO_KICAD_SEXPR::format(PCB_GROUP)).
      if (gi < board.groups.length && board.groups[gi]!.members.length > 0)
        out.push(groupNode(board.groups[gi]!));
      gi++;
    } else if (h === 'generator') {
      // We wrote this file, so we name ourselves, as KiCad does on save.
      out.push(list(atom('generator'), str(GENERATOR)));
    } else if (h === 'generator_version') {
      out.push(list(atom('generator_version'), str(GENERATOR_VERSION)));
    } else out.push(it);
  }

  // Append items the model gained beyond what the source held (duplicate/place).
  for (; fi < board.footprints.length; fi++) out.push(writeFootprintNode(board.footprints[fi]!));
  for (; ti < board.tracks.length; ti++) out.push(trackNode(board.tracks[ti]!));
  for (; ai < board.arcs.length; ai++) out.push(arcTrackNode(board.arcs[ai]!));
  for (; vi < board.vias.length; vi++) out.push(viaNode(board.vias[vi]!));
  for (; si < board.shapes.length; si++) out.push(shapeNode(board.shapes[si]!));
  for (; xi < board.texts.length; xi++) out.push(textNode(board.texts[xi]!));
  for (; zi < board.zones.length; zi++) out.push(zoneNode(board.zones[zi]!));
  for (; bi < board.textBoxes.length; bi++) out.push(textBoxNode(board.textBoxes[bi]!));
  for (; ii < board.images.length; ii++) out.push(imageNode(board.images[ii]!));
  for (; tbi < board.tables.length; tbi++) out.push(tableNode(board.tables[tbi]!));
  for (; di < board.dimensions.length; di++) out.push(dimensionNode(board.dimensions[di]!));
  // With the graphics and before the points: a barcode is a `BOARD::Drawings()`
  // item (`board.cpp:1504`), so `format( const BOARD* )` writes it in the
  // `sorted_drawings` loop (:833) that runs ahead of `sorted_points` (:837).
  for (; bci < board.barcodes.length; bci++) out.push(barcodeNode(board.barcodes[bci]!));
  for (; pi < board.points.length; pi++) out.push(pointNode(board.points[pi]!));
  for (; gi < board.groups.length; gi++)
    if (board.groups[gi]!.members.length > 0) out.push(groupNode(board.groups[gi]!));

  return { kind: 'list', items: out };
}

/** Serialize a board to `.kicad_pcb` text. */
export function serializeBoard(board: Board): string {
  return serialize(writeBoardNode(board));
}
