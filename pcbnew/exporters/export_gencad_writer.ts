// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GENCAD_EXPORTER` (pcbnew/exporters/export_gencad_writer.cpp/.h): board to
 * GenCAD 1.4 text. Operates on the live `BOARD`, like `GENCAD_EXPORTER` does
 * on its `BOARD*` — GenCAD needs `MergePrimitivesAsPolygon`,
 * `GetBoardPolygonOutlines`, `GetFPRelativePosition` and the padstack layer
 * machinery, none of which the plain record view exposes.
 *
 * `export_gencad.cpp` (`BOARD_EDITOR_CONTROL::ExportGenCAD`, the dialog and
 * tool-action glue) is not ported here — that is UI wiring, not the writer.
 *
 * ## The shape-dedup hash
 *
 * `createShapesSection` reuses a `$SHAPES` entry across footprints with
 * identical geometry, keyed by a structural hash (`hash_fp_item`,
 * `common/hash_eda.cpp`) over each pad/graphic's shape, size, offset, layer
 * set, **absolute** orientation (not relative to the footprint — a real
 * asymmetry in upstream's own hash: position is footprint-relative,
 * rotation is not, so two identical footprints reuse a shape only when
 * placed at the same board rotation too) and **relative** position. This
 * port reproduces the same field set as a canonical string key rather than
 * a numeric hash — the hash value itself is never printed, only used to
 * group, so a collision-free string key is an equivalent, more legible
 * reimplementation. Not reproduced: `CHAMFERED_RECT` and `CUSTOM` pads
 * contribute their outline polygon to upstream's hash; here they contribute
 * only their declared parameters, so two footprints that differ *only* in a
 * custom pad's primitive list could be over-merged. `useIndividualShapes`
 * (`UseIndividualShapes` / kicad-cli's `--unique-footprints`) sidesteps the
 * whole question — each footprint gets its own shape named after its
 * reference — and is what this port's oracle test verifies byte-exact.
 */

import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { ANGLE_0, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GENERATOR_APPLICATION, GENERATOR_VERSION } from '@ziroeda/common/generator.js';
import { PCB_LAYER_ID, IsCopperLayer } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from '../board.js';
import type { FOOTPRINT } from '../footprint.js';
import { PAD } from '../pad.js';
import { PAD_SHAPE, PADSTACK } from '../padstack.js';
import type { PCB_TRACK } from '../pcb_track.js';
import { PCB_VIA, PCB_ARC } from '../pcb_track.js';
import type { PCB_SHAPE } from '../pcb_shape.js';

export interface GenCadOptions {
  /** `SetPlotOffet`: the export origin (the auxiliary axis), in IU. */
  plotOffset?: VECTOR2I;
  /** `FlipBottomPads`: flip pad shapes on the bottom side. */
  flipBottomPads?: boolean;
  /** `UsePinNamesUnique`: make pin names unique. */
  useUniquePins?: boolean;
  /** `UseIndividualShapes` / kicad-cli `--unique-footprints`. */
  useIndividualShapes?: boolean;
  /** `StoreOriginCoordsInFile`. */
  storeOriginCoords?: boolean;
}

// GerbTool chokes on units different than INCH, so this is the conversion factor.
const SCALE_FACTOR = 1000.0 * pcbIUScale.IU_PER_MILS;

const escapeString = (s: string): string => s.replace(/"/g, '\\"');

/** `genCADLayerName`. */
function genCadLayerName(cuCount: number, id: PCB_LAYER_ID): string {
  if (IsCopperLayer(id)) {
    if (id === PCB_LAYER_ID.F_Cu) return 'TOP';
    if (id === PCB_LAYER_ID.B_Cu) return 'BOTTOM';
    if (id <= 14) return `INNER${cuCount - id - 1}`;
    return `LAYER${id}`;
  }

  switch (id) {
    case PCB_LAYER_ID.B_Adhes:
      return 'B.Adhes';
    case PCB_LAYER_ID.F_Adhes:
      return 'F.Adhes';
    case PCB_LAYER_ID.B_Paste:
      return 'SOLDERPASTE_BOTTOM';
    case PCB_LAYER_ID.F_Paste:
      return 'SOLDERPASTE_TOP';
    case PCB_LAYER_ID.B_SilkS:
      return 'SILKSCREEN_BOTTOM';
    case PCB_LAYER_ID.F_SilkS:
      return 'SILKSCREEN_TOP';
    case PCB_LAYER_ID.B_Mask:
      return 'SOLDERMASK_BOTTOM';
    case PCB_LAYER_ID.F_Mask:
      return 'SOLDERMASK_TOP';
    case PCB_LAYER_ID.Dwgs_User:
      return 'Dwgs.User';
    case PCB_LAYER_ID.Cmts_User:
      return 'Cmts.User';
    case PCB_LAYER_ID.Eco1_User:
      return 'Eco1.User';
    case PCB_LAYER_ID.Eco2_User:
      return 'Eco2.User';
    case PCB_LAYER_ID.Edge_Cuts:
      return 'Edge.Cuts';
    case PCB_LAYER_ID.Margin:
      return 'Margin';
    case PCB_LAYER_ID.F_CrtYd:
      return 'F_CrtYd';
    case PCB_LAYER_ID.B_CrtYd:
      return 'B_CrtYd';
    case PCB_LAYER_ID.F_Fab:
      return 'F_Fab';
    case PCB_LAYER_ID.B_Fab:
      return 'B_Fab';
    default:
      return 'BAD-INDEX!';
  }
}

/** `genCADLayerNameFlipped`. */
function genCadLayerNameFlipped(cuCount: number, id: PCB_LAYER_ID): string {
  if (id >= 1 && id <= 14) return `INNER${14 - id}`;
  return genCadLayerName(cuCount, id);
}

/** `fmt_mask`: `(aSet & AllCuMask()).to_string()`, leading zeros stripped. */
function fmtMask(set: LSET, cuCount: number): string {
  const masked = new LSET(set);
  masked.andAssign(LSET.AllCuMask(cuCount));
  let s = '';
  for (let i = masked.size() - 1; i >= 0; i--) s += masked.test(i) ? '1' : '0';
  return s.replace(/^0+/, '');
}

const mapXTo = (x: number, offset: VECTOR2I): number => (x - offset.x) / SCALE_FACTOR;
const mapYTo = (y: number, offset: VECTOR2I): number => (offset.y - y) / SCALE_FACTOR;

/**
 * The structural key `createShapesSection`'s dedup groups footprints by —
 * see the file header's note on the hash it stands in for.
 */
function footprintShapeKey(fp: FOOTPRINT): string {
  const parts: string[] = [];

  for (const pad of fp.Pads()) {
    const layer = PADSTACK.ALL_LAYERS;
    const size = pad.GetSize(layer);
    const off = pad.GetOffset(layer);
    const shape = pad.GetShape(layer);
    const extra: (string | number)[] = [];

    if (shape === PAD_SHAPE.CHAMFERED_RECT) {
      extra.push(pad.GetChamferPositions(layer), pad.GetChamferRectRatio(layer));
    } else if (shape === PAD_SHAPE.ROUNDRECT) {
      extra.push(pad.GetRoundRectCornerRadius(layer));
    } else if (shape === PAD_SHAPE.TRAPEZOID) {
      const d = pad.GetDelta(layer);
      extra.push(d.x, d.y);
    }

    const pos = pad.GetFPRelativePosition();

    parts.push(
      [
        'P',
        pad.GetAttribute(),
        shape,
        size.x,
        size.y,
        off.x,
        off.y,
        ...extra,
        fmtMask(pad.GetLayerSet(), 32),
        pos.x,
        pos.y,
        pad.GetOrientation().AsDegrees(),
      ].join(','),
    );
  }

  for (const item of fp.GraphicalItems()) {
    if (item.Type() !== KICAD_T.PCB_SHAPE_T) continue;

    const shape = item as unknown as PCB_SHAPE;
    const points: VECTOR2I[] = [shape.GetStart(), shape.GetEnd()];

    if (shape.GetShape() === SHAPE_T.CIRCLE) points.push(shape.GetCenter());
    if (shape.GetShape() === SHAPE_T.ARC) points.push(shape.GetCenter());

    for (const p of points) {
      const rel = RotatePoint(
        { x: p.x - fp.GetPosition().x, y: p.y - fp.GetPosition().y } as VECTOR2I,
        fp.GetOrientation().Invert(),
      );
      parts.push(`S,${shape.GetShape()},${shape.GetWidth()},${shape.GetLayer()},${rel.x},${rel.y}`);
    }
  }

  parts.sort();
  return `${fp.GetFPID().Format()}\u0000${parts.join('|')}`;
}

/**
 * `createHeaderInfoData`. Upstream's `USER` line is always `"KiCad <version>"`
 * (`GetBuildVersion()`); ours carries our own identity instead, the same
 * reason `GENERATOR_APPLICATION` exists everywhere else a file names its
 * writer.
 */
function createHeaderInfoData(board: BOARD, offset: VECTOR2I, storeOrigin: boolean): string {
  let out = '$HEADER\n';
  out += 'GENCAD 1.4\n';
  out += `USER "${escapeString(GENERATOR_APPLICATION)} ${GENERATOR_VERSION}"\n`;
  out += `DRAWING "${escapeString(board.GetFileName())}"\n`;
  out += `REVISION "${escapeString(board.GetTitleBlock().GetRevision())} ${escapeString(
    board.GetTitleBlock().GetDate(),
  )}"\n`;
  out += 'UNITS INCH\n';
  out += `ORIGIN ${storeOrigin ? mapXTo(0, offset) : 0} ${storeOrigin ? mapYTo(0, offset) : 0}\n`;
  out += 'INTERTRACK 0\n';
  out += '$ENDHEADER\n\n';
  return out;
}

/** `createArtworksSection`: empty but mandatory. */
function createArtworksSection(): string {
  return '$ARTWORKS\n$ENDARTWORKS\n\n';
}

/** `createBoardSection`: the board perimeter, via `GetBoardPolygonOutlines`. */
function createBoardSection(board: BOARD, offset: VECTOR2I): string {
  let out = '$BOARD\n';
  const outline = new SHAPE_POLY_SET();
  board.GetBoardPolygonOutlines(outline, true);

  for (const seg of outline.IterateSegmentsWithHoles()) {
    out += `LINE ${mapXTo(seg.A.x, offset)} ${mapYTo(seg.A.y, offset)} ${mapXTo(seg.B.x, offset)} ${mapYTo(seg.B.y, offset)}\n`;
  }

  out += '$ENDBOARD\n\n';
  return out;
}

interface PadShapeCtx {
  padstacks: PAD[];
  vias: PCB_VIA[];
  viastacks: PCB_VIA[];
}

/** One `PAD ...` + shape body, for a component pad — `createPadsShapesSection`'s per-pad switch. */
function writePadShape(pad: PAD, index: number): string {
  const layer = PADSTACK.ALL_LAYERS;
  const off = pad.GetOffset(layer);
  const size = pad.GetSize(layer);
  const dx = size.x / 2;
  const dy = size.y / 2;
  let out = `PAD P${index}`;

  switch (pad.GetShape(layer)) {
    case PAD_SHAPE.RECTANGLE:
      out += ` RECTANGULAR ${pad.GetDrillSize().x / SCALE_FACTOR}\n`;
      out += `RECTANGLE ${(-dx + off.x) / SCALE_FACTOR} ${(-dy - off.y) / SCALE_FACTOR} ${dx / (SCALE_FACTOR / 2)} ${dy / (SCALE_FACTOR / 2)}\n`;
      break;

    case PAD_SHAPE.ROUNDRECT:
    case PAD_SHAPE.OVAL: {
      let radius = Math.min(size.x, size.y) / 2;
      if (pad.GetShape(layer) === PAD_SHAPE.ROUNDRECT) radius = pad.GetRoundRectCornerRadius(layer);

      const lineX = size.x / 2 - radius;
      const lineY = size.y / 2 - radius;

      out += ` POLYGON ${pad.GetDrillSize().x / SCALE_FACTOR}\n`;
      out += `ARC ${(off.x - lineX - radius) / SCALE_FACTOR} ${(-off.y - lineY) / SCALE_FACTOR} ${(off.x - lineX) / SCALE_FACTOR} ${(-off.y - lineY - radius) / SCALE_FACTOR} ${(off.x - lineX) / SCALE_FACTOR} ${(-off.y - lineY) / SCALE_FACTOR}\n`;
      if (lineX > 0)
        out += `LINE ${(off.x - lineX) / SCALE_FACTOR} ${(-off.y - lineY - radius) / SCALE_FACTOR} ${(off.x + lineX) / SCALE_FACTOR} ${(-off.y - lineY - radius) / SCALE_FACTOR}\n`;
      out += `ARC ${(off.x + lineX) / SCALE_FACTOR} ${(-off.y - lineY - radius) / SCALE_FACTOR} ${(off.x + lineX + radius) / SCALE_FACTOR} ${(-off.y - lineY) / SCALE_FACTOR} ${(off.x + lineX) / SCALE_FACTOR} ${(-off.y - lineY) / SCALE_FACTOR}\n`;
      if (lineY > 0)
        out += `LINE ${(off.x + lineX + radius) / SCALE_FACTOR} ${(-off.y + lineY) / SCALE_FACTOR} ${(off.x + lineX + radius) / SCALE_FACTOR} ${(-off.y - lineY) / SCALE_FACTOR}\n`;
      out += `ARC ${(off.x + lineX + radius) / SCALE_FACTOR} ${(-off.y + lineY) / SCALE_FACTOR} ${(off.x + lineX) / SCALE_FACTOR} ${(-off.y + lineY + radius) / SCALE_FACTOR} ${(off.x + lineX) / SCALE_FACTOR} ${(-off.y + lineY) / SCALE_FACTOR}\n`;
      if (lineX > 0)
        out += `LINE ${(off.x - lineX) / SCALE_FACTOR} ${(-off.y + lineY + radius) / SCALE_FACTOR} ${(off.x + lineX) / SCALE_FACTOR} ${(-off.y + lineY + radius) / SCALE_FACTOR}\n`;
      out += `ARC ${(off.x - lineX) / SCALE_FACTOR} ${(-off.y + lineY + radius) / SCALE_FACTOR} ${(off.x - lineX - radius) / SCALE_FACTOR} ${(-off.y + lineY) / SCALE_FACTOR} ${(off.x - lineX) / SCALE_FACTOR} ${(-off.y + lineY) / SCALE_FACTOR}\n`;
      if (lineY > 0)
        out += `LINE ${(off.x - lineX - radius) / SCALE_FACTOR} ${(-off.y - lineY) / SCALE_FACTOR} ${(off.x - lineX - radius) / SCALE_FACTOR} ${(-off.y + lineY) / SCALE_FACTOR}\n`;
      break;
    }

    case PAD_SHAPE.TRAPEZOID: {
      out += ` POLYGON ${pad.GetDrillSize().x / SCALE_FACTOR}\n`;
      const delta = pad.GetDelta(layer);
      const ddx = delta.x / 2;
      const ddy = delta.y / 2;
      const poly: VECTOR2I[] = [
        { x: -dx + ddy, y: dy + ddx } as VECTOR2I,
        { x: dx - ddy, y: dy - ddx } as VECTOR2I,
        { x: dx + ddy, y: -dy + ddx } as VECTOR2I,
        { x: -dx - ddy, y: -dy - ddx } as VECTOR2I,
      ];
      for (let cur = 0; cur < 4; cur++) {
        const next = (cur + 1) % 4;
        out += `LINE ${(off.x + poly[cur]!.x) / SCALE_FACTOR} ${(-off.y - poly[cur]!.y) / SCALE_FACTOR} ${(off.x + poly[next]!.x) / SCALE_FACTOR} ${(-off.y - poly[next]!.y) / SCALE_FACTOR}\n`;
      }
      break;
    }

    case PAD_SHAPE.CIRCLE:
    default:
      out += ` ROUND ${pad.GetDrillSize().x / SCALE_FACTOR}\n`;
      out += `CIRCLE ${off.x / SCALE_FACTOR} ${-off.y / SCALE_FACTOR} ${size.x / (SCALE_FACTOR * 2)}\n`;
      break;
  }

  return out;
}

/** `createPadsShapesSection`: $PADS + $PADSTACKS. */
function createPadsShapesSection(
  board: BOARD,
  flipBottomPads: boolean,
): { text: string; ctx: PadShapeCtx } {
  const cuCount = board.GetCopperLayerCount();
  const masterLayermask = board.GetDesignSettings().GetEnabledLayers();
  const gcSeq = [...board.GetEnabledLayers().CuStack()].reverse();

  let out = '$PADS\n';

  const pads = [...board.GetPads()].sort((a, b) => PAD.Compare(a, b));

  const viaSort = (a: PCB_VIA, b: PCB_VIA): number => {
    if (a.GetWidth(PADSTACK.ALL_LAYERS) !== b.GetWidth(PADSTACK.ALL_LAYERS))
      return a.GetWidth(PADSTACK.ALL_LAYERS) - b.GetWidth(PADSTACK.ALL_LAYERS);
    if (a.GetDrillValue() !== b.GetDrillValue()) return a.GetDrillValue() - b.GetDrillValue();
    const la = a.GetLayerSet().FmtBin();
    const lb = b.GetLayerSet().FmtBin();
    return la < lb ? -1 : la > lb ? 1 : 0;
  };

  const vias: PCB_VIA[] = [];
  for (const track of board.Tracks()) if (track instanceof PCB_VIA) vias.push(track);
  vias.sort(viaSort);
  const uniqueVias: PCB_VIA[] = [];
  for (const v of vias) {
    const prev = uniqueVias.at(-1);
    if (!prev || viaSort(prev, v) !== 0) uniqueVias.push(v);
  }

  const viastacks: PCB_VIA[] = [];
  for (const via of uniqueVias) {
    viastacks.push(via);
    out += `PAD V${via.GetWidth(PADSTACK.ALL_LAYERS)}.${via.GetDrillValue()}.${fmtMask(via.GetLayerSet(), cuCount)} ROUND ${via.GetDrillValue() / SCALE_FACTOR}\n`;
    out += `CIRCLE 0 0 ${via.GetWidth(PADSTACK.ALL_LAYERS) / (SCALE_FACTOR * 2)}\n`;
  }

  const padstacks: PAD[] = [];
  let oldPad: PAD | null = null;
  let padNameNumber = 0;

  for (const pad of pads) {
    pad.SetSubRatsnest(padNameNumber);

    if (oldPad && PAD.Compare(oldPad, pad) === 0) continue;

    oldPad = pad;
    padNameNumber++;
    pad.SetSubRatsnest(padNameNumber);

    padstacks.push(pad);
    out += writePadShape(pad, pad.GetSubRatsnest());
  }

  out += '\n$ENDPADS\n\n';
  out += '$PADSTACKS\n';

  for (const via of viastacks) {
    const mask = new LSET(via.GetLayerSet());
    mask.andAssign(masterLayermask);
    out += `PADSTACK VIA${via.GetWidth(PADSTACK.ALL_LAYERS)}.${via.GetDrillValue()}.${fmtMask(mask, cuCount)} ${via.GetDrillValue() / SCALE_FACTOR}\n`;

    for (const layer of mask.Seq(gcSeq)) {
      out += `PAD V${via.GetWidth(PADSTACK.ALL_LAYERS)}.${via.GetDrillValue()}.${fmtMask(mask, cuCount)} ${genCadLayerName(cuCount, layer)} 0 0\n`;
    }
  }

  for (let i = 0; i < padstacks.length; i++) {
    const pad = padstacks[i]!;
    const idx = i + 1;
    out += `PADSTACK PAD${idx} ${pad.GetDrillSize().x / SCALE_FACTOR}\n`;

    const padSet = new LSET(pad.GetLayerSet());
    padSet.andAssign(masterLayermask);

    for (const layer of padSet.Seq(gcSeq))
      out += `PAD P${idx} ${genCadLayerName(cuCount, layer)} 0 0\n`;

    if (flipBottomPads) {
      out += `PADSTACK PAD${idx}F ${pad.GetDrillSize().x / SCALE_FACTOR}\n`;
      for (const layer of padSet.Seq())
        out += `PAD P${idx} ${genCadLayerNameFlipped(cuCount, layer)} 0 0\n`;
    }
  }

  out += '$ENDPADSTACKS\n\n';

  return { text: out, ctx: { padstacks, vias: uniqueVias, viastacks } };
}

/** `footprintWriteShape`: the SHAPE body (silk outline). */
function footprintWriteShape(fp: FOOTPRINT, shapeName: string): string {
  let out = `\nSHAPE "${escapeString(shapeName)}"\n`;
  out += fp.GetAttributes() & 1 /* FP_THROUGH_HOLE */ ? 'INSERT TH\n' : 'INSERT SMD\n';

  for (const item of fp.GraphicalItems()) {
    if (item.Type() !== KICAD_T.PCB_SHAPE_T) continue;
    const shape = item as unknown as PCB_SHAPE;
    if (shape.GetLayer() !== PCB_LAYER_ID.F_SilkS && shape.GetLayer() !== PCB_LAYER_ID.B_SilkS)
      continue;

    const rel = (p: VECTOR2I): VECTOR2I =>
      RotatePoint(
        { x: p.x - fp.GetPosition().x, y: p.y - fp.GetPosition().y } as VECTOR2I,
        fp.GetOrientation().Invert(),
      );
    const start = rel(shape.GetStart());
    const end = rel(shape.GetEnd());
    const center = rel(shape.GetCenter());

    switch (shape.GetShape()) {
      case SHAPE_T.SEGMENT:
        out += `LINE ${start.x / SCALE_FACTOR} ${-start.y / SCALE_FACTOR} ${end.x / SCALE_FACTOR} ${-end.y / SCALE_FACTOR}\n`;
        break;
      case SHAPE_T.RECTANGLE:
        out += `LINE ${start.x / SCALE_FACTOR} ${-start.y / SCALE_FACTOR} ${end.x / SCALE_FACTOR} ${-start.y / SCALE_FACTOR}\n`;
        out += `LINE ${end.x / SCALE_FACTOR} ${-start.y / SCALE_FACTOR} ${end.x / SCALE_FACTOR} ${-end.y / SCALE_FACTOR}\n`;
        out += `LINE ${end.x / SCALE_FACTOR} ${-end.y / SCALE_FACTOR} ${start.x / SCALE_FACTOR} ${-end.y / SCALE_FACTOR}\n`;
        out += `LINE ${start.x / SCALE_FACTOR} ${-end.y / SCALE_FACTOR} ${start.x / SCALE_FACTOR} ${-start.y / SCALE_FACTOR}\n`;
        break;
      case SHAPE_T.CIRCLE: {
        const radius = KiROUND(Math.hypot(end.x - start.x, end.y - start.y));
        out += `CIRCLE ${start.x / SCALE_FACTOR} ${-start.y / SCALE_FACTOR} ${radius / SCALE_FACTOR}\n`;
        break;
      }
      case SHAPE_T.ARC: {
        let a = start;
        let b = end;
        if (shape.GetArcAngle().gt(ANGLE_0)) {
          a = end;
          b = start;
        }
        out += `ARC ${a.x / SCALE_FACTOR} ${-a.y / SCALE_FACTOR} ${b.x / SCALE_FACTOR} ${-b.y / SCALE_FACTOR} ${center.x / SCALE_FACTOR} ${-center.y / SCALE_FACTOR}\n`;
        break;
      }
      default:
        break;
    }
  }

  return out;
}

/** `createShapesSection`: $SHAPES, and the shape-name assignment `createComponentsSection`/`createDevicesSection` reuse. */
function createShapesSection(
  board: BOARD,
  useIndividualShapes: boolean,
  useUniquePins: boolean,
  flipBottomPads: boolean,
): { text: string; shapeNameOf: Map<FOOTPRINT, string>; deviceReps: Map<string, FOOTPRINT> } {
  let out = '$SHAPES\n';
  const shapeNameOf = new Map<FOOTPRINT, string>();
  const deviceReps = new Map<string, FOOTPRINT>();
  // Mirrors upstream's two maps: `shapeNames` (hash -> chosen name) and
  // `shapes` (name -> hash), the latter only so a *different*-shaped
  // footprint sharing a library id gets a `_0`, `_1`, ... suffix.
  const nameByKey = new Map<string, string>();
  const keyByName = new Map<string, string>();

  for (const fp of board.Footprints()) {
    let shapeName: string;

    if (useIndividualShapes) {
      // Upstream never populates `componentShapes` on this branch, so
      // `createDevicesSection` later emits nothing for these footprints.
      shapeName = fp.GetReference();
      shapeNameOf.set(fp, shapeName);
      out += footprintWriteShape(fp, shapeName);
    } else {
      const baseName = fp.GetFPID().Format();
      const key = footprintShapeKey(fp);
      const existingName = nameByKey.get(key);

      if (existingName !== undefined) {
        // Shape reused: upstream `continue`s here, skipping this
        // footprint's own PIN block entirely — the shared shape's pins
        // (from whichever footprint defined it) are the only ones emitted.
        shapeName = existingName;
        shapeNameOf.set(fp, shapeName);
        if (!deviceReps.has(shapeName)) deviceReps.set(shapeName, fp);
        continue;
      }

      let candidate = baseName;
      let collidingKey = keyByName.get(candidate);
      if (collidingKey !== undefined && collidingKey !== key) {
        let suffix = 0;
        let attempt: string;
        do {
          attempt = `${baseName}_${suffix}`;
          collidingKey = keyByName.get(attempt);
          suffix++;
        } while (collidingKey !== undefined && collidingKey !== key);
        candidate = attempt;
      }

      shapeName = candidate;
      nameByKey.set(key, shapeName);
      keyByName.set(shapeName, key);
      shapeNameOf.set(fp, shapeName);
      if (!deviceReps.has(shapeName)) deviceReps.set(shapeName, fp);
      out += footprintWriteShape(fp, shapeName);
    }

    const pins = new Set<string>();

    for (const pad of fp.Pads()) {
      let pinname = pad.GetNumber();
      if (pinname === '') pinname = 'none';

      if (useUniquePins) {
        let suffix = 0;
        const orig = pinname;
        while (pins.has(pinname)) {
          pinname = `${orig}_${suffix}`;
          suffix++;
        }
        pins.add(pinname);
      }

      const orient = pad.GetOrientation().sub(fp.GetOrientation());
      orient.Normalize();
      const padPos = pad.GetFPRelativePosition();
      const flipStr = flipBottomPads && fp.GetFlag() ? 'F' : '';

      out += `PIN "${escapeString(pinname)}" PAD${pad.GetSubRatsnest()}${flipStr} ${padPos.x / SCALE_FACTOR} ${-padPos.y / SCALE_FACTOR} TOP ${orient.AsDegrees()} 0\n`;
    }
  }

  out += '$ENDSHAPES\n\n';
  return { text: out, shapeNameOf, deviceReps };
}

/** `createComponentsSection`: $COMPONENTS. */
function createComponentsSection(
  board: BOARD,
  shapeNameOf: Map<FOOTPRINT, string>,
  offset: VECTOR2I,
): string {
  let out = '$COMPONENTS\n';
  const cuCount = board.GetCopperLayerCount();

  for (const fp of board.Footprints()) {
    const flipped = fp.GetFlag() !== 0;
    const mirror = flipped ? 'MIRRORX' : '0';
    const flip = flipped ? 'FLIP' : '0';
    let fpOrient = fp.GetOrientation();
    if (flipped) fpOrient = fpOrient.Invert().Normalize();

    const shapeName = shapeNameOf.get(fp)!;

    out += `\nCOMPONENT "${escapeString(fp.GetReference())}"\n`;
    out += `DEVICE "DEV_${escapeString(shapeName)}"\n`;
    out += `PLACE ${mapXTo(fp.GetPosition().x, offset)} ${mapYTo(fp.GetPosition().y, offset)}\n`;
    out += `LAYER ${flipped ? 'BOTTOM' : 'TOP'}\n`;
    out += `ROTATION ${fpOrient.AsDegrees()}\n`;
    out += `SHAPE "${escapeString(shapeName)}" ${mirror} ${flip}\n`;

    for (const textItem of [fp.Reference(), fp.Value()]) {
      const layer = genCadLayerName(cuCount, flipped ? PCB_LAYER_ID.B_SilkS : PCB_LAYER_ID.F_SilkS);
      const pos = textItem.GetFPRelativePosition();

      out += `TEXT ${pos.x / SCALE_FACTOR} ${-pos.y / SCALE_FACTOR} ${textItem.GetTextWidth() / SCALE_FACTOR} ${textItem.GetTextAngle().AsDegrees()} ${mirror} ${layer} "${escapeString(textItem.GetText())}"`;

      const box = textItem.GetTextBox(null);
      out += ` 0 0 ${box.GetWidth() / SCALE_FACTOR} ${box.GetHeight() / SCALE_FACTOR}\n`;
    }

    out += `SHEET "RefDes: ${fp.GetReference()}, Value: ${fp.GetValue()}"\n`;
  }

  out += '$ENDCOMPONENTS\n\n';
  return out;
}

/** `createDevicesSection`: $DEVICES, sorted (upstream sorts to make map-order irrelevant). */
function createDevicesSection(deviceReps: Map<string, FOOTPRINT>): string {
  let out = '$DEVICES\n';

  const data: string[] = [];
  for (const [shapeName, fp] of deviceReps) {
    let txt = `\nDEVICE "DEV_${escapeString(shapeName)}"\n`;
    txt += `PART "${escapeString(fp.GetValue())}"\n`;
    txt += `PACKAGE "${escapeString(fp.GetFPID().Format())}"\n`;
    data.push(txt);
  }

  data.sort();
  for (const item of data) out += item;

  out += '$ENDDEVICES\n\n';
  return out;
}

/** `createSignalsSection`: $SIGNALS. */
function createSignalsSection(board: BOARD): string {
  let out = '$SIGNALS\n';

  for (let i = 0; i < board.GetNetCount(); i++) {
    const net = board.FindNet(i);
    if (!net) continue;
    if (net.GetNetCode() <= 0) continue;

    out += `SIGNAL "${escapeString(net.GetNetname())}"\n`;

    for (const fp of board.Footprints()) {
      for (const pad of fp.Pads()) {
        if (pad.GetNetCode() !== net.GetNetCode()) continue;
        out += `NODE "${escapeString(fp.GetReference())}" "${escapeString(pad.GetNumber())}"\n`;
      }
    }
  }

  out += '$ENDSIGNALS\n\n';
  return out;
}

/** `createTracksInfoData`: $TRACKS. */
function createTracksInfoData(board: BOARD): string {
  const widths = new Set<number>();
  for (const track of board.Tracks()) {
    if (track.Type() === KICAD_T.PCB_VIA_T) continue;
    widths.add(track.GetWidth());
  }

  let out = '$TRACKS\n';
  for (const size of [...widths].sort((a, b) => a - b))
    out += `TRACK TRACK${size} ${size / SCALE_FACTOR}\n`;
  out += '$ENDTRACKS\n\n';
  return out;
}

/** `createRoutesSection`: $ROUTES (tracks, arcs and vias). */
function createRoutesSection(board: BOARD, offset: VECTOR2I): string {
  const masterLayermask = board.GetDesignSettings().GetEnabledLayers();
  const cuCount = board.GetCopperLayerCount();

  const widthOf = (t: PCB_TRACK): number =>
    t.Type() === KICAD_T.PCB_VIA_T ? (t as PCB_VIA).GetWidth(PADSTACK.ALL_LAYERS) : t.GetWidth();

  const tracks = [...board.Tracks()].sort((a, b) => {
    const wa = widthOf(a);
    const wb = widthOf(b);
    if (a.GetNetCode() === b.GetNetCode()) {
      if (wa === wb) return a.GetLayer() - b.GetLayer();
      return wa - wb;
    }
    return a.GetNetCode() - b.GetNetCode();
  });

  let out = '$ROUTES\n';
  let oldNetcode = -1;
  let oldWidth = -1;
  let oldLayer = -1;
  let vianum = 1;

  for (const track of tracks) {
    if (oldNetcode !== track.GetNetCode()) {
      oldNetcode = track.GetNetCode();
      const net = track.GetNet();
      const netname = net && net.GetNetname() !== '' ? net.GetNetname() : '_noname_';
      out += `ROUTE "${escapeString(netname)}"\n`;
    }

    const currentWidth = widthOf(track);
    if (oldWidth !== currentWidth) {
      oldWidth = currentWidth;
      out += `TRACK TRACK${currentWidth}\n`;
    }

    if (track.Type() === KICAD_T.PCB_TRACE_T) {
      if (oldLayer !== track.GetLayer()) {
        oldLayer = track.GetLayer();
        out += `LAYER ${genCadLayerName(cuCount, track.GetLayer())}\n`;
      }
      out += `LINE ${mapXTo(track.GetStart().x, offset)} ${mapYTo(track.GetStart().y, offset)} ${mapXTo(track.GetEnd().x, offset)} ${mapYTo(track.GetEnd().y, offset)}\n`;
    } else if (track.Type() === KICAD_T.PCB_ARC_T) {
      if (oldLayer !== track.GetLayer()) {
        oldLayer = track.GetLayer();
        out += `LAYER ${genCadLayerName(cuCount, track.GetLayer())}\n`;
      }
      const arc = track as PCB_ARC;
      let start = track.GetStart();
      let end = track.GetEnd();
      if (arc.IsCCW()) {
        const tmp = start;
        start = end;
        end = tmp;
      }
      const center = arc.GetCenter();
      out += `ARC ${mapXTo(start.x, offset)} ${mapYTo(start.y, offset)} ${mapXTo(end.x, offset)} ${mapYTo(end.y, offset)} ${mapXTo(center.x, offset)} ${mapYTo(center.y, offset)}\n`;
    } else if (track.Type() === KICAD_T.PCB_VIA_T) {
      const via = track as PCB_VIA;
      const vset = new LSET(via.GetLayerSet());
      vset.andAssign(masterLayermask);
      out += `VIA VIA${via.GetWidth(PADSTACK.ALL_LAYERS)}.${via.GetDrillValue()}.${fmtMask(vset, cuCount)} ${mapXTo(via.GetStart().x, offset)} ${mapYTo(via.GetStart().y, offset)} ALL ${via.GetDrillValue() / SCALE_FACTOR} via${vianum++}\n`;
    }
  }

  out += '$ENDROUTES\n\n';
  return out;
}

/**
 * `GENCAD_EXPORTER::WriteFile`, minus the file I/O: temporarily flips
 * bottom-side footprints to normal orientation (as upstream does, so shapes
 * export unflipped), builds every section in upstream's mandatory order,
 * then restores the flip.
 */
export function writeGenCad(board: BOARD, opts: GenCadOptions = {}): string {
  const offset = opts.plotOffset ?? ({ x: 0, y: 0 } as VECTOR2I);

  const flipped: FOOTPRINT[] = [];
  for (const fp of board.Footprints()) {
    fp.SetFlag(0);
    if (fp.GetLayer() === PCB_LAYER_ID.B_Cu) {
      fp.Flip(fp.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
      fp.SetFlag(1);
      flipped.push(fp);
    }
  }

  let out = '';
  try {
    out += createHeaderInfoData(board, offset, opts.storeOriginCoords ?? false);
    out += createBoardSection(board, offset);
    out += createPadsShapesSection(board, opts.flipBottomPads ?? false).text;
    out += createArtworksSection();

    const shapes = createShapesSection(
      board,
      opts.useIndividualShapes ?? false,
      opts.useUniquePins ?? false,
      opts.flipBottomPads ?? false,
    );
    out += shapes.text;
    out += createComponentsSection(board, shapes.shapeNameOf, offset);
    out += createDevicesSection(shapes.deviceReps);

    out += createSignalsSection(board);
    out += createTracksInfoData(board);
    out += createRoutesSection(board, offset);
  } finally {
    for (const fp of flipped) {
      fp.Flip(fp.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
      fp.SetFlag(0);
    }
  }

  return out;
}
