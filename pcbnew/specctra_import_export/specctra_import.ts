// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/specctra_import_export/specctra_import.cpp`: applying a SPECCTRA
 * session (SES) file to a BOARD: `SPECCTRA_DB::FromSESSION`, its `makeTRACK` /
 * `makeARC` / `makeVIA`, and `ImportSpecctraSession`.
 *
 * `PCB_EDIT_FRAME::ImportSpecctraSession` (the frame half: clear the undo
 * list, drop the tracks from the view, run this, `OnModify`, re-add the tracks
 * to the view) is the caller's; the failures the C++ throws as `IO_ERROR` are
 * `Error`s here.
 */

import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { CalcArcMid } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../board.js';
import { PADSTACK as KI_PADSTACK } from '../padstack.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import { UNDEFINED_DRILL_DIAMETER, VIATYPE } from '../pcb_track_types.js';
import { SPECCTRA_EXPORT_DB, type SpecctraFrame } from './specctra_export.js';
import {
  CIRCLE,
  PADSTACK,
  type PATH,
  type POINT,
  type QARC,
  type SHAPE,
  type UNIT_RES,
  type WIRE,
  type WIRE_VIA,
} from './specctra.js';

/** Convert a session file distance to KiCad internal units (nanometers). */
function scale(distance: number, aResolution: UNIT_RES): number {
  const resValue = aResolution.GetValue();
  let factor: number;

  switch (aResolution.GetEngUnits()) {
    default:
    case 'inch':
      factor = 25.4e6; // nanometers per inch
      break;
    case 'mil':
      factor = 25.4e3; // nanometers per mil
      break;
    case 'cm':
      factor = 1e7; // nanometers per cm
      break;
    case 'mm':
      factor = 1e6; // nanometers per mm
      break;
    case 'um':
      factor = 1e3; // nanometers per um
      break;
  }

  return KiROUND((factor * distance) / resValue);
}

/** Translate a point from the Specctra Session coordinate system to KiCad's (y negated). */
function mapPt(aPoint: POINT, aResolution: UNIT_RES): Vec2 {
  return { x: scale(aPoint.x, aResolution), y: -scale(aPoint.y, aResolution) };
}

/** `SPECCTRA_DB` as the importer extends it (the layer maps come from the exporter's builder). */
export class SPECCTRA_IMPORT_DB extends SPECCTRA_EXPORT_DB {
  m_sessionBoard: BOARD | null = null;

  /** `makeTRACK`. */
  makeTRACK(wire: WIRE, aPath: PATH, aPointIndex: number, aNetcode: number): PCB_TRACK {
    const layerNdx = this.findLayerName(aPath.layer_id);

    if (layerNdx === -1) throw new Error(`Session file uses invalid layer id '${aPath.layer_id}'.`);

    const track = new PCB_TRACK(this.m_sessionBoard!);

    track.SetStart(mapPt(aPath.points[aPointIndex + 0]!, this.m_routeResolution!));
    track.SetEnd(mapPt(aPath.points[aPointIndex + 1]!, this.m_routeResolution!));
    track.SetLayer(this.m_pcbLayer2kicad.get(layerNdx)!);
    track.SetWidth(scale(aPath.aperture_width, this.m_routeResolution!));
    track.SetNetCode(aNetcode);

    // a track can be locked.
    // However specctra as 4 types, none is exactly the same as our locked option
    // wire->wire_type = fix, route, normal or protect
    // fix and protect could be used as lock option
    // but protect is returned for all tracks having initially the route or protect property
    if (wire.m_wire_type === 'fix') track.SetLocked(true);

    return track;
  }

  /** `makeARC`. */
  makeARC(wire: WIRE, aQarc: QARC, aNetcode: number): PCB_ARC {
    const layerNdx = this.findLayerName(aQarc.layer_id);

    if (layerNdx === -1) throw new Error(`Session file uses invalid layer id '${aQarc.layer_id}'.`);

    const res = this.m_routeResolution!;
    const arc = new PCB_ARC(this.m_sessionBoard!);

    arc.SetStart(mapPt(aQarc.vertex[0], res));
    arc.SetEnd(mapPt(aQarc.vertex[1], res));
    arc.SetMid(CalcArcMid(arc.GetStart(), arc.GetEnd(), mapPt(aQarc.vertex[2], res)));
    arc.SetLayer(this.m_pcbLayer2kicad.get(layerNdx)!);
    arc.SetWidth(scale(aQarc.aperture_width, res));
    arc.SetNetCode(aNetcode);

    if (wire.m_wire_type === 'fix') arc.SetLocked(true);

    return arc;
  }

  /** `makeVIA`. */
  makeVIA(
    aVia: WIRE_VIA,
    aPadstack: PADSTACK,
    aPoint: POINT,
    aNetCode: number,
    aViaDrillDefault: number,
  ): PCB_VIA {
    const res = this.m_routeResolution!;
    const board = this.m_sessionBoard!;
    let via: PCB_VIA;
    const shapeCount = aPadstack.Length();
    let drill_diam_iu = -1;
    const copperLayerCount = board.GetCopperLayerCount();

    // The drill diameter is encoded in the padstack name if Pcbnew did the DSN export.
    // It is after the colon and before the last '_'
    let drillStartNdx = aPadstack.m_padstack_id.indexOf(':');

    if (drillStartNdx >= 0) {
      ++drillStartNdx; // skip over the ':'

      const drillEndNdx = aPadstack.m_padstack_id.lastIndexOf('_');

      if (drillEndNdx >= 0) {
        const diam_txt = aPadstack.m_padstack_id.slice(drillStartNdx, drillEndNdx);
        const drill_um = Number.parseFloat(diam_txt);

        drill_diam_iu = Math.trunc(
          (Number.isNaN(drill_um) ? 0 : drill_um) * (pcbIUScale.IU_PER_MM / 1000.0),
        );

        if (drill_diam_iu === aViaDrillDefault) drill_diam_iu = UNDEFINED_DRILL_DIAMETER;
      }
    }

    const circleOf = (shape: SHAPE, aSuffix: string): CIRCLE => {
      const type = shape.shape!.Type();

      if (type !== 'circle') throw new Error(`Unsupported via shape: ${type}${aSuffix}`);

      return shape.shape as CIRCLE;
    };

    if (shapeCount === 0) {
      throw new Error('Session via padstack has no shapes');
    } else if (shapeCount === 1) {
      const circle = circleOf(aPadstack.At(0) as SHAPE, '.');
      const viaDiam = scale(circle.diameter, res);

      via = new PCB_VIA(board);
      via.SetPosition(mapPt(aPoint, res));
      via.SetDrill(drill_diam_iu);
      via.SetViaType(VIATYPE.THROUGH);
      via.SetWidth(KI_PADSTACK.ALL_LAYERS, viaDiam);
      via.SetLayerPair(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
    } else if (shapeCount === copperLayerCount) {
      const circle = circleOf(aPadstack.At(0) as SHAPE, '');
      const viaDiam = scale(circle.diameter, res);

      via = new PCB_VIA(board);
      via.SetPosition(mapPt(aPoint, res));
      via.SetDrill(drill_diam_iu);
      via.SetViaType(VIATYPE.THROUGH);
      via.SetWidth(KI_PADSTACK.ALL_LAYERS, viaDiam);
      via.SetLayerPair(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
    } else {
      // VIA_MICROVIA or VIA_BLIND_BURIED
      let topLayerNdx = -1; // session layer detectors
      let botLayerNdx = Number.MAX_SAFE_INTEGER;
      let viaDiam = -1;

      for (let i = 0; i < shapeCount; ++i) {
        const circle = circleOf(aPadstack.At(i) as SHAPE, '');
        const layerNdx = this.findLayerName(circle.layer_id);

        if (layerNdx === -1)
          throw new Error(`Session file uses invalid layer id '${circle.layer_id}'`);

        if (layerNdx > topLayerNdx) topLayerNdx = layerNdx;

        if (layerNdx < botLayerNdx) botLayerNdx = layerNdx;

        if (viaDiam === -1) viaDiam = scale(circle.diameter, res);
      }

      via = new PCB_VIA(board);
      via.SetPosition(mapPt(aPoint, res));
      via.SetDrill(drill_diam_iu);

      if (
        (topLayerNdx === 0 && botLayerNdx === 1) ||
        (topLayerNdx === copperLayerCount - 2 && botLayerNdx === copperLayerCount - 1)
      ) {
        via.SetViaType(VIATYPE.MICROVIA);
      } else if (topLayerNdx > 0 && botLayerNdx < copperLayerCount - 1) {
        via.SetViaType(VIATYPE.BURIED);
      } else {
        via.SetViaType(VIATYPE.BLIND);
      }

      if (topLayerNdx < 0) topLayerNdx = 0; // wxCHECK2( topLayerNdx >= 0, topLayerNdx = 0 )

      via.SetWidth(KI_PADSTACK.ALL_LAYERS, viaDiam);
      via.SetLayerPair(
        this.m_pcbLayer2kicad.get(topLayerNdx)!,
        this.m_pcbLayer2kicad.get(botLayerNdx)!,
      );
    }

    via.SetNetCode(aNetCode);

    // a via can be locked.
    // However specctra as 4 types, none is exactly the same as our locked option
    // aVia->via_type = fix, route, normal or protect
    // fix and protect could be used as lock option
    // but protect is returned for all tracks having initially the route or protect property
    if (aVia.m_via_type === 'fix') via.SetLocked(true);

    return via;
  }

  /**
   * `FromSESSION`: no UI code here; problems are thrown to the UI handler
   * (`PCB_EDIT_FRAME::ImportSpecctraSession`). Returns the number of session
   * items that were skipped for an unresolved reference, layer or padstack.
   */
  FromSESSION(aBoard: BOARD): number {
    this.m_sessionBoard = aBoard; // not owned here

    if (!this.m_session) throw new Error('Session file is missing the "session" section');

    if (!this.m_session.route) throw new Error('Session file is missing the "routes" section');

    if (!this.m_session.route.library)
      throw new Error('Session file is missing the "library_out" section');

    // delete the old tracks and vias but save locked tracks/vias; they will be re-added later
    const locked: PCB_TRACK[] = [];
    const tracks = [...aBoard.Tracks()];

    aBoard.RemoveAll([KICAD_T.PCB_TRACE_T]);

    for (const track of tracks) {
      if (track.IsLocked()) {
        locked.push(track);
      } else {
        const group = track.GetParentGroup();

        if (group) group.RemoveItem(track);
      }
    }

    aBoard.DeleteMARKERs();

    this.buildLayerMaps(aBoard);

    // Add locked tracks: because they are exported as Fix tracks, they are not
    // in .ses file.
    for (const track of locked) aBoard.Add(track);

    // A single unresolvable place, wire, or via (e.g. a uniquified fiducial id or an unknown layer
    // from a foreign router) must not sink the whole session, so skipped items are counted and
    // reported once at the end.
    let skipped = 0;

    if (this.m_session.placement) {
      // Walk the PLACEMENT object's COMPONENTs list, and for each PLACE within
      // each COMPONENT, reposition and re-orient each component and put on
      // correct side of the board.
      for (const component of this.m_session.placement.m_components) {
        for (const place of component.m_places) {
          const reference = place.m_component_id;
          const footprint = aBoard.FindFootprintByReference(reference);

          if (!footprint) {
            ++skipped;
            continue;
          }

          if (!place.m_hasVertex) continue;

          const resolution = place.GetUnits();

          const newPos = mapPt(place.m_vertex, resolution);

          footprint.SetPosition(newPos);

          if (place.m_side === 'front') {
            // convert from degrees to tenths of degrees used in KiCad.
            const orientation = new EDA_ANGLE(place.m_rotation);

            if (footprint.GetLayer() !== PCB_LAYER_ID.F_Cu) {
              // footprint is on copper layer (back)
              footprint.Flip(footprint.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
            }

            footprint.SetOrientation(orientation);
          } else if (place.m_side === 'back') {
            const orientation = new EDA_ANGLE(place.m_rotation + 180.0);

            if (footprint.GetLayer() !== PCB_LAYER_ID.B_Cu) {
              // footprint is on component layer (front)
              footprint.Flip(footprint.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
            }

            footprint.SetOrientation(orientation);
          }
        }
      }
    }

    this.m_routeResolution = this.m_session.route.GetUnits();

    // Walk the NET_OUTs and create tracks and vias anew.
    const net_outs = this.m_session.route.net_outs;

    // Item-local failures (unknown layer id, missing padstack) throw from the make* helpers; run
    // each item through this guard so one bad wire or via is dropped instead of aborting.
    const skipOnError = (aBuild: () => void): void => {
      try {
        aBuild();
      } catch {
        ++skipped;
      }
    };

    for (const net_out of net_outs) {
      let netoutCode = 0;

      // page 143 of spec says wire's net_id is optional
      if (net_out.net_id.length) {
        const netinfo = aBoard.FindNet(net_out.net_id);

        if (netinfo) netoutCode = netinfo.GetNetCode();
      }

      for (const wire of net_out.wires) {
        skipOnError(() => {
          const shape = wire.m_shape!.Type();

          if (shape === 'path') {
            const path = wire.m_shape as PATH;

            for (let pt = 0; pt < path.points.length - 1; ++pt)
              aBoard.Add(this.makeTRACK(wire, path, pt, netoutCode));
          } else if (shape === 'qarc') {
            const qarc = wire.m_shape as QARC;

            aBoard.Add(this.makeARC(wire, qarc, netoutCode));
          }
          // shape == polygon is expected from freerouter if you have a zone on a non-"power"
          // type layer, i.e. a signal layer and the design does a round-trip back in as
          // session here.  We kept our own zones in the BOARD, so ignore this so called 'wire'.
        });
      }

      for (const wire_via of net_out.wire_vias) {
        skipOnError(() => {
          let netCode = 0;

          // page 144 of spec says wire_via's net_id is optional
          if (net_out.net_id.length) {
            const netvia = aBoard.FindNet(net_out.net_id);

            if (netvia) netCode = netvia.GetNetCode();
          }

          // example: (via Via_15:8_mil 149000 -71000 )
          const padstack = this.m_session!.route!.library!.FindPADSTACK(wire_via.GetPadstackId());

          if (!padstack)
            throw new Error(`A wire_via refers to missing padstack '${wire_via.GetPadstackId()}'.`);

          const via_drill_default = aBoard
            .GetDesignSettings()
            .m_NetSettings.GetDefaultNetclass()
            .GetViaDrill();

          for (const v of wire_via.m_vertexes)
            aBoard.Add(this.makeVIA(wire_via, padstack, v, netCode, via_drill_default));
        });
      }
    }

    return skipped;
  }
}

/**
 * `ImportSpecctraSession( aBoard, fullFileName )`: read the session text and
 * apply it, then rebuild the connectivity. Returns the skipped-item count the C++
 * logs as a warning.
 */
export function ImportSpecctraSession(
  aBoard: BOARD,
  aSessionText: string,
  aSource = 'session',
): number {
  const db = new SPECCTRA_IMPORT_DB();

  db.LoadSESSION(aSessionText, aSource);

  const skipped = db.FromSESSION(aBoard);

  aBoard.GetConnectivity().ClearRatsnest();
  aBoard.BuildConnectivity();

  return skipped;
}

/**
 * `PCB_EDIT_FRAME::ImportSpecctraSession`: `ImportSpecctraSession` with the
 * frame's bookkeeping. The undo/redo lists are cleared first (they would hold
 * the tracks about to be deleted), and a failure reports "Board may be
 * corrupted, do not save it." with the parser's own text.
 */
export function ImportSpecctraSessionIntoFrame(
  aFrame: SpecctraFrame & { ClearUndoRedoList?(): void },
  aSessionText: string,
  aSource = 'session',
): { ok: boolean; skipped: number; error?: string } {
  const board = aFrame.GetBoard();

  if (!board) return { ok: false, skipped: 0, error: 'No board' };

  // To avoid issues with undo/redo lists (dangling pointers) clear the lists
  aFrame.ClearUndoRedoList?.();

  try {
    return { ok: true, skipped: ImportSpecctraSession(board, aSessionText, aSource) };
  } catch (e) {
    return {
      ok: false,
      skipped: 0,
      error: `Board may be corrupted, do not save it.\n Fix problem and try again\n${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
