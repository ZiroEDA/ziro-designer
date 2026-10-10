// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/odbpp/odb_netlist.{h,cpp}`: the step's `netlists/cadnet/netlist` - every via and
 * copper pad as a net point, grouped by netcode.
 */
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '../../board.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK } from '../../padstack.js';
import type { PCB_VIA } from '../../pcb_track.js';
import { Data2String, GenLegalNetName, type OSTREAM } from './odb_util.js';

/** The ODB net point record. */
interface ODB_NET_RECORD {
  smd: boolean;
  hole: boolean;
  is_via: boolean;
  netname: string;
  refdes: string;
  drill_radius: number;
  mechanical: boolean;
  side: string; // B: Both, T: Top, D: Down
  // All these in PCB units, will be output in decimils
  x_location: number;
  y_location: number;
  // Width and height of non-drilled pads (only when radius = 0).
  x_size: number; // Width
  y_size: number; // Height
  epoint: string; // e: net end point,  m: net mid point
  soldermask: number;
}

export class ODB_NET_LIST {
  constructor(private readonly m_board: BOARD) {}

  /** Compute the side code for a pad. Returns "" if there is no copper. */
  private ComputePadAccessSide(aBoard: BOARD, aLayerMask: LSET): string {
    // Non-copper is not interesting here
    const mask = new LSET(aLayerMask);
    mask.and(LSET.AllCuMask(aBoard.GetCopperLayerCount()));

    if (!mask.any()) return '';

    // Traditional TH pad
    if (mask.Contains(PCB_LAYER_ID.F_Cu) && mask.Contains(PCB_LAYER_ID.B_Cu)) return 'B';

    // Front SMD pad
    if (mask.Contains(PCB_LAYER_ID.F_Cu)) return 'T';

    // Back SMD pad
    if (mask.Contains(PCB_LAYER_ID.B_Cu)) return 'D';

    // Inner.  We've already checked that there is no copper on the front or back, so
    // since we checked that there is at least one copper layer, this must be an inner layer
    return 'I';
  }

  private InitPadNetPoints(aBoard: BOARD, aRecords: Map<number, ODB_NET_RECORD[]>): void {
    for (const footprint of aBoard.Footprints()) {
      for (const pad of footprint.Pads()) {
        const side = this.ComputePadAccessSide(aBoard, pad.GetLayerSet());

        // It could be a mask only pad, we only handle pads with copper here
        if (side === '' || side === 'I') continue;

        const drill = pad.GetDrillSize();
        const hole = pad.HasHole();
        const x_size = pad.GetSize(PADSTACK.ALL_LAYERS).x;

        // the value indicates which sides are *not* accessible
        let soldermask = 3;

        if (pad.GetLayerSet().Contains(PCB_LAYER_ID.F_Mask)) soldermask &= ~1;

        if (pad.GetLayerSet().Contains(PCB_LAYER_ID.B_Mask)) soldermask &= ~2;

        const net_point: ODB_NET_RECORD = {
          side,
          netname: pad.GetNetCode() === 0 ? '$NONE$' : pad.GetNetname(),
          refdes: footprint.GetReference(),
          hole,
          drill_radius: !hole ? 0 : Math.min(drill.x, drill.y),
          smd: pad.GetAttribute() === PAD_ATTRIB.SMD || pad.GetAttribute() === PAD_ATTRIB.CONN,
          is_via: false,
          mechanical: pad.GetAttribute() === PAD_ATTRIB.NPTH,
          x_location: pad.GetPosition().x,
          y_location: -pad.GetPosition().y,
          x_size,
          // Rule: round pads have y = 0
          y_size:
            pad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CIRCLE
              ? x_size
              : pad.GetSize(PADSTACK.ALL_LAYERS).y,
          // always output NET end point as net test point
          epoint: 'e',
          soldermask,
        };

        this.push(aRecords, pad.GetNetCode(), net_point);
      }
    }
  }

  /** Compute the side code for a via. */
  private ComputeViaAccessSide(_aBoard: BOARD, top_layer: number, bottom_layer: number): string {
    // Easy case for through vias: top_layer is component, bottom_layer is
    // solder, side code is Both
    if (top_layer === PCB_LAYER_ID.F_Cu && bottom_layer === PCB_LAYER_ID.B_Cu) return 'B';

    // Blind via, reachable from front, Top
    if (top_layer === PCB_LAYER_ID.F_Cu) return 'T';

    // Blind via, reachable from bottom, Down
    if (bottom_layer === PCB_LAYER_ID.B_Cu) return 'D';

    // It's a buried via, accessible from some inner layer, Inner
    return 'I';
  }

  private InitViaNetPoints(aBoard: BOARD, aRecords: Map<number, ODB_NET_RECORD[]>): void {
    // Enumerate all the track segments and keep the vias
    for (const track of aBoard.Tracks()) {
      if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = track as PCB_VIA;
      const [top_layer, bottom_layer] = via.LayerPair();
      const side = this.ComputeViaAccessSide(aBoard, top_layer, bottom_layer);

      if (side === 'I') continue;

      const net = track.GetNet()!;

      // the value indicates which sides are *not* accessible
      let soldermask = 3;

      if (via.GetLayerSet().Contains(PCB_LAYER_ID.F_Mask)) soldermask &= ~1;

      if (via.GetLayerSet().Contains(PCB_LAYER_ID.B_Mask)) soldermask &= ~2;

      this.push(aRecords, net.GetNetCode(), {
        side,
        smd: false,
        hole: true,
        netname: net.GetNetCode() === 0 ? '$NONE$' : net.GetNetname(),
        refdes: 'VIA',
        is_via: true,
        drill_radius: via.GetDrillValue(),
        mechanical: false,
        x_location: via.GetPosition().x,
        y_location: -via.GetPosition().y,
        // via always has drill radius, Width and Height are 0
        x_size: 0,
        y_size: 0, // Round so height = 0
        epoint: 'e', // only buried via is "m" net mid point
        soldermask,
      });
    }
  }

  private push(
    aRecords: Map<number, ODB_NET_RECORD[]>,
    aKey: number,
    aRecord: ODB_NET_RECORD,
  ): void {
    let v = aRecords.get(aKey);

    if (!v) {
      v = [];
      aRecords.set(aKey, v);
    }

    v.push(aRecord);
  }

  /** Writes a list of records to the given output stream. */
  private WriteNetPointRecords(aRecords: Map<number, ODB_NET_RECORD[]>, aStream: OSTREAM): void {
    // std::map<size_t, …>: by netcode.
    const keys = [...aRecords.keys()].sort((a, b) => a - b);

    aStream.write('H optimize n staggered n', '\n');

    for (const key of keys)
      aStream.write('$', key, ' ', GenLegalNetName(aRecords.get(key)![0]!.netname), '\n');

    aStream.write('#', '\n', '#Netlist points', '\n', '#', '\n');

    for (const key of keys) {
      for (const net_point of aRecords.get(key)!) {
        aStream.write(key, ' ');

        if (net_point.hole) aStream.write(Data2String(net_point.drill_radius));
        else aStream.write(0);

        aStream.write(
          ' ',
          Data2String(net_point.x_location),
          ' ',
          Data2String(net_point.y_location),
          ' ',
          net_point.side,
          ' ',
        );

        if (!net_point.hole)
          aStream.write(Data2String(net_point.x_size), ' ', Data2String(net_point.y_size), ' ');

        let exp = '';

        if (net_point.soldermask === 3) exp = 'c';
        else if (net_point.soldermask === 2) exp = 's';
        else if (net_point.soldermask === 1) exp = 'p';
        else if (net_point.soldermask === 0) exp = 'e';

        aStream.write(net_point.epoint, ' ', exp);

        if (net_point.hole) aStream.write(' staggered 0 0 0');

        if (net_point.is_via) aStream.write(' v');

        aStream.write('\n');
      }
    }
  }

  Write(aStream: OSTREAM): void {
    const net_point_records = new Map<number, ODB_NET_RECORD[]>();

    this.InitViaNetPoints(this.m_board, net_point_records);

    this.InitPadNetPoints(this.m_board, net_point_records);

    this.WriteNetPointRecords(net_point_records, aStream);
  }
}
