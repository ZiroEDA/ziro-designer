// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pads/pcb_io_pads.cpp` / `.h`: the PADS ASCII (`.asc`)
 * board importer, built on `PADS_IO::PARSER` (pads_parser.ts).
 *
 * `generateDrcRules` writes the diff-pair gap rules to a `.kicad_dru` beside
 * the board upstream; a plugin cannot write files here, so the text is kept
 * (`GetCustomRules()`) for the caller to store, as the Eagle importer does.
 */

import {
  ConvertInvertedNetName,
  ConvertText,
  FromUTF8,
  GenerateDeterministicUuid,
  byteString,
} from '@ziroeda/common/io/pads/pads_common.js';
import {
  PADS_UNIT_CONVERTER,
  PADS_UNIT_TYPE,
  cRound,
} from '@ziroeda/common/io/pads/pads_unit_converter.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { KIID_PATH, kiidFromString } from '@ziroeda/common/kiid.js';
import {
  B_Cu,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  Cmts_User,
  Edge_Cuts,
  F_Cu,
  F_Mask,
  F_Paste,
  F_SilkS,
  In1_Cu,
  IsBackLayer,
  IsCopperLayer,
  PCB_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { NETCLASS } from '@ziroeda/common/netclass.js';
import { RPT_SEVERITY_INFO, RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { FormatDouble2Str } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import { RECT_CHAMFER_ALL } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { atan2, cos, sin } from '@ziroeda/kimath/src/math/libm.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { add, EuclideanNormI, sub, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { BOARD } from '../../board.js';
import { BOARD_STACKUP_ITEM_TYPE } from '../../board_stackup_manager/board_stackup.js';
import { VIA_DIMENSION } from '../../board_design_settings.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FOOTPRINT } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_SHAPE, PADSTACK, PADSTACK_MODE } from '../../padstack.js';
import { PCB_DIM_ALIGNED } from '../../pcb_dimension.js';
import { PCB_FIELD } from '../../pcb_field.js';
import { PCB_GROUP } from '../../pcb_group.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { TENTING_MODE, VIATYPE } from '../../pcb_track_types.js';
import { ZONE } from '../../zone.js';
import { ZONE_BORDER_DISPLAY_STYLE } from '../../zone_settings.js';
import { ZONE_CONNECTION } from '../../zones.js';
import {
  type INPUT_LAYER_DESC,
  LAYER_MAPPABLE_PLUGIN,
  type LAYER_MAPPING_HANDLER,
} from '../common/plugin_common_layer_mapping.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import { PADS_LAYER_MAPPER, type PADS_LAYER_INFO, PADS_LAYER_TYPE } from './pads_layer_mapper.js';
import {
  type ARC_POINT,
  type ATTRIBUTE,
  type CLUSTER,
  type COPPER_SHAPE,
  KEEPOUT_TYPE,
  type LAYER_INFO,
  PADS_LAYER_FUNCTION,
  type PAD_STACK_LAYER,
  PARSER,
  type PART_TYPE,
  POUR_STYLE,
  THERMAL_TYPE,
  UNIT_TYPE,
  VIA_TYPE,
  sortedMap,
} from './pads_parser.js';

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

const clampInt = (v: number): number => Math.min(Math.max(v, INT_MIN), INT_MAX);

const V = (x: number, y: number): VECTOR2I => ({ x, y });

export class PCB_IO_PADS extends PCB_IO {
  private readonly m_layerMappable = new LAYER_MAPPABLE_PLUGIN();

  private m_layer_map = new Map<string, PCB_LAYER_ID>(); ///< PADS layer names to KiCad layers
  private m_loadBoard: BOARD | null = null;
  private m_parser: PARSER | null = null;
  private m_unitConverter = new PADS_UNIT_CONVERTER();
  private m_layerMapper = new PADS_LAYER_MAPPER();
  private m_layerInfos: PADS_LAYER_INFO[] = [];
  private m_scaleFactor = 0.0;
  private m_originX = 0.0;
  private m_originY = 0.0;
  private m_pinToNetMap = new Map<string, string>();
  private m_partToBlockMap = new Map<string, string>();
  private m_testPointIndex = 1;
  private m_minObjectSize = 1000;
  private m_customRules = '';

  constructor() {
    super('PADS ASCII');

    this.RegisterCallback((aDescs) => this.DefaultLayerMappingCallback(aDescs));
  }

  RegisterCallback(aLayerMappingHandler: LAYER_MAPPING_HANDLER): void {
    this.m_layerMappable.RegisterCallback(aLayerMappingHandler);
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('PADS ASCII', ['asc']);
  }

  GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('PADS ASCII Library', ['asc']);
  }

  GetLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }

  /** The `.kicad_dru` text upstream writes beside the board (see the file header). */
  GetCustomRules(): string {
    return this.m_customRules;
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    const data = this.m_readFile(aFileName);

    if (!data) return false;

    let end = data.indexOf(0x0a);

    if (end < 0) end = data.length;

    // std::getline fails only on an empty file
    if (data.length === 0) return false;

    return byteString(data.subarray(0, end)).includes('!PADS-');
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    _aProperties: PCB_IO_PROPERTIES | null = null,
    _aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    const board = aAppendToMe ?? new BOARD();

    this.Report('Starting PADS PCB import', RPT_SEVERITY_INFO);

    this.m_progressReporter?.SetNumPhases(4);

    const parser = new PARSER();

    try {
      const data = this.m_readFile(aFileName);

      if (!data) throw new Error(`Cannot open file: ${aFileName}`);

      parser.Parse(byteString(data));
    } catch (e) {
      if (e instanceof IO_ERROR) throw e;

      throw new IO_ERROR(`Error parsing PADS file: ${(e as Error).message}`);
    }

    this.m_loadBoard = board;
    this.m_parser = parser;
    this.m_testPointIndex = 1;
    this.m_minObjectSize = ADVANCED_CFG.GetCfg().m_PcbImportMinObjectSizeNm;
    this.m_customRules = '';

    try {
      this.m_progressReporter?.BeginPhase(1);

      this.loadBoardSetup();
      this.loadNets();

      this.m_progressReporter?.BeginPhase(2);

      this.loadFootprints();
      this.loadReuseBlockGroups();
      this.loadTestPoints();
      this.loadTexts();

      this.m_progressReporter?.BeginPhase(3);

      this.loadTracksAndVias();
      this.loadCopperShapes();
      this.loadClusterGroups();
      this.loadZones();
      this.loadBoardOutline();
      this.loadDimensions();
      this.loadKeepouts();
      this.loadGraphicLines();
      this.generateDrcRules(aFileName);
      this.reportStatistics();
    } finally {
      this.clearLoadingState();
    }

    return board;
  }

  private get board(): BOARD {
    return this.m_loadBoard!;
  }

  private get parser(): PARSER {
    return this.m_parser!;
  }

  private loadNets(): void {
    const nets = this.parser.GetNets();

    for (const pads_net of nets) this.ensureNet(pads_net.name);

    for (const pads_net of nets) {
      for (const pin of pads_net.pins)
        this.m_pinToNetMap.set(`${pin.ref_des}.${pin.pin_name}`, pads_net.name);
    }

    const route_nets = this.parser.GetRoutes();

    for (const route of route_nets) {
      for (const pin of route.pins) {
        const key = `${pin.ref_des}.${pin.pin_name}`;

        if (!this.m_pinToNetMap.has(key)) this.m_pinToNetMap.set(key, route.net_name);
      }
    }

    for (const route of route_nets) this.ensureNet(route.net_name);

    for (const pour_def of this.parser.GetPours()) this.ensureNet(pour_def.net_name);

    for (const copper of this.parser.GetCopperShapes()) {
      if (copper.net_name !== '' && IsCopperLayer(this.getMappedLayer(copper.layer)))
        this.ensureNet(copper.net_name);
    }

    for (const [blockName, block] of sortedMap(this.parser.GetReuseBlocks())) {
      for (const partName of block.part_names) this.m_partToBlockMap.set(partName, blockName);
    }
  }

  private loadFootprints(): void {
    const decals = this.parser.GetPartDecals();
    const part_types = this.parser.GetPartTypes();
    const partInstanceAttrs = this.parser.GetPartInstanceAttrs();
    const parts = this.parser.GetParts();
    const cfg = ADVANCED_CFG.GetCfg();
    const layer_count = this.parser.GetParameters().layer_count;

    for (const pads_part of parts) {
      const footprint = new FOOTPRINT(this.board);
      footprint.SetReference(FromUTF8(pads_part.name));

      const symbolUuid = kiidFromString(GenerateDeterministicUuid(pads_part.name));
      const path = new KIID_PATH();
      path.push_back(symbolUuid);
      footprint.SetPath(path.steps());

      let decal_name = pads_part.decal;

      if (!pads_part.explicit_decal) {
        const part_type = part_types.get(decal_name);

        if (part_type) decal_name = part_type.decal_name;
      }

      // std::getline( ss, segment, ':' ): no trailing empty segment
      const decal_list = decal_name === '' ? [] : decal_name.split(':');

      if (decal_list.length > 0 && decal_name.endsWith(':')) decal_list.pop();

      let actual_decal_name = '';
      let found_valid_decal = false;

      if (pads_part.alt_decal_index >= 0 && pads_part.alt_decal_index < decal_list.length) {
        const alt_decal = decal_list[pads_part.alt_decal_index]!;

        if (decals.has(alt_decal)) {
          actual_decal_name = alt_decal;
          found_valid_decal = true;
        }
      }

      if (!found_valid_decal) {
        for (const decal of decal_list) {
          if (decals.has(decal)) {
            actual_decal_name = decal;
            found_valid_decal = true;
            break;
          }
        }
      }

      if (found_valid_decal) decal_name = actual_decal_name;

      const fpid = new LIB_ID();
      fpid.SetLibItemName(FromUTF8(decal_name));
      footprint.SetFPID(fpid);

      footprint.SetValue(FromUTF8(pads_part.decal));

      if (pads_part.alternate_decals.length > 0) {
        const alternates = pads_part.alternate_decals.map((d) => FromUTF8(d)).join(', ');

        const field = new PCB_FIELD(footprint, FIELD_T.USER, 'PADS_Alternate_Decals');
        field.SetLayer(Cmts_User);
        field.SetVisible(false);
        field.SetText(alternates);
        footprint.Add(field);
      }

      const partCoordScaler = (val: number, is_x: boolean): number => {
        const origin = is_x ? this.m_originX : this.m_originY;
        let part_factor = this.m_scaleFactor;

        if (!this.parser.IsBasicUnits()) {
          if (pads_part.units === 'M') part_factor = PADS_UNIT_CONVERTER.MILS_TO_NM;
          else if (pads_part.units === 'MM') part_factor = PADS_UNIT_CONVERTER.MM_TO_NM;
          else if (pads_part.units === 'I') part_factor = PADS_UNIT_CONVERTER.INCHES_TO_NM;
          else if (pads_part.units === 'D') part_factor = PADS_UNIT_CONVERTER.MILS_TO_NM;
        }

        const origin_nm = cRound(origin * this.m_scaleFactor);
        const val_nm = cRound(val * part_factor);
        let res_nm = val_nm - origin_nm;

        if (!is_x) res_nm = -res_nm;

        return clampInt(res_nm);
      };

      footprint.SetPosition(
        V(
          partCoordScaler(pads_part.location.x, true),
          partCoordScaler(pads_part.location.y, false),
        ),
      );
      footprint.SetOrientation(new EDA_ANGLE(pads_part.rotation));
      footprint.SetLayer(F_Cu);

      const partType: PART_TYPE | undefined = part_types.get(pads_part.decal);
      const instanceAttrs = partInstanceAttrs.get(pads_part.name);

      const applyAttributes = (
        attrs: readonly ATTRIBUTE[],
        scaler: (v: number) => number,
      ): void => {
        for (const attr of attrs) {
          let field: PCB_FIELD | null = null;
          let ownsField = false;

          if (attr.name === 'Ref.Des.') {
            field = footprint.Reference();
          } else if (attr.name === 'Part Type' || attr.name === 'VALUE') {
            field = footprint.Value();
          } else {
            let attrValue = '';

            if (instanceAttrs) {
              const v = instanceAttrs.get(attr.name);

              if (v !== undefined) attrValue = v;
            }

            if (attrValue === '' && partType) {
              const v = partType.attributes.get(attr.name);

              if (v !== undefined) attrValue = v;
            }

            if (attrValue !== '') {
              field = new PCB_FIELD(footprint, FIELD_T.USER, FromUTF8(attr.name));
              field.SetText(FromUTF8(attrValue));

              let fieldLayer = this.getMappedLayer(attr.level);

              if (fieldLayer === UNDEFINED_LAYER) fieldLayer = Cmts_User;
              else if (IsCopperLayer(fieldLayer))
                fieldLayer = IsBackLayer(fieldLayer) ? B_SilkS : F_SilkS;

              field.SetLayer(fieldLayer);
              ownsField = true;
            }
          }

          if (!field) continue;

          const scaledSize = scaler(attr.height);
          const charHeight = Math.trunc(scaledSize * cfg.m_PadsPcbTextHeightScale);
          const charWidth = Math.trunc(scaledSize * cfg.m_PadsPcbTextWidthScale);
          field.SetTextSize(V(charWidth, charHeight));

          if (attr.width > 0) field.SetTextThickness(scaler(attr.width));

          let offset = V(scaler(attr.x), -scaler(attr.y));
          const part_orient = new EDA_ANGLE(pads_part.rotation);
          offset = RotatePoint(offset, part_orient);

          const textAngle = new EDA_ANGLE(attr.orientation).add(part_orient);
          const textShift = RotatePoint(V(-cfg.m_PadsTextAnchorOffsetNm, 0), textAngle);
          offset = add(offset, textShift);

          field.SetPosition(add(footprint.GetPosition(), offset));
          field.SetTextAngle(textAngle);
          field.SetKeepUpright(false);
          field.SetVisible(attr.visible);

          if (attr.hjust === 'LEFT') field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
          else if (attr.hjust === 'RIGHT')
            field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
          else field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);

          if (attr.vjust === 'UP') field.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
          else if (attr.vjust === 'DOWN')
            field.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
          else field.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

          if (ownsField) footprint.Add(field);
        }
      };

      const decal = decals.get(decal_name);
      const decalScale = decal ? this.decalUnitScale(decal.units) : 0.0;
      const decalScaler = (val: number): number =>
        decalScale > 0.0 ? KiROUND(val * decalScale) : this.scaleSize(val);

      if (decal) {
        applyAttributes(decal.attributes, decalScaler);
      } else {
        this.Report(
          `Footprint '${FromUTF8(decal_name)}' not found in decal list, part skipped`,
          RPT_SEVERITY_WARNING,
        );
      }

      const partScaler = (val: number): number => {
        if (!this.parser.IsBasicUnits()) {
          if (pads_part.units === 'M') return KiROUND(val * PADS_UNIT_CONVERTER.MILS_TO_NM);
        }

        if (pads_part.units === 'M') return KiROUND(val);

        return this.scaleSize(val);
      };

      applyAttributes(pads_part.attributes, partScaler);

      footprint.Value().SetVisible(false);

      this.board.Add(footprint);

      const blockName = this.m_partToBlockMap.get(pads_part.name);

      if (blockName !== undefined) {
        const blockField = new PCB_FIELD(footprint, FIELD_T.USER, 'PADS_Reuse_Block');
        blockField.SetLayer(Cmts_User);
        blockField.SetVisible(false);
        blockField.SetText(FromUTF8(blockName));
        footprint.Add(blockField);
      }

      if (!decal) continue;

      const applyCornerRadius = (
        layer_def: PAD_STACK_LAYER,
        pad: PAD,
        kicad_layer: PCB_LAYER_ID,
        aSize: VECTOR2I,
        aDefaultRound: boolean,
      ): void => {
        if (layer_def.corner_radius > 0) {
          const min_dim = Math.min(aSize.x, aSize.y);
          const radius = decalScaler(layer_def.corner_radius);
          const ratio = min_dim > 0 ? Math.min(radius / min_dim, 0.5) : 0.25;

          if (layer_def.chamfered) {
            pad.SetShape(kicad_layer, PAD_SHAPE.CHAMFERED_RECT);
            pad.SetRoundRectRadiusRatio(kicad_layer, 0.0);
            pad.SetChamferRectRatio(kicad_layer, ratio);
            pad.SetChamferPositions(kicad_layer, RECT_CHAMFER_ALL);
          } else {
            pad.SetShape(kicad_layer, PAD_SHAPE.ROUNDRECT);
            pad.SetRoundRectRadiusRatio(kicad_layer, ratio);
          }
        } else if (aDefaultRound) {
          pad.SetShape(kicad_layer, PAD_SHAPE.ROUNDRECT);
          pad.SetRoundRectRadiusRatio(kicad_layer, 0.25);
        } else {
          pad.SetShape(kicad_layer, PAD_SHAPE.RECTANGLE);
        }
      };

      const convertPadShape = (
        layer_def: PAD_STACK_LAYER,
        pad: PAD,
        kicad_layer: PCB_LAYER_ID,
      ): void => {
        const shape = layer_def.shape;
        const size = V(
          Math.max(decalScaler(layer_def.sizeB), this.m_minObjectSize),
          Math.max(decalScaler(layer_def.sizeA), this.m_minObjectSize),
        );

        if (shape === 'R' || shape === 'C' || shape === 'A' || shape === 'RT') {
          pad.SetShape(kicad_layer, PAD_SHAPE.CIRCLE);
          pad.SetSize(kicad_layer, V(size.x, size.x));
        } else if (shape === 'S' || shape === 'ST') {
          const side = layer_def.sizeB > 0 ? size.x : size.y;
          const sq_size = V(side, side);
          applyCornerRadius(layer_def, pad, kicad_layer, sq_size, false);
          pad.SetSize(kicad_layer, sq_size);
        } else if (shape === 'O' || shape === 'OT') {
          pad.SetShape(kicad_layer, PAD_SHAPE.OVAL);
          pad.SetSize(kicad_layer, size);
        } else if (shape === 'RF') {
          applyCornerRadius(layer_def, pad, kicad_layer, size, false);
          pad.SetSize(kicad_layer, size);
        } else if (shape === 'OF') {
          pad.SetShape(kicad_layer, PAD_SHAPE.OVAL);
          pad.SetSize(kicad_layer, size);
        } else if (shape === 'RC' || shape === 'OC') {
          applyCornerRadius(layer_def, pad, kicad_layer, size, true);
          pad.SetSize(kicad_layer, size);
        } else {
          pad.SetShape(kicad_layer, PAD_SHAPE.CIRCLE);
          pad.SetSize(kicad_layer, V(size.x, size.x));
        }

        if (layer_def.finger_offset !== 0)
          pad.SetOffset(kicad_layer, V(decalScaler(layer_def.finger_offset), 0));
      };

      const part_orient = new EDA_ANGLE(pads_part.rotation);

      for (let term_idx = 0; term_idx < decal.terminals.length; ++term_idx) {
        const term = decal.terminals[term_idx]!;
        const pad = new PAD(footprint);
        footprint.Add(pad);

        pad.SetNumber(FromUTF8(term.name));

        const pad_pos = RotatePoint(V(decalScaler(term.x), -decalScaler(term.y)), part_orient);
        pad.SetPosition(add(footprint.GetPosition(), pad_pos));

        const pin_num = term_idx + 1;
        let stack = decal.pad_stacks.get(pin_num);

        if (stack === undefined) stack = decal.pad_stacks.get(0);

        if (stack !== undefined && stack.length > 0) {
          let drill = 0.0;
          let plated = true;
          let slot_length = 0.0;
          let slot_orientation = 0.0;
          let pad_rotation = 0.0;

          for (const layer_def of stack) {
            if (layer_def.drill > 0) {
              drill = layer_def.drill;
              plated = layer_def.plated;
              slot_length = layer_def.slot_length;
              slot_orientation = layer_def.slot_orientation;
              pad_rotation = layer_def.rotation;
              break;
            }
          }

          let layer_set = new LSET();

          const mapPadsLayer = (pads_layer: number): PCB_LAYER_ID => {
            if (pads_layer === -2 || pads_layer === 1) return F_Cu;
            else if (pads_layer === -1 || pads_layer === layer_count) return B_Cu;
            else if (pads_layer > 1 && pads_layer < layer_count) {
              const inner_idx = pads_layer - 2;

              if (inner_idx >= 0 && inner_idx < 30) return (In1_Cu + inner_idx * 2) as PCB_LAYER_ID;
            }

            return UNDEFINED_LAYER;
          };

          let has_explicit_layers = false;

          for (const layer_def of stack) {
            if (
              layer_def.layer === -2 ||
              layer_def.layer === -1 ||
              layer_def.layer === 1 ||
              layer_def.layer === layer_count
            ) {
              has_explicit_layers = true;
              break;
            }
          }

          let shape_rotation = 0.0;
          let shape_rotation_set = false;

          const convertGeometry = (aLayerDef: PAD_STACK_LAYER, aKicadLayer: PCB_LAYER_ID): void => {
            convertPadShape(aLayerDef, pad, aKicadLayer);

            if (!shape_rotation_set) {
              shape_rotation = aLayerDef.rotation;
              shape_rotation_set = true;
            }
          };

          const explicitly_seen_tech = new LSET();

          for (const layer_def of stack) {
            if (layer_def.layer > 0) {
              const check = this.getMappedLayer(layer_def.layer);

              if (check === F_Mask || check === B_Mask || check === F_Paste || check === B_Paste)
                explicitly_seen_tech.set(check);
            }
          }

          if (has_explicit_layers) {
            // std::to_string( double ) is "%f"; std::to_string( bool ) is "0" / "1"
            const shapeKey = (aLayerDef: PAD_STACK_LAYER): string =>
              `${aLayerDef.shape}|${aLayerDef.corner_radius.toFixed(6)}|${aLayerDef.chamfered ? 1 : 0}`;

            let front_shape = '';
            let back_shape = '';

            for (const layer_def of stack) {
              if (layer_def.sizeA <= 0) continue;

              if (
                layer_def.shape === 'RT' ||
                layer_def.shape === 'ST' ||
                layer_def.shape === 'RA' ||
                layer_def.shape === 'SA'
              )
                continue;

              const mapped = mapPadsLayer(layer_def.layer);

              if (mapped === F_Cu && front_shape === '') front_shape = shapeKey(layer_def);
              else if (mapped === B_Cu && back_shape === '') back_shape = shapeKey(layer_def);
            }

            if (front_shape !== '' && back_shape !== '' && front_shape !== back_shape)
              pad.Padstack().SetMode(PADSTACK_MODE.FRONT_INNER_BACK);
          }

          let normal_copper_set = false;

          for (const layer_def of stack) {
            if (layer_def.layer === 0) {
              if (!has_explicit_layers) {
                layer_set = drill > 0 ? LSET.AllCuMask() : new LSET([F_Cu, B_Cu]);
                convertGeometry(layer_def, F_Cu);

                if (drill === 0) {
                  pad.SetShape(B_Cu, pad.GetShape(F_Cu));
                  pad.SetSize(B_Cu, pad.GetSize(F_Cu));
                }
              }

              continue;
            }

            if (layer_def.sizeA <= 0) continue;

            if (layer_def.shape === 'RT' || layer_def.shape === 'ST') {
              pad.SetLocalZoneConnection(ZONE_CONNECTION.THERMAL);

              if (layer_def.thermal_spoke_width > 0)
                pad.SetLocalThermalSpokeWidthOverride(decalScaler(layer_def.thermal_spoke_width));

              if (layer_def.thermal_outer_diameter > layer_def.sizeA) {
                const gap = (layer_def.thermal_outer_diameter - layer_def.sizeA) / 2.0;
                const scaledGap = decalScaler(gap);

                if (scaledGap > 0) pad.SetLocalThermalGapOverride(scaledGap);
              }

              if (layer_def.thermal_spoke_orientation !== 0.0)
                pad.SetThermalSpokeAngleDegrees(layer_def.thermal_spoke_orientation);

              continue;
            }

            if (layer_def.shape === 'RA' || layer_def.shape === 'SA') continue;

            const kicad_layer = mapPadsLayer(layer_def.layer);

            if (kicad_layer === UNDEFINED_LAYER && layer_def.layer > 0) {
              const tech_layer = this.getMappedLayer(layer_def.layer);

              if (
                tech_layer === F_Mask ||
                tech_layer === B_Mask ||
                tech_layer === F_Paste ||
                tech_layer === B_Paste
              )
                layer_set.set(tech_layer);
            } else if (kicad_layer !== UNDEFINED_LAYER) {
              layer_set.set(kicad_layer);

              const is_copper = IsCopperLayer(kicad_layer);

              if (is_copper && normal_copper_set && pad.Padstack().Mode() === PADSTACK_MODE.NORMAL)
                continue;

              convertGeometry(layer_def, kicad_layer);

              if (is_copper) normal_copper_set = true;
            }
          }

          if (layer_set.none()) {
            layer_set.set(F_Cu);
            convertGeometry(stack[0]!, F_Cu);
          }

          pad.SetOrientation(part_orient.add(new EDA_ANGLE(shape_rotation)));

          if (drill === 0) {
            if (
              layer_set.test(F_Cu) &&
              !layer_set.test(F_Mask) &&
              !explicitly_seen_tech.test(F_Mask)
            )
              layer_set.set(F_Mask);

            if (
              layer_set.test(F_Cu) &&
              !layer_set.test(F_Paste) &&
              !explicitly_seen_tech.test(F_Paste)
            )
              layer_set.set(F_Paste);

            if (
              layer_set.test(B_Cu) &&
              !layer_set.test(B_Mask) &&
              !explicitly_seen_tech.test(B_Mask)
            )
              layer_set.set(B_Mask);

            if (
              layer_set.test(B_Cu) &&
              !layer_set.test(B_Paste) &&
              !explicitly_seen_tech.test(B_Paste)
            )
              layer_set.set(B_Paste);
          }

          if (slot_length > 0 && slot_length !== drill) {
            pad.SetDrillShape(PAD_DRILL_SHAPE.OBLONG);

            const drillMinor = decalScaler(drill);
            const drillMajor = decalScaler(slot_length);

            let relAngle = slot_orientation - pad_rotation;
            relAngle = relAngle % 360.0;

            if (relAngle < 0) relAngle += 360.0;

            const vertical =
              (relAngle > 45.0 && relAngle < 135.0) || (relAngle > 225.0 && relAngle < 315.0);

            if (vertical) pad.SetDrillSize(V(drillMinor, drillMajor));
            else pad.SetDrillSize(V(drillMajor, drillMinor));
          } else {
            pad.SetDrillSize(V(decalScaler(drill), decalScaler(drill)));
          }

          if (drill === 0) {
            pad.SetAttribute(PAD_ATTRIB.SMD);
          } else {
            if (plated) pad.SetAttribute(PAD_ATTRIB.PTH);
            else pad.SetAttribute(PAD_ATTRIB.NPTH);

            const mask_paste_bits = layer_set.and(new LSET([F_Mask, B_Mask, F_Paste, B_Paste]));
            layer_set = LSET.AllCuMask().or(mask_paste_bits);
          }

          pad.SetLayerSet(layer_set);
        } else {
          const fallbackSize = Math.max(decalScaler(1.5), this.m_minObjectSize);
          pad.SetSize(F_Cu, V(fallbackSize, fallbackSize));
          pad.SetShape(F_Cu, PAD_SHAPE.CIRCLE);
          pad.SetAttribute(PAD_ATTRIB.PTH);
          pad.SetLayerSet(LSET.AllCuMask());
        }

        const netName = this.m_pinToNetMap.get(`${pads_part.name}.${term.name}`);

        if (netName !== undefined) {
          const net = this.board.FindNet(ConvertInvertedNetName(netName));

          if (net) pad.SetNet(net);
        }
      }

      for (const item of decal.items) {
        if (item.points.length === 0) continue;

        let shape_layer: PCB_LAYER_ID = F_SilkS;

        if (item.layer === 0) {
          shape_layer = F_SilkS;
        } else {
          const mapped_layer = this.getMappedLayer(item.layer);

          if (IsCopperLayer(mapped_layer)) shape_layer = mapped_layer === B_Cu ? B_SilkS : F_SilkS;
          else shape_layer = mapped_layer;
        }

        if (shape_layer === UNDEFINED_LAYER) {
          this.Report(`Skipping decal item on unmapped layer ${item.layer}`, RPT_SEVERITY_WARNING);
          continue;
        }

        const is_circle = item.type === 'CIRCLE';
        const is_closed = item.type === 'CLOSED' || is_circle;
        const fp_pos = footprint.GetPosition();
        const stroke = (): STROKE_PARAMS =>
          new STROKE_PARAMS(decalScaler(item.width), LINE_STYLE.SOLID);

        if (is_circle && item.points.length >= 2) {
          const shape = new PCB_SHAPE(footprint, SHAPE_T.CIRCLE);
          shape.SetLayer(shape_layer);

          const x1 = item.points[0]!.x;
          const y1 = item.points[0]!.y;
          const x2 = item.points[1]!.x;
          const y2 = item.points[1]!.y;
          const cx = (x1 + x2) / 2.0;
          const cy = (y1 + y2) / 2.0;
          const radius = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)) / 2.0;
          const scaledRadius = Math.max(decalScaler(radius), this.m_minObjectSize);

          let center = V(decalScaler(cx), -decalScaler(cy));
          let pt_on_circle = V(center.x + scaledRadius, center.y);
          center = RotatePoint(center, part_orient);
          pt_on_circle = RotatePoint(pt_on_circle, part_orient);

          shape.SetCenter(add(fp_pos, center));
          shape.SetEnd(add(fp_pos, pt_on_circle));
          shape.SetStroke(stroke());
          footprint.Add(shape);
          continue;
        }

        if (item.points.length < 2) continue;

        const addPiece = (p1: ARC_POINT, p2: ARC_POINT): void => {
          const shape = new PCB_SHAPE(footprint);
          shape.SetLayer(shape_layer);
          shape.SetStroke(stroke());

          let start = V(decalScaler(p1.x), -decalScaler(p1.y));
          let end = V(decalScaler(p2.x), -decalScaler(p2.y));

          if (p2.is_arc) {
            shape.SetShape(SHAPE_T.ARC);

            let center = V(decalScaler(p2.arc.cx), -decalScaler(p2.arc.cy));

            if (p2.arc.delta_angle > 0) [start, end] = [end, start];

            center = RotatePoint(center, part_orient);
            start = RotatePoint(start, part_orient);
            end = RotatePoint(end, part_orient);

            shape.SetCenter(add(fp_pos, center));
            shape.SetStart(add(fp_pos, start));
            shape.SetEnd(add(fp_pos, end));
          } else {
            shape.SetShape(SHAPE_T.SEGMENT);

            start = RotatePoint(start, part_orient);
            end = RotatePoint(end, part_orient);

            shape.SetStart(add(fp_pos, start));
            shape.SetEnd(add(fp_pos, end));
          }

          footprint.Add(shape);
        };

        for (let i = 0; i < item.points.length - 1; ++i)
          addPiece(item.points[i]!, item.points[i + 1]!);

        if (is_closed && item.points.length > 2)
          addPiece(item.points[item.points.length - 1]!, item.points[0]!);
      }

      if (pads_part.bottom_layer)
        footprint.Flip(footprint.GetPosition(), FLIP_DIRECTION.LEFT_RIGHT);
    }
  }

  private loadReuseBlockGroups(): void {
    const reuse_blocks = this.parser.GetReuseBlocks();

    if (reuse_blocks.size === 0) return;

    const blockGroups = new Map<string, PCB_GROUP>();

    for (const [blockName, block] of sortedMap(reuse_blocks)) {
      if (block.instances.length > 0 || block.part_names.length > 0) {
        const group = new PCB_GROUP(this.board);
        group.SetName(FromUTF8(blockName));
        this.board.Add(group);
        blockGroups.set(blockName, group);
      }
    }

    for (const fp of this.board.Footprints()) {
      for (const field of fp.GetFields()) {
        if (field.GetName() === 'PADS_Reuse_Block') {
          // wxString::ToStdString(): the UTF-8 bytes
          const blockName = byteString(new TextEncoder().encode(field.GetText()));
          const group = blockGroups.get(blockName);

          if (group) group.AddItem(fp);

          break;
        }
      }
    }
  }

  private loadTestPoints(): void {
    const test_points = this.parser.GetTestPoints();
    const via_defs = this.parser.GetViaDefs();

    for (const tp of test_points) {
      const footprint = new FOOTPRINT(this.board);
      footprint.SetReference(`TP${this.m_testPointIndex++}`);
      footprint.SetValue(FromUTF8(tp.symbol_name));

      const pos = V(this.scaleCoord(tp.x, true), this.scaleCoord(tp.y, false));
      footprint.SetPosition(pos);

      let layer: PCB_LAYER_ID = tp.side === 2 ? B_Cu : F_Cu;
      let tpSize = Math.max(this.scaleSize(50.0), this.m_minObjectSize);

      const def = via_defs.get(tp.symbol_name);

      if (def) {
        let stackSize = def.size;
        let hasTopPad = false;
        let hasBottomPad = false;
        let hasMaskTop = false;
        let hasMaskBot = false;

        for (const stackLayer of def.stack) {
          if (def.size <= 0.0 && stackLayer.sizeA > stackSize) stackSize = stackLayer.sizeA;

          if (stackLayer.layer === PADS_LAYER_MAPPER.LAYER_PAD_STACK_TOP && stackLayer.sizeA > 0.0)
            hasTopPad = true;
          else if (
            stackLayer.layer === PADS_LAYER_MAPPER.LAYER_PAD_STACK_BOTTOM &&
            stackLayer.sizeA > 0.0
          )
            hasBottomPad = true;
          else if (stackLayer.layer === PADS_LAYER_MAPPER.LAYER_SOLDERMASK_TOP) hasMaskTop = true;
          else if (stackLayer.layer === PADS_LAYER_MAPPER.LAYER_SOLDERMASK_BOTTOM)
            hasMaskBot = true;
        }

        if (stackSize > 0.0) tpSize = Math.max(this.scaleSize(stackSize), this.m_minObjectSize);

        if (hasTopPad && !hasBottomPad) layer = F_Cu;
        else if (hasBottomPad && !hasTopPad) layer = B_Cu;
        else if (hasMaskBot && !hasMaskTop) layer = B_Cu;
        else if (hasMaskTop && !hasMaskBot) layer = F_Cu;
      }

      footprint.SetLayer(layer);

      const pad = new PAD(footprint);
      pad.SetNumber('1');
      pad.SetPosition(pos);
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
      pad.SetSize(PADSTACK.ALL_LAYERS, V(tpSize, tpSize));
      pad.SetAttribute(PAD_ATTRIB.SMD);
      pad.SetLayerSet(layer === B_Cu ? new LSET([B_Cu]) : new LSET([F_Cu]));

      if (tp.net_name !== '') {
        const net = this.board.FindNet(ConvertInvertedNetName(tp.net_name));

        if (net) pad.SetNet(net);
      }

      footprint.Add(pad);
      footprint.SetBoardOnly(true);

      const tpField = new PCB_FIELD(footprint, FIELD_T.USER, 'Test_Point');
      tpField.SetLayer(Cmts_User);
      tpField.SetVisible(false);
      tpField.SetText(FromUTF8(tp.type));
      footprint.Add(tpField);

      this.board.Add(footprint);
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
      text.SetText(ConvertText(pads_text.content));

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
      text.SetMirrored(pads_text.mirrored);
      this.board.Add(text);
    }
  }

  private loadTracksAndVias(): void {
    const routes = this.parser.GetRoutes();
    const placedThroughVias = new Set<string>();
    const testPointPositions = new Set<string>();

    for (const tp of this.parser.GetTestPoints()) {
      if (tp.type === 'VIA')
        testPointPositions.add(`${this.scaleCoord(tp.x, true)},${this.scaleCoord(tp.y, false)}`);
    }

    for (const route of routes) {
      const net = this.board.FindNet(ConvertInvertedNetName(route.net_name));

      if (!net) continue;

      for (const track_def of route.tracks) {
        if (track_def.points.length < 2) continue;

        const track_layer = this.getMappedLayer(track_def.layer);

        if (!IsCopperLayer(track_layer)) {
          this.Report(
            `Skipping track on non-copper layer ${track_def.layer}`,
            RPT_SEVERITY_WARNING,
          );
          continue;
        }

        const track_width = Math.max(this.scaleSize(track_def.width), this.m_minObjectSize);

        for (let i = 0; i < track_def.points.length - 1; ++i) {
          const p1 = track_def.points[i]!;
          const p2 = track_def.points[i + 1]!;

          const start = V(this.scaleCoord(p1.x, true), this.scaleCoord(p1.y, false));
          const end = V(this.scaleCoord(p2.x, true), this.scaleCoord(p2.y, false));

          if (EuclideanNormI(sub(start, end)) < 1000) continue;

          if (p2.is_arc) {
            const shapeArc = this.makeMidpointArc(p1, p2, track_width);
            const arc = new PCB_ARC(this.board, shapeArc);
            arc.SetNet(net);
            arc.SetWidth(track_width);
            arc.SetLayer(track_layer);
            this.board.Add(arc);
          } else {
            const track = new PCB_TRACK(this.board);
            track.SetNet(net);
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

        if (testPointPositions.has(`${pos.x},${pos.y}`)) continue;

        let viaType = VIATYPE.THROUGH;
        const def = this.parser.GetViaDefs().get(via_def.name);

        if (def) {
          switch (def.via_type) {
            case VIA_TYPE.THROUGH:
              viaType = VIATYPE.THROUGH;
              break;
            case VIA_TYPE.BLIND:
              viaType = VIATYPE.BLIND;
              break;
            case VIA_TYPE.BURIED:
              viaType = VIATYPE.BURIED;
              break;
            case VIA_TYPE.MICROVIA:
              viaType = VIATYPE.MICROVIA;
              break;
          }
        }

        if (viaType === VIATYPE.THROUGH) {
          const key = `${pos.x},${pos.y}`;

          if (placedThroughVias.has(key)) continue;

          placedThroughVias.add(key);
        }

        const via = new PCB_VIA(this.board);
        via.SetNet(net);
        via.SetPosition(pos);

        if (def) {
          via.SetWidth(Math.max(this.scaleSize(def.size), this.m_minObjectSize));
          via.SetDrill(Math.max(this.scaleSize(def.drill), this.m_minObjectSize));

          const startLayer =
            def.start_layer > 0 ? this.getMappedLayer(def.start_layer) : UNDEFINED_LAYER;
          const endLayer = def.end_layer > 0 ? this.getMappedLayer(def.end_layer) : UNDEFINED_LAYER;

          if (startLayer !== UNDEFINED_LAYER && endLayer !== UNDEFINED_LAYER) {
            via.SetLayerPair(startLayer, endLayer);
            via.SetViaType(viaType);
          } else {
            via.SetLayerPair(F_Cu, B_Cu);
            via.SetViaType(VIATYPE.THROUGH);
          }

          if (!def.has_mask_front) via.SetFrontTentingMode(TENTING_MODE.TENTED);

          if (!def.has_mask_back) via.SetBackTentingMode(TENTING_MODE.TENTED);
        } else {
          via.SetWidth(Math.max(this.scaleSize(20.0), this.m_minObjectSize));
          via.SetDrill(Math.max(this.scaleSize(10.0), this.m_minObjectSize));
          via.SetLayerPair(F_Cu, B_Cu);
          via.SetViaType(VIATYPE.THROUGH);
        }

        this.board.Add(via);
      }
    }
  }

  private loadCopperShapes(): void {
    const copperShapes = this.parser.GetCopperShapes();

    const isRectCandidate = (cs: COPPER_SHAPE): boolean =>
      cs.outline.length === 2 && !cs.outline[1]!.is_arc && !cs.filled && !cs.is_cutout;

    const tryFormRectangle = (idx: number): [VECTOR2I, VECTOR2I] | null => {
      if (idx + 3 >= copperShapes.length) return null;

      const segs = [
        copperShapes[idx]!,
        copperShapes[idx + 1]!,
        copperShapes[idx + 2]!,
        copperShapes[idx + 3]!,
      ];
      const c0 = segs[0]!;

      if (!segs.every(isRectCandidate)) return null;

      if (segs.some((c) => c.net_name !== c0.net_name)) return null;

      if (segs.some((c) => c.layer !== c0.layer)) return null;

      const pts: VECTOR2I[] = [];

      for (const s of segs) {
        pts.push(
          V(this.scaleCoord(s.outline[0]!.x, true), this.scaleCoord(s.outline[0]!.y, false)),
        );
        pts.push(
          V(this.scaleCoord(s.outline[1]!.x, true), this.scaleCoord(s.outline[1]!.y, false)),
        );
      }

      for (let i = 0; i < 4; ++i) {
        const s = pts[i * 2]!;
        const e = pts[i * 2 + 1]!;

        if (s.x !== e.x && s.y !== e.y) return null;
      }

      for (let i = 0; i < 3; ++i) {
        const a = pts[i * 2 + 1]!;
        const b = pts[(i + 1) * 2]!;

        if (a.x !== b.x || a.y !== b.y) return null;
      }

      if (pts[7]!.x !== pts[0]!.x || pts[7]!.y !== pts[0]!.y) return null;

      let minX = pts[0]!.x;
      let maxX = pts[0]!.x;
      let minY = pts[0]!.y;
      let maxY = pts[0]!.y;

      for (const p of pts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }

      return [V(minX, minY), V(maxX, maxY)];
    };

    for (let idx = 0; idx < copperShapes.length; ++idx) {
      const copper = copperShapes[idx]!;

      if (copper.outline.length < 2) continue;

      if (copper.is_cutout) continue;

      let layer = this.getMappedLayer(copper.layer);

      if (layer === UNDEFINED_LAYER) {
        this.Report(
          `COPPER item on unmapped layer ${copper.layer} defaulting to F.Cu`,
          RPT_SEVERITY_WARNING,
        );
        layer = F_Cu;
      }

      const width = Math.max(this.scaleSize(copper.width), this.m_minObjectSize);

      if (!IsCopperLayer(layer)) {
        const rect = tryFormRectangle(idx);

        if (rect) {
          const shape = new PCB_SHAPE(this.board);
          shape.SetShape(SHAPE_T.RECTANGLE);
          shape.SetStart(rect[0]);
          shape.SetEnd(rect[1]);
          shape.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));
          shape.SetLayer(layer);
          this.board.Add(shape);
          idx += 3;
          continue;
        }

        for (let i = 0; i < copper.outline.length - 1; ++i) {
          const p1 = copper.outline[i]!;
          const p2 = copper.outline[i + 1]!;
          const start = V(this.scaleCoord(p1.x, true), this.scaleCoord(p1.y, false));
          const end = V(this.scaleCoord(p2.x, true), this.scaleCoord(p2.y, false));

          if (EuclideanNormI(sub(start, end)) < 1000) continue;

          const shape = new PCB_SHAPE(this.board);

          if (p2.is_arc) {
            this.setPcbShapeArc(shape, p1, p2);
          } else {
            shape.SetShape(SHAPE_T.SEGMENT);
            shape.SetStart(start);
            shape.SetEnd(end);
          }

          shape.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));
          shape.SetLayer(layer);
          this.board.Add(shape);
        }

        continue;
      }

      let net: NETINFO_ITEM | null = null;

      if (copper.net_name !== '') net = this.board.FindNet(ConvertInvertedNetName(copper.net_name));

      if (copper.filled) {
        if (copper.outline.length < 3) continue;

        const zone = new ZONE(this.board);
        zone.SetLayer(layer);
        zone.SetIsRuleArea(false);

        if (net) zone.SetNet(net);

        const outline = new SHAPE_LINE_CHAIN();
        this.appendArcPoints(outline, copper.outline);
        outline.SetClosed(true);
        zone.Outline().AddOutline(outline);

        zone.SetBorderDisplayStyle(
          ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
          ZONE.GetDefaultHatchPitch(),
          true,
        );
        this.board.Add(zone);
      } else {
        for (let i = 0; i < copper.outline.length - 1; ++i) {
          const p1 = copper.outline[i]!;
          const p2 = copper.outline[i + 1]!;
          const start = V(this.scaleCoord(p1.x, true), this.scaleCoord(p1.y, false));
          const end = V(this.scaleCoord(p2.x, true), this.scaleCoord(p2.y, false));

          if (EuclideanNormI(sub(start, end)) < 1000) continue;

          if (p2.is_arc) {
            const shapeArc = this.makeMidpointArc(p1, p2, width);
            const arc = new PCB_ARC(this.board, shapeArc);

            if (net) arc.SetNet(net);

            arc.SetWidth(width);
            arc.SetLayer(layer);
            this.board.Add(arc);
          } else {
            const track = new PCB_TRACK(this.board);

            if (net) track.SetNet(net);

            track.SetWidth(width);
            track.SetLayer(layer);
            track.SetStart(start);
            track.SetEnd(end);
            this.board.Add(track);
          }
        }
      }
    }
  }

  private loadClusterGroups(): void {
    const clusters = this.parser.GetClusters();

    if (clusters.length === 0) return;

    const netToClusterMap = new Map<string, CLUSTER>();

    for (const cluster of clusters) {
      for (const netName of cluster.net_names)
        netToClusterMap.set(ConvertInvertedNetName(netName), cluster);
    }

    const clusterGroups = new Map<number, PCB_GROUP>();

    for (const cluster of clusters) {
      const group = new PCB_GROUP(this.board);
      group.SetName(FromUTF8(cluster.name));
      this.board.Add(group);
      clusterGroups.set(cluster.id, group);
    }

    for (const track of this.board.Tracks()) {
      const net = track.GetNet();

      if (net) {
        const cluster = netToClusterMap.get(net.GetNetname());

        if (cluster) clusterGroups.get(cluster.id)?.AddItem(track);
      }
    }
  }

  private loadZones(): void {
    const pours = this.parser.GetPours();
    const params = this.parser.GetParameters();

    const isValidPoly = (pts: readonly ARC_POINT[]): boolean => {
      if (pts.length >= 3) return true;

      if (pts.length === 1 && pts[0]!.is_arc && Math.abs(pts[0]!.arc.delta_angle) >= 359.0)
        return true;

      return false;
    };

    let maxPriority = 0;

    for (const pour_def of pours) {
      if (pour_def.priority > maxPriority) maxPriority = pour_def.priority;
    }

    const pourZoneMap = new Map<string, ZONE>();
    const hatoutToParent = new Map<string, string>();

    for (const pour_def of pours) {
      if (pour_def.style === POUR_STYLE.HATCHED) {
        hatoutToParent.set(pour_def.name, pour_def.owner_pour);
        continue;
      }

      if (pour_def.style === POUR_STYLE.VOIDOUT || pour_def.thermal_type !== THERMAL_TYPE.NONE)
        continue;

      if (pour_def.points.length < 3) continue;

      const pourLayer = this.getMappedLayer(pour_def.layer);

      if (pourLayer === UNDEFINED_LAYER) {
        this.Report(`Skipping pour on unmapped layer ${pour_def.layer}`, RPT_SEVERITY_WARNING);
        continue;
      }

      const zone = new ZONE(this.board);
      zone.SetLayer(pourLayer);

      zone.Outline().NewOutline();
      this.appendArcPoints(zone.Outline().Outline(0), pour_def.points);

      zone.SetBorderDisplayStyle(
        ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
        ZONE.GetDefaultHatchPitch(),
        true,
      );

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
        zone.SetPadConnection(ZONE_CONNECTION.FULL);
      }

      pourZoneMap.set(pour_def.name, zone);
      this.board.Add(zone);
    }

    for (const pour_def of pours) {
      if (pour_def.style !== POUR_STYLE.HATCHED) continue;

      if (!isValidPoly(pour_def.points)) continue;

      const zone = pourZoneMap.get(pour_def.owner_pour);

      if (!zone) continue;

      const pourLayer = zone.GetLayer();

      const fillPoly = new SHAPE_POLY_SET();
      fillPoly.NewOutline();
      this.appendArcPoints(fillPoly.Outline(0), pour_def.points);

      if (fillPoly.Outline(0).PointCount() >= 3 && fillPoly.IsPolygonSelfIntersecting(0))
        fillPoly.Simplify();

      fillPoly.Inflate(
        Math.trunc(this.scaleSize(pour_def.width) / 2),
        CornerStrategy.ROUND_ALL_CORNERS,
        ARC_HIGH_DEF,
      );

      const allVoids = new SHAPE_POLY_SET();

      for (const void_def of pours) {
        if (void_def.style !== POUR_STYLE.VOIDOUT) continue;

        if (!isValidPoly(void_def.points)) continue;

        const parent = hatoutToParent.get(void_def.owner_pour);

        if (parent === undefined) continue;

        if (parent !== pour_def.owner_pour) continue;

        const voidPoly = new SHAPE_POLY_SET();
        voidPoly.NewOutline();
        this.appendArcPoints(voidPoly.Outline(0), void_def.points);
        voidPoly.Inflate(
          Math.trunc(this.scaleSize(void_def.width) / 2),
          CornerStrategy.ROUND_ALL_CORNERS,
          ARC_HIGH_DEF,
        );
        allVoids.Append(voidPoly);
      }

      if (allVoids.OutlineCount() > 0) fillPoly.BooleanSubtract(allVoids);

      zone.SetFilledPolysList(pourLayer, fillPoly);
      zone.SetIsFilled(true);
    }
  }

  /** The segments and arcs of an outline, closed back to its first point when asked. */
  private addOutlineShapes(
    pts: readonly ARC_POINT[],
    aClosed: boolean,
    aWidth: number,
    aLayer: PCB_LAYER_ID,
  ): void {
    const addPiece = (p1: ARC_POINT, p2: ARC_POINT): void => {
      const shape = new PCB_SHAPE(this.board);

      if (p2.is_arc) {
        this.setPcbShapeArc(shape, p1, p2);
      } else {
        shape.SetShape(SHAPE_T.SEGMENT);
        shape.SetStart(V(this.scaleCoord(p1.x, true), this.scaleCoord(p1.y, false)));
        shape.SetEnd(V(this.scaleCoord(p2.x, true), this.scaleCoord(p2.y, false)));
      }

      shape.SetWidth(this.scaleSize(aWidth));
      shape.SetLayer(aLayer);
      this.board.Add(shape);
    };

    for (let i = 0; i < pts.length - 1; ++i) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;

      if (Math.abs(p1.x - p2.x) < 0.001 && Math.abs(p1.y - p2.y) < 0.001) continue;

      addPiece(p1, p2);
    }

    if (aClosed && pts.length > 2) {
      const pLast = pts[pts.length - 1]!;
      const pFirst = pts[0]!;
      const needsClosing =
        Math.abs(pLast.x - pFirst.x) > 0.001 || Math.abs(pLast.y - pFirst.y) > 0.001;

      if (needsClosing) addPiece(pLast, pFirst);
    }
  }

  private loadBoardOutline(): void {
    for (const polyline of this.parser.GetBoardOutlines()) {
      if (polyline.points.length < 2) continue;

      this.addOutlineShapes(polyline.points, polyline.closed, polyline.width, Edge_Cuts);
    }
  }

  private loadDimensions(): void {
    const cfg = ADVANCED_CFG.GetCfg();

    for (const dim of this.parser.GetDimensions()) {
      if (dim.points.length < 2) continue;

      const dimension = new PCB_DIM_ALIGNED(this.board, KICAD_T.PCB_DIM_ALIGNED_T);

      const start = V(
        this.scaleCoord(dim.points[0]!.x, true),
        this.scaleCoord(dim.points[0]!.y, false),
      );
      const end = V(
        this.scaleCoord(dim.points[1]!.x, true),
        this.scaleCoord(dim.points[1]!.y, false),
      );

      if (dim.is_horizontal) end.y = start.y;
      else end.x = start.x;

      dimension.SetStart(start);
      dimension.SetEnd(end);

      if (dim.is_horizontal) {
        const heightOffset = dim.crossbar_pos - dim.points[0]!.y;
        dimension.SetHeight(-this.scaleSize(heightOffset));
      } else {
        const heightOffset = dim.crossbar_pos - dim.points[0]!.x;
        dimension.SetHeight(this.scaleSize(heightOffset));
      }

      let dimLayer = this.getMappedLayer(dim.layer);

      if (dimLayer === UNDEFINED_LAYER || IsCopperLayer(dimLayer)) dimLayer = Cmts_User;

      dimension.SetLayer(dimLayer);

      if (dim.text_height > 0) {
        const scaledSize = this.scaleSize(dim.text_height);
        const charHeight = Math.trunc(scaledSize * cfg.m_PadsPcbTextHeightScale);
        const charWidth = Math.trunc(scaledSize * cfg.m_PadsPcbTextWidthScale);
        dimension.SetTextSize(V(charWidth, charHeight));

        if (dim.text_width > 0) dimension.SetTextThickness(this.scaleSize(dim.text_width));
      }

      if (dim.text !== '') {
        dimension.SetOverrideTextEnabled(true);
        dimension.SetOverrideText(FromUTF8(dim.text));
      }

      dimension.SetLineThickness(this.scaleSize(5.0));

      if (dim.rotation !== 0.0) dimension.SetTextAngle(new EDA_ANGLE(dim.rotation));

      dimension.Update();
      this.board.Add(dimension);
    }
  }

  private loadKeepouts(): void {
    let keepoutIndex = 0;

    for (const ko of this.parser.GetKeepouts()) {
      if (ko.outline.length < 3) continue;

      const zone = new ZONE(this.board);
      zone.SetIsRuleArea(true);

      if (ko.layers.length === 0) {
        zone.SetLayerSet(LSET.AllCuMask());
      } else if (ko.layers.length === 1) {
        const koLayer = this.getMappedLayer(ko.layers[0]!);

        if (koLayer === UNDEFINED_LAYER) {
          this.Report(`Skipping keepout on unmapped layer ${ko.layers[0]}`, RPT_SEVERITY_WARNING);
          continue;
        }

        zone.SetLayer(koLayer);
      } else {
        const layerSet = new LSET();

        for (const layer of ko.layers) {
          const mappedLayer = this.getMappedLayer(layer);

          if (mappedLayer !== UNDEFINED_LAYER) layerSet.set(mappedLayer);
        }

        if (layerSet.none()) {
          this.Report('Skipping keepout with no valid layers', RPT_SEVERITY_WARNING);
          continue;
        }

        zone.SetLayerSet(layerSet);
      }

      zone.SetDoNotAllowTracks(ko.no_traces);
      zone.SetDoNotAllowVias(ko.no_vias);
      zone.SetDoNotAllowZoneFills(ko.no_copper);
      zone.SetDoNotAllowFootprints(ko.no_components);
      zone.SetDoNotAllowPads(false);

      let typeName = '';

      switch (ko.type) {
        case KEEPOUT_TYPE.ALL:
          typeName = 'Keepout';
          break;
        case KEEPOUT_TYPE.ROUTE:
          typeName = 'RouteKeepout';
          break;
        case KEEPOUT_TYPE.VIA:
          typeName = 'ViaKeepout';
          break;
        case KEEPOUT_TYPE.COPPER:
          typeName = 'CopperKeepout';
          break;
        case KEEPOUT_TYPE.PLACEMENT:
          typeName = 'PlacementKeepout';
          break;
      }

      zone.SetZoneName(`${typeName}_${++keepoutIndex}`);

      const koChain = new SHAPE_LINE_CHAIN();
      this.appendArcPoints(koChain, ko.outline);

      if (ko.outline.length > 2) {
        const first = ko.outline[0]!;
        const last = ko.outline[ko.outline.length - 1]!;

        if (Math.abs(first.x - last.x) > 0.001 || Math.abs(first.y - last.y) > 0.001)
          koChain.Append(this.scaleCoord(first.x, true), this.scaleCoord(first.y, false));
      }

      koChain.SetClosed(true);
      zone.Outline().AddOutline(koChain);

      zone.SetBorderDisplayStyle(
        ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
        ZONE.GetDefaultHatchPitch(),
        true,
      );
      this.board.Add(zone);
    }
  }

  private loadGraphicLines(): void {
    for (const graphic of this.parser.GetGraphicLines()) {
      const pts = graphic.points;
      const graphicLayer = this.getMappedLayer(graphic.layer);

      if (graphicLayer === UNDEFINED_LAYER) continue;

      if (pts.length === 1 && pts[0]!.is_arc && Math.abs(pts[0]!.arc.delta_angle - 360.0) < 0.1) {
        const shape = new PCB_SHAPE(this.board);
        shape.SetShape(SHAPE_T.CIRCLE);

        const center = V(
          this.scaleCoord(pts[0]!.arc.cx, true),
          this.scaleCoord(pts[0]!.arc.cy, false),
        );
        const radius = Math.max(this.scaleSize(pts[0]!.arc.radius), this.m_minObjectSize);

        shape.SetCenter(center);
        shape.SetEnd(V(center.x + radius, center.y));
        shape.SetWidth(this.scaleSize(graphic.width));
        shape.SetLayer(graphicLayer);
        this.board.Add(shape);
        continue;
      }

      if (pts.length < 2) continue;

      this.addOutlineShapes(pts, graphic.closed, graphic.width, graphicLayer);
    }
  }

  private generateDrcRules(_aFileName: string): void {
    let customRules = '(version 1)\n';

    for (const dp of this.parser.GetDiffPairs()) {
      if (dp.name === '' || (dp.gap <= 0 && dp.width <= 0)) continue;

      const ruleName = `DiffPair_${FromUTF8(dp.name)}`;

      if (dp.gap > 0 && dp.positive_net !== '' && dp.negative_net !== '') {
        const posNet = ConvertInvertedNetName(dp.positive_net);
        const negNet = ConvertInvertedNetName(dp.negative_net);
        const gapMm = (dp.gap * this.m_scaleFactor) / PADS_UNIT_CONVERTER.MM_TO_NM;
        const gapStr = `${FormatDouble2Str(gapMm)}mm`;

        customRules +=
          `\n(rule "${ruleName}_gap"\n` +
          `  (condition "A.NetName == '${posNet}' && B.NetName == '${negNet}'")\n` +
          `  (constraint clearance (min ${gapStr})))\n`;
      }
    }

    if (customRules.length > 15) this.m_customRules = customRules;
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
    const layer_map = new Map<string, PCB_LAYER_ID>();

    for (const layer of aInputLayerDescriptionVector) layer_map.set(layer.Name, layer.AutoMapLayer);

    return layer_map;
  }

  private scaleSize(aVal: number): number {
    return clampInt(this.m_unitConverter.ToNanometersSize(aVal));
  }

  private decalUnitScale(aUnits: string): number {
    if (this.parser.IsBasicUnits()) return 0.0;

    if (aUnits === 'I' || aUnits === 'MIL' || aUnits === 'MILS')
      return PADS_UNIT_CONVERTER.MILS_TO_NM;

    if (aUnits === 'M' || aUnits === 'MM' || aUnits === 'METRIC')
      return PADS_UNIT_CONVERTER.MM_TO_NM;

    if (aUnits === 'INCH' || aUnits === 'INCHES') return PADS_UNIT_CONVERTER.INCHES_TO_NM;

    return 0.0;
  }

  private scaleCoord(aVal: number, aIsX: boolean): number {
    const origin = aIsX ? this.m_originX : this.m_originY;
    const origin_nm = cRound(origin * this.m_scaleFactor);
    const val_nm = cRound(aVal * this.m_scaleFactor);
    const result = aIsX ? val_nm - origin_nm : origin_nm - val_nm;
    return clampInt(result);
  }

  private getMappedLayer(aPadsLayer: number): PCB_LAYER_ID {
    for (const info of this.m_layerInfos) {
      if (info.padsLayerNum === aPadsLayer) {
        const mapped = this.m_layer_map.get(FromUTF8(info.name));

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
    this.m_pinToNetMap.clear();
    this.m_partToBlockMap.clear();
    this.m_testPointIndex = 1;
  }

  private appendArcPoints(aChain: SHAPE_LINE_CHAIN, aPts: readonly ARC_POINT[]): void {
    if (aPts.length === 0) return;

    if (aPts.length === 1 && aPts[0]!.is_arc && Math.abs(aPts[0]!.arc.delta_angle) >= 359.0) {
      const center = V(
        this.scaleCoord(aPts[0]!.arc.cx, true),
        this.scaleCoord(aPts[0]!.arc.cy, false),
      );
      const radius = this.scaleSize(aPts[0]!.arc.radius);
      const NUM_SEGS = 36;

      for (let i = 0; i < NUM_SEGS; i++) {
        const angle = (2.0 * Math.PI * i) / NUM_SEGS;
        aChain.Append(
          center.x + KiROUND(radius * cos(angle)),
          center.y + KiROUND(radius * sin(angle)),
        );
      }

      return;
    }

    aChain.Append(this.scaleCoord(aPts[0]!.x, true), this.scaleCoord(aPts[0]!.y, false));

    for (let i = 1; i < aPts.length; i++) {
      const pt = aPts[i]!;

      if (pt.is_arc) {
        const arc = this.makeMidpointArc(aPts[i - 1]!, pt, 0);
        const arcPoly = arc.ConvertToPolyline();

        for (let j = 1; j < arcPoly.PointCount(); j++)
          aChain.Append(arcPoly.CPoint(j).x, arcPoly.CPoint(j).y);
      } else {
        aChain.Append(this.scaleCoord(pt.x, true), this.scaleCoord(pt.y, false));
      }
    }
  }

  private setPcbShapeArc(aShape: PCB_SHAPE, aPrev: ARC_POINT, aCurr: ARC_POINT): void {
    aShape.SetShape(SHAPE_T.ARC);

    const center = V(this.scaleCoord(aCurr.arc.cx, true), this.scaleCoord(aCurr.arc.cy, false));
    let start = V(this.scaleCoord(aPrev.x, true), this.scaleCoord(aPrev.y, false));
    let end = V(this.scaleCoord(aCurr.x, true), this.scaleCoord(aCurr.y, false));

    if (aCurr.arc.delta_angle > 0) [start, end] = [end, start];

    aShape.SetCenter(center);
    aShape.SetStart(start);
    aShape.SetEnd(end);
  }

  private makeMidpointArc(aPrev: ARC_POINT, aCurr: ARC_POINT, aWidth: number): SHAPE_ARC {
    const start = V(this.scaleCoord(aPrev.x, true), this.scaleCoord(aPrev.y, false));
    const end = V(this.scaleCoord(aCurr.x, true), this.scaleCoord(aCurr.y, false));

    let midX: number;
    let midY: number;

    if (aCurr.arc.radius === 0.0) {
      const dx = aCurr.x - aPrev.x;
      const dy = aCurr.y - aPrev.y;

      if (aCurr.arc.delta_angle < 0) {
        midX = (aPrev.x + aCurr.x) / 2.0 - dy / 2.0;
        midY = (aPrev.y + aCurr.y) / 2.0 + dx / 2.0;
      } else {
        midX = (aPrev.x + aCurr.x) / 2.0 + dy / 2.0;
        midY = (aPrev.y + aCurr.y) / 2.0 - dx / 2.0;
      }
    } else {
      const startAngleRad = atan2(aPrev.y - aCurr.arc.cy, aPrev.x - aCurr.arc.cx);
      const midAngleRad = startAngleRad + (aCurr.arc.delta_angle * Math.PI) / 180.0 / 2.0;
      midX = aCurr.arc.cx + aCurr.arc.radius * cos(midAngleRad);
      midY = aCurr.arc.cy + aCurr.arc.radius * sin(midAngleRad);
    }

    const mid = V(this.scaleCoord(midX, true), this.scaleCoord(midY, false));
    return new SHAPE_ARC(start, mid, end, aWidth);
  }

  private loadBoardSetup(): void {
    const parser = this.parser;
    const layer_count = parser.GetParameters().layer_count;

    this.m_layerMapper.SetCopperLayerCount(layer_count);

    const padsLayerInfos: LAYER_INFO[] = parser.GetLayerInfos();

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

    for (const padsInfo of padsLayerInfos) {
      const info: PADS_LAYER_INFO = {
        padsLayerNum: padsInfo.number,
        name: padsInfo.name,
        type: PADS_LAYER_TYPE.UNKNOWN,
        required: false,
      };

      if (
        padsInfo.layer_type !== PADS_LAYER_FUNCTION.UNKNOWN &&
        padsInfo.layer_type !== PADS_LAYER_FUNCTION.UNASSIGNED
      ) {
        info.type = convertLayerType(padsInfo.layer_type);

        const lowerName = padsInfo.name.replace(/[A-Z]/g, (c) => c.toLowerCase());
        const isBottom = lowerName.includes('bottom') || lowerName.includes('bot');

        if (info.type === PADS_LAYER_TYPE.SOLDERMASK_TOP && isBottom)
          info.type = PADS_LAYER_TYPE.SOLDERMASK_BOTTOM;
        else if (info.type === PADS_LAYER_TYPE.PASTE_TOP && isBottom)
          info.type = PADS_LAYER_TYPE.PASTE_BOTTOM;
        else if (info.type === PADS_LAYER_TYPE.SILKSCREEN_TOP && isBottom)
          info.type = PADS_LAYER_TYPE.SILKSCREEN_BOTTOM;
        else if (info.type === PADS_LAYER_TYPE.ASSEMBLY_TOP && isBottom)
          info.type = PADS_LAYER_TYPE.ASSEMBLY_BOTTOM;
        else if (info.type === PADS_LAYER_TYPE.COPPER_INNER) {
          if (padsInfo.number === 1) info.type = PADS_LAYER_TYPE.COPPER_TOP;
          else if (padsInfo.number === layer_count) info.type = PADS_LAYER_TYPE.COPPER_BOTTOM;
        }
      } else {
        info.type = this.m_layerMapper.GetLayerType(padsInfo.number);
      }

      info.required = padsInfo.required;
      this.m_layerInfos.push(info);
    }

    const inputDescs = this.m_layerMapper.BuildInputLayerDescriptions(this.m_layerInfos);

    // INPUT_LAYER_DESC::Name is wxString::FromUTF8( info.name )
    for (const d of inputDescs) d.Name = FromUTF8(d.Name);

    this.m_layer_map = this.m_layerMappable.m_layer_mapping_handler(inputDescs);

    let copperLayerCount = layer_count;

    if (copperLayerCount < 1) copperLayerCount = 2;

    this.board.SetCopperLayerCount(copperLayerCount);

    if (parser.IsBasicUnits()) {
      this.m_unitConverter.SetBasicUnitsMode(true);
    } else {
      switch (parser.GetParameters().units) {
        case UNIT_TYPE.MILS:
          this.m_unitConverter.SetBaseUnits(PADS_UNIT_TYPE.MILS);
          break;
        case UNIT_TYPE.METRIC:
          this.m_unitConverter.SetBaseUnits(PADS_UNIT_TYPE.METRIC);
          break;
        case UNIT_TYPE.INCHES:
          this.m_unitConverter.SetBaseUnits(PADS_UNIT_TYPE.INCHES);
          break;
      }
    }

    const units = parser.GetParameters().units;

    this.m_scaleFactor = parser.IsBasicUnits()
      ? PADS_UNIT_CONVERTER.BASIC_TO_NM
      : units === UNIT_TYPE.MILS
        ? PADS_UNIT_CONVERTER.MILS_TO_NM
        : units === UNIT_TYPE.METRIC
          ? PADS_UNIT_CONVERTER.MM_TO_NM
          : PADS_UNIT_CONVERTER.INCHES_TO_NM;

    const designRules = parser.GetDesignRules();
    const bds = this.board.GetDesignSettings();

    bds.m_MinClearance = this.scaleSize(designRules.min_clearance);
    bds.m_TrackMinWidth = this.scaleSize(designRules.min_track_width);
    bds.m_ViasMinSize = this.scaleSize(designRules.min_via_size);
    bds.m_MinThroughDrill = this.scaleSize(designRules.min_via_drill);
    bds.m_HoleToHoleMin = this.scaleSize(designRules.hole_to_hole);
    bds.m_SilkClearance = this.scaleSize(designRules.silk_clearance);
    bds.m_SolderMaskExpansion = this.scaleSize(designRules.mask_clearance);
    bds.m_CopperEdgeClearance = this.scaleSize(designRules.copper_edge_clearance);

    bds.SetCustomTrackWidth(this.scaleSize(designRules.default_track_width));
    bds.SetCustomViaSize(this.scaleSize(designRules.default_via_size));
    bds.SetCustomViaDrill(this.scaleSize(designRules.default_via_drill));

    const defaultNetclass = bds.m_NetSettings.GetDefaultNetclass();

    if (defaultNetclass) {
      defaultNetclass.SetClearance(this.scaleSize(designRules.default_clearance));
      defaultNetclass.SetTrackWidth(this.scaleSize(designRules.default_track_width));
      defaultNetclass.SetViaDiameter(this.scaleSize(designRules.default_via_size));
      defaultNetclass.SetViaDrill(this.scaleSize(designRules.default_via_drill));
    }

    const viaDefs = parser.GetViaDefs();

    if (viaDefs.size > 0) {
      const sortedVias = sortedMap(viaDefs);
      const defaultViaName = parser.GetParameters().default_signal_via;
      const defaultDef = viaDefs.get(defaultViaName) ?? sortedVias[0]![1];

      const viaDia = this.scaleSize(defaultDef.size);
      const viaDrill = this.scaleSize(defaultDef.drill);

      bds.SetCustomViaSize(viaDia);
      bds.SetCustomViaDrill(viaDrill);

      if (defaultNetclass) {
        defaultNetclass.SetViaDiameter(viaDia);
        defaultNetclass.SetViaDrill(viaDrill);
      }

      for (const [, def] of sortedVias)
        bds.m_ViasDimensionsList.push(
          new VIA_DIMENSION(this.scaleSize(def.size), this.scaleSize(def.drill)),
        );
    }

    for (const nc of parser.GetNetClasses()) {
      if (nc.name === '') continue;

      const ncName = FromUTF8(nc.name);
      const netclass = new NETCLASS(ncName);

      if (nc.clearance > 0) netclass.SetClearance(this.scaleSize(nc.clearance));

      if (nc.track_width > 0) netclass.SetTrackWidth(this.scaleSize(nc.track_width));

      if (nc.via_size > 0) netclass.SetViaDiameter(this.scaleSize(nc.via_size));

      if (nc.via_drill > 0) netclass.SetViaDrill(this.scaleSize(nc.via_drill));

      if (nc.diff_pair_width > 0) netclass.SetDiffPairWidth(this.scaleSize(nc.diff_pair_width));

      if (nc.diff_pair_gap > 0) netclass.SetDiffPairGap(this.scaleSize(nc.diff_pair_gap));

      bds.m_NetSettings.SetNetclass(ncName, netclass);

      for (const netName of nc.net_names)
        bds.m_NetSettings.SetNetclassPatternAssignment(ConvertInvertedNetName(netName), ncName);
    }

    for (const dp of parser.GetDiffPairs()) {
      if (dp.name === '') continue;

      const dpClassName = `DiffPair_${FromUTF8(dp.name)}`;
      const dpNetclass = new NETCLASS(dpClassName);

      if (dp.gap > 0) dpNetclass.SetDiffPairGap(this.scaleSize(dp.gap));

      if (dp.width > 0) {
        dpNetclass.SetDiffPairWidth(this.scaleSize(dp.width));
        dpNetclass.SetTrackWidth(this.scaleSize(dp.width));
      }

      bds.m_NetSettings.SetNetclass(dpClassName, dpNetclass);

      if (dp.positive_net !== '')
        bds.m_NetSettings.SetNetclassPatternAssignment(
          ConvertInvertedNetName(dp.positive_net),
          dpClassName,
        );

      if (dp.negative_net !== '')
        bds.m_NetSettings.SetNetclassPatternAssignment(
          ConvertInvertedNetName(dp.negative_net),
          dpClassName,
        );
    }

    this.m_originX = parser.GetParameters().origin.x;
    this.m_originY = parser.GetParameters().origin.y;

    const boardOutlines = parser.GetBoardOutlines();

    if (boardOutlines.length > 0) {
      let min_x = Number.MAX_VALUE;
      let max_x = -Number.MAX_VALUE;
      let min_y = Number.MAX_VALUE;
      let max_y = -Number.MAX_VALUE;

      for (const outline of boardOutlines) {
        for (const pt of outline.points) {
          min_x = Math.min(min_x, pt.x);
          max_x = Math.max(max_x, pt.x);
          min_y = Math.min(min_y, pt.y);
          max_y = Math.max(max_y, pt.y);
        }
      }

      if (min_x < max_x && min_y < max_y) {
        this.m_originX = (min_x + max_x) / 2.0;
        this.m_originY = (min_y + max_y) / 2.0;
      }
    }

    const copperLayerInfos = padsLayerInfos.filter((li) => li.is_copper);

    const hasStackupData = copperLayerInfos.some(
      (li) => li.layer_thickness > 0.0 || li.dielectric_constant > 0.0,
    );

    if (hasStackupData) {
      const stackup = bds.GetStackupDescriptor();
      stackup.RemoveAll();
      stackup.BuildDefaultStackupList(bds, copperLayerCount);

      const copperInfoMap = new Map<PCB_LAYER_ID, LAYER_INFO>();

      for (const li of copperLayerInfos) {
        const kicadLayer = this.getMappedLayer(li.number);

        if (kicadLayer !== UNDEFINED_LAYER) copperInfoMap.set(kicadLayer, li);
      }

      let prevCopperInfo: LAYER_INFO | null = null;

      for (const item of stackup.GetList()) {
        if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER) {
          const info = copperInfoMap.get(item.GetBrdLayerId());

          if (info) {
            prevCopperInfo = info;

            if (info.copper_thickness > 0.0)
              item.SetThickness(this.scaleSize(info.copper_thickness));
          }
        } else if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
          if (prevCopperInfo) {
            if (prevCopperInfo.layer_thickness > 0.0)
              item.SetThickness(this.scaleSize(prevCopperInfo.layer_thickness));

            if (prevCopperInfo.dielectric_constant > 0.0)
              item.SetEpsilonR(prevCopperInfo.dielectric_constant);
          }
        } else if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN) {
          item.SetColor('White');
        } else if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK) {
          item.SetColor('Green');
        }
      }

      const thickness = stackup.BuildBoardThicknessFromStackup();
      bds.SetBoardThickness(thickness);
      bds.m_HasStackup = true;
    }
  }
}
