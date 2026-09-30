// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/easyeda/pcb_io_easyeda_parser.cpp` / `.h`: the EasyEDA Std
 * board and footprint shapes (`TRACK~…`, `PAD~…`, `LIB~…#@$…`) built into a
 * BOARD or a FOOTPRINT.
 *
 * `wxArrayString::operator[]` past the end is undefined upstream (a debug
 * assert); here it reads as an empty string (`at()`).
 */

import { EASYEDA_PARSER_BASE } from '@ziroeda/common/io/easyeda/easyeda_parser_base.js';
import {
  getString,
  getStringMap,
  isObject,
  JSON_EXCEPTION,
  type JSON_VALUE,
  parseJson,
} from '@ziroeda/common/io/easyeda/easyeda_parser_structs.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import {
  B_Cu,
  B_Mask,
  B_Paste,
  B_SilkS,
  B_Fab,
  Cmts_User,
  Dwgs_User,
  Eco1_User,
  Eco2_User,
  Edge_Cuts,
  F_CrtYd,
  F_Cu,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  In1_Cu,
  IsBackLayer,
  IsCopperLayer,
  type PCB_LAYER_ID,
  User_1,
  User_3,
  User_4,
  User_5,
} from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { atoi } from '@ziroeda/common/libc/stdlib.js';
import { LSET } from '@ziroeda/common/lset.js';
import {
  ESCAPE_CONTEXT,
  EscapeString,
  formatG,
  UnescapeHTML,
  wxSplit,
} from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ANGLE_0, ANGLE_180, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { hypot } from '@ziroeda/kimath/src/math/libm.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  Perpendicular,
  ResizeD,
  type Vec2,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../../board.js';
import { ADD_MODE } from '../../board_item_container.js';
import { DEFAULT_COURTYARD_WIDTH } from '../../board_design_settings_defaults.js';
import { ConnectBoardShapes } from '../../fix_board_shape.js';
import { FOOTPRINT, FP_3DMODEL } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_SHAPE, PADSTACK } from '../../padstack.js';
import { PCB_FIELD } from '../../pcb_field.js';
import { PCB_GROUP } from '../../pcb_group.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { ZONE } from '../../zone.js';
import { ISLAND_REMOVAL_MODE } from '../../zone_settings.js';
import { ZONE_CONNECTION } from '../../zones.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';

const DIRECT_MODEL_UUID_KEY = 'JLC_3DModel';
const MODEL_SIZE_KEY = 'JLC_3D_Size';

const SHAPE_JOIN_DISTANCE = pcbIUScale.mmToIU(1.5);
const HIDDEN_TEXT_SIZE: VECTOR2I = { x: pcbIUScale.mmToIU(0.5), y: pcbIUScale.mmToIU(0.5) };

/** `std::map<wxString, std::unique_ptr<FOOTPRINT>>`. */
export type FOOTPRINT_MAP = Map<string, FOOTPRINT>;

/** `wxArrayString[i]`, the empty string past the end (see the file header). */
function at(aArr: readonly string[], i: number): string {
  return aArr[i] ?? '';
}

/** `wxSplit( s, c, '\0' )`: no escape character. */
function split(s: string, c: string): string[] {
  return wxSplit(s, c, '');
}

/** `VECTOR2I( const VECTOR2D& )`: KiROUND per component. */
function toI(p: Vec2): VECTOR2I {
  return { x: KiROUND(p.x), y: KiROUND(p.y) };
}

/** `wxString::Trim()`: trailing blanks off (spaces, tabs, newlines). */
function trimRight(s: string): string {
  return s.replace(/[ \t\n\v\f\r]+$/, '');
}

/** `std::map< wxString, … >::operator[]`: '' for a missing key. */
function get(aMap: Map<string, string>, aKey: string): string {
  return aMap.get(aKey) ?? '';
}

function EasyEdaToKiCadLibID(aLibName: string, aLibReference: string): LIB_ID {
  const libReference = EscapeString(aLibReference, ESCAPE_CONTEXT.CTX_LIBID);

  const key = aLibName !== '' ? `${aLibName}:${libReference}` : libReference;

  const libId = new LIB_ID();
  libId.Parse(key, true);

  return libId;
}

type CONTAINER = BOARD | FOOTPRINT;

export class PCB_IO_EASYEDA_PARSER extends EASYEDA_PARSER_BASE {
  constructor(_aProgressReporter: unknown = null) {
    super();
  }

  LayerToKi(aLayer: string): PCB_LAYER_ID {
    const elayer = atoi(aLayer);

    switch (elayer) {
      case 1:
        return F_Cu;
      case 2:
        return B_Cu;
      case 3:
        return F_SilkS;
      case 4:
        return B_SilkS;
      case 5:
        return F_Paste;
      case 6:
        return B_Paste;
      case 7:
        return F_Mask;
      case 8:
        return B_Mask;
      /*case 9: return UNDEFINED_LAYER;*/ // Ratsnest
      case 10:
        return Edge_Cuts;
      case 11:
        return Eco1_User;
      case 12:
        return Dwgs_User;
      case 13:
        return F_Fab;
      case 14:
        return B_Fab;
      case 15:
        return Eco2_User;

      case 19:
        return F_Fab; // 3D model

      case 99:
        return User_3;
      case 100:
        return User_4;
      case 101:
        return User_5;

      default:
        // case 21 … case 50: In1_Cu … In30_Cu
        if (elayer >= 21 && elayer <= 50) return (In1_Cu + 2 * (elayer - 21)) as PCB_LAYER_ID;

        break;
    }

    return User_1;
  }

  override ScaleSize(aValue: number): number {
    return KiROUND((aValue * 254000.0) / 100.0) * 100;
  }

  ParseToBoardItemContainer(
    aContainer: CONTAINER,
    aParent: BOARD | null,
    paramMap: Map<string, string>,
    aFootprintMap: FOOTPRINT_MAP,
    aShapes: readonly string[],
  ): void {
    // TODO: make this path configurable?
    const easyedaModelDir = 'EASYEDA_MODELS';
    const kicadModelPrefix = `\${KIPRJMOD}/${easyedaModelDir}/`;

    const board: BOARD | null = aParent
      ? aParent
      : aContainer instanceof FOOTPRINT
        ? null
        : aContainer;
    const footprint: FOOTPRINT | null = aContainer instanceof FOOTPRINT ? aContainer : null;

    const getOrAddNetItem = (aNetName: string): NETINFO_ITEM | null => {
      if (!board) return null;

      if (aNetName === '') return null;

      const found = board.FindNet(aNetName);

      if (found) return found;

      const item = new NETINFO_ITEM(board, aNetName, board.GetNetCount() + 1);
      board.Add(item, ADD_MODE.APPEND);
      return item;
    };

    if (footprint) {
      // TODO: library name
      const fpID = EasyEdaToKiCadLibID('', get(paramMap, 'package'));
      footprint.SetFPID(fpID);
    }

    for (const shapeIn of aShapes) {
      let shape = shapeIn;
      const arr = split(shape, '~');

      const elType = at(arr, 0);

      if (elType === 'LIB') {
        shape = shape.replaceAll('#@$', '\n');
        const parts = split(shape, '\n');

        if (parts.length < 1) continue;

        const paramsRoot = split(parts[0]!, '~');

        if (paramsRoot.length < 4) continue;

        const fpOrigin = { x: this.Convert(at(paramsRoot, 1)), y: this.Convert(at(paramsRoot, 2)) };

        let packageName = `Unknown_${at(paramsRoot, 1)}_${at(paramsRoot, 2)}`;

        const paramParts = split(at(paramsRoot, 3), '`');

        let orientation = new EDA_ANGLE(0);

        if (at(paramsRoot, 4) !== '') orientation = new EDA_ANGLE(this.Convert(at(paramsRoot, 4))); // Already applied

        let layer = 1;

        // `int layer = Convert( … )`: the double narrowed to int
        if (at(paramsRoot, 7) !== '') layer = Math.trunc(this.Convert(at(paramsRoot, 7)));

        const innerParamMap = new Map<string, string>();

        for (let i = 1; i < paramParts.length; i += 2) {
          const key = paramParts[i - 1]!;
          const value = paramParts[i]!;

          if (key === 'package') packageName = value;

          innerParamMap.set(key, value);
        }

        void packageName;

        parts.splice(0, 1);

        const pcbOrigin = this.m_relOrigin;
        const fp = this.ParseFootprint(
          fpOrigin,
          orientation,
          layer,
          board,
          innerParamMap,
          aFootprintMap,
          parts,
        );

        if (!fp) continue;

        this.m_relOrigin = pcbOrigin;

        fp.Move(toI(this.RelPos(fpOrigin)));

        aContainer.Add(fp, ADD_MODE.APPEND);
      } else if (elType === 'TRACK') {
        const width = this.ConvertSize(at(arr, 1));
        const layer = this.LayerToKi(at(arr, 2));
        const netname = at(arr, 3);
        const data = split(at(arr, 4), ' ');

        for (let i = 3; i < data.length; i += 2) {
          const start = { x: this.RelPosX(data[i - 3]!), y: this.RelPosY(data[i - 2]!) };
          const end = { x: this.RelPosX(data[i - 1]!), y: this.RelPosY(data[i]!) };

          if (!footprint && IsCopperLayer(layer)) {
            const track = new PCB_TRACK(aContainer);

            track.SetLayer(layer);
            track.SetWidth(Math.trunc(width));
            track.SetStart(toI(start));
            track.SetEnd(toI(end));
            track.SetNet(getOrAddNetItem(netname));

            aContainer.Add(track, ADD_MODE.APPEND);
          } else {
            const seg = new PCB_SHAPE(aContainer, SHAPE_T.SEGMENT);

            seg.SetLayer(layer);
            seg.SetWidth(Math.trunc(width));
            seg.SetStart(toI(start));
            seg.SetEnd(toI(end));

            aContainer.Add(seg, ADD_MODE.APPEND);
          }
        }
      } else if (elType === 'CIRCLE') {
        const circleShape = new PCB_SHAPE(aContainer, SHAPE_T.CIRCLE);
        const width = this.ConvertSize(at(arr, 4));
        circleShape.SetWidth(Math.trunc(width));

        const layer = this.LayerToKi(at(arr, 5));
        circleShape.SetLayer(layer);

        const center = { x: this.RelPosX(at(arr, 1)), y: this.RelPosY(at(arr, 2)) };

        const radius = this.ConvertSize(at(arr, 3));

        circleShape.SetCenter(toI(center));
        // `center + VECTOR2I( radius, 0 )`: the radius narrowed to int, the sum a VECTOR2D
        circleShape.SetEnd(toI({ x: center.x + Math.trunc(radius), y: center.y }));

        if (IsCopperLayer(layer)) circleShape.SetNet(getOrAddNetItem(at(arr, 8)));

        aContainer.Add(circleShape, ADD_MODE.APPEND);
      } else if (elType === 'RECT') {
        const rectShape = new PCB_SHAPE(aContainer, SHAPE_T.RECTANGLE);
        const width = this.ConvertSize(at(arr, 8));
        rectShape.SetWidth(Math.trunc(width));

        const layer = this.LayerToKi(at(arr, 5));
        rectShape.SetLayer(layer);

        const filled = at(arr, 9) !== 'none';
        rectShape.SetFilled(filled);

        const rectStart = { x: this.RelPosX(at(arr, 1)), y: this.RelPosY(at(arr, 2)) };

        const rectSize = { x: this.ConvertSize(at(arr, 3)), y: this.ConvertSize(at(arr, 4)) };

        rectShape.SetStart(toI(rectStart));
        rectShape.SetEnd(toI({ x: rectStart.x + rectSize.x, y: rectStart.y + rectSize.y }));

        if (IsCopperLayer(layer)) rectShape.SetNet(getOrAddNetItem(at(arr, 11)));

        aContainer.Add(rectShape, ADD_MODE.APPEND);
      } else if (elType === 'ARC') {
        const arcShape = new PCB_SHAPE(aContainer, SHAPE_T.ARC);

        const arcWidth = this.ConvertSize(at(arr, 1));
        arcShape.SetWidth(Math.trunc(arcWidth));

        const layer = this.LayerToKi(at(arr, 2));
        arcShape.SetLayer(layer);

        if (IsCopperLayer(layer)) arcShape.SetNet(getOrAddNetItem(at(arr, 3)));

        let arcStart: Vec2 = { x: 0, y: 0 };
        let arcEnd: Vec2 = { x: 0, y: 0 };
        let rad: Vec2 = { x: 10, y: 10 };
        let isFar = false;
        let cw = false;

        let pos = 0;
        const data = at(arr, 4);
        const ch_at = (i: number): string => (i < data.length ? data[i]! : '\0');
        const isdigit = (c: string): boolean => c >= '0' && c <= '9';
        const readNumber = (): string => {
          let aOut = '';
          let ch = ch_at(pos);

          while (ch === ' ' || ch === ',') ch = ch_at(++pos);

          while (isdigit(ch) || ch === '.' || ch === '-') {
            aOut += ch;
            pos++;

            if (pos === data.length) break;

            ch = ch_at(pos);
          }

          return aOut;
        };

        do {
          const sym = ch_at(pos++);

          if (sym === 'M') {
            const xStr = readNumber();
            const yStr = readNumber();

            arcStart = { x: this.Convert(xStr), y: this.Convert(yStr) };
          } else if (sym === 'A') {
            const radX = readNumber();
            const radY = readNumber();
            readNumber(); // unknown
            const farFlag = readNumber();
            const cwFlag = readNumber();
            const endX = readNumber();
            const endY = readNumber();

            isFar = farFlag === '1';
            cw = cwFlag === '1';
            rad = { x: this.Convert(radX), y: this.Convert(radY) };
            arcEnd = { x: this.Convert(endX), y: this.Convert(endY) };
          }
        } while (pos < data.length);

        const delta = { x: arcEnd.x - arcStart.x, y: arcEnd.y - arcStart.y };

        const d = hypot(delta.x, delta.y);
        const h = Math.sqrt(Math.max(0.0, rad.x * rad.x - (d * d) / 4));

        //( !far && cw ) => h
        //( far && cw ) => -h
        //( !far && !cw ) => -h
        //( far && !cw ) => h
        const perp = ResizeD(Perpendicular(delta), isFar !== cw ? h : -h);
        const arcCenter = {
          x: arcStart.x + delta.x / 2 + perp.x,
          y: arcStart.y + delta.y / 2 + perp.y,
        };

        if (!cw) [arcStart, arcEnd] = [arcEnd, arcStart];

        arcShape.SetStart(toI(this.RelPos(arcStart)));
        arcShape.SetEnd(toI(this.RelPos(arcEnd)));
        arcShape.SetCenter(toI(this.RelPos(arcCenter)));

        aContainer.Add(arcShape, ADD_MODE.APPEND);
      } else if (elType === 'DIMENSION') {
        const layer = this.LayerToKi(at(arr, 1));
        const lineWidth = this.ConvertSize(at(arr, 7));
        const shapeData = trimRight(at(arr, 2));
        //double       textHeight = !arr[4].IsEmpty() ? ConvertSize( arr[4] ) : 0;

        const lineChains = this.ParseLineChains(
          shapeData,
          SHAPE_ARC.DefaultAccuracyForPCB(),
          false,
        );

        const group = new PCB_GROUP(aContainer);
        group.SetName('Dimension');

        for (const chain of lineChains) {
          for (let segId = 0; segId < chain.SegmentCount(); segId++) {
            const seg = chain.CSegment(segId);
            const dimSeg = new PCB_SHAPE(aContainer, SHAPE_T.SEGMENT);

            dimSeg.SetLayer(layer);
            dimSeg.SetWidth(Math.trunc(lineWidth));
            dimSeg.SetStart(seg.A);
            dimSeg.SetEnd(seg.B);

            group.AddItem(dimSeg);

            aContainer.Add(dimSeg, ADD_MODE.APPEND);
          }
        }

        aContainer.Add(group, ADD_MODE.APPEND);
      } else if (elType === 'SOLIDREGION') {
        const layer = at(arr, 1);

        // `SHAPE_POLY_SET polySet = ParseLineChains( … )`: the chains become ONE polygon,
        // the first its outline and the rest its holes (SHAPE_POLY_SET( const POLYGON& ))
        const polySet = new SHAPE_POLY_SET(
          this.ParseLineChains(trimRight(at(arr, 3)), SHAPE_ARC.DefaultAccuracyForPCB(), true),
        );

        if (layer === '11') {
          // Multi-layer (board cutout)
          for (const poly of polySet.CPolygons()) {
            const cutoutShape = new PCB_SHAPE(aContainer, SHAPE_T.POLY);

            cutoutShape.SetLayer(Edge_Cuts);
            cutoutShape.SetFilled(false);
            cutoutShape.SetWidth(pcbIUScale.mmToIU(0.1));
            cutoutShape.SetPolyShape(new SHAPE_POLY_SET(poly));

            aContainer.Add(cutoutShape, ADD_MODE.APPEND);
          }
        } else {
          const zone = new ZONE(aContainer);

          const klayer = this.LayerToKi(layer);
          zone.SetLayer(klayer);

          if (IsCopperLayer(klayer)) zone.SetNet(getOrAddNetItem(at(arr, 2)));

          for (const poly of polySet.CPolygons()) zone.Outline().AddPolygon(poly);

          if (at(arr, 4).toLowerCase() === 'cutout') {
            zone.SetIsRuleArea(true);
            zone.SetDoNotAllowZoneFills(true);
            zone.SetDoNotAllowTracks(false);
            zone.SetDoNotAllowVias(false);
            zone.SetDoNotAllowPads(false);
            zone.SetDoNotAllowFootprints(false);
          } else {
            // solid
            zone.SetFilledPolysList(klayer, polySet);
            zone.SetPadConnection(ZONE_CONNECTION.FULL);
            zone.SetIsFilled(true);
            zone.SetNeedRefill(false);
          }

          zone.SetMinThickness(0);
          zone.SetLocalClearance(0);
          zone.SetAssignedPriority(100);

          aContainer.Add(zone, ADD_MODE.APPEND);
        }
      } else if (elType === 'COPPERAREA') {
        const zone = new ZONE(aContainer);

        const layer = this.LayerToKi(at(arr, 2));
        zone.SetLayer(layer);

        const netname = at(arr, 3);

        if (IsCopperLayer(layer)) zone.SetNet(getOrAddNetItem(netname));

        zone.SetLocalClearance(Math.trunc(this.ConvertSize(at(arr, 5))));
        zone.SetThermalReliefGap(zone.GetLocalClearance()!);

        const fillStyle = at(arr, 5);
        if (fillStyle === 'none') {
          // Do not fill?
        }

        const polySet = new SHAPE_POLY_SET(
          this.ParseLineChains(trimRight(at(arr, 4)), SHAPE_ARC.DefaultAccuracyForPCB(), true),
        );

        for (const poly of polySet.CPolygons()) zone.Outline().AddPolygon(poly);

        const thermal = at(arr, 8);
        if (thermal === 'direct') zone.SetPadConnection(ZONE_CONNECTION.FULL);

        const keepIsland = at(arr, 9);
        if (keepIsland === 'yes') zone.SetIslandRemovalMode(ISLAND_REMOVAL_MODE.NEVER);

        const fillData = at(arr, 10);
        const fillPolySet = new SHAPE_POLY_SET();

        try {
          const parsed = parseJson(fillData);

          for (const polyData of iterate(parsed)) {
            for (const contourData of iterate(polyData)) {
              const contourPolySet = new SHAPE_POLY_SET(
                this.ParseLineChains(
                  getString(contourData),
                  SHAPE_ARC.DefaultAccuracyForPCB(),
                  true,
                ),
              );

              const currentOutline = new SHAPE_POLY_SET(contourPolySet.COutline(0));

              for (let i = 1; i < contourPolySet.OutlineCount(); i++)
                currentOutline.AddHole(contourPolySet.COutline(i));

              fillPolySet.Append(currentOutline);
            }
          }

          fillPolySet.Fracture();

          zone.SetFilledPolysList(layer, fillPolySet);
          zone.SetIsFilled(true);
          zone.SetNeedRefill(false);
        } catch (e) {
          if (!(e instanceof JSON_EXCEPTION)) throw e;
        }

        const fillOrder = atoi(at(arr, 13));
        zone.SetAssignedPriority(100 - fillOrder);

        const improveFabrication = at(arr, 17);

        if (improveFabrication === 'none') {
          zone.SetMinThickness(0);
        } else {
          // arr[1] is "stroke Width" per docs
          const minThickness = Math.max(
            pcbIUScale.mmToIU(0.03),
            Math.trunc(this.ConvertSize(at(arr, 1))),
          );
          zone.SetMinThickness(minThickness);
        }

        if (arr.length > 18) {
          zone.SetThermalReliefSpokeWidth(
            Math.max(Math.trunc(this.ConvertSize(at(arr, 18))), zone.GetMinThickness()),
          );
        } else {
          // wxFAIL_MSG( "COPPERAREA unexpected size …" )
          zone.SetThermalReliefSpokeWidth(zone.GetMinThickness());
        }

        aContainer.Add(zone, ADD_MODE.APPEND);
      } else if (elType === 'SVGNODE') {
        const nodeData = parseJson(at(arr, 1));

        if (!isObject(nodeData)) throw new JSON_EXCEPTION('[json.exception.type_error.305]');

        const nodeType = jsonInt(nodeData.nodeType, 'nodeType');
        const layer = getString(requireKey(nodeData, 'layerid'));
        const klayer = this.LayerToKi(layer);

        if (nodeType === 1) {
          const attributes = getStringMap(requireKey(nodeData, 'attrs'));

          if (layer === '19') {
            // 3DModel
            if (!footprint) continue;

            const ec_eType = attributes.get('c_etype');
            const ec_rotation = attributes.get('c_rotation');
            const ec_origin = attributes.get('c_origin');
            const ec_width = attributes.get('c_width');
            const ec_height = attributes.get('c_height');
            const ez = attributes.get('z');
            const etitle = attributes.get('title');
            const euuid = attributes.get('uuid');

            if (ec_eType === undefined || ec_eType !== 'outline3D' || etitle === undefined)
              continue;

            const modelTitle = etitle;
            const kmodelOffset = { x: 0, y: 0, z: 0 };
            const kmodelRotation = { x: 0, y: 0, z: 0 };

            if (euuid !== undefined) {
              const field = new PCB_FIELD(footprint, FIELD_T.USER, DIRECT_MODEL_UUID_KEY);
              field.SetLayer(Cmts_User);
              field.SetVisible(false);
              field.SetText(euuid);
              footprint.Add(field);
            }

            if (ec_width !== undefined && ec_height !== undefined) {
              let fitXmm = pcbIUScale.iuToMM(this.ScaleSize(this.Convert(ec_width)));
              let fitYmm = pcbIUScale.iuToMM(this.ScaleSize(this.Convert(ec_height)));

              const rounding = 0.001;
              fitXmm = KiROUND(fitXmm / rounding) * rounding;
              fitYmm = KiROUND(fitYmm / rounding) * rounding;

              const field = new PCB_FIELD(footprint, FIELD_T.USER, MODEL_SIZE_KEY);
              field.SetLayer(Cmts_User);
              field.SetVisible(false);
              field.SetText(`${formatG(fitXmm, 6)} ${formatG(fitYmm, 6)}`);
              footprint.Add(field);
            }

            if (ec_origin !== undefined) {
              const orParts = split(ec_origin, ',');

              if (orParts.length === 2) {
                const p = {
                  x: this.Convert(trimRight(orParts[0]!)),
                  y: this.Convert(trimRight(orParts[1]!)),
                };

                const rel = this.RelPos(p);
                kmodelOffset.x = -pcbIUScale.iuToMM(rel.x);
                kmodelOffset.y = -pcbIUScale.iuToMM(rel.y);

                const r = RotatePointD(
                  { x: kmodelOffset.x, y: kmodelOffset.y },
                  footprint.GetOrientation().negate(),
                );
                kmodelOffset.x = r.x;
                kmodelOffset.y = r.y;
              }
            }

            if (ez !== undefined) {
              kmodelOffset.z = pcbIUScale.iuToMM(this.ScaleSize(this.Convert(trimRight(ez))));
            }

            if (ec_rotation !== undefined) {
              const rotParts = split(ec_rotation, ',');

              if (rotParts.length === 3) {
                kmodelRotation.x = -this.Convert(trimRight(rotParts[0]!));
                kmodelRotation.y = -this.Convert(trimRight(rotParts[1]!));
                kmodelRotation.z =
                  -this.Convert(trimRight(rotParts[2]!)) + footprint.GetOrientationDegrees();
              }
            }

            if (footprint.GetLayer() === B_Cu) {
              kmodelRotation.z = 180 - kmodelRotation.z;
              const r = RotatePointD({ x: kmodelOffset.x, y: kmodelOffset.y }, ANGLE_180);
              kmodelOffset.x = r.x;
              kmodelOffset.y = r.y;
            }

            const model = new FP_3DMODEL();
            model.m_Filename = `${kicadModelPrefix}${EscapeString(modelTitle, ESCAPE_CONTEXT.CTX_FILENAME)}.step`;
            model.m_Offset = kmodelOffset;
            model.m_Rotation = kmodelRotation;
            footprint.Models().push(model);
          } else {
            const dataStr = attributes.get('d');

            if (dataStr !== undefined) {
              let maxError = SHAPE_ARC.DefaultAccuracyForPCB();

              if (dataStr.length >= 8000) maxError *= 10;

              const polySet = new SHAPE_POLY_SET(
                this.ParseLineChains(trimRight(dataStr), maxError, true),
              );

              polySet.RebuildHolesFromContours();

              let group: PCB_GROUP | null = null;

              if (polySet.OutlineCount() > 1) group = new PCB_GROUP(aContainer);

              for (const poly of polySet.CPolygons()) {
                const svgShape = new PCB_SHAPE(aContainer, SHAPE_T.POLY);

                svgShape.SetFilled(true);
                svgShape.SetPolyShape(new SHAPE_POLY_SET(poly));
                svgShape.SetLayer(klayer);
                svgShape.SetWidth(0);

                if (group) group.AddItem(svgShape);

                aContainer.Add(svgShape, ADD_MODE.APPEND);
              }

              if (group) aContainer.Add(group, ADD_MODE.APPEND);
            }
          }
        } else {
          throw new IO_ERROR(`Unknown SVGNODE nodeType ${nodeType}`);
        }
      } else if (elType === 'TEXT') {
        let text: PCB_TEXT;
        const textType = at(arr, 1);

        if (footprint && textType === 'P') {
          text = footprint.GetField(FIELD_T.REFERENCE);
        } else if (footprint && textType === 'N') {
          text = footprint.GetField(FIELD_T.VALUE);
        } else if (at(arr, 12) === 'none') {
          // created and never added upstream: the text is dropped
          const field = new PCB_FIELD(aContainer, FIELD_T.USER);
          field.SetVisible(false);
          text = field;
        } else {
          // `new PCB_TEXT( aContainer )` with a BOARD_ITEM_CONTAINER*: the BOARD_ITEM*
          // constructor even inside a footprint, so the text is not kept upright
          text = new PCB_TEXT(null);
          text.SetParent(aContainer);
          aContainer.Add(text, ADD_MODE.APPEND);
        }

        const start = { x: this.RelPosX(at(arr, 2)), y: this.RelPosY(at(arr, 3)) };
        text.SetPosition(toI(start));

        const thickness = this.ConvertSize(at(arr, 4));
        text.SetTextThickness(Math.trunc(thickness));

        const rot = this.Convert(at(arr, 5));
        text.SetTextAngleDegrees(rot);

        text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);

        const layer = this.LayerToKi(at(arr, 7));
        text.SetLayer(layer);

        if (IsBackLayer(layer)) text.SetMirrored(true);

        const height = this.ConvertSize(at(arr, 9)) * 0.8;
        text.SetTextSize({ x: Math.trunc(height), y: Math.trunc(height) });

        const textStr = at(arr, 10).replaceAll('\\n', '\n');
        text.SetText(UnescapeHTML(textStr));

        //arr[11] // Geometry data

        const font = at(arr, 14);
        if (font !== '') text.SetFont(FONT.GetFont(font));

        this.TransformTextToBaseline(text, '');
      } else if (elType === 'VIA') {
        const center = { x: this.RelPosX(at(arr, 1)), y: this.RelPosY(at(arr, 2)) };
        const kdia = Math.trunc(this.ConvertSize(at(arr, 3)));
        const kdrill = Math.trunc(this.ConvertSize(at(arr, 5)) * 2);

        if (footprint) {
          const pad = new PAD(footprint);

          pad.SetPosition(toI(center));
          pad.SetLayerSet(PAD.PTHMask());
          pad.SetAttribute(PAD_ATTRIB.PTH);
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
          pad.SetSize(PADSTACK.ALL_LAYERS, { x: kdia, y: kdia });
          pad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
          pad.SetDrillSize({ x: kdrill, y: kdrill });

          footprint.Add(pad, ADD_MODE.APPEND);
        } else {
          const via = new PCB_VIA(aContainer);

          via.SetPosition(toI(center));

          via.SetWidth(PADSTACK.ALL_LAYERS, kdia);
          via.SetNet(getOrAddNetItem(at(arr, 4)));
          via.SetDrill(kdrill);

          aContainer.Add(via, ADD_MODE.APPEND);
        }
      } else if (elType === 'HOLE') {
        let padContainer: FOOTPRINT;

        const center = { x: this.RelPosX(at(arr, 1)), y: this.RelPosY(at(arr, 2)) };
        const kdia = Math.trunc(this.ConvertSize(at(arr, 3)) * 2);
        const holeUuid = at(arr, 4);

        if (footprint) {
          padContainer = footprint;
        } else {
          padContainer = this.newHiddenFootprint(aContainer as BOARD, `Hole_${holeUuid}`, center);
          aContainer.Add(padContainer, ADD_MODE.APPEND);
        }

        const pad = new PAD(padContainer);

        pad.SetPosition(toI(center));
        pad.SetLayerSet(PAD.UnplatedHoleMask());
        pad.SetAttribute(PAD_ATTRIB.NPTH);
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
        pad.SetSize(PADSTACK.ALL_LAYERS, { x: kdia, y: kdia });
        pad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
        pad.SetDrillSize({ x: kdia, y: kdia });

        padContainer.Add(pad, ADD_MODE.APPEND);
      } else if (elType === 'PAD') {
        let padContainer: FOOTPRINT;

        const center = { x: this.RelPosX(at(arr, 2)), y: this.RelPosY(at(arr, 3)) };
        const size = { x: this.ConvertSize(at(arr, 4)), y: this.ConvertSize(at(arr, 5)) };
        const padUuid = at(arr, 12);

        if (footprint) {
          padContainer = footprint;
        } else {
          padContainer = this.newHiddenFootprint(aContainer as BOARD, `Pad_${padUuid}`, center);
          aContainer.Add(padContainer, ADD_MODE.APPEND);
        }

        const pad = new PAD(padContainer);

        pad.SetNet(getOrAddNetItem(at(arr, 7)));
        pad.SetNumber(at(arr, 8));
        pad.SetPosition(toI(center));
        pad.SetSize(PADSTACK.ALL_LAYERS, toI(size));
        pad.SetOrientationDegrees(this.Convert(at(arr, 11)));
        pad.SetThermalSpokeAngle(ANGLE_0);

        const elayer = at(arr, 6);
        const klayer = this.LayerToKi(elayer);

        const plated = at(arr, 15) === 'Y';

        if (klayer === F_Cu) {
          pad.SetLayer(F_Cu);
          pad.SetLayerSet(PAD.SMDMask());
          pad.SetAttribute(PAD_ATTRIB.SMD);
        } else if (klayer === B_Cu) {
          pad.SetLayer(B_Cu);
          pad.SetLayerSet(PAD.SMDMask().FlipStandardLayers());
          pad.SetAttribute(PAD_ATTRIB.SMD);
        } else if (elayer === '11') {
          pad.SetLayerSet(plated ? PAD.PTHMask() : PAD.UnplatedHoleMask());
          pad.SetAttribute(plated ? PAD_ATTRIB.PTH : PAD_ATTRIB.NPTH);
        } else {
          pad.SetLayer(klayer);
          pad.SetLayerSet(new LSET([klayer]));
          pad.SetAttribute(PAD_ATTRIB.SMD);
        }

        const padType = at(arr, 1);

        if (padType === 'ELLIPSE') {
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.OVAL);
        } else if (padType === 'RECT') {
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
        } else if (padType === 'OVAL') {
          if (pad.GetSizeX() === pad.GetSizeY())
            pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
          else pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.OVAL);
        } else if (padType === 'POLYGON') {
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CUSTOM);
          pad.SetAnchorPadShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
          pad.SetSize(PADSTACK.ALL_LAYERS, { x: 1, y: 1 });

          const data = split(at(arr, 10), ' ');

          const chain = new SHAPE_LINE_CHAIN();

          for (let i = 1; i < data.length; i += 2) {
            const pt = { x: this.RelPosX(data[i - 1]!), y: this.RelPosY(data[i]!) };
            chain.Append(toI(pt));
          }

          chain.SetClosed(true);

          chain.Move(toI({ x: -center.x, y: -center.y }));
          chain.Rotate(pad.GetOrientation().negate());
          pad.AddPrimitivePoly(PADSTACK.ALL_LAYERS, new SHAPE_POLY_SET(chain), 0, true);
        }

        const holeDia = at(arr, 9);

        if (holeDia !== '') {
          const holeD = this.ConvertSize(holeDia) * 2;
          let holeL = 0;

          const holeLength = at(arr, 13);

          if (holeLength !== '') holeL = this.ConvertSize(holeLength);

          if (holeL > 0) {
            pad.SetDrillShape(PAD_DRILL_SHAPE.OBLONG);

            if (size.x < size.y) pad.SetDrillSize(toI({ x: holeD, y: holeL }));
            else pad.SetDrillSize(toI({ x: holeL, y: holeD }));
          } else {
            pad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
            pad.SetDrillSize(toI({ x: holeD, y: holeD }));
          }
        }

        const pasteExp = at(arr, 17);

        if (pasteExp !== '') {
          const pasteExpansion = this.ConvertSize(pasteExp);
          pad.SetLocalSolderPasteMargin(Math.trunc(pasteExpansion));
        }

        const maskExp = at(arr, 18);

        if (maskExp !== '') {
          const maskExpansion = this.ConvertSize(maskExp);
          pad.SetLocalSolderMaskMargin(Math.trunc(maskExpansion));
        }

        padContainer.Add(pad, ADD_MODE.APPEND);
      }
    }
  }

  /** The locked, hidden-field footprint a board-level `HOLE` or `PAD` is wrapped in. */
  private newHiddenFootprint(aBoard: BOARD, name: string, center: Vec2): FOOTPRINT {
    const newFootprint = new FOOTPRINT(aBoard);

    newFootprint.SetFPID(new LIB_ID('', name));
    newFootprint.SetPosition(toI(center));
    newFootprint.SetLocked(true);

    newFootprint.Reference().SetText(name);
    newFootprint.Reference().SetVisible(false);
    newFootprint.Reference().SetTextSize(HIDDEN_TEXT_SIZE);
    newFootprint.Value().SetText(name);
    newFootprint.Value().SetVisible(false);
    newFootprint.Value().SetTextSize(HIDDEN_TEXT_SIZE);

    return newFootprint;
  }

  ParseFootprint(
    aOrigin: Vec2,
    aOrientation: EDA_ANGLE,
    aLayer: number,
    aParent: BOARD | null,
    aParams: Map<string, string>,
    aFootprintMap: FOOTPRINT_MAP,
    aShapes: readonly string[],
  ): FOOTPRINT | null {
    const footprint = new FOOTPRINT(aParent);

    if (aLayer === 2) {
      // Bottom layer
      footprint.SetLayer(B_Cu);
      footprint.SetOrientation(aOrientation.sub(ANGLE_180));
    } else {
      footprint.SetLayer(F_Cu);
      footprint.SetOrientation(aOrientation);
    }

    footprint.Value().SetText(get(aParams, 'package'));

    this.m_relOrigin = aOrigin;

    this.ParseToBoardItemContainer(footprint, aParent, aParams, aFootprintMap, aShapes);

    // Heal board outlines
    const shapes: PCB_SHAPE[] = [];

    for (const item of footprint.GraphicalItems()) {
      if (!item.IsOnLayer(Edge_Cuts)) continue;

      if (item.Type() === KICAD_T.PCB_SHAPE_T) shapes.push(item as PCB_SHAPE);
    }

    ConnectBoardShapes(shapes, SHAPE_JOIN_DISTANCE);

    // EasyEDA footprints don't have courtyard, so build a box ourselves
    if (!footprint.IsOnLayer(F_CrtYd)) {
      const bbox = footprint.GetLayerBoundingBox(
        new LSET([F_Cu, F_Fab, F_Paste, F_Mask, Edge_Cuts]),
      );
      bbox.Inflate(pcbIUScale.mmToIU(0.25)); // Default courtyard clearance

      const shape = new PCB_SHAPE(footprint, SHAPE_T.RECTANGLE);

      shape.SetWidth(pcbIUScale.mmToIU(DEFAULT_COURTYARD_WIDTH));
      shape.SetLayer(F_CrtYd);
      shape.SetStart(bbox.GetOrigin());
      shape.SetEnd(bbox.GetEnd());

      footprint.Add(shape, ADD_MODE.APPEND);
    }

    let hasFabRef = false;

    for (const item of footprint.GraphicalItems()) {
      if (item.Type() === KICAD_T.PCB_TEXT_T && item.IsOnLayer(F_Fab)) {
        if ((item as PCB_TEXT).GetText() === '${REFERENCE}') {
          hasFabRef = true;
          break;
        }
      }
    }

    if (!hasFabRef) {
      // Add reference text field on F_Fab
      const c_refTextSize = pcbIUScale.mmToIU(0.5); // KLC min Fab text size
      const c_refTextThickness = pcbIUScale.mmToIU(0.1); // Decent text thickness
      const refText = new PCB_TEXT(footprint);

      refText.SetLayer(F_Fab);
      refText.SetTextSize({ x: c_refTextSize, y: c_refTextSize });
      refText.SetTextThickness(c_refTextThickness);
      refText.SetText('${REFERENCE}');

      footprint.Add(refText, ADD_MODE.APPEND);
    }

    return footprint;
  }

  ParseBoard(
    aBoard: BOARD,
    aOrigin: Vec2,
    aFootprintMap: FOOTPRINT_MAP,
    aShapes: readonly string[],
  ): void {
    this.m_relOrigin = aOrigin;

    this.ParseToBoardItemContainer(aBoard, null, new Map(), aFootprintMap, aShapes);

    // Heal board outlines
    const shapes: PCB_SHAPE[] = [];

    for (const item of aBoard.Drawings()) {
      if (!item.IsOnLayer(Edge_Cuts)) continue;

      if (item.Type() === KICAD_T.PCB_SHAPE_T) shapes.push(item as PCB_SHAPE);
    }

    ConnectBoardShapes(shapes, SHAPE_JOIN_DISTANCE);
  }
}

/** `for( const json& x : j )`: an array's elements, an object's values, a scalar itself. */
function iterate(j: JSON_VALUE): JSON_VALUE[] {
  if (Array.isArray(j)) return j;

  if (isObject(j)) {
    // nlohmann's object is a std::map: values in key order
    return Object.keys(j)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((k) => j[k]!);
  }

  if (j === null) return [];

  return [j];
}

/** `j.at( key )`: out_of_range when the key is absent. */
function requireKey(j: { [k: string]: JSON_VALUE }, aKey: string): JSON_VALUE {
  if (!Object.hasOwn(j, aKey))
    throw new JSON_EXCEPTION(`[json.exception.out_of_range.403] key '${aKey}' not found`);

  return j[aKey]!;
}

/** `int x = j.at( key )`: a number, truncated; anything else is a type_error. */
function jsonInt(j: JSON_VALUE | undefined, aKey: string): number {
  if (j === undefined)
    throw new JSON_EXCEPTION(`[json.exception.out_of_range.403] key '${aKey}' not found`);

  if (typeof j !== 'number' && typeof j !== 'boolean')
    throw new JSON_EXCEPTION('[json.exception.type_error.302] type must be number');

  return Math.trunc(Number(j));
}
