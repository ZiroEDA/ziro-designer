// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/exporters/export_hyperlynx.cpp`: HYPERLYNX_EXPORTER, File > Export > Hyperlynx...
 *
 * The .hyp is written line for line as upstream prints it: `%.9f` / `%.10f` through fmt's exact
 * `fixed()`, `%g` through `formatG()`, and `%.Ns` as the first N bytes of the UTF-8 string.
 */
import { STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { fixed, formatG } from '@ziroeda/common/plotters/fmt.js';
import { RPT_SEVERITY_INFO, RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import { BOARD_STACKUP_ITEM_TYPE, IsPrmSpecified } from '../board_stackup_manager/board_stackup.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK } from '../padstack.js';
import type { PCB_ARC, PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import type { ZONE } from '../zone.js';
import { BOARD_EXPORTER_BASE } from './board_exporter_base.js';

function iu2hyp(iu: number): number {
  return iu / 1e9 / 0.0254;
}

/** `%.Ns`: at most N bytes of the string's UTF-8. */
function prec(aText: string, aBytes: number): string {
  const enc = new TextEncoder().encode(aText);

  return enc.length <= aBytes ? aText : new TextDecoder().decode(enc.subarray(0, aBytes));
}

/** `%.9f`, `%.10f`, `%.1f`. */
const f9 = (v: number): string => fixed(v, 9);
const f10 = (v: number): string => fixed(v, 10);

export class HYPERLYNX_PAD_STACK {
  m_board: BOARD;
  m_id = 0;
  m_drill: number;
  m_shape: PAD_SHAPE;
  m_sx: number;
  m_sy: number;
  m_angle: number;
  m_layers: LSET;
  m_type: PAD_ATTRIB;

  constructor(aBoard: BOARD, aItem: PAD | PCB_VIA) {
    this.m_board = aBoard;

    if (aItem.Type() === KICAD_T.PCB_PAD_T) {
      const pad = aItem as PAD;
      // TODO(JE) padstacks
      this.m_sx = pad.GetSize(PADSTACK.ALL_LAYERS).x;
      this.m_sy = pad.GetSize(PADSTACK.ALL_LAYERS).y;
      this.m_angle = 180.0 - pad.GetOrientation().AsDegrees();

      if (this.m_angle < 0.0) this.m_angle += 360.0;

      this.m_layers = pad.GetLayerSet();
      this.m_drill = pad.GetDrillSize().x;
      this.m_shape = pad.GetShape(PADSTACK.ALL_LAYERS);
    } else {
      const via = aItem as PCB_VIA;
      // TODO(JE) padstacks
      this.m_sx = this.m_sy = via.GetWidth(PADSTACK.ALL_LAYERS);
      this.m_angle = 0;
      this.m_layers = via.GetLayerSet();
      this.m_drill = via.GetDrillValue();
      this.m_shape = PAD_SHAPE.CIRCLE;
    }

    this.m_type = PAD_ATTRIB.PTH;
  }

  IsThrough(): boolean {
    return this.m_type === PAD_ATTRIB.NPTH || this.m_type === PAD_ATTRIB.PTH;
  }

  /** `operator==`. */
  Equals(other: HYPERLYNX_PAD_STACK): boolean {
    if (this.m_shape !== other.m_shape) return false;

    if (this.m_type !== other.m_type) return false;

    if (this.IsThrough() && other.IsThrough() && this.m_drill !== other.m_drill) return false;

    if (this.m_sx !== other.m_sx) return false;

    if (this.m_sy !== other.m_sy) return false;

    if (!this.m_layers.equals(other.m_layers)) return false;

    if (this.m_angle !== other.m_angle) return false;

    return true;
  }

  SetId(id: number): void {
    this.m_id = id;
  }

  GetId(): number {
    return this.m_id;
  }

  IsEmpty(): boolean {
    const outLayers = this.m_layers.and(LSET.AllCuMask(this.m_board.GetCopperLayerCount()));

    return outLayers.none();
  }
}

export class HYPERLYNX_EXPORTER extends BOARD_EXPORTER_BASE {
  private m_padStacks: HYPERLYNX_PAD_STACK[] = [];
  private m_padMap = new Map<BOARD_ITEM, HYPERLYNX_PAD_STACK>();
  private m_out = new STRING_FORMATTER();
  private m_polyId = 1;

  private board(): BOARD {
    return this.m_board!;
  }

  private addPadStack(stack: HYPERLYNX_PAD_STACK): HYPERLYNX_PAD_STACK {
    for (const p of this.m_padStacks) {
      if (p.Equals(stack)) return p;
    }

    stack.SetId(this.m_padStacks.length);
    this.m_padStacks.push(stack);

    return stack;
  }

  private formatPadShape(aStack: HYPERLYNX_PAD_STACK): string {
    let shapeId = 0;

    switch (aStack.m_shape) {
      case PAD_SHAPE.CIRCLE:
      case PAD_SHAPE.OVAL:
        shapeId = 0;
        break;

      case PAD_SHAPE.ROUNDRECT:
        shapeId = 2;
        break;

      case PAD_SHAPE.RECTANGLE:
        shapeId = 1;
        break;

      default:
        if (this.m_reporter) {
          this.m_reporter.Report(
            'File contains pad shapes that are not supported by the ' +
              'Hyperlynx exporter (supported shapes are oval, rectangle, ' +
              'rounded rectangle, and circle).',
            RPT_SEVERITY_WARNING,
          );
          this.m_reporter.Report('They have been exported as oval pads.', RPT_SEVERITY_INFO);
        }

        shapeId = 0;
        break;
    }

    return `${shapeId}, ${f9(iu2hyp(aStack.m_sx))}, ${f9(iu2hyp(aStack.m_sy))}, ${fixed(aStack.m_angle, 1)}, M`;
  }

  private generateHeaders(): boolean {
    this.m_out.Print(0, '{VERSION=2.14}\n');
    this.m_out.Print(0, '{UNITS=ENGLISH LENGTH}\n\n');
    return true;
  }

  private writeSinglePadStack(aStack: HYPERLYNX_PAD_STACK): void {
    const layerMask = LSET.AllCuMask(this.board().GetCopperLayerCount());
    const outLayers = aStack.m_layers.and(layerMask);

    if (outLayers.none()) return;

    this.m_out.Print(0, `{PADSTACK=${aStack.m_id}, ${f9(iu2hyp(aStack.m_drill))}\n`);

    if (outLayers.equals(layerMask)) {
      this.m_out.Print(1, `("MDEF", ${this.formatPadShape(aStack)})\n`);
    } else {
      for (const l of outLayers.Seq()) {
        this.m_out.Print(
          1,
          `("${this.board().GetLayerName(l)}", ${this.formatPadShape(aStack)})\n`,
        );
      }
    }

    this.m_out.Print(0, '}\n\n');
  }

  private writeBoardInfo(): boolean {
    const outlines = new SHAPE_POLY_SET();

    this.m_out.Print(0, `{BOARD "${this.board().GetFileName()}"\n`);

    if (!this.board().GetBoardPolygonOutlines(outlines, false)) {
      // wxLogError: there is no log window to show it in.
      this.m_reporter?.Report('Board outline is malformed. Run DRC for a full analysis.');
      return false;
    }

    for (let o = 0; o < outlines.OutlineCount(); o++) {
      const outl = outlines.COutline(o);

      for (let i = 0; i < outl.SegmentCount(); i++) {
        const s = outl.CSegment(i);
        this.m_out.Print(
          1,
          `(PERIMETER_SEGMENT X1=${f9(iu2hyp(s.A.x))} Y1=${f9(iu2hyp(-s.A.y))} ` +
            `X2=${f9(iu2hyp(s.B.x))} Y2=${f9(iu2hyp(-s.B.y))})\n`,
        );
      }
    }

    this.m_out.Print(0, '}\n\n');

    return true;
  }

  private writeStackupInfo(): boolean {
    /* Format:
     * {STACKUP
     * (SIGNAL T=thickness [P=plating_thickness] [C=resistivity] L=layer_name [M=material_name])
     * (DIELECTRIC T=thickness [C=dielectric_constant] [L=layer_name] [M=material_name])
     * }
     * C parameter: bulk resistivity (ohm-m) for SIGNAL, epsilon_r for DIELECTRIC
     * Layer name length is <= 20 chars
     */

    // Get the board physical stackup structure
    const stackup = this.board().GetDesignSettings().GetStackupDescriptor();

    this.m_out.Print(0, '{STACKUP\n');

    let layer_name = ''; // The last copper layer name used in stackup

    for (const item of stackup.GetList()) {
      if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER) {
        layer_name = this.board().GetLayerName(item.GetBrdLayerId());
        const plating_thickness = 0;
        const resistivity = 1.724e-8; // Copper bulk resistivity in ohm-meters
        this.m_out.Print(
          1,
          `(SIGNAL T=${formatG(iu2hyp(item.GetThickness(0)))} P=${formatG(iu2hyp(plating_thickness))} ` +
            `C=${formatG(resistivity)} L="${prec(layer_name, 20)}" M=COPPER)\n`,
        );
      } else if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
        if (item.GetSublayersCount() < 2) {
          this.m_out.Print(
            1,
            `(DIELECTRIC T=${formatG(iu2hyp(item.GetThickness(0)))} C=${formatG(item.GetEpsilonR(0))} ` +
              `L="DE_${prec(layer_name, 17)}" M="${prec(item.GetMaterial(0), 20)}")\n`,
          );
        } else {
          for (let idx = 0; idx < item.GetSublayersCount(); idx++) {
            this.m_out.Print(
              1,
              `(DIELECTRIC T=${formatG(iu2hyp(item.GetThickness(idx)))} C=${formatG(item.GetEpsilonR(idx))} ` +
                `L="DE${idx}_${prec(layer_name, 16)}" M="${prec(item.GetMaterial(idx), 20)}")\n`,
            );
          }
        }
      } else if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK) {
        // Soldermask uses its KiCad layer name directly (e.g., "F.Mask") rather than
        // a constructed name like core dielectrics, since these names are already unique.
        const maskLayerName = this.board().GetLayerName(item.GetBrdLayerId());
        let material = item.GetMaterial(0);

        if (!IsPrmSpecified(material)) material = 'Solder Mask';

        this.m_out.Print(
          1,
          `(DIELECTRIC T=${formatG(iu2hyp(item.GetThickness(0)))} C=${formatG(item.GetEpsilonR(0))} ` +
            `L="${prec(maskLayerName, 20)}" M="${prec(material, 20)}")\n`,
        );
      }
    }

    this.m_out.Print(0, '}\n\n');

    return true;
  }

  private writeDevices(): boolean {
    this.m_out.Print(0, '{DEVICES\n');

    for (const footprint of this.board().Footprints()) {
      let ref = footprint.GetReference();
      const layerName = this.board().GetLayerName(footprint.GetLayer());

      if (ref === '') ref = 'EMPTY';

      this.m_out.Print(1, `(? REF="${ref}" L="${layerName}")\n`);
    }

    this.m_out.Print(0, '}\n\n');

    return true;
  }

  private writePadStacks(): boolean {
    for (const footprint of this.board().Footprints()) {
      for (const pad of footprint.Pads()) {
        const ps = this.addPadStack(new HYPERLYNX_PAD_STACK(this.board(), pad));
        this.m_padMap.set(pad, ps);
      }
    }

    for (const track of this.board().Tracks()) {
      if (track.Type() === KICAD_T.PCB_VIA_T) {
        const via = track as PCB_VIA;
        const ps = this.addPadStack(new HYPERLYNX_PAD_STACK(this.board(), via));
        this.m_padMap.set(via, ps);
      }
    }

    for (const pstack of this.m_padStacks) this.writeSinglePadStack(pstack);

    return true;
  }

  private writeNetObjects(aObjects: readonly BOARD_ITEM[]): boolean {
    for (const item of aObjects) {
      const type = item.Type();

      if (type === KICAD_T.PCB_PAD_T) {
        const pad = item as PAD;
        const pstack = this.m_padMap.get(pad);

        if (pstack) {
          let ref = pad.GetParentFootprint()!.GetReference();

          if (ref === '') ref = 'EMPTY';

          let padName = pad.GetNumber();

          if (padName === '') padName = '1';

          this.m_out.Print(
            1,
            `(PIN X=${f10(iu2hyp(pad.GetPosition().x))} Y=${f10(iu2hyp(-pad.GetPosition().y))} ` +
              `R="${ref}.${padName}" P=${pstack.GetId()})\n`,
          );
        }
      } else if (type === KICAD_T.PCB_VIA_T) {
        const via = item as PCB_VIA;
        const pstack = this.m_padMap.get(via);

        if (pstack) {
          this.m_out.Print(
            1,
            `(VIA X=${f10(iu2hyp(via.GetPosition().x))} Y=${f10(iu2hyp(-via.GetPosition().y))} ` +
              `P=${pstack.GetId()})\n`,
          );
        }
      } else if (type === KICAD_T.PCB_TRACE_T) {
        const track = item as PCB_TRACK;
        const layerName = this.board().GetLayerName(track.GetLayer());

        this.m_out.Print(
          1,
          `(SEG X1=${f10(iu2hyp(track.GetStart().x))} Y1=${f10(iu2hyp(-track.GetStart().y))} ` +
            `X2=${f10(iu2hyp(track.GetEnd().x))} Y2=${f10(iu2hyp(-track.GetEnd().y))} ` +
            `W=${f10(iu2hyp(track.GetWidth()))} L="${layerName}")\n`,
        );
      } else if (type === KICAD_T.PCB_ARC_T) {
        const arc = item as PCB_ARC;
        const layerName = this.board().GetLayerName(arc.GetLayer());
        let start: VECTOR2I = arc.GetStart();
        let end: VECTOR2I = arc.GetEnd();

        if (!arc.IsCCW()) [start, end] = [end, start];

        this.m_out.Print(
          1,
          `(ARC X1=${f10(iu2hyp(start.x))} Y1=${f10(iu2hyp(-start.y))} ` +
            `X2=${f10(iu2hyp(end.x))} Y2=${f10(iu2hyp(-end.y))} ` +
            `XC=${f10(iu2hyp(arc.GetCenter().x))} YC=${f10(iu2hyp(-arc.GetCenter().y))} ` +
            `R=${f10(iu2hyp(arc.GetRadius()))} W=${f10(iu2hyp(arc.GetWidth()))} L="${layerName}")\n`,
        );
      } else if (type === KICAD_T.PCB_ZONE_T) {
        const zone = item as ZONE;

        for (const layer of zone.GetLayerSet().Seq()) {
          const layerName = this.board().GetLayerName(layer);
          const fill = zone.GetFilledPolysList(layer).CloneDropTriangulation();

          fill.Simplify();

          for (let i = 0; i < fill.OutlineCount(); i++) {
            const outl = fill.COutline(i);
            const p0 = outl.CPoint(0);

            this.m_out.Print(
              1,
              `{POLYGON T=POUR L="${layerName}" ID=${this.m_polyId} X=${f10(iu2hyp(p0.x))} Y=${f10(iu2hyp(-p0.y))}\n`,
            );

            for (let v = 0; v < outl.PointCount(); v++) {
              this.m_out.Print(
                2,
                `(LINE X=${f10(iu2hyp(outl.CPoint(v).x))} Y=${f10(iu2hyp(-outl.CPoint(v).y))})\n`,
              );
            }

            this.m_out.Print(2, `(LINE X=${f10(iu2hyp(p0.x))} Y=${f10(iu2hyp(-p0.y))})\n`);
            this.m_out.Print(1, '}\n');

            for (let h = 0; h < fill.HoleCount(i); h++) {
              const holeShape = fill.CHole(i, h);
              const ph0 = holeShape.CPoint(0);

              this.m_out.Print(
                1,
                `{POLYVOID ID=${this.m_polyId} X=${f10(iu2hyp(ph0.x))} Y=${f10(iu2hyp(-ph0.y))}\n`,
              );

              for (let v = 0; v < holeShape.PointCount(); v++) {
                this.m_out.Print(
                  2,
                  `(LINE X=${f10(iu2hyp(holeShape.CPoint(v).x))} Y=${f10(iu2hyp(-holeShape.CPoint(v).y))})\n`,
                );
              }

              this.m_out.Print(2, `(LINE X=${f10(iu2hyp(ph0.x))} Y=${f10(iu2hyp(-ph0.y))})\n`);
              this.m_out.Print(1, '}\n');
            }

            this.m_polyId++;
          }
        }
      }
    }

    return true;
  }

  private collectNetObjects(netcode: number): BOARD_ITEM[] {
    const rv: BOARD_ITEM[] = [];

    const check = (item: BOARD_CONNECTED_ITEM): boolean => {
      if (item.GetLayerSet().and(LSET.AllCuMask()).none()) return false;

      if (item.GetNetCode() === netcode || (netcode < 0 && item.GetNetCode() <= 0)) return true;

      return false;
    };

    for (const footprint of this.board().Footprints()) {
      for (const pad of footprint.Pads()) {
        if (check(pad)) rv.push(pad);
      }
    }

    for (const item of this.board().Tracks()) {
      if (check(item)) rv.push(item);
    }

    for (const zone of this.board().Zones()) {
      if (check(zone)) rv.push(zone);
    }

    return rv;
  }

  private writeNets(): boolean {
    this.m_polyId = 1;

    for (const netInfo of this.board().GetNetInfo()) {
      const netcode = netInfo.GetNetCode();
      const isNullNet = netInfo.GetNetCode() <= 0 || netInfo.GetNetname() === '';

      if (isNullNet) continue;

      const netObjects = this.collectNetObjects(netcode);

      if (netObjects.length) {
        this.m_out.Print(0, `{NET="${netInfo.GetNetname()}"\n`);
        this.writeNetObjects(netObjects);
        this.m_out.Print(0, '}\n\n');
      }
    }

    const nullNetObjects = this.collectNetObjects(-1);

    let idx = 0;

    for (const item of nullNetObjects) {
      this.m_out.Print(0, `{NET="EmptyNet${idx}"\n`);
      this.writeNetObjects([item]);
      this.m_out.Print(0, '}\n\n');
      idx++;
    }

    return true;
  }

  /** `Run()`: the whole file, then `m_outputFilePath` written in one piece. */
  override Run(): boolean {
    this.m_out = new STRING_FORMATTER();

    this.generateHeaders();
    this.writeBoardInfo();
    this.writeStackupInfo();
    this.writeDevices();
    this.writePadStacks();
    this.writeNets();

    this.m_writeFile(this.m_outputFilePath, new TextEncoder().encode(this.m_out.GetString()));

    return true;
  }
}
