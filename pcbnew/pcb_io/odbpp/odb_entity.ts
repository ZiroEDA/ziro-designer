// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/odbpp/odb_entity.{h,cpp}`: the ODB++ entities - the matrix (every layer, its
 * row, type and span), the pcb step (its layers, eda data, netlist, profile and header), a layer
 * (attrlist, features, components, drill tools), misc (the info file), fonts, and the folders
 * written empty (input, symbols, user, wheels).
 *
 * The step header is an `unordered_map<wxString, wxString>` upstream, written in libstdc++'s
 * bucket order; its keys never change, so that order is the fixed list STEPHDR_ORDER, measured
 * from kicad-cli's output.
 */
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IsCopperLayer, IsValidLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_360 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from '../../board.js';
import type { BOARD_ITEM } from '../../board_item.js';
import {
  BOARD_STACKUP_ITEM_TYPE,
  type BOARD_STACKUP_ITEM,
  KEY_CORE,
} from '../../board_stackup_manager/board_stackup.js';
import type { FOOTPRINT } from '../../footprint.js';
import { HASH_FLAGS, hash_fp_item } from '../../hash_eda.js';
import type { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK, type PADSTACK_DRILL_PROPS } from '../../padstack.js';
import type { PCB_VIA } from '../../pcb_track.js';
import { COMPONENTS_MANAGER, type ODB_COMPONENT, TOEPRINT } from './odb_component.js';
import {
  CUTOUT_TYPE,
  EDA_DATA,
  FILL_TYPE,
  type PACKAGE,
  SIDE,
  SUB_NET_PLANE,
  SUB_NET_TOEPRINT,
  SUB_NET_TRACE,
  SUB_NET_VIA,
} from './odb_eda_data.js';
import { FEATURES_MANAGER } from './odb_feature.js';
import { ODB_FONTS_STANDARD } from './odb_fonts.js';
import { ODB_NET_LIST } from './odb_netlist.js';
import {
  AddXY,
  Double2String,
  GenLegalEntityName,
  ODB_AUX_LAYER_TYPE,
  ODB_CONTEXT,
  ODB_DIELECTRIC_TYPE,
  ODB_DRILL_TOOLS,
  ODB_JOB_NAME,
  ODB_POLARITY,
  ODB_SETTINGS,
  ODB_SUBTYPE,
  ODB_TEXT_WRITER,
  type ODB_TREE_WRITER,
  ODB_TYPE,
  ODB_UNITS,
} from './odb_util.js';
import { ODB_DRILL_SPAN, type PCB_IO_ODBPP, tupleSorted } from './pcb_io_odbpp.js';

/** The step header's keys in the order libstdc++'s unordered_map gives them (see the file comment). */
const STEPHDR_ORDER = [
  'LEFT_ACTIVE',
  'AFFECTING_BOM',
  'RIGHT_ACTIVE',
  'TOP_ACTIVE',
  'Y_ORIGIN',
  'AFFECTING_BOM_CHANGED',
  'X_ORIGIN',
  'Y_DATUM',
  'X_DATUM',
  'BOTTOM_ACTIVE',
  ODB_UNITS,
];

const strCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `wxDateTime::Format( "%Y%m%d.%H%M%S" )`, local time. */
function odbDate(aNow: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${aNow.getFullYear()}${p(aNow.getMonth() + 1)}${p(aNow.getDate())}.${p(aNow.getHours())}${p(aNow.getMinutes())}${p(aNow.getSeconds())}`;
}

/** `wxDateTime::FormatISOCombined()`, local time. */
export function isoCombined(aNow: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${aNow.getFullYear()}-${p(aNow.getMonth() + 1)}-${p(aNow.getDate())}T${p(aNow.getHours())}:${p(aNow.getMinutes())}:${p(aNow.getSeconds())}`;
}

const auxFeatureName = (aType: ODB_AUX_LAYER_TYPE): string | null => {
  switch (aType) {
    case ODB_AUX_LAYER_TYPE.TENTING:
      return 'tenting';
    case ODB_AUX_LAYER_TYPE.COVERING:
      return 'covering';
    case ODB_AUX_LAYER_TYPE.PLUGGING:
      return 'plugging';
    case ODB_AUX_LAYER_TYPE.FILLING:
      return 'filling';
    case ODB_AUX_LAYER_TYPE.CAPPING:
      return 'capping';
    default:
      return null;
  }
};

export abstract class ODB_ENTITY_BASE {
  constructor(
    protected readonly m_board: BOARD | null = null,
    protected readonly m_plugin: PCB_IO_ODBPP | null = null,
  ) {}

  GenerateFiles(_writer: ODB_TREE_WRITER): void {}

  CreateDirectoryTree(writer: ODB_TREE_WRITER): boolean {
    writer.CreateEntityDirectory(writer.GetRootPath(), this.GetEntityName());
    return true;
  }

  abstract GetEntityName(): string;

  InitEntityData(): void {}

  protected get board(): BOARD {
    return this.m_board!;
  }

  protected get plugin(): PCB_IO_ODBPP {
    return this.m_plugin!;
  }
}

interface MATRIX_LAYER {
  m_span: [string, string] | null; // !< start, end
  m_addType: ODB_SUBTYPE | null;
  m_diType: ODB_DIELECTRIC_TYPE | null;
  m_rowNumber: number;
  m_layerName: string;
  m_context: ODB_CONTEXT;
  m_type: ODB_TYPE;
  m_polarity: ODB_POLARITY;
}

const matrixLayer = (aRow: number, aLayerName: string): MATRIX_LAYER => ({
  m_span: null,
  m_addType: null,
  m_diType: null,
  m_rowNumber: aRow,
  m_layerName: GenLegalEntityName(aLayerName),
  m_context: ODB_CONTEXT.BOARD,
  m_type: ODB_TYPE.UNDEFINED,
  m_polarity: ODB_POLARITY.POSITIVE,
});

export class ODB_MATRIX_ENTITY extends ODB_ENTITY_BASE {
  /** std::map<wxString, unsigned>: by name. */
  private readonly m_matrixSteps = new Map<string, number>();
  private readonly m_matrixLayers: MATRIX_LAYER[] = [];
  private m_row = 1;
  private m_col = 1;
  private m_hasBotComp = false;

  GetEntityName(): string {
    return 'matrix';
  }

  AddStep(aStepName: string): void {
    const name = aStepName.toUpperCase();

    if (!this.m_matrixSteps.has(name)) this.m_matrixSteps.set(name, this.m_col);

    this.m_col++;
  }

  override InitEntityData(): void {
    this.AddStep('PCB');

    this.InitMatrixLayerData();
  }

  InitMatrixLayerData(): void {
    const dsnSettings = this.board.GetDesignSettings();
    const stackup = dsnSettings.GetStackupDescriptor();
    stackup.SynchronizeWithBoard(dsnSettings);

    const layers = stackup.GetList();
    const added_layers = new Set<PCB_LAYER_ID>();

    this.AddCOMPMatrixLayer(PCB_LAYER_ID.F_Cu);

    for (let i = 0; i < stackup.GetCount(); i++) {
      const stackup_item = layers[i]!;

      for (let sublayer_id = 0; sublayer_id < stackup_item.GetSublayersCount(); sublayer_id++) {
        let ly_name = stackup_item.GetLayerName();

        if (ly_name === '') {
          if (IsValidLayer(stackup_item.GetBrdLayerId()))
            ly_name = this.board.GetLayerName(stackup_item.GetBrdLayerId());

          if (
            ly_name === '' &&
            stackup_item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC
          )
            ly_name = `DIELECTRIC_${stackup_item.GetDielectricLayerId()}`;
        }

        const matrix = matrixLayer(this.m_row++, ly_name);

        if (stackup_item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
          matrix.m_diType =
            stackup_item.GetTypeName() === KEY_CORE
              ? ODB_DIELECTRIC_TYPE.CORE
              : ODB_DIELECTRIC_TYPE.PREPREG;

          matrix.m_type = ODB_TYPE.DIELECTRIC;
          matrix.m_context = ODB_CONTEXT.BOARD;
          matrix.m_polarity = ODB_POLARITY.POSITIVE;
          this.m_matrixLayers.push(matrix);
          this.plugin.GetLayerNameList().push([PCB_LAYER_ID.UNDEFINED_LAYER, matrix.m_layerName]);

          continue;
        }

        added_layers.add(stackup_item.GetBrdLayerId());
        this.AddMatrixLayerField(matrix, stackup_item.GetBrdLayerId());
      }
    }

    for (const layer of this.board.GetEnabledLayers().Seq()) {
      if (added_layers.has(layer)) continue;

      const matrix = matrixLayer(this.m_row++, this.board.GetLayerName(layer));
      added_layers.add(layer);
      this.AddMatrixLayerField(matrix, layer);
    }

    this.AddDrillMatrixLayer();

    this.AddAuxilliaryMatrixLayer();

    this.AddCOMPMatrixLayer(PCB_LAYER_ID.B_Cu);

    this.EnsureUniqueLayerNames();
  }

  AddMatrixLayerField(aMLayer: MATRIX_LAYER, aLayer: PCB_LAYER_ID): void {
    const L = PCB_LAYER_ID;
    aMLayer.m_polarity = ODB_POLARITY.POSITIVE;
    aMLayer.m_context = ODB_CONTEXT.BOARD;

    const isUser = aLayer >= L.User_1 && aLayer <= L.User_45 && (aLayer - L.User_1) % 2 === 0;

    switch (aLayer) {
      case L.F_Paste:
      case L.B_Paste:
        aMLayer.m_type = ODB_TYPE.SOLDER_PASTE;
        break;
      case L.F_SilkS:
      case L.B_SilkS:
        aMLayer.m_type = ODB_TYPE.SILK_SCREEN;
        break;
      case L.F_Mask:
      case L.B_Mask:
        aMLayer.m_type = ODB_TYPE.SOLDER_MASK;
        break;
      case L.B_CrtYd:
      case L.F_CrtYd:
      case L.Edge_Cuts:
      case L.B_Fab:
      case L.F_Fab:
      case L.F_Adhes:
      case L.B_Adhes:
      case L.Dwgs_User:
      case L.Cmts_User:
      case L.Eco1_User:
      case L.Eco2_User:
      case L.Margin:
        aMLayer.m_context = ODB_CONTEXT.MISC;
        aMLayer.m_type = ODB_TYPE.DOCUMENT;
        break;

      default:
        if (isUser) {
          // User_1 … User_45
          aMLayer.m_context = ODB_CONTEXT.MISC;
          aMLayer.m_type = ODB_TYPE.DOCUMENT;
        } else if (IsCopperLayer(aLayer)) {
          aMLayer.m_type = ODB_TYPE.SIGNAL;
        } else {
          // Do not handle other layers :
          aMLayer.m_type = ODB_TYPE.UNDEFINED;
          this.m_row--;
        }

        break;
    }

    if (aMLayer.m_type !== ODB_TYPE.UNDEFINED) {
      this.m_matrixLayers.push(aMLayer);
      this.plugin.GetLayerNameList().push([aLayer, aMLayer.m_layerName]);
    }
  }

  AddDrillMatrixLayer(): void {
    const drill_layers = this.plugin.GetDrillLayerItemsMap();
    const slot_holes = this.plugin.GetSlotHolesMap();

    drill_layers.clear();
    slot_holes.clear();

    const span_names = this.plugin.GetDrillSpanNameMap();
    span_names.clear();

    let has_pth_layer = false;
    let has_npth_layer = false;

    for (const item of this.board.Tracks()) {
      if (item.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = item as PCB_VIA;
      has_pth_layer = true;

      const platedSpan = new ODB_DRILL_SPAN(via.TopLayer(), via.BottomLayer(), false, false);
      drill_layers.at(platedSpan).push(via);

      const addedBackdrillSpans = new Set<string>();

      const addBackdrillSpan = (aDrill: PADSTACK_DRILL_PROPS): void => {
        if (
          aDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER &&
          aDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER &&
          (aDrill.size.x > 0 || aDrill.size.y > 0)
        ) {
          const backSpan = new ODB_DRILL_SPAN(aDrill.start, aDrill.end, true, true);

          if (!addedBackdrillSpans.has(backSpan.Key())) {
            addedBackdrillSpans.add(backSpan.Key());
            drill_layers.at(backSpan).push(via);
          }
        }
      };

      addBackdrillSpan(via.Padstack().SecondaryDrill());
      addBackdrillSpan(via.Padstack().TertiaryDrill());
    }

    const slotKey = `${PCB_LAYER_ID.F_Cu},${PCB_LAYER_ID.B_Cu}`;

    for (const fp of this.board.Footprints()) {
      if (fp.IsFlipped()) this.m_hasBotComp = true;

      for (const pad of fp.Pads()) {
        if (pad.GetAttribute() === PAD_ATTRIB.PTH) has_pth_layer = true;

        if (pad.GetAttribute() === PAD_ATTRIB.NPTH) has_npth_layer = true;

        if (pad.HasHole() && pad.GetDrillSizeX() !== pad.GetDrillSizeY()) {
          let v = slot_holes.get(slotKey);

          if (!v) {
            v = [];
            slot_holes.set(slotKey, v);
          }

          v.push(pad);
        } else if (pad.HasHole()) {
          const padSpan = new ODB_DRILL_SPAN(
            PCB_LAYER_ID.F_Cu,
            PCB_LAYER_ID.B_Cu,
            false,
            pad.GetAttribute() === PAD_ATTRIB.NPTH,
          );
          drill_layers.at(padSpan).push(pad);
        }
      }
    }

    if (has_npth_layer)
      drill_layers.at(new ODB_DRILL_SPAN(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, false, true));

    if (has_pth_layer)
      drill_layers.at(new ODB_DRILL_SPAN(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, false, false));

    let backdrillIndex = 1;

    const assignName = (aSpan: ODB_DRILL_SPAN): string => {
      const known = span_names.find(aSpan);

      if (known !== undefined) return known;

      let name: string;

      if (aSpan.m_IsBackdrill) {
        name = `drill${backdrillIndex++}`;
      } else {
        const platedLabel = aSpan.m_IsNonPlated ? 'non-plated' : 'plated';
        name = `drill_${platedLabel}_${this.board.GetLayerName(aSpan.TopLayer())}-${this.board.GetLayerName(aSpan.BottomLayer())}`;
      }

      const legalName = GenLegalEntityName(name);
      span_names.set(aSpan, legalName);

      return legalName;
    };

    for (const [span] of drill_layers.entries()) {
      const dLayerName = assignName(span);
      const matrix = matrixLayer(this.m_row++, dLayerName);

      matrix.m_type = ODB_TYPE.DRILL;
      matrix.m_context = ODB_CONTEXT.BOARD;
      matrix.m_polarity = ODB_POLARITY.POSITIVE;
      matrix.m_span = [
        GenLegalEntityName(this.board.GetLayerName(span.m_StartLayer)),
        GenLegalEntityName(this.board.GetLayerName(span.m_EndLayer)),
      ];

      if (span.m_IsBackdrill) matrix.m_addType = ODB_SUBTYPE.BACKDRILL;

      this.m_matrixLayers.push(matrix);
      this.plugin.GetLayerNameList().push([PCB_LAYER_ID.UNDEFINED_LAYER, matrix.m_layerName]);
    }
  }

  AddCOMPMatrixLayer(aCompSide: PCB_LAYER_ID): void {
    const matrix = matrixLayer(this.m_row++, 'COMP_+_TOP');
    matrix.m_type = ODB_TYPE.COMPONENT;
    matrix.m_context = ODB_CONTEXT.BOARD;

    if (aCompSide === PCB_LAYER_ID.F_Cu) {
      this.m_matrixLayers.push(matrix);
      this.plugin.GetLayerNameList().push([PCB_LAYER_ID.UNDEFINED_LAYER, matrix.m_layerName]);
    }

    if (aCompSide === PCB_LAYER_ID.B_Cu && this.m_hasBotComp) {
      matrix.m_layerName = GenLegalEntityName('COMP_+_BOT');
      this.m_matrixLayers.push(matrix);
      this.plugin.GetLayerNameList().push([PCB_LAYER_ID.UNDEFINED_LAYER, matrix.m_layerName]);
    }
  }

  AddAuxilliaryMatrixLayer(): void {
    const auxilliary_layers = this.plugin.GetAuxilliaryLayerItemsMap();

    const add = (
      aType: ODB_AUX_LAYER_TYPE,
      a: PCB_LAYER_ID,
      b: PCB_LAYER_ID,
      via: PCB_VIA,
    ): void => {
      const k = `${aType},${a},${b}`;
      let v = auxilliary_layers.get(k);

      if (!v) {
        v = [];
        auxilliary_layers.set(k, v);
      }

      v.push(via);
    };

    for (const item of this.board.Tracks()) {
      if (item.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = item as PCB_VIA;
      const ps = via.Padstack();

      if (ps.IsFilled() ?? false)
        add(ODB_AUX_LAYER_TYPE.FILLING, via.TopLayer(), via.BottomLayer(), via);

      if (ps.IsCapped() ?? false)
        add(ODB_AUX_LAYER_TYPE.CAPPING, via.TopLayer(), via.BottomLayer(), via);

      for (const layer of [via.TopLayer(), via.BottomLayer()]) {
        if (ps.IsPlugged(layer) ?? false)
          add(ODB_AUX_LAYER_TYPE.PLUGGING, layer, PCB_LAYER_ID.UNDEFINED_LAYER, via);

        if (ps.IsCovered(layer) ?? false)
          add(ODB_AUX_LAYER_TYPE.COVERING, layer, PCB_LAYER_ID.UNDEFINED_LAYER, via);

        if (ps.IsTented(layer) ?? false)
          add(ODB_AUX_LAYER_TYPE.TENTING, layer, PCB_LAYER_ID.UNDEFINED_LAYER, via);
      }
    }

    for (const [[type, first, second]] of tupleSorted(auxilliary_layers)) {
      const featureName = auxFeatureName(type as ODB_AUX_LAYER_TYPE);

      if (featureName === null) continue;

      let dLayerName: string;

      if (second !== PCB_LAYER_ID.UNDEFINED_LAYER) {
        dLayerName = `${featureName}_${this.board.GetLayerName(first!)}-${this.board.GetLayerName(second!)}`;
      } else if (this.board.IsFrontLayer(first!)) {
        dLayerName = `${featureName}_front`;
      } else if (this.board.IsBackLayer(first!)) {
        dLayerName = `${featureName}_back`;
      } else {
        continue;
      }

      const matrix = matrixLayer(this.m_row++, dLayerName);

      matrix.m_type = ODB_TYPE.DOCUMENT;
      matrix.m_context = ODB_CONTEXT.BOARD;
      matrix.m_polarity = ODB_POLARITY.POSITIVE;

      if (second !== PCB_LAYER_ID.UNDEFINED_LAYER) {
        matrix.m_span = [
          GenLegalEntityName(this.board.GetLayerName(first!)),
          GenLegalEntityName(this.board.GetLayerName(second!)),
        ];
      }

      this.m_matrixLayers.push(matrix);

      if (second !== PCB_LAYER_ID.UNDEFINED_LAYER)
        this.plugin.GetLayerNameList().push([PCB_LAYER_ID.UNDEFINED_LAYER, matrix.m_layerName]);
      else this.plugin.GetLayerNameList().push([first as PCB_LAYER_ID, matrix.m_layerName]);
    }
  }

  EnsureUniqueLayerNames(): void {
    // Track occurrences of each layer name to detect and handle duplicates
    const name_to_indices = new Map<string, number[]>();

    // First pass: collect all layer names and their indices
    this.m_matrixLayers.forEach((l, i) => {
      let v = name_to_indices.get(l.m_layerName);

      if (!v) {
        v = [];
        name_to_indices.set(l.m_layerName, v);
      }

      v.push(i);
    });

    // Second pass: for any layer names that appear more than once, add suffixes
    for (const name of [...name_to_indices.keys()].sort(strCmp)) {
      const indices = name_to_indices.get(name)!;

      if (indices.length <= 1) continue;

      // Multiple layers have the same name, add suffixes to make them unique
      indices.forEach((idx, count) => {
        let newLayerName = `${this.m_matrixLayers[idx]!.m_layerName}_${count + 1}`;

        // Ensure the new name doesn't exceed the 64-character limit
        if (newLayerName.length > 64) {
          // Truncate the base name if necessary to fit the suffix
          let baseName = this.m_matrixLayers[idx]!.m_layerName;
          const suffixLen = `_${count + 1}`.length;

          if (suffixLen < baseName.length) {
            baseName = baseName.substring(0, 64 - suffixLen);
            newLayerName = `${baseName}_${count + 1}`;
          }
        }

        this.m_matrixLayers[idx]!.m_layerName = newLayerName;
      });
    }
  }

  override GenerateFiles(writer: ODB_TREE_WRITER): void {
    const fileproxy = writer.CreateFileProxy('matrix');

    const twriter = new ODB_TEXT_WRITER(fileproxy.GetStream());

    for (const step_name of [...this.m_matrixSteps.keys()].sort(strCmp)) {
      twriter.Array('STEP', () => {
        twriter.WriteEquationLine('COL', this.m_matrixSteps.get(step_name)!);
        twriter.WriteEquationLine('NAME', step_name);
      });
    }

    for (const layer of this.m_matrixLayers) {
      twriter.Array('LAYER', () => {
        twriter.WriteEquationLine('ROW', layer.m_rowNumber);
        twriter.write_line_enum('CONTEXT', ODB_CONTEXT, layer.m_context);
        twriter.write_line_enum('TYPE', ODB_TYPE, layer.m_type);

        if (layer.m_addType !== null)
          twriter.write_line_enum('ADD_TYPE', ODB_SUBTYPE, layer.m_addType);

        twriter.WriteEquationLine('NAME', layer.m_layerName.toUpperCase());
        twriter.WriteEquationLine('OLD_NAME', '');
        twriter.write_line_enum('POLARITY', ODB_POLARITY, layer.m_polarity);

        if (layer.m_diType !== null) {
          twriter.write_line_enum('DIELECTRIC_TYPE', ODB_DIELECTRIC_TYPE, layer.m_diType);
          // twriter.WriteEquationLine( "DIELECTRIC_NAME", wxEmptyString );

          // Can be used with DIELECTRIC_TYPE=CORE
          // twriter.WriteEquationLine( "CU_TOP", wxEmptyString );
          // twriter.WriteEquationLine( "CU_BOTTOM", wxEmptyString );
        }

        // Only applies to: soldermask, silkscreen, solderpaste and specifies the relevant cu layer
        // twriter.WriteEquationLine( "REF", wxEmptyString );

        if (layer.m_span !== null) {
          twriter.WriteEquationLine('START_NAME', layer.m_span[0].toUpperCase());
          twriter.WriteEquationLine('END_NAME', layer.m_span[1].toUpperCase());
        }

        twriter.WriteEquationLine('COLOR', '0');
      });
    }
  }
}

export class ODB_MISC_ENTITY extends ODB_ENTITY_BASE {
  private readonly m_info: [string, string][];

  constructor(aNow: Date, aBuildVersion: string) {
    super();
    this.m_info = [
      [ODB_JOB_NAME, 'job'],
      [ODB_UNITS, ODB_SETTINGS.m_unitsStr],
      ['ODB_VERSION_MAJOR', '8'],
      ['ODB_VERSION_MINOR', '1'],
      ['ODB_SOURCE', 'KiCad EDA'],
      ['CREATION_DATE', odbDate(aNow)],
      ['SAVE_DATE', odbDate(aNow)],
      ['SAVE_APP', `KiCad EDA ${aBuildVersion}`],
    ];
  }

  GetEntityName(): string {
    return 'misc';
  }

  override GenerateFiles(writer: ODB_TREE_WRITER): void {
    const fileproxy = writer.CreateFileProxy('info');

    const twriter = new ODB_TEXT_WRITER(fileproxy.GetStream());

    for (const [k, v] of this.m_info) twriter.WriteEquationLine(k, v);
  }
}

export class ODB_LAYER_ENTITY extends ODB_ENTITY_BASE {
  private m_layerItems: Map<number, BOARD_ITEM[]>;
  private m_tools: ODB_DRILL_TOOLS | null = null;
  private m_compTop: COMPONENTS_MANAGER | null = null;
  private m_compBot: COMPONENTS_MANAGER | null = null;
  private readonly m_featuresMgr: FEATURES_MANAGER;

  constructor(
    aBoard: BOARD,
    aPlugin: PCB_IO_ODBPP,
    aMap: Map<number, BOARD_ITEM[]>,
    private readonly m_layerID: PCB_LAYER_ID,
    private readonly m_matrixLayerName: string,
  ) {
    super(aBoard, aPlugin);
    // Copied by value upstream.
    this.m_layerItems = new Map([...aMap].map(([k, v]) => [k, [...v]]));
    this.m_featuresMgr = new FEATURES_MANAGER(aBoard, aPlugin, m_matrixLayerName);
  }

  GetEntityName(): string {
    return 'layers';
  }

  private items(aNet: number): BOARD_ITEM[] {
    let v = this.m_layerItems.get(aNet);

    if (!v) {
      v = [];
      this.m_layerItems.set(aNet, v);
    }

    return v;
  }

  override InitEntityData(): void {
    const name = this.m_matrixLayerName;

    if (name.includes('drill')) {
      this.InitDrillData();
      this.InitFeatureData();
      return;
    }

    if (
      name.includes('filling') ||
      name.includes('capping') ||
      name.includes('covering') ||
      name.includes('plugging') ||
      name.includes('tenting')
    ) {
      this.InitAuxilliaryData();
      this.InitFeatureData();
      return;
    }

    if (this.m_layerID !== PCB_LAYER_ID.UNDEFINED_LAYER) this.InitFeatureData();
  }

  InitFeatureData(): void {
    if (this.m_layerItems.size === 0) return;

    // The parent-footprint pointer order upstream sorts by: load order, footprint-less first.
    const fpOrder = new Map<FOOTPRINT, number>();
    this.board.Footprints().forEach((fp, i) => fpOrder.set(fp, i + 1));
    const rank = (aItem: BOARD_ITEM): number => {
      const fp = aItem.GetParentFootprint();
      return fp ? (fpOrder.get(fp) ?? 0) : 0;
    };

    for (const net of this.board.GetNetInfo()) {
      const vec = this.items(net.GetNetCode());

      // std::stable_sort; Array.prototype.sort is stable.
      vec.sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);

        if (ra === rb) return a.Type() - b.Type();

        return ra - rb;
      });

      if (vec.length === 0) continue;

      this.m_featuresMgr.InitFeatureList(this.m_layerID, vec);
    }
  }

  InitComponentData(aFp: FOOTPRINT, aPkg: PACKAGE): ODB_COMPONENT {
    if (this.m_matrixLayerName === 'COMP_+_BOT') {
      if (!this.m_compBot) this.m_compBot = new COMPONENTS_MANAGER();

      return this.m_compBot.AddComponent(aFp, aPkg);
    }

    if (!this.m_compTop) this.m_compTop = new COMPONENTS_MANAGER();

    return this.m_compTop.AddComponent(aFp, aPkg);
  }

  InitDrillData(): void {
    const drill_layers = this.plugin.GetDrillLayerItemsMap();
    const slot_holes = this.plugin.GetSlotHolesMap();
    const span_names = this.plugin.GetDrillSpanNameMap();

    if (this.m_layerItems.size > 0) this.m_layerItems.clear();

    this.m_tools = new ODB_DRILL_TOOLS(ODB_SETTINGS.m_unitsStr);
    const tools = this.m_tools;

    let matchedSpan: ODB_DRILL_SPAN | null = null;

    for (const [span, name] of span_names.entries()) {
      if (name === this.m_matrixLayerName) {
        matchedSpan = span;
        break;
      }
    }

    const useLegacyMatching = matchedSpan === null;
    const isBackdrillLayer = matchedSpan !== null && matchedSpan.m_IsBackdrill;
    const isNonPlatedLayer = matchedSpan !== null && matchedSpan.m_IsNonPlated;
    const isNPTHLayer =
      matchedSpan !== null && matchedSpan.m_IsNonPlated && !matchedSpan.m_IsBackdrill;
    const isPlatedDrillLayer =
      matchedSpan !== null && !matchedSpan.m_IsNonPlated && !matchedSpan.m_IsBackdrill;
    const pairKey = (a: PCB_LAYER_ID, b: PCB_LAYER_ID): string => `${a},${b}`;

    if (matchedSpan !== null && (isNPTHLayer || isPlatedDrillLayer)) {
      // Slotted (oval) holes are routed to a separate map; emit them on the matching
      // plated or non-plated drill layer. Plated slots belong on the plated layer,
      // non-plated slots on the non-plated layer.
      const [top, bottom] = matchedSpan.Pair();
      const slots = slot_holes.get(pairKey(top, bottom));

      for (const item of slots ?? []) {
        if (item.Type() !== KICAD_T.PCB_PAD_T) continue;

        const pad = item as PAD;
        const padIsNPTH = pad.GetAttribute() === PAD_ATTRIB.NPTH;

        if (isNPTHLayer !== padIsNPTH) continue;

        tools.AddDrillTools(
          padIsNPTH ? 'NON_PLATED' : 'PLATED',
          SymDouble(Math.min(pad.GetDrillSizeX(), pad.GetDrillSizeY())),
        );

        this.items(pad.GetNetCode()).push(item);
      }
    } else if (useLegacyMatching) {
      let is_npth_layer = false;
      let plated_name = 'plated';

      if (this.m_matrixLayerName.includes('non-plated')) {
        is_npth_layer = true;
        plated_name = 'non-plated';
      }

      for (const [[first, second], vec] of tupleSorted(slot_holes)) {
        const dLayerName = `drill_${plated_name}_${this.board.GetLayerName(first!)}-${this.board.GetLayerName(second!)}`;

        if (GenLegalEntityName(dLayerName) !== this.m_matrixLayerName) continue;

        for (const item of vec) {
          if (item.Type() !== KICAD_T.PCB_PAD_T) continue;

          const pad = item as PAD;

          if (
            (is_npth_layer && pad.GetAttribute() === PAD_ATTRIB.PTH) ||
            (!is_npth_layer && pad.GetAttribute() === PAD_ATTRIB.NPTH)
          )
            continue;

          tools.AddDrillTools(
            pad.GetAttribute() === PAD_ATTRIB.PTH ? 'PLATED' : 'NON_PLATED',
            SymDouble(Math.min(pad.GetDrillSizeX(), pad.GetDrillSizeY())),
          );

          this.items(pad.GetNetCode()).push(item);
        }

        break;
      }
    }

    if (matchedSpan !== null) {
      const span = matchedSpan;
      const drillItems = drill_layers.find(span);

      for (const item of drillItems ?? []) {
        if (item.Type() === KICAD_T.PCB_VIA_T) {
          const via = item as PCB_VIA;

          if (isBackdrillLayer) {
            const drillMatches = (aDrill: PADSTACK_DRILL_PROPS): boolean =>
              aDrill.start === span.m_StartLayer &&
              aDrill.end === span.m_EndLayer &&
              (aDrill.size.x > 0 || aDrill.size.y > 0);

            const secondary = via.Padstack().SecondaryDrill();
            const tertiary = via.Padstack().TertiaryDrill();

            let drill: PADSTACK_DRILL_PROPS;

            if (drillMatches(secondary)) drill = secondary;
            else if (drillMatches(tertiary)) drill = tertiary;
            else continue;

            let diameter = drill.size.x;

            if (drill.size.y > 0)
              diameter = diameter > 0 ? Math.min(diameter, drill.size.y) : drill.size.y;

            if (diameter <= 0) continue;

            tools.AddDrillTools('NON_PLATED', SymDouble(diameter), 'BLIND');
          } else if (isNonPlatedLayer) {
            tools.AddDrillTools('NON_PLATED', SymDouble(via.GetDrillValue()));
          } else {
            tools.AddDrillTools('VIA', SymDouble(via.GetDrillValue()));
          }

          this.items(via.GetNetCode()).push(item);
        } else if (item.Type() === KICAD_T.PCB_PAD_T) {
          const pad = item as PAD;
          const padIsNPTH = pad.GetAttribute() === PAD_ATTRIB.NPTH;

          if (isNPTHLayer && !padIsNPTH) continue;

          if (!isNonPlatedLayer && padIsNPTH) continue;

          let drillSize = pad.GetDrillSizeX();

          if (pad.GetDrillSizeX() !== pad.GetDrillSizeY())
            drillSize = Math.min(pad.GetDrillSizeX(), pad.GetDrillSizeY());

          const typeLabel = padIsNPTH || isNonPlatedLayer ? 'NON_PLATED' : 'PLATED';
          const type2 = isBackdrillLayer ? 'BLIND' : 'STANDARD';

          tools.AddDrillTools(typeLabel, SymDouble(drillSize), type2);

          this.items(pad.GetNetCode()).push(item);
        }
      }
    } else {
      let is_npth_layer = false;
      let plated_name = 'plated';

      if (this.m_matrixLayerName.includes('non-plated')) {
        is_npth_layer = true;
        plated_name = 'non-plated';
      }

      for (const [span, vec] of drill_layers.entries()) {
        const dLayerName = `drill_${plated_name}_${this.board.GetLayerName(span.TopLayer())}-${this.board.GetLayerName(span.BottomLayer())}`;

        if (GenLegalEntityName(dLayerName) !== this.m_matrixLayerName) continue;

        for (const item of vec) {
          if (item.Type() === KICAD_T.PCB_VIA_T && !is_npth_layer) {
            const via = item as PCB_VIA;

            tools.AddDrillTools('VIA', SymDouble(via.GetDrillValue()));

            this.items(via.GetNetCode()).push(item);
          } else if (item.Type() === KICAD_T.PCB_PAD_T) {
            const pad = item as PAD;

            if (
              (is_npth_layer && pad.GetAttribute() === PAD_ATTRIB.PTH) ||
              (!is_npth_layer && pad.GetAttribute() === PAD_ATTRIB.NPTH)
            )
              continue;

            tools.AddDrillTools(
              pad.GetAttribute() === PAD_ATTRIB.PTH ? 'PLATED' : 'NON_PLATED',
              SymDouble(pad.GetDrillSizeX()),
            );

            this.items(pad.GetNetCode()).push(item);
          }
        }

        break;
      }
    }
  }

  InitAuxilliaryData(): void {
    const auxilliary_layers = this.plugin.GetAuxilliaryLayerItemsMap();

    if (this.m_layerItems.size > 0) this.m_layerItems.clear();

    for (const [[type, first, second], vec] of tupleSorted(auxilliary_layers)) {
      const featureName = auxFeatureName(type as ODB_AUX_LAYER_TYPE);

      if (featureName === null) return;

      let dLayerName: string;

      if (second !== PCB_LAYER_ID.UNDEFINED_LAYER) {
        dLayerName = `${featureName}_${this.board.GetLayerName(first!)}-${this.board.GetLayerName(second!)}`;
      } else if (this.board.IsFrontLayer(first!)) {
        dLayerName = `${featureName}_front`;
      } else if (this.board.IsBackLayer(first!)) {
        dLayerName = `${featureName}_back`;
      } else {
        return;
      }

      if (GenLegalEntityName(dLayerName) === this.m_matrixLayerName) {
        for (const item of vec) {
          if (item.Type() === KICAD_T.PCB_VIA_T)
            this.items((item as PCB_VIA).GetNetCode()).push(item);
        }

        break;
      }
    }
  }

  override GenerateFiles(writer: ODB_TREE_WRITER): void {
    this.GenAttrList(writer);

    this.GenFeatures(writer);

    if (this.m_compTop || this.m_compBot) this.GenComponents(writer);

    if (this.m_tools) this.GenTools(writer);
  }

  GenComponents(writer: ODB_TREE_WRITER): void {
    const fileproxy = writer.CreateFileProxy('components');

    if (this.m_compTop) this.m_compTop.Write(fileproxy.GetStream());
    else if (this.m_compBot) this.m_compBot.Write(fileproxy.GetStream());
  }

  GenFeatures(writer: ODB_TREE_WRITER): void {
    const fileproxy = writer.CreateFileProxy('features');

    this.m_featuresMgr.GenerateFeatureFile(fileproxy.GetStream());
  }

  GenAttrList(writer: ODB_TREE_WRITER): void {
    const fileproxy = writer.CreateFileProxy('attrlist');

    const ost = fileproxy.GetStream();

    const stackup = this.board.GetDesignSettings().GetStackupDescriptor();

    let stackupItem: BOARD_STACKUP_ITEM | null = null;

    if (this.m_layerID !== PCB_LAYER_ID.UNDEFINED_LAYER) {
      stackupItem =
        stackup.GetList().find((item) => item.GetBrdLayerId() === this.m_layerID) ?? null;
    } else {
      for (const item of stackup.GetList()) {
        if (item.GetType() !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) continue;

        const dielectricName = `DIELECTRIC_${item.GetDielectricLayerId()}`;

        if (GenLegalEntityName(dielectricName) === this.m_matrixLayerName) {
          stackupItem = item;
          break;
        }
      }
    }

    if (!stackupItem) return;

    const thickness = stackupItem.GetThickness();

    if (thickness > 0) {
      const thicknessOut = ODB_SETTINGS.m_scale * thickness;
      ost.write('.layer_dielectric=', Double2String(thicknessOut), '\n');
    }

    if (stackupItem.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER) {
      const copperThicknessMM = thickness / pcbIUScale.mmToIU(1.0);
      const thicknessOz = copperThicknessMM / 0.035;
      ost.write('.copper_weight=', Double2String(thicknessOz), '\n');
    }

    if (stackupItem.HasEpsilonRValue()) {
      const epsilonR = stackupItem.GetEpsilonR();

      if (epsilonR > 0.0) ost.write('.dielectric_constant=', Double2String(epsilonR), '\n');
    }

    if (stackupItem.HasLossTangentValue()) {
      const lossTangent = stackupItem.GetLossTangent();

      if (lossTangent > 0.0) ost.write('.loss_tangent=', Double2String(lossTangent), '\n');
    }

    const material = stackupItem.GetMaterial();

    if (material !== '') ost.write('.material=', GenLegalEntityName(material), '\n');
  }

  GenTools(writer: ODB_TREE_WRITER): void {
    const fileproxy = writer.CreateFileProxy('tools');

    this.m_tools!.GenerateFile(fileproxy.GetStream());
  }
}

/** `ODB::SymDouble2String`, local for the drill tools. */
function SymDouble(aVal: number): string {
  return Double2String(ODB_SETTINGS.m_symbolScale * aVal);
}

export class ODB_STEP_ENTITY extends ODB_ENTITY_BASE {
  /** std::map<wxString, …>: walked by name. */
  private readonly m_layerEntityMap = new Map<string, ODB_LAYER_ENTITY>();
  private m_profile: FEATURES_MANAGER | null = null;
  private readonly m_edaData: EDA_DATA;
  private readonly m_netlist: ODB_NET_LIST;

  constructor(aBoard: BOARD, aPlugin: PCB_IO_ODBPP) {
    super(aBoard, aPlugin);
    this.m_netlist = new ODB_NET_LIST(aBoard);
    this.m_edaData = new EDA_DATA(isoCombined(aPlugin.m_now), aPlugin.m_buildVersion);
  }

  GetEntityName(): string {
    return 'pcb';
  }

  private layerEntities(): [string, ODB_LAYER_ENTITY][] {
    return [...this.m_layerEntityMap].sort(([a], [b]) => strCmp(a, b));
  }

  override InitEntityData(): void {
    this.MakeLayerEntity();

    this.InitEdaData();

    // Init Layer Entity Data
    for (const [, layer_entity] of this.layerEntities()) layer_entity.InitEntityData();
  }

  InitEdaData(): void {
    //InitPackage
    for (const fp of this.board.Footprints()) this.m_edaData.AddPackage(fp);

    // for NET
    for (const net of this.board.GetNetInfo()) this.m_edaData.AddNET(net);

    // for CMP
    let j = 0;

    for (const fp of this.board.Footprints()) {
      const compName = GenLegalEntityName(fp.IsFlipped() ? 'COMP_+_BOT' : 'COMP_+_TOP');

      const layerEntity = this.m_layerEntityMap.get(compName);

      if (!layerEntity) return;

      // ODBPP only need unique PACKAGE in PKG record in eda/data file.
      // the PKG index can repeat to be ref in CMP record in component file.
      const fp_pkg = this.m_edaData.GetEdaFootprints()[j]!;
      ++j;

      const eda_pkg = this.m_edaData.GetPackage(
        hash_fp_item(fp_pkg, HASH_FLAGS.HASH_POS | HASH_FLAGS.REL_COORD),
      );

      const pads = fp.Pads();

      if (pads.length === 0) continue;

      const comp = layerEntity.InitComponentData(fp, eda_pkg);

      for (let i = 0; i < pads.length; ++i) {
        const pad = pads[i]!;
        const eda_net = this.m_edaData.GetNet(pad.GetNetCode());

        const subnet = eda_net.AddSubnet(
          (aIndex) =>
            new SUB_NET_TOEPRINT(
              aIndex,
              this.m_edaData,
              fp.IsFlipped() ? SIDE.BOTTOM : SIDE.TOP,
              comp.m_index,
              comp.m_toeprints.length,
            ),
        );

        if (!this.plugin.GetPadSubnetMap().has(pad)) this.plugin.GetPadSubnetMap().set(pad, subnet);

        const pin = eda_pkg.GetEdaPkgPin(i);
        const toep = new TOEPRINT(pin);
        comp.m_toeprints.push(toep);

        toep.m_net_num = eda_net.m_index;
        toep.m_subnet_num = subnet.m_index;

        toep.m_center = AddXY(pad.GetPosition());

        toep.m_rot = Double2String(ANGLE_360.sub(pad.GetOrientation()).Normalize().AsDegrees());

        toep.m_mirror = pad.IsFlipped() ? 'M' : 'N';
      }
    }

    for (const track of this.board.Tracks()) {
      const eda_net = this.m_edaData.GetNet(track.GetNetCode());

      const subnet =
        track.Type() === KICAD_T.PCB_VIA_T
          ? eda_net.AddSubnet((aIndex) => new SUB_NET_VIA(aIndex, this.m_edaData))
          : eda_net.AddSubnet((aIndex) => new SUB_NET_TRACE(aIndex, this.m_edaData));

      if (!this.plugin.GetViaTraceSubnetMap().has(track))
        this.plugin.GetViaTraceSubnetMap().set(track, subnet);
    }

    for (const zone of this.board.Zones()) {
      for (const layer of zone.GetLayerSet().Seq()) {
        const eda_net = this.m_edaData.GetNet(zone.GetNetCode());
        const subnet = eda_net.AddSubnet(
          (aIndex) =>
            new SUB_NET_PLANE(aIndex, this.m_edaData, FILL_TYPE.SOLID, CUTOUT_TYPE.EXACT, 0),
        );

        let byLayer = this.plugin.GetPlaneSubnetMap().get(zone);

        if (!byLayer) {
          byLayer = new Map();
          this.plugin.GetPlaneSubnetMap().set(zone, byLayer);
        }

        if (!byLayer.has(layer)) byLayer.set(layer, subnet);
      }
    }
  }

  override GenerateFiles(writer: ODB_TREE_WRITER): void {
    const step_root = writer.GetCurrentPath();

    writer.CreateEntityDirectory(step_root, 'layers');
    this.GenerateLayerFiles(writer);

    writer.CreateEntityDirectory(step_root, 'eda');
    this.GenerateEdaFiles(writer);

    writer.CreateEntityDirectory(step_root, 'netlists/cadnet');
    this.GenerateNetlistsFiles(writer);

    writer.SetCurrentPath(step_root);
    this.GenerateProfileFile(writer);

    this.GenerateStepHeaderFile(writer);

    //TODO: system attributes
    // GenerateAttrListFile( writer );
  }

  GenerateProfileFile(writer: ODB_TREE_WRITER): void {
    const fileproxy = writer.CreateFileProxy('profile');

    this.m_profile = new FEATURES_MANAGER(this.board, this.plugin, '');

    const board_outline = new SHAPE_POLY_SET();

    this.board.GetBoardPolygonOutlines(board_outline, true);

    this.m_profile.AddContour(board_outline, 0);

    this.m_profile.GenerateProfileFeatures(fileproxy.GetStream());
  }

  GenerateStepHeaderFile(writer: ODB_TREE_WRITER): void {
    const fileproxy = writer.CreateFileProxy('stephdr');

    const stephdr = new Map<string, string>([
      [ODB_UNITS, ODB_SETTINGS.m_unitsStr],
      ['X_DATUM', '0'],
      ['Y_DATUM', '0'],
      ['X_ORIGIN', '0'],
      ['Y_ORIGIN', '0'],
      ['TOP_ACTIVE', '0'],
      ['BOTTOM_ACTIVE', '0'],
      ['RIGHT_ACTIVE', '0'],
      ['LEFT_ACTIVE', '0'],
      ['AFFECTING_BOM', ''],
      ['AFFECTING_BOM_CHANGED', '0'],
    ]);

    const twriter = new ODB_TEXT_WRITER(fileproxy.GetStream());

    for (const key of STEPHDR_ORDER) twriter.WriteEquationLine(key, stephdr.get(key)!);
  }

  GenerateLayerFiles(writer: ODB_TREE_WRITER): void {
    const layers_root = writer.GetCurrentPath();

    for (const [layerName, layerEntity] of this.layerEntities()) {
      writer.CreateEntityDirectory(layers_root, layerName);

      layerEntity.GenerateFiles(writer);
    }
  }

  GenerateEdaFiles(writer: ODB_TREE_WRITER): void {
    const fileproxy = writer.CreateFileProxy('data');

    this.m_edaData.Write(fileproxy.GetStream());
  }

  GenerateNetlistsFiles(writer: ODB_TREE_WRITER): void {
    const fileproxy = writer.CreateFileProxy('netlist');

    this.m_netlist.Write(fileproxy.GetStream());
  }

  override CreateDirectoryTree(writer: ODB_TREE_WRITER): boolean {
    writer.CreateEntityDirectory(writer.GetRootPath(), 'steps');
    writer.CreateEntityDirectory(writer.GetCurrentPath(), this.GetEntityName());
    return true;
  }

  MakeLayerEntity(): void {
    const layers = this.board.GetEnabledLayers();

    // To avoid the overhead of repeatedly cycling through the layers and nets,
    // we pre-sort the board items into a map of layer -> net -> items
    const elements = this.plugin.GetLayerElementsMap();

    const push = (aLayer: PCB_LAYER_ID, aNet: number, aItem: BOARD_ITEM): void => {
      let byNet = elements.get(aLayer);

      if (!byNet) {
        byNet = new Map();
        elements.set(aLayer, byNet);
      }

      let v = byNet.get(aNet);

      if (!v) {
        v = [];
        byNet.set(aNet, v);
      }

      v.push(aItem);
    };

    for (const aTrack of this.board.Tracks()) {
      if (aTrack.Type() === KICAD_T.PCB_VIA_T) {
        const via = aTrack as PCB_VIA;

        for (const layer of layers.Seq()) {
          if (via.FlashLayer(layer)) push(layer, via.GetNetCode(), via);
        }
      } else {
        push(aTrack.GetLayer(), aTrack.GetNetCode(), aTrack);
      }
    }

    for (const zone of this.board.Zones()) {
      for (const layer of zone.GetLayerSet().Seq()) push(layer, zone.GetNetCode(), zone);
    }

    for (const item of this.board.Drawings()) {
      if (item.IsConnected()) {
        for (const layer of item.GetLayerSet().Seq()) push(layer, (item as PAD).GetNetCode(), item);
      } else {
        for (const layer of item.GetLayerSet().Seq()) push(layer, 0, item);
      }
    }

    const maskLayers = new LSET([PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask]);
    const pasteLayers = new LSET([PCB_LAYER_ID.F_Paste, PCB_LAYER_ID.B_Paste]);
    const allCu = LSET.AllCuMask();

    for (const fp of this.board.Footprints()) {
      for (const field of fp.GetFields()) push(field.GetLayer(), 0, field);

      for (const item of fp.GraphicalItems()) {
        for (const layer of item.GetLayerSet().Seq()) push(layer, 0, item);
      }

      for (const pad of fp.Pads()) {
        let margin = { x: 0, y: 0 };

        for (const layer of pad.GetLayerSet().Seq()) {
          const onCopperLayer = allCu.Contains(layer);
          const onSolderMaskLayer = maskLayers.Contains(layer);
          const onSolderPasteLayer = pasteLayers.Contains(layer);

          if (onSolderMaskLayer) {
            const m = pad.GetSolderMaskExpansion(PADSTACK.ALL_LAYERS);
            margin = { x: m, y: m };
          }

          if (onSolderPasteLayer) margin = { ...pad.GetSolderPasteMargin(PADSTACK.ALL_LAYERS) };

          const size = pad.GetSize(PADSTACK.ALL_LAYERS);
          const padPlotsSize = { x: size.x + margin.x * 2, y: size.y + margin.y * 2 };

          if (onCopperLayer && !pad.IsOnCopperLayer()) continue;

          if (onCopperLayer && !pad.FlashLayer(layer)) continue;

          if (
            pad.GetShape(PADSTACK.ALL_LAYERS) !== PAD_SHAPE.CUSTOM &&
            (padPlotsSize.x <= 0 || padPlotsSize.y <= 0)
          )
            continue;

          push(layer, pad.GetNetCode(), pad);
        }
      }
    }

    for (const [layerID, layerName] of this.plugin.GetLayerNameList()) {
      // `elements[layerID]`: an absent layer gets an empty map.
      let byNet = elements.get(layerID);

      if (!byNet) {
        byNet = new Map();
        elements.set(layerID, byNet);
      }

      if (this.m_layerEntityMap.has(layerName)) continue;

      this.m_layerEntityMap.set(
        layerName,
        new ODB_LAYER_ENTITY(this.board, this.plugin, byNet, layerID, layerName),
      );
    }
  }
}

export class ODB_SYMBOLS_ENTITY extends ODB_ENTITY_BASE {
  GetEntityName(): string {
    return 'symbols';
  }
}

export class ODB_FONTS_ENTITY extends ODB_ENTITY_BASE {
  GetEntityName(): string {
    return 'fonts';
  }

  override GenerateFiles(writer: ODB_TREE_WRITER): void {
    writer.CreateFileProxy('standard').GetStream().write(ODB_FONTS_STANDARD);
  }
}

export class ODB_WHEELS_ENTITY extends ODB_ENTITY_BASE {
  GetEntityName(): string {
    return 'wheels';
  }
}

export class ODB_INPUT_ENTITY extends ODB_ENTITY_BASE {
  GetEntityName(): string {
    return 'input';
  }
}

export class ODB_USER_ENTITY extends ODB_ENTITY_BASE {
  GetEntityName(): string {
    return 'user';
  }
}
