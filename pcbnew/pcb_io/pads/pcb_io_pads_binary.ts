// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pads/pcb_io_pads_binary.cpp` / `.h`: the PADS Layout binary
 * (`.pcb`) board importer, built on `PADS_IO::BINARY_PARSER`.
 */

import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import {
  ConvertInvertedNetName,
  FromUTF8,
  GenerateDeterministicUuid,
} from '@ziroeda/common/io/pads/pads_common.js';
import { PADS_UNIT_CONVERTER, cRound } from '@ziroeda/common/io/pads/pads_unit_converter.js';
import { KIID_PATH, kiidFromString } from '@ziroeda/common/kiid.js';
import {
  B_Cu,
  Cmts_User,
  Edge_Cuts,
  F_Cu,
  IsCopperLayer,
  type PCB_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { RPT_SEVERITY_INFO, RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { add, EuclideanNormI, sub, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { BOARD } from '../../board.js';
import { FOOTPRINT } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { VIATYPE } from '../../pcb_track_types.js';
import { ZONE } from '../../zone.js';
import { ZONE_CONNECTION } from '../../zones.js';
import {
  type INPUT_LAYER_DESC,
  LAYER_MAPPABLE_PLUGIN,
  type LAYER_MAPPING_HANDLER,
} from '../common/plugin_common_layer_mapping.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import { BINARY_PARSER } from './pads_binary_parser.js';
import { PADS_LAYER_MAPPER, type PADS_LAYER_INFO, PADS_LAYER_TYPE } from './pads_layer_mapper.js';
import { PADS_LAYER_FUNCTION } from './pads_parser.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });

export class PCB_IO_PADS_BINARY extends PCB_IO {
  private readonly m_layerMappable = new LAYER_MAPPABLE_PLUGIN();

  private m_layerMap = new Map<string, PCB_LAYER_ID>();
  private m_loadBoard: BOARD | null = null;
  private m_parser: BINARY_PARSER | null = null;
  private m_unitConverter = new PADS_UNIT_CONVERTER();
  private m_layerMapper = new PADS_LAYER_MAPPER();
  private m_layerInfos: PADS_LAYER_INFO[] = [];
  private m_scaleFactor = 0.0;
  private m_originX = 0.0;
  private m_originY = 0.0;

  constructor() {
    super('PADS Binary');

    this.RegisterCallback((aDescs) => this.DefaultLayerMappingCallback(aDescs));
  }

  RegisterCallback(aLayerMappingHandler: LAYER_MAPPING_HANDLER): void {
    this.m_layerMappable.RegisterCallback(aLayerMappingHandler);
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('PADS Binary', ['pcb']);
  }

  GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('PADS Binary Library', ['pcb']);
  }

  GetLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    return BINARY_PARSER.IsBinaryPadsFile(this.m_readFile(aFileName));
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    _aProperties: PCB_IO_PROPERTIES | null = null,
    _aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    const board = aAppendToMe ?? new BOARD();

    this.Report('Starting PADS binary PCB import', RPT_SEVERITY_INFO);

    this.m_progressReporter?.SetNumPhases(3);

    const parser = new BINARY_PARSER();

    try {
      const data = this.m_readFile(aFileName);

      if (!data) throw new IO_ERROR('Cannot open file');

      parser.Parse(data);
    } catch (e) {
      const what = e instanceof IO_ERROR ? e.What() : (e as Error).message;
      throw new IO_ERROR(`Error parsing PADS binary file: ${what}`);
    }

    this.m_loadBoard = board;
    this.m_parser = parser;

    try {
      this.m_progressReporter?.BeginPhase(1);

      this.loadBoardSetup();
      this.loadNets();

      this.m_progressReporter?.BeginPhase(2);

      this.loadFootprints();
      this.loadBoardOutline();
      this.loadTracksAndVias();
      this.loadTexts();
      this.loadZones();
      this.reportStatistics();
    } finally {
      this.clearLoadingState();
    }

    return board;
  }

  private get board(): BOARD {
    return this.m_loadBoard!;
  }

  private get parser(): BINARY_PARSER {
    return this.m_parser!;
  }

  private loadBoardSetup(): void {
    const layer_count = this.parser.GetParameters().layer_count;

    this.m_layerMapper.SetCopperLayerCount(layer_count);

    const convertLayerType = (func: PADS_LAYER_FUNCTION): PADS_LAYER_TYPE => {
      switch (func) {
        case PADS_LAYER_FUNCTION.ROUTING:
        case PADS_LAYER_FUNCTION.PLANE:
        case PADS_LAYER_FUNCTION.MIXED:
          return PADS_LAYER_TYPE.COPPER_INNER;
        case PADS_LAYER_FUNCTION.SOLDER_MASK:
          return PADS_LAYER_TYPE.SOLDERMASK_TOP;
        case PADS_LAYER_FUNCTION.PASTE_MASK:
          return PADS_LAYER_TYPE.PASTE_TOP;
        case PADS_LAYER_FUNCTION.SILK_SCREEN:
          return PADS_LAYER_TYPE.SILKSCREEN_TOP;
        case PADS_LAYER_FUNCTION.ASSEMBLY:
          return PADS_LAYER_TYPE.ASSEMBLY_TOP;
        case PADS_LAYER_FUNCTION.DOCUMENTATION:
          return PADS_LAYER_TYPE.DOCUMENTATION;
        case PADS_LAYER_FUNCTION.DRILL:
          return PADS_LAYER_TYPE.DRILL_DRAWING;
        default:
          return PADS_LAYER_TYPE.UNKNOWN;
      }
    };

    for (const padsInfo of this.parser.GetLayerInfos()) {
      const info: PADS_LAYER_INFO = {
        padsLayerNum: padsInfo.number,
        name: padsInfo.name,
        type: PADS_LAYER_TYPE.UNKNOWN,
        required: padsInfo.required,
      };

      if (padsInfo.layer_type !== PADS_LAYER_FUNCTION.UNKNOWN) {
        info.type = convertLayerType(padsInfo.layer_type);

        if (info.type === PADS_LAYER_TYPE.COPPER_INNER) {
          if (padsInfo.number === 1) info.type = PADS_LAYER_TYPE.COPPER_TOP;
          else if (padsInfo.number === layer_count) info.type = PADS_LAYER_TYPE.COPPER_BOTTOM;
        }
      } else {
        info.type = this.m_layerMapper.GetLayerType(padsInfo.number);
      }

      this.m_layerInfos.push(info);
    }

    const inputDescs = this.m_layerMapper.BuildInputLayerDescriptions(this.m_layerInfos);

    for (const d of inputDescs) d.Name = FromUTF8(d.Name);

    this.m_layerMap = this.m_layerMappable.m_layer_mapping_handler(inputDescs);

    let copperLayerCount = layer_count;

    if (copperLayerCount < 1) copperLayerCount = 2;

    this.board.SetCopperLayerCount(copperLayerCount);

    this.m_unitConverter.SetBasicUnitsMode(true);
    this.m_scaleFactor = PADS_UNIT_CONVERTER.BASIC_TO_NM;

    this.m_originX = this.parser.GetParameters().origin.x;
    this.m_originY = this.parser.GetParameters().origin.y;

    if (this.m_originX === 0.0 && this.m_originY === 0.0) {
      const boardOutlines = this.parser.GetBoardOutlines();

      if (boardOutlines.length > 0) {
        let minX = Number.MAX_VALUE;
        let maxX = -Number.MAX_VALUE;
        let minY = Number.MAX_VALUE;
        let maxY = -Number.MAX_VALUE;

        for (const outline of boardOutlines) {
          for (const pt of outline.points) {
            minX = Math.min(minX, pt.x);
            maxX = Math.max(maxX, pt.x);
            minY = Math.min(minY, pt.y);
            maxY = Math.max(maxY, pt.y);
          }
        }

        if (minX < maxX && minY < maxY) {
          this.m_originX = (minX + maxX) / 2.0;
          this.m_originY = (minY + maxY) / 2.0;
        }
      }
    }
  }

  private loadNets(): void {
    for (const padsNet of this.parser.GetNets()) this.ensureNet(padsNet.name);
  }

  private loadFootprints(): void {
    for (const padsPart of this.parser.GetParts()) {
      const footprint = new FOOTPRINT(this.board);
      footprint.SetReference(FromUTF8(padsPart.name));

      const path = new KIID_PATH();
      path.push_back(kiidFromString(GenerateDeterministicUuid(padsPart.name)));
      footprint.SetPath(path.steps());

      const decalName = padsPart.decal;
      const fpid = new LIB_ID();

      fpid.SetLibItemName(FromUTF8(decalName !== '' ? decalName : padsPart.name));
      footprint.SetFPID(fpid);

      footprint.SetValue(FromUTF8(padsPart.decal));
      footprint.SetPosition(
        V(this.scaleCoord(padsPart.location.x, true), this.scaleCoord(padsPart.location.y, false)),
      );
      footprint.SetOrientation(new EDA_ANGLE(padsPart.rotation));
      footprint.SetLayer(F_Cu);

      this.board.Add(footprint);

      if (padsPart.bottom_layer) footprint.Flip(footprint.GetPosition(), FLIP_DIRECTION.LEFT_RIGHT);
    }
  }

  private loadBoardOutline(): void {
    for (const polyline of this.parser.GetBoardOutlines()) {
      const pts = polyline.points;

      if (pts.length < 2) continue;

      const addSegment = (p1: { x: number; y: number }, p2: { x: number; y: number }): void => {
        const shape = new PCB_SHAPE(this.board);
        shape.SetShape(SHAPE_T.SEGMENT);
        shape.SetStart(V(this.scaleCoord(p1.x, true), this.scaleCoord(p1.y, false)));
        shape.SetEnd(V(this.scaleCoord(p2.x, true), this.scaleCoord(p2.y, false)));
        shape.SetWidth(this.scaleSize(polyline.width));
        shape.SetLayer(Edge_Cuts);
        this.board.Add(shape);
      };

      for (let i = 0; i < pts.length - 1; ++i) {
        const p1 = pts[i]!;
        const p2 = pts[i + 1]!;

        if (Math.abs(p1.x - p2.x) < 0.001 && Math.abs(p1.y - p2.y) < 0.001) continue;

        addSegment(p1, p2);
      }

      if (polyline.closed && pts.length > 2) {
        const pLast = pts[pts.length - 1]!;
        const pFirst = pts[0]!;

        if (Math.abs(pLast.x - pFirst.x) > 0.001 || Math.abs(pLast.y - pFirst.y) > 0.001)
          addSegment(pLast, pFirst);
      }
    }
  }

  private loadTracksAndVias(): void {
    const placedThroughVias = new Set<string>();

    for (const route of this.parser.GetRoutes()) {
      let net: NETINFO_ITEM | null = null;

      if (route.net_name !== '') {
        net = this.board.FindNet(ConvertInvertedNetName(route.net_name));

        if (!net) continue;
      }

      for (const track_def of route.tracks) {
        if (track_def.points.length < 2) continue;

        let track_layer = this.getMappedLayer(track_def.layer);

        if (!IsCopperLayer(track_layer)) {
          if (route.net_name === '' && track_def.layer === 0) {
            track_layer = F_Cu;
          } else {
            this.Report(
              `Skipping track on non-copper layer ${track_def.layer}`,
              RPT_SEVERITY_WARNING,
            );
            continue;
          }
        }

        let track_width = this.scaleSize(track_def.width);

        if (track_width <= 0) track_width = this.scaleSize(8.0);

        for (let i = 0; i < track_def.points.length - 1; ++i) {
          const p1 = track_def.points[i]!;
          const p2 = track_def.points[i + 1]!;

          const start = V(this.scaleCoord(p1.x, true), this.scaleCoord(p1.y, false));
          const end = V(this.scaleCoord(p2.x, true), this.scaleCoord(p2.y, false));

          if (EuclideanNormI(sub(start, end)) < 1000) continue;

          if (p2.is_arc) {
            const center = V(this.scaleCoord(p2.arc.cx, true), this.scaleCoord(p2.arc.cy, false));
            const clockwise = p2.arc.delta_angle < 0;
            const shapeArc = new SHAPE_ARC();
            shapeArc.ConstructFromStartEndCenter(start, end, center, clockwise, track_width);

            const arc = new PCB_ARC(this.board, shapeArc);

            if (net) arc.SetNet(net);

            arc.SetWidth(track_width);
            arc.SetLayer(track_layer);
            this.board.Add(arc);
          } else {
            const track = new PCB_TRACK(this.board);

            if (net) track.SetNet(net);

            track.SetWidth(track_width);
            track.SetLayer(track_layer);
            track.SetStart(start);
            track.SetEnd(end);
            this.board.Add(track);
          }
        }
      }

      for (const via_def of route.vias) {
        const pos = V(
          this.scaleCoord(via_def.location.x, true),
          this.scaleCoord(via_def.location.y, false),
        );
        const key = `${pos.x},${pos.y}`;

        if (placedThroughVias.has(key)) continue;

        placedThroughVias.add(key);

        const via = new PCB_VIA(this.board);

        if (net) via.SetNet(net);

        via.SetPosition(pos);
        via.SetWidth(this.scaleSize(20.0));
        via.SetDrill(this.scaleSize(10.0));
        via.SetLayerPair(F_Cu, B_Cu);
        via.SetViaType(VIATYPE.THROUGH);
        this.board.Add(via);
      }
    }
  }

  private loadTexts(): void {
    const cfg = ADVANCED_CFG.GetCfg();

    for (const pads_text of this.parser.GetTexts()) {
      let textLayer = this.getMappedLayer(pads_text.layer);

      if (textLayer === UNDEFINED_LAYER) {
        this.Report(
          `Text on unmapped layer ${pads_text.layer} assigned to Comments layer`,
          RPT_SEVERITY_WARNING,
        );
        textLayer = Cmts_User;
      }

      const text = new PCB_TEXT(this.board);

      // wxString( std::string ): the bytes are printable ASCII (readFixedString)
      text.SetText(pads_text.content);

      const scaledSize = this.scaleSize(pads_text.height);
      const charHeight = Math.trunc(scaledSize * cfg.m_PadsPcbTextHeightScale);
      const charWidth = Math.trunc(scaledSize * cfg.m_PadsPcbTextWidthScale);
      text.SetTextSize(V(charWidth, charHeight));

      if (pads_text.width > 0) text.SetTextThickness(this.scaleSize(pads_text.width));

      const textAngle = new EDA_ANGLE(pads_text.rotation);
      text.SetTextAngle(textAngle);

      const pos = V(
        this.scaleCoord(pads_text.location.x, true),
        this.scaleCoord(pads_text.location.y, false),
      );
      const textShift = RotatePoint(V(-cfg.m_PadsTextAnchorOffsetNm, 0), textAngle);
      text.SetPosition(add(pos, textShift));

      if (pads_text.hjust === 'LEFT') text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      else if (pads_text.hjust === 'RIGHT')
        text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
      else text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);

      if (pads_text.vjust === 'UP') text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
      else if (pads_text.vjust === 'DOWN')
        text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
      else text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

      text.SetKeepUpright(false);
      text.SetLayer(textLayer);
      this.board.Add(text);
    }
  }

  private loadZones(): void {
    const pours = this.parser.GetPours();
    const params = this.parser.GetParameters();

    let maxPriority = 0;

    for (const pour_def of pours) {
      if (pour_def.priority > maxPriority) maxPriority = pour_def.priority;
    }

    for (const pour_def of pours) {
      const pourLayer = this.getMappedLayer(pour_def.layer);

      if (pourLayer === UNDEFINED_LAYER) {
        this.Report(`Skipping pour on unmapped layer ${pour_def.layer}`, RPT_SEVERITY_WARNING);
        continue;
      }

      const zone = new ZONE(this.board);
      zone.SetLayer(pourLayer);
      zone.Outline().NewOutline();

      for (const pt of pour_def.points)
        zone.Outline().Append(this.scaleCoord(pt.x, true), this.scaleCoord(pt.y, false));

      if (zone.GetNumCorners() === 0) continue;

      if (pour_def.is_cutout) {
        zone.SetIsRuleArea(true);
        zone.SetDoNotAllowZoneFills(true);
        zone.SetDoNotAllowTracks(false);
        zone.SetDoNotAllowVias(false);
        zone.SetDoNotAllowPads(false);
        zone.SetDoNotAllowFootprints(false);
        zone.SetZoneName(`Cutout_${FromUTF8(pour_def.owner_pour)}`);
      } else {
        const net = this.board.FindNet(ConvertInvertedNetName(pour_def.net_name));

        if (net) zone.SetNet(net);

        zone.SetAssignedPriority(maxPriority - pour_def.priority + 1);
        zone.SetMinThickness(this.scaleSize(pour_def.width));
        zone.SetThermalReliefGap(this.scaleSize(params.thermal_min_clearance));
        zone.SetThermalReliefSpokeWidth(this.scaleSize(params.thermal_line_width));
        zone.SetPadConnection(ZONE_CONNECTION.THERMAL);
      }

      this.board.Add(zone);
    }
  }

  private reportStatistics(): void {
    if (!this.m_reporter) return;

    let trackCount = 0;
    let viaCount = 0;

    for (const track of this.board.Tracks()) {
      if (track.Type() === KICAD_T.PCB_VIA_T) viaCount++;
      else trackCount++;
    }

    this.Report(
      `Imported ${this.board.Footprints().length} footprints, ${this.board.GetNetCount()} nets, ${trackCount} tracks, ${viaCount} vias, ${this.board.Zones().length} zones`,
      RPT_SEVERITY_INFO,
    );
  }

  DefaultLayerMappingCallback(
    aInputLayerDescriptionVector: readonly INPUT_LAYER_DESC[],
  ): Map<string, PCB_LAYER_ID> {
    const layerMap = new Map<string, PCB_LAYER_ID>();

    for (const layer of aInputLayerDescriptionVector) layerMap.set(layer.Name, layer.AutoMapLayer);

    return layerMap;
  }

  /** `static_cast<int>( int64_t )`: the low 32 bits, as g++ converts. */
  private scaleSize(aVal: number): number {
    return this.m_unitConverter.ToNanometersSize(aVal) | 0;
  }

  private scaleCoord(aVal: number, aIsX: boolean): number {
    const origin = aIsX ? this.m_originX : this.m_originY;
    const originNm = cRound(origin * this.m_scaleFactor);
    const valNm = cRound(aVal * this.m_scaleFactor);

    return (aIsX ? valNm - originNm : originNm - valNm) | 0;
  }

  private getMappedLayer(aPadsLayer: number): PCB_LAYER_ID {
    for (const info of this.m_layerInfos) {
      if (info.padsLayerNum === aPadsLayer) {
        const mapped = this.m_layerMap.get(FromUTF8(info.name));

        if (mapped !== undefined && mapped !== UNDEFINED_LAYER) return mapped;

        return this.m_layerMapper.GetAutoMapLayer(aPadsLayer, info.type);
      }
    }

    return this.m_layerMapper.GetAutoMapLayer(aPadsLayer);
  }

  private ensureNet(aNetName: string): void {
    if (aNetName === '') return;

    const wxName = ConvertInvertedNetName(aNetName);

    if (this.board.FindNet(wxName) === null) {
      const net = new NETINFO_ITEM(this.board, wxName, this.board.GetNetCount() + 1);
      this.board.Add(net);
    }
  }

  private clearLoadingState(): void {
    this.m_loadBoard = null;
    this.m_parser = null;
    this.m_unitConverter = new PADS_UNIT_CONVERTER();
    this.m_layerMapper = new PADS_LAYER_MAPPER();
    this.m_layerInfos = [];
    this.m_scaleFactor = 0.0;
    this.m_originX = 0.0;
    this.m_originY = 0.0;
  }
}
