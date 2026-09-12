// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_IO_KICAD_SEXPR` (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.cpp): the
 * `.kicad_pcb` writer. Each `format*` is the C++ function of the same name in
 * the same order with the same `Print` calls, printed compact into an
 * `OUTPUTFORMATTER` and laid out by `KICAD_FORMAT::Prettify` at the end —
 * which is exactly how `PRETTIFIED_FILE_OUTPUTFORMATTER::Finish` writes the
 * file upstream, and why a board we write is the bytes KiCad would write.
 *
 * Line references are to the 10.0.5 source.
 */
import { FormatAngle, FormatInternalUnits, pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { GENERATOR } from '@ziroeda/common/src/generator.js';
import {
  FormatBool,
  FormatOptBool,
  FormatStreamData,
  FormatUuid,
} from '@ziroeda/common/src/io/kicad/kicad_io_utils.js';
import { type OUTPUTFORMATTER, PRETTIFIED_STRING_FORMATTER } from '@ziroeda/common/src/richio.js';
import { FormatDouble2Str, formatF, formatG, strNumCmp } from '@ziroeda/common/src/string_utils.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { TeardropParams } from '../../types.js';
import {
  copperLayerPropsConst,
  defaultTeardropParams,
  fieldCanonicalName,
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_SMD,
  FP_THROUGH_HOLE,
  type KEdaText,
  type KFootprint,
  type KFpGraphicalItem,
  type KPad,
  type KPcbBarcode,
  type KPcbDimension,
  type KPcbGenerator,
  type KPcbGroup,
  type KPcbPoint,
  type KPcbReferenceImage,
  type KPcbTable,
  type KPcbTableCell,
  type KPcbTarget,
  type KPcbText,
  type KPcbTextBox,
  type KPcbTrack,
  type KPcbVia,
  type KZone,
  PADSTACK_ALL_LAYERS,
  PADSTACK_INNER_LAYERS,
  type PadShape,
  padstackThermalSpokeAngle,
  type PostMachiningProps,
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_BOTTOM_RIGHT,
  RECT_CHAMFER_TOP_LEFT,
  RECT_CHAMFER_TOP_RIGHT,
  uniquePadstackLayers,
} from './kicad_board_items.js';
import type { KBoard, KBoardDrawing, KBoardTrack } from './pcb_io_kicad_sexpr_board.js';
import {
  type BoardDesignSettingsFile,
  type BoardStackup,
  type BoardVariant,
  type EmbeddedFiles,
  IsPrmSpecified,
  type LayerDescr,
  type PageInfo,
  type PcbPlotParams,
  type TitleBlock,
  type ZoneLayerProperties,
} from '../../board_file_model.js';
import {
  B_Adhes,
  B_CrtYd,
  B_Cu,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  F_Adhes,
  F_CrtYd,
  F_Cu,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  IsCopperLayer,
  IsExternalCopperLayer,
  LSET_Name,
  MAX_CU_LAYERS,
  PCB_LAYER_ID_COUNT,
  UNDEFINED_LAYER,
  User_1,
} from '../../layer_ids.js';
import { LAYER_RANGE, LSET } from '../../lset.js';
import {
  type FillT,
  type KPcbShape,
  type NetRef,
  type OutlineEntry,
  type ParentFP,
  type ShapeT,
  shapeLayerSet,
  type StrokeParams,
  trackLayerSet,
  UNDEFINED_DRILL_DIAMETER,
  zoneFirstLayer,
} from './pcb_io_kicad_sexpr_items.js';
import type { StrokeType } from '../../types.js';
import { SEXPR_BOARD_FILE_VERSION } from './pcb_io_kicad_sexpr_parser.js';

/** `KiROUND`. */
const KiROUND = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/** `GetMajorMinorVersion()`: the `generator_version` a 10.0.x build writes. */
export const MAJOR_MINOR_VERSION = '10.0';

/** `formatInternalUnits( int )` (:454). */
export const formatInternalUnits = (
  value: number,
  dataType: 'distance' | 'time' = 'distance',
): string => FormatInternalUnits(pcbIUScale, value, dataType);

/** `formatInternalUnits( const VECTOR2I& )` (:460). */
export const formatInternalUnitsPt = (p: Vec2): string =>
  `${FormatInternalUnits(pcbIUScale, p.x)} ${FormatInternalUnits(pcbIUScale, p.y)}`;

/** What the header formatter reads: the board's header model. */
export interface BoardHeaderView {
  /** The generator name written after `(kicad_pcb (version …)`. */
  generator: string;
  /** `BOARD::GetNetname( code )` for a legacy net code; `''` when unknown. */
  netNames: Map<number, string>;
  designSettings: BoardDesignSettingsFile;
  legacyTeardrops: boolean;
  pageInfo: PageInfo;
  titleBlock: TitleBlock;
  enabledLayers: LSET;
  copperLayerCount: number;
  layerDescrs: Map<number, LayerDescr>;
  properties: Map<string, string>;
  variants: BoardVariant[];
  embeddedFiles: EmbeddedFiles;
}

export class PCB_IO_KICAD_SEXPR {
  /** `resolveGroups`' answer: group uuid -> member uuids that exist, set by `formatBoard`. */
  private m_groupMembers: Map<string, string[]> | null = null;

  constructor(
    private readonly m_out: OUTPUTFORMATTER,
    private readonly m_board: BoardHeaderView,
  ) {}

  // -------------------------------------------------------------------------
  // The header: formatHeader (:747) and what it calls
  // -------------------------------------------------------------------------

  /** `formatHeader( aBoard )` (:747). */
  formatHeader(): void {
    this.formatGeneral();
    // Layers list.
    this.formatBoardLayers();
    // Setup
    this.formatSetup();
    // Properties
    this.formatProperties();
    // Variants
    this.formatVariants();
  }

  /** `formatGeneral( aBoard )` (:641). */
  formatGeneral(): void {
    const dsnSettings = this.m_board.designSettings;
    this.m_out.Print('(general');
    this.m_out.Print(`(thickness ${formatInternalUnits(dsnSettings.boardThickness)})`);
    FormatBool(this.m_out, 'legacy_teardrops', this.m_board.legacyTeardrops);
    this.m_out.Print(')');

    formatPageInfo(this.m_out, this.m_board.pageInfo);
    formatTitleBlock(this.m_out, this.m_board.titleBlock);
  }

  /** `formatBoardLayers( aBoard )` (:659). */
  formatBoardLayers(): void {
    const board = this.m_board;
    this.m_out.Print('(layers');

    const layerName = (layer: number): string => {
      // `BOARD::GetLayerName`: the user's name when set, else the canonical.
      const d = board.layerDescrs.get(layer);
      return d && d.userName !== '' ? d.userName : LSET_Name(layer);
    };
    const layerType = (layer: number): string => {
      // `BOARD::GetLayerType` (board.cpp:793): the descriptor's type when the
      // layer is enabled and described; else LT_AUX for a user layer, LT_SIGNAL
      // for copper, LT_UNDEFINED otherwise — through `LAYER::ShowType`, whose
      // `default` is "signal".
      const d = board.enabledLayers.test(layer) ? board.layerDescrs.get(layer) : undefined;
      let t: string;
      if (d) t = d.type;
      else if (layer >= User_1 && !IsCopperLayer(layer)) t = 'auxiliary';
      else if (IsCopperLayer(layer)) t = 'signal';
      else t = 'undefined';
      return t === 'undefined' ? 'signal' : t;
    };

    // Save only the used copper layers from front to back.
    for (const layer of board.enabledLayers.CuStack()) {
      this.m_out.Print(
        `(${layer} ${this.m_out.Quotew(LSET_Name(layer))} ${layerType(layer)} ${
          LSET_Name(layer) === layerName(layer) ? '' : this.m_out.Quotew(layerName(layer))
        })`,
      );
    }

    // Save used non-copper layers in the order they are defined.
    const seq = board.enabledLayers.TechAndUserUIOrder();
    for (const layer of seq) {
      let printType = false;
      // User layers (layer id >= User_1) have a qualifier
      // default is "user", but other qualifiers exist
      if (layer >= User_1) {
        if (IsCopperLayer(layer)) printType = true;
        const t = layerType(layer);
        if (t === 'front' || t === 'back') printType = true;
      }
      this.m_out.Print(
        `(${layer} ${this.m_out.Quotew(LSET_Name(layer))} ${printType ? layerType(layer) : 'user'} ${
          layerName(layer) === LSET_Name(layer) ? '' : this.m_out.Quotew(layerName(layer))
        })`,
      );
    }

    this.m_out.Print(')');
  }

  /** `formatSetup( aBoard )` (:551). */
  formatSetup(): void {
    // Setup
    this.m_out.Print('(setup');

    // Save the board physical stackup structure
    const dsnSettings = this.m_board.designSettings;
    if (dsnSettings.hasStackup) formatBoardStackup(this.m_out, dsnSettings.stackup);

    this.m_out.Print(
      `(pad_to_mask_clearance ${formatInternalUnits(dsnSettings.solderMaskExpansion)})`,
    );

    if (dsnSettings.solderMaskMinWidth)
      this.m_out.Print(
        `(solder_mask_min_width ${formatInternalUnits(dsnSettings.solderMaskMinWidth)})`,
      );

    if (dsnSettings.solderPasteMargin !== 0)
      this.m_out.Print(
        `(pad_to_paste_clearance ${formatInternalUnits(dsnSettings.solderPasteMargin)})`,
      );

    if (dsnSettings.solderPasteMarginRatio !== 0)
      this.m_out.Print(
        `(pad_to_paste_clearance_ratio ${FormatDouble2Str(dsnSettings.solderPasteMarginRatio)})`,
      );

    FormatBool(
      this.m_out,
      'allow_soldermask_bridges_in_footprints',
      dsnSettings.allowSoldermaskBridgesInFPs,
    );

    this.m_out.Print(0, ' (tenting ');
    FormatBool(this.m_out, 'front', dsnSettings.tentViasFront);
    FormatBool(this.m_out, 'back', dsnSettings.tentViasBack);
    this.m_out.Print(0, ')');

    this.m_out.Print(0, ' (covering ');
    FormatBool(this.m_out, 'front', dsnSettings.coverViasFront);
    FormatBool(this.m_out, 'back', dsnSettings.coverViasBack);
    this.m_out.Print(0, ')');

    this.m_out.Print(0, ' (plugging ');
    FormatBool(this.m_out, 'front', dsnSettings.plugViasFront);
    FormatBool(this.m_out, 'back', dsnSettings.plugViasBack);
    this.m_out.Print(0, ')');

    FormatBool(this.m_out, 'capping', dsnSettings.capVias);

    FormatBool(this.m_out, 'filling', dsnSettings.fillVias);

    if (dsnSettings.zoneLayerProperties.size > 0) {
      this.m_out.Print(0, ' (zone_defaults');
      // `std::map<PCB_LAYER_ID, …>` iterates in layer-id order.
      for (const layer of [...dsnSettings.zoneLayerProperties.keys()].sort((a, b) => a - b))
        this.formatZoneLayerProperties(dsnSettings.zoneLayerProperties.get(layer)!, 0, layer);
      this.m_out.Print(0, ')\n');
    }

    let origin = dsnSettings.auxOrigin;
    if (origin.x !== 0 || origin.y !== 0)
      this.m_out.Print(
        `(aux_axis_origin ${formatInternalUnits(origin.x)} ${formatInternalUnits(origin.y)})`,
      );

    origin = dsnSettings.gridOrigin;
    if (origin.x !== 0 || origin.y !== 0)
      this.m_out.Print(
        `(grid_origin ${formatInternalUnits(origin.x)} ${formatInternalUnits(origin.y)})`,
      );

    formatPlotParams(this.m_out, dsnSettings.plotOptions);

    this.m_out.Print(')');
  }

  /** `format( const ZONE_LAYER_PROPERTIES&, int aNestLevel, PCB_LAYER_ID )` (:3096). */
  formatZoneLayerProperties(props: ZoneLayerProperties, nestLevel: number, layer: number): void {
    // Do not store the layer properties if no value is actually set.
    if (props.hatchingOffset === undefined) return;
    this.m_out.Print(nestLevel, '(property\n');
    this.m_out.Print(nestLevel, `(layer ${this.m_out.Quotew(LSET_Name(layer))})\n`);
    this.m_out.Print(
      nestLevel,
      `(hatch_position (xy ${formatInternalUnitsPt(props.hatchingOffset)}))`,
    );
    this.m_out.Print(nestLevel, ')\n');
  }

  /** `formatProperties( aBoard )` (:711). */
  formatProperties(): void {
    for (const [k, v] of this.m_board.properties)
      this.m_out.Print(`(property ${this.m_out.Quotew(k)} ${this.m_out.Quotew(v)})`);
  }

  /** `formatVariants( aBoard )` (:722). */
  formatVariants(): void {
    const variantNames = this.m_board.variants;
    if (variantNames.length === 0) return;
    this.m_out.Print('(variants');
    for (const v of variantNames) {
      this.m_out.Print(`(variant (name ${this.m_out.Quotew(v.name)})`);
      if (v.description !== '')
        this.m_out.Print(`(description ${this.m_out.Quotew(v.description)})`);
      this.m_out.Print(')');
    }
    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // Shared item helpers
  // -------------------------------------------------------------------------

  /** `GetNetname()` and `GetNetCode()` for an item's net; null is the unconnected net. */
  netName(net: NetRef): { name: string; code: number } {
    return net ?? { name: '', code: 0 };
  }

  /** `formatLayer( aLayer, aIsKnockout )` (:480). */
  formatLayer(layer: number, isKnockout = false): void {
    this.m_out.Print(
      `(layer ${this.m_out.Quotew(LSET_Name(layer))} ${isKnockout ? 'knockout' : ''})`,
    );
  }

  /** `formatLayers( aLayerMask, aEnumerateLayers, aIsZone )` (:1549). */
  formatLayers(layerMaskIn: LSET, enumerateLayers: boolean, isZone = false): void {
    const cu_all = LSET.AllCuMask();
    const fr_bk = new LSET([B_Cu, F_Cu]);
    const adhes = new LSET([B_Adhes, F_Adhes]);
    const paste = new LSET([B_Paste, F_Paste]);
    const silks = new LSET([B_SilkS, F_SilkS]);
    const mask = new LSET([B_Mask, F_Mask]);
    const crt_yd = new LSET([B_CrtYd, F_CrtYd]);
    const fab = new LSET([B_Fab, F_Fab]);

    const cu_board_mask = LSET.AllCuMask(this.m_board.copperLayerCount);

    let layerMask = layerMaskIn.clone();
    let output = '';

    if (!enumerateLayers) {
      // If all copper layers present on the board are enabled, then output the wildcard
      if (layerMask.and(cu_board_mask).equals(cu_board_mask)) {
        output += ` ${this.m_out.Quotew('*.Cu')}`;
        // Clear all copper bits because pads might have internal layers that aren't part of the
        // board enabled, and we don't want to output those in the layers listing if we already
        // output the wildcard.
        layerMask = layerMask.andNot(cu_all);
      } else if (layerMask.and(cu_board_mask).equals(fr_bk)) {
        if (isZone) output += ` ${this.m_out.Quotew('F&B.Cu')}`;
        else output += ` ${this.m_out.Quotew('*.Cu')}`;
        layerMask = layerMask.andNot(fr_bk);
      }
      const pair = (set: LSET, name: string): void => {
        if (layerMask.and(set).equals(set)) {
          output += ` ${this.m_out.Quotew(name)}`;
          layerMask = layerMask.andNot(set);
        }
      };
      pair(adhes, '*.Adhes');
      pair(paste, '*.Paste');
      pair(silks, '*.SilkS');
      pair(mask, '*.Mask');
      pair(crt_yd, '*.CrtYd');
      pair(fab, '*.Fab');
    }

    // output any individual layers not handled in wildcard combos above
    for (let layer = 0; layer < PCB_LAYER_ID_COUNT; ++layer) {
      if (layerMask.test(layer)) output += ` ${this.m_out.Quotew(LSET_Name(layer))}`;
    }

    this.m_out.Print(`(layers ${output})`);
  }

  /** `formatPolyPts( outline, aParentFP )` (:488). */
  formatPolyPts(outline: readonly OutlineEntry[]): void {
    this.m_out.Print('(pts');
    for (const e of outline) {
      if ('xy' in e) this.m_out.Print(`(xy ${formatInternalUnitsPt(e.xy)})`);
      else
        this.m_out.Print(
          `(arc (start ${formatInternalUnitsPt(e.arc.start)}) (mid ${formatInternalUnitsPt(e.arc.mid)}) (end ${formatInternalUnitsPt(e.arc.end)}))`,
        );
    }
    this.m_out.Print(')');
  }

  /** `STROKE_PARAMS::Format( aFormatter, aIuScale )` (common/stroke_params.cpp). */
  formatStroke(stroke: StrokeParams): void {
    if (!stroke.color) {
      this.m_out.Print(
        `(stroke (width ${formatInternalUnits(stroke.width)}) (type ${stroke.type}))`,
      );
    } else {
      const c = stroke.color;
      this.m_out.Print(
        `(stroke (width ${formatInternalUnits(stroke.width)}) (type ${stroke.type}) (color ${KiROUND(c.r * 255.0)} ${KiROUND(c.g * 255.0)} ${KiROUND(c.b * 255.0)} ${FormatDouble2Str(c.a)}))`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // PCB_SHAPE (:1000)
  // -------------------------------------------------------------------------

  /** `format( const PCB_SHAPE* aShape )` (:1000). */
  formatShape(shape: KPcbShape, parentFP: ParentFP | null): void {
    const prefix = parentFP ? 'fp' : 'gr';
    const pt = formatInternalUnitsPt;

    switch (shape.shape) {
      case 'segment':
        this.m_out.Print(`(${prefix}_line (start ${pt(shape.start)}) (end ${pt(shape.end)})`);
        break;
      case 'rectangle':
        this.m_out.Print(`(${prefix}_rect (start ${pt(shape.start)}) (end ${pt(shape.end)})`);
        if (shape.cornerRadius > 0)
          this.m_out.Print(` (radius ${formatInternalUnits(shape.cornerRadius)})`);
        break;
      case 'circle':
        this.m_out.Print(`(${prefix}_circle (center ${pt(shape.start)}) (end ${pt(shape.end)})`);
        break;
      case 'arc':
        this.m_out.Print(
          `(${prefix}_arc (start ${pt(shape.start)}) (mid ${pt(shape.arcMid!)}) (end ${pt(shape.end)})`,
        );
        break;
      case 'poly':
        // `IsPolyShapeValid()`: an outline with at least three points.
        if ((shape.outline?.length ?? 0) >= 3) {
          this.m_out.Print(`(${prefix}_poly`);
          this.formatPolyPts(shape.outline!);
        } else {
          return;
        }
        break;
      case 'bezier':
        this.m_out.Print(
          `(${prefix}_curve (pts (xy ${pt(shape.start)}) (xy ${pt(shape.bezierC1!)}) (xy ${pt(shape.bezierC2!)}) (xy ${pt(shape.end)}))`,
        );
        break;
    }

    this.formatStroke(shape.stroke);

    // The filled flag represents if a solid fill is present on circles, rectangles and polygons
    if (shape.shape === 'poly' || shape.shape === 'rectangle' || shape.shape === 'circle') {
      switch (shape.fill) {
        case 'hatch':
          this.m_out.Print('(fill hatch)');
          break;
        case 'reverse_hatch':
          this.m_out.Print('(fill reverse_hatch)');
          break;
        case 'cross_hatch':
          this.m_out.Print('(fill cross_hatch)');
          break;
        case 'filled_shape':
          FormatBool(this.m_out, 'fill', true);
          break;
        default:
          FormatBool(this.m_out, 'fill', false);
          break;
      }
    }

    if (shape.locked) FormatBool(this.m_out, 'locked', true);

    const layerSet = shapeLayerSet(shape);
    if (layerSet.count() > 1) this.formatLayers(layerSet, false /* enumerate layers */);
    else this.formatLayer(shape.layer);

    if (
      shape.hasSolderMask &&
      shape.solderMaskMargin !== undefined &&
      IsExternalCopperLayer(shape.layer)
    )
      this.m_out.Print(`(solder_mask_margin ${formatInternalUnits(shape.solderMaskMargin)})`);

    const net = this.netName(shape.net);
    if (net.code > 0) this.m_out.Print(`(net ${this.m_out.Quotew(net.name)})`);

    FormatUuid(this.m_out, shape.uuid);
    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // formatRenderCache (:523), formatTeardropParameters (:781)
  // -------------------------------------------------------------------------

  /**
   * `formatRenderCache( aText )` (:523). The C++ regenerates the glyph
   * polygons from the outline font; the model keeps the cache as read.
   */
  formatRenderCache(text: KEdaText): void {
    const cache = text.renderCache!;
    this.m_out.Print(`(render_cache ${this.m_out.Quotew(cache.text)} ${FormatAngle(cache.angle)}`);
    for (const glyph of cache.glyphs) {
      for (const poly of glyph) {
        this.m_out.Print('(polygon');
        this.formatPolyPts(poly);
        this.m_out.Print(')');
      }
    }
    this.m_out.Print(')');
  }

  /** `formatTeardropParameters( tdParams )` (:781). */
  formatTeardropParameters(td: TeardropParams): void {
    this.m_out.Print(
      `(teardrops (best_length_ratio ${FormatDouble2Str(td.bestLengthRatio)}) (max_length ${formatInternalUnits(td.tdMaxLen)}) (best_width_ratio ${FormatDouble2Str(td.bestWidthRatio)}) (max_width ${formatInternalUnits(td.tdMaxWidth)})`,
    );
    FormatBool(this.m_out, 'curved_edges', td.curvedEdges);
    this.m_out.Print(`(filter_ratio ${FormatDouble2Str(td.widthtoSizeFilterRatio)})`);
    FormatBool(this.m_out, 'enabled', td.enabled);
    FormatBool(this.m_out, 'allow_two_segments', td.allowUseTwoTracks);
    FormatBool(this.m_out, 'prefer_zone_connections', !td.tdOnPadsInZones);
    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // PCB_DIMENSION_BASE (:885)
  // -------------------------------------------------------------------------

  /** `format( const PCB_DIMENSION_BASE* aDimension )` (:885). */
  formatDimension(dim: KPcbDimension): void {
    const aligned = dim.type === 'aligned' || dim.type === 'orthogonal';
    const ortho = dim.type === 'orthogonal';
    const center = dim.type === 'center';
    const radial = dim.type === 'radial';
    const leader = dim.type === 'leader';

    this.m_out.Print('(dimension');

    if (ortho) this.m_out.Print('(type orthogonal)');
    else if (aligned) this.m_out.Print('(type aligned)');
    else if (leader) this.m_out.Print('(type leader)');
    else if (center) this.m_out.Print('(type center)');
    else if (radial) this.m_out.Print('(type radial)');

    if (dim.locked) FormatBool(this.m_out, 'locked', dim.locked);

    this.formatLayer(dim.layer);

    FormatUuid(this.m_out, dim.uuid);

    this.m_out.Print(
      `(pts (xy ${formatInternalUnits(dim.start.x)} ${formatInternalUnits(dim.start.y)}) (xy ${formatInternalUnits(dim.end.x)} ${formatInternalUnits(dim.end.y)}))`,
    );

    if (aligned) this.m_out.Print(`(height ${formatInternalUnits(dim.height)})`);

    if (radial) this.m_out.Print(`(leader_length ${formatInternalUnits(dim.leaderLength)})`);

    if (ortho) this.m_out.Print(`(orientation ${dim.orientation})`);

    if (!center) {
      this.m_out.Print(
        `(format (prefix ${this.m_out.Quotew(dim.prefix)}) (suffix ${this.m_out.Quotew(dim.suffix)}) (units ${dim.unitsMode}) (units_format ${dim.unitsFormat}) (precision ${dim.precision})`,
      );
      if (dim.overrideTextEnabled)
        this.m_out.Print(`(override_value ${this.m_out.Quotew(dim.overrideText)})`);
      if (dim.suppressZeroes) FormatBool(this.m_out, 'suppress_zeroes', true);
      this.m_out.Print(')');
    }

    this.m_out.Print(
      `(style (thickness ${formatInternalUnits(dim.lineThickness)}) (arrow_length ${formatInternalUnits(dim.arrowLength)}) (text_position_mode ${dim.textPositionMode})`,
    );

    if (ortho || aligned) {
      switch (dim.arrowDirection) {
        case 'outward':
          this.m_out.Print('(arrow_direction outward)');
          break;
        case 'inward':
          this.m_out.Print('(arrow_direction inward)');
          break;
        // No default, handle all cases
      }
    }

    if (aligned) this.m_out.Print(`(extension_height ${formatInternalUnits(dim.extensionHeight)})`);

    if (leader) this.m_out.Print(`(text_frame ${dim.textBorder})`);

    this.m_out.Print(`(extension_offset ${formatInternalUnits(dim.extensionOffset)})`);

    if (dim.keepTextAligned) FormatBool(this.m_out, 'keep_text_aligned', true);

    this.m_out.Print(')');

    // Write dimension text after all other options to be sure the
    // text options are known when reading the file
    if (!center)
      this.formatText(
        { ...dim.text, layer: dim.layer, uuid: dim.uuid, locked: dim.locked },
        null,
        true,
      );

    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // PCB_REFERENCE_IMAGE (:1124), PCB_POINT (:1156), PCB_TARGET (:1170)
  // -------------------------------------------------------------------------

  /** `format( const PCB_REFERENCE_IMAGE* aBitmap )` (:1124). */
  formatReferenceImage(img: KPcbReferenceImage): void {
    this.m_out.Print(
      `(image (at ${formatInternalUnits(img.pos.x)} ${formatInternalUnits(img.pos.y)})`,
    );

    this.formatLayer(img.layer);

    if (img.scale !== 1.0) this.m_out.Print(`(scale ${formatG(img.scale, 6)})`);

    if (img.locked) FormatBool(this.m_out, 'locked', true);

    // `SaveImageData`: the original image bytes, as loaded.
    FormatStreamData(this.m_out, base64ToBytes(img.data));

    FormatUuid(this.m_out, img.uuid);
    this.m_out.Print(')'); // Closes image token.
  }

  /** `format( const PCB_POINT* aPoint )` (:1156). */
  formatPoint(point: KPcbPoint): void {
    this.m_out.Print(
      `(point (at ${formatInternalUnitsPt(point.pos)}) (size ${formatInternalUnits(point.size)})`,
    );

    this.formatLayer(point.layer);

    FormatUuid(this.m_out, point.uuid);
    this.m_out.Print(')');
  }

  /** `format( const PCB_TARGET* aTarget )` (:1170). */
  formatTarget(target: KPcbTarget): void {
    this.m_out.Print(
      `(target ${target.shape ? 'x' : 'plus'} (at ${formatInternalUnitsPt(target.pos)}) (size ${formatInternalUnits(target.size)})`,
    );

    if (target.width !== 0) this.m_out.Print(`(width ${formatInternalUnits(target.width)})`);

    this.formatLayer(target.layer);
    FormatUuid(this.m_out, target.uuid);
    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // FOOTPRINT (:1186)
  // -------------------------------------------------------------------------

  /** `format( const FOOTPRINT* aFootprint )` (:1186), with `m_ctl == CTL_FOR_BOARD`. */
  formatFootprint(fp: KFootprint): void {
    // CTL_OMIT_INITIAL_COMMENTS: none in a board.

    this.m_out.Print(`(footprint ${this.m_out.Quotes(fp.fpid)}`);

    // CTL_OMIT_FOOTPRINT_VERSION: no (version) (generator) in a board.

    if (fp.locked) FormatBool(this.m_out, 'locked', true);

    if (fp.placed) FormatBool(this.m_out, 'placed', true);

    this.formatLayer(fp.layer);

    FormatUuid(this.m_out, fp.uuid);

    this.m_out.Print(
      `(at ${formatInternalUnitsPt(fp.at)} ${fp.orientation === 0 ? '' : FormatAngle(fp.orientation)})`,
    );

    if (fp.libDescription !== '')
      this.m_out.Print(`(descr ${this.m_out.Quotew(fp.libDescription)})`);

    if (fp.keywords !== '') this.m_out.Print(`(tags ${this.m_out.Quotew(fp.keywords)})`);

    const parent: ParentFP = { at: fp.at, angle: fp.orientation };

    for (const field of fp.fields) {
      this.m_out.Print(
        `(property ${this.m_out.Quotew(fieldCanonicalName(field))} ${this.m_out.Quotew(field.text)}`,
      );
      this.formatText(field, parent, false, true);
      this.m_out.Print(')');
    }

    if (fp.componentClasses.length > 0) {
      this.m_out.Print('(component_classes');
      for (const name of fp.componentClasses)
        this.m_out.Print(`(class ${this.m_out.Quotew(name)})`);
      this.m_out.Print(')');
    }

    if (fp.filters !== '')
      this.m_out.Print(`(property ki_fp_filters ${this.m_out.Quotew(fp.filters)})`);

    if (fp.path !== '') this.m_out.Print(`(path ${this.m_out.Quotew(fp.path)})`);

    if (fp.sheetname !== '') this.m_out.Print(`(sheetname ${this.m_out.Quotew(fp.sheetname)})`);

    if (fp.sheetfile !== '') this.m_out.Print(`(sheetfile ${this.m_out.Quotew(fp.sheetfile)})`);

    // Emit unit info for gate swapping metadata (flat pin list form)
    if (fp.unitInfo.length > 0) {
      this.m_out.Print('(units');
      for (const u of fp.unitInfo) {
        this.m_out.Print(`(unit (name ${this.m_out.Quotew(u.unitName)})`);
        this.m_out.Print('(pins');
        for (const n of u.pins) this.m_out.Print(` ${this.m_out.Quotew(n)}`);
        this.m_out.Print(')'); // </pins>
        this.m_out.Print(')'); // </unit>
      }
      this.m_out.Print(')'); // </units>
    }

    if (fp.localSolderMaskMargin !== undefined)
      this.m_out.Print(`(solder_mask_margin ${formatInternalUnits(fp.localSolderMaskMargin)})`);

    if (fp.localSolderPasteMargin !== undefined)
      this.m_out.Print(`(solder_paste_margin ${formatInternalUnits(fp.localSolderPasteMargin)})`);

    if (fp.localSolderPasteMarginRatio !== undefined)
      this.m_out.Print(
        `(solder_paste_margin_ratio ${FormatDouble2Str(fp.localSolderPasteMarginRatio)})`,
      );

    if (fp.localClearance !== undefined)
      this.m_out.Print(`(clearance ${formatInternalUnits(fp.localClearance)})`);

    if (fp.localZoneConnection !== -1) this.m_out.Print(`(zone_connect ${fp.localZoneConnection})`);

    // Attributes
    if (fp.attributes || fp.allowMissingCourtyard || fp.allowSolderMaskBridges) {
      this.m_out.Print('(attr');

      if (fp.attributes & FP_SMD) this.m_out.Print(' smd');

      if (fp.attributes & FP_THROUGH_HOLE) this.m_out.Print(' through_hole');

      if (fp.attributes & FP_BOARD_ONLY) this.m_out.Print(' board_only');

      if (fp.attributes & FP_EXCLUDE_FROM_POS_FILES) this.m_out.Print(' exclude_from_pos_files');

      if (fp.attributes & FP_EXCLUDE_FROM_BOM) this.m_out.Print(' exclude_from_bom');

      if (fp.allowMissingCourtyard) this.m_out.Print(' allow_missing_courtyard');

      if (fp.attributes & FP_DNP) this.m_out.Print(' dnp');

      if (fp.allowSolderMaskBridges) this.m_out.Print(' allow_soldermask_bridges');

      this.m_out.Print(')');
    }

    // Expand inner layers is the default stackup mode
    if (fp.stackupMode !== 'expand_inner_layers') {
      this.m_out.Print('(stackup');
      for (const layer of fp.stackupLayers.Seq())
        this.m_out.Print(`(layer ${this.m_out.Quotew(LSET_Name(layer))})`);
      this.m_out.Print(')');
    }

    if (fp.privateLayers.any()) {
      this.m_out.Print('(private_layers');
      for (const layer of fp.privateLayers.Seq())
        this.m_out.Print(` ${this.m_out.Quotew(LSET_Name(layer))}`);
      this.m_out.Print(')');
    }

    // `IsNetTie()`: any non-empty group.
    if (fp.netTiePadGroups.some((g) => g !== '')) {
      this.m_out.Print('(net_tie_pad_groups');
      for (const group of fp.netTiePadGroups) this.m_out.Print(` ${this.m_out.Quotew(group)}`);
      this.m_out.Print(')');
    }

    FormatBool(this.m_out, 'duplicate_pad_numbers_are_jumpers', fp.duplicatePadNumbersAreJumpers);

    if (fp.jumperPadGroups.length > 0) {
      this.m_out.Print('(jumper_pad_groups');
      for (const group of fp.jumperPadGroups) {
        this.m_out.Print('(');
        // A `std::set<wxString>`: codepoint order.
        for (const padName of [...group].sort(cmpWxString))
          this.m_out.Print(`${this.m_out.Quotew(padName)} `);
        this.m_out.Print(')');
      }
      this.m_out.Print(')');
    }

    // Format( &Reference() ) and Format( &Value() ): PCB_FIELD_T is handled
    // above with the properties, so these print nothing.

    const sortedPads = stdSet(fp.pads, cmpPads);
    const sortedDrawings = stdSet(fp.graphicalItems, (a, b, ia, ib) =>
      cmpFpDrawings(a, b, ia, ib, parent),
    );
    const sortedPoints = stdSet(fp.points, cmpPoints);
    const sortedZones = stdSet(fp.zones, cmpZones);
    const layerSets = footprintChildLayerSets(fp);
    const sortedGroups = stdSet(fp.groups, (a, b, ia, ib) => ptrCmpGroup(a, b, ia, ib, layerSets));

    // Save drawing elements.
    for (const gr of sortedDrawings) this.formatFpGraphicalItem(gr, parent);

    for (const point of sortedPoints) this.formatPoint(point);

    // Save pads.
    for (const pad of sortedPads) this.formatPad(pad);

    // Save zones.
    for (const zone of sortedZones) this.formatZone(zone);

    // Save groups.
    for (const group of sortedGroups) this.formatGroup(group);

    // Save variants.
    const baseDnp = (fp.attributes & FP_DNP) !== 0;
    const baseExcludedFromBOM = (fp.attributes & FP_EXCLUDE_FROM_BOM) !== 0;
    const baseExcludedFromPosFiles = (fp.attributes & FP_EXCLUDE_FROM_POS_FILES) !== 0;

    // `GetVariants()`: a `std::map` by name.
    for (const variant of [...fp.variants].sort((a, b) => cmpWxString(a.name, b.name))) {
      this.m_out.Print(`(variant (name ${this.m_out.Quotew(variant.name)})`);

      const dnp = variant.dnp ?? baseDnp;
      if (dnp !== baseDnp) FormatBool(this.m_out, 'dnp', dnp);

      const exBom = variant.excludedFromBOM ?? baseExcludedFromBOM;
      if (exBom !== baseExcludedFromBOM) FormatBool(this.m_out, 'exclude_from_bom', exBom);

      const exPos = variant.excludedFromPosFiles ?? baseExcludedFromPosFiles;
      if (exPos !== baseExcludedFromPosFiles)
        FormatBool(this.m_out, 'exclude_from_pos_files', exPos);

      for (const [fieldName, fieldValue] of [...variant.fields.entries()].sort(([a], [b]) =>
        cmpWxString(a, b),
      )) {
        const baseField = fp.fields.find(
          (f) => fieldCanonicalName(f) === fieldName || f.name === fieldName,
        );
        const baseValue = baseField ? baseField.text : '';

        if (fieldValue === baseValue) continue;

        this.m_out.Print(
          `(field (name ${this.m_out.Quotew(fieldName)}) (value ${this.m_out.Quotew(fieldValue)}))`,
        );
      }

      this.m_out.Print(')');
    }

    FormatBool(this.m_out, 'embedded_fonts', fp.embeddedFiles.areFontsEmbedded);

    if (fp.embeddedFiles.files.size > 0)
      writeEmbeddedFiles(this.m_out, fp.embeddedFiles, false /* CTL_FOR_BOARD */);

    // Save 3D info.
    for (const m of fp.models) {
      if (m.filename === '') continue;

      this.m_out.Print(`(model ${this.m_out.Quotew(m.filename)}`);

      if (!m.show) FormatBool(this.m_out, 'hide', !m.show);

      if (m.opacity !== 1.0) this.m_out.Print(`(opacity ${formatF(m.opacity, 4)})`);

      this.m_out.Print(
        `(offset (xyz ${FormatDouble2Str(m.offset.x)} ${FormatDouble2Str(m.offset.y)} ${FormatDouble2Str(m.offset.z)}))`,
      );

      this.m_out.Print(
        `(scale (xyz ${FormatDouble2Str(m.scale.x)} ${FormatDouble2Str(m.scale.y)} ${FormatDouble2Str(m.scale.z)}))`,
      );

      this.m_out.Print(
        `(rotate (xyz ${FormatDouble2Str(m.rotation.x)} ${FormatDouble2Str(m.rotation.y)} ${FormatDouble2Str(m.rotation.z)}))`,
      );

      this.m_out.Print(')');
    }

    this.m_out.Print(')');
  }

  /** `Format( aItem )` (:371) for a footprint's graphical item. */
  formatFpGraphicalItem(gr: KFpGraphicalItem, parent: ParentFP | null): void {
    switch (gr.kind) {
      case 'shape':
        this.formatShape(gr.item, parent);
        break;
      case 'text':
        this.formatText(gr.item, parent);
        break;
      case 'textbox':
        this.formatTextBox(gr.item, parent, false);
        break;
      case 'table':
        this.formatTable(gr.item, parent);
        break;
      case 'image':
        this.formatReferenceImage(gr.item);
        break;
      case 'barcode':
        this.formatBarcode(gr.item);
        break;
      case 'dimension':
        this.formatDimension(gr.item);
        break;
    }
  }

  // -------------------------------------------------------------------------
  // PAD (:1634)
  // -------------------------------------------------------------------------

  /** `format( const PAD* aPad )` (:1634). */
  formatPad(pad: KPad): void {
    const ps = pad.padstack;
    const board = this.m_board;

    const shapeOf = (layer: number): PadShape => copperLayerPropsConst(ps, layer).shape.shape;
    const shapeName = (layer: number): string => {
      switch (shapeOf(layer)) {
        case 'circle':
          return 'circle';
        case 'rectangle':
          return 'rect';
        case 'oval':
          return 'oval';
        case 'trapezoid':
          return 'trapezoid';
        case 'chamfered_rect':
        case 'roundrect':
          return 'roundrect';
        case 'custom':
          return 'custom';
      }
    };

    let type: string;
    switch (pad.attribute) {
      case 'pth':
        type = 'thru_hole';
        break;
      case 'smd':
        type = 'smd';
        break;
      case 'conn':
        type = 'connect';
        break;
      case 'npth':
        type = 'np_thru_hole';
        break;
    }

    let property: string | null = null;
    switch (pad.property) {
      case 'none':
        break; // could be "none"
      case 'bga':
        property = 'pad_prop_bga';
        break;
      case 'fiducial_glbl':
        property = 'pad_prop_fiducial_glob';
        break;
      case 'fiducial_local':
        property = 'pad_prop_fiducial_loc';
        break;
      case 'testpoint':
        property = 'pad_prop_testpoint';
        break;
      case 'heatsink':
        property = 'pad_prop_heatsink';
        break;
      case 'castellated':
        property = 'pad_prop_castellated';
        break;
      case 'mechanical':
        property = 'pad_prop_mechanical';
        break;
      case 'pressfit':
        property = 'pad_prop_pressfit';
        break;
    }

    this.m_out.Print(
      `(pad ${this.m_out.Quotew(pad.number)} ${type} ${shapeName(PADSTACK_ALL_LAYERS)}`,
    );

    this.m_out.Print(
      `(at ${formatInternalUnitsPt(pad.at)} ${pad.orientation === 0 ? '' : FormatAngle(pad.orientation)})`,
    );

    const sizeOf = (layer: number): Vec2 => copperLayerPropsConst(ps, layer).shape.size;
    const deltaOf = (layer: number): Vec2 =>
      copperLayerPropsConst(ps, layer).shape.trapezoidDeltaSize;
    const offsetOf = (layer: number): Vec2 => copperLayerPropsConst(ps, layer).shape.offset;

    this.m_out.Print(`(size ${formatInternalUnitsPt(sizeOf(PADSTACK_ALL_LAYERS))})`);

    if (deltaOf(PADSTACK_ALL_LAYERS).x !== 0 || deltaOf(PADSTACK_ALL_LAYERS).y !== 0)
      this.m_out.Print(`(rect_delta ${formatInternalUnitsPt(deltaOf(PADSTACK_ALL_LAYERS))})`);

    const drill = ps.drill.size;
    let shapeoffset = offsetOf(PADSTACK_ALL_LAYERS);
    let forceShapeOffsetOutput = false;

    for (const layer of uniquePadstackLayers(ps)) {
      const o = offsetOf(layer);
      if (o.x !== shapeoffset.x || o.y !== shapeoffset.y) forceShapeOffsetOutput = true;
    }

    if (
      drill.x > 0 ||
      drill.y > 0 ||
      shapeoffset.x !== 0 ||
      shapeoffset.y !== 0 ||
      forceShapeOffsetOutput
    ) {
      this.m_out.Print('(drill');

      if (ps.drill.shape === 'oblong') this.m_out.Print(' oval');

      if (drill.x > 0) this.m_out.Print(` ${formatInternalUnits(drill.x)}`);

      if (drill.y > 0 && drill.x !== drill.y) this.m_out.Print(` ${formatInternalUnits(drill.y)}`);

      // NOTE: Shape offest is a property of the copper shape, not of the drill, but this was put
      // in the file format under the drill section.  So, it is left here to minimize file format
      // changes, but note that the other padstack layers (if present) will have an offset stored
      // separately.
      if (shapeoffset.x !== 0 || shapeoffset.y !== 0 || forceShapeOffsetOutput)
        this.m_out.Print(`(offset ${formatInternalUnitsPt(offsetOf(PADSTACK_ALL_LAYERS))})`);

      this.m_out.Print(')');
    }

    if (ps.secondaryDrill.size.x > 0) {
      this.m_out.Print(
        `(backdrill (size ${formatInternalUnits(ps.secondaryDrill.size.x)}) (layers ${this.m_out.Quotew(LSET_Name(ps.secondaryDrill.start))} ${this.m_out.Quotew(LSET_Name(ps.secondaryDrill.end))}))`,
      );
    }

    if (ps.tertiaryDrill.size.x > 0) {
      this.m_out.Print(
        `(tertiary_drill (size ${formatInternalUnits(ps.tertiaryDrill.size.x)}) (layers ${this.m_out.Quotew(LSET_Name(ps.tertiaryDrill.start))} ${this.m_out.Quotew(LSET_Name(ps.tertiaryDrill.end))}))`,
      );
    }

    this.formatPostMachining('front_post_machining', ps.frontPostMachining);
    this.formatPostMachining('back_post_machining', ps.backPostMachining);

    // Add pad property, if exists.
    if (property) this.m_out.Print(`(property ${property})`);

    this.formatLayers(ps.layerSet, false /* enumerate layers */);

    if (pad.attribute === 'pth') {
      // `GetRemoveUnconnected()`: any mode but KEEP_ALL.
      const removeUnconnected = ps.unconnectedLayerMode !== 'keep_all';
      FormatBool(this.m_out, 'remove_unused_layers', removeUnconnected);

      if (removeUnconnected) {
        // `GetKeepTopBottom()`: REMOVE_EXCEPT_START_AND_END only.
        FormatBool(
          this.m_out,
          'keep_end_layers',
          ps.unconnectedLayerMode === 'remove_except_start_and_end',
        );

        if (board) {
          // Will be nullptr in footprint library
          this.m_out.Print('(zone_layer_connections');
          for (const layer of board.enabledLayers.CuStack()) {
            if (pad.zoneLayerForceFlashed.has(layer))
              this.m_out.Print(` ${this.m_out.Quotew(LSET_Name(layer))}`);
          }
          this.m_out.Print(')');
        }
      }
    }

    const formatCornerProperties = (layer: number): void => {
      const s = copperLayerPropsConst(ps, layer).shape;
      // Output the radius ratio for rounded and chamfered rect pads
      if (s.shape === 'roundrect' || s.shape === 'chamfered_rect')
        this.m_out.Print(`(roundrect_rratio ${FormatDouble2Str(s.roundRectRadiusRatio)})`);

      // Output the chamfer corners for chamfered rect pads
      if (s.shape === 'chamfered_rect') {
        this.m_out.Print(`(chamfer_ratio ${FormatDouble2Str(s.chamferedRectRatio)})`);

        this.m_out.Print('(chamfer');

        if (s.chamferedRectPositions & RECT_CHAMFER_TOP_LEFT) this.m_out.Print(' top_left');

        if (s.chamferedRectPositions & RECT_CHAMFER_TOP_RIGHT) this.m_out.Print(' top_right');

        if (s.chamferedRectPositions & RECT_CHAMFER_BOTTOM_LEFT) this.m_out.Print(' bottom_left');

        if (s.chamferedRectPositions & RECT_CHAMFER_BOTTOM_RIGHT) this.m_out.Print(' bottom_right');

        this.m_out.Print(')');
      }
    };

    // For normal padstacks, this is the one and only set of properties.  For complex ones, this
    // will represent the front layer properties, and other layers will be formatted below
    formatCornerProperties(PADSTACK_ALL_LAYERS);

    // Unconnected pad is default net so don't save it.
    const net = this.netName(pad.net);
    if (net.code > 0) this.m_out.Print(`(net ${this.m_out.Quotew(net.name)})`);

    // Pin functions and types are closely related to nets, so if CTL_OMIT_NETS is set, omit
    // them as well (for instance when saved from library editor).
    if (pad.pinFunction !== '')
      this.m_out.Print(`(pinfunction ${this.m_out.Quotew(pad.pinFunction)})`);

    if (pad.pinType !== '') this.m_out.Print(`(pintype ${this.m_out.Quotew(pad.pinType)})`);

    if (pad.padToDieLength !== 0)
      this.m_out.Print(`(die_length ${formatInternalUnits(pad.padToDieLength)})`);

    if (pad.padToDieDelay !== 0)
      this.m_out.Print(`(die_delay ${formatInternalUnits(pad.padToDieDelay, 'time')})`);

    // The pad-level locals: `m_padStack.SolderMaskMargin()` etc. read F_Cu / the front.
    const front = ps.frontOuterLayers;
    const fcu = copperLayerPropsConst(ps, F_Cu);

    if (front.solderMaskMargin !== undefined)
      this.m_out.Print(`(solder_mask_margin ${formatInternalUnits(front.solderMaskMargin)})`);

    if (front.solderPasteMargin !== undefined)
      this.m_out.Print(`(solder_paste_margin ${formatInternalUnits(front.solderPasteMargin)})`);

    if (front.solderPasteMarginRatio !== undefined)
      this.m_out.Print(
        `(solder_paste_margin_ratio ${FormatDouble2Str(front.solderPasteMarginRatio)})`,
      );

    if (fcu.clearance !== undefined)
      this.m_out.Print(`(clearance ${formatInternalUnits(fcu.clearance)})`);

    // `GetLocalZoneConnection()`: `value_or( INHERITED )`, INHERITED being -1.
    if ((fcu.zoneConnection ?? -1) !== -1) this.m_out.Print(`(zone_connect ${fcu.zoneConnection})`);

    if (fcu.thermalSpokeWidth !== undefined)
      this.m_out.Print(`(thermal_bridge_width ${formatInternalUnits(fcu.thermalSpokeWidth)})`);

    let defaultThermalSpokeAngle = 90;

    const allShape = copperLayerPropsConst(ps, PADSTACK_ALL_LAYERS).shape;
    if (
      allShape.shape === 'circle' ||
      (allShape.shape === 'custom' && allShape.anchorShape === 'circle')
    )
      defaultThermalSpokeAngle = 45;

    if (padstackThermalSpokeAngle(ps, F_Cu) !== defaultThermalSpokeAngle)
      this.m_out.Print(
        `(thermal_bridge_angle ${FormatAngle(padstackThermalSpokeAngle(ps, F_Cu))})`,
      );

    if (fcu.thermalGap !== undefined)
      this.m_out.Print(`(thermal_gap ${formatInternalUnits(fcu.thermalGap)})`);

    const anchorShape = (layer: number): string =>
      copperLayerPropsConst(ps, layer).shape.anchorShape === 'rectangle' ? 'rect' : 'circle';

    const formatPrimitives = (layer: number): void => {
      this.m_out.Print('(primitives');

      // Output all basic shapes
      for (const primitive of copperLayerPropsConst(ps, layer).customShapes) {
        const pt = formatInternalUnitsPt;
        switch (primitive.shape) {
          case 'segment':
            if (primitive.proxy)
              this.m_out.Print(
                `(gr_vector (start ${pt(primitive.start)}) (end ${pt(primitive.end)})`,
              );
            else
              this.m_out.Print(
                `(gr_line (start ${pt(primitive.start)}) (end ${pt(primitive.end)})`,
              );
            break;

          case 'rectangle':
            if (primitive.proxy) {
              this.m_out.Print(
                `(gr_bbox (start ${pt(primitive.start)}) (end ${pt(primitive.end)})`,
              );
            } else {
              this.m_out.Print(
                `(gr_rect (start ${pt(primitive.start)}) (end ${pt(primitive.end)})`,
              );

              if (primitive.cornerRadius > 0)
                this.m_out.Print(` (radius ${formatInternalUnits(primitive.cornerRadius)})`);
            }
            break;

          case 'arc':
            this.m_out.Print(
              `(gr_arc (start ${pt(primitive.start)}) (mid ${pt(primitive.arcMid!)}) (end ${pt(primitive.end)})`,
            );
            break;

          case 'circle':
            this.m_out.Print(
              `(gr_circle (center ${pt(primitive.start)}) (end ${pt(primitive.end)})`,
            );
            break;

          case 'bezier':
            this.m_out.Print(
              `(gr_curve (pts (xy ${pt(primitive.start)}) (xy ${pt(primitive.bezierC1!)}) (xy ${pt(primitive.bezierC2!)}) (xy ${pt(primitive.end)}))`,
            );
            break;

          case 'poly':
            if ((primitive.outline?.length ?? 0) >= 3) {
              this.m_out.Print('(gr_poly');
              this.formatPolyPts(primitive.outline!);
            }
            break;
        }

        if (!primitive.proxy)
          this.m_out.Print(`(width ${formatInternalUnits(primitive.stroke.width)})`);

        // The filled flag represents if a solid fill is present on circles,
        // rectangles and polygons
        if (
          primitive.shape === 'poly' ||
          primitive.shape === 'rectangle' ||
          primitive.shape === 'circle'
        )
          FormatBool(this.m_out, 'fill', primitive.fill === 'filled_shape');

        this.m_out.Print(')');
      }

      this.m_out.Print(')'); // end of (primitives
    };

    if (shapeOf(PADSTACK_ALL_LAYERS) === 'custom') {
      this.m_out.Print('(options');

      if (ps.customShapeInZoneMode === 'convexhull') this.m_out.Print('(clearance convexhull)');
      else this.m_out.Print('(clearance outline)');

      // Output the anchor pad shape (circle/rect)
      this.m_out.Print(`(anchor ${anchorShape(PADSTACK_ALL_LAYERS)})`);

      this.m_out.Print(')'); // end of (options ...

      // Output graphic primitive of the pad shape
      formatPrimitives(PADSTACK_ALL_LAYERS);
    }

    if (!isDefaultTeardropParameters(pad.teardrops)) this.formatTeardropParameters(pad.teardrops);

    if (
      ps.frontOuterLayers.hasSolderMask !== undefined ||
      ps.backOuterLayers.hasSolderMask !== undefined
    ) {
      this.m_out.Print(0, ' (tenting ');
      FormatOptBool(this.m_out, 'front', ps.frontOuterLayers.hasSolderMask);
      FormatOptBool(this.m_out, 'back', ps.backOuterLayers.hasSolderMask);
      this.m_out.Print(0, ')');
    }

    FormatUuid(this.m_out, pad.uuid);

    const formatPadLayer = (layer: number): void => {
      const props = copperLayerPropsConst(ps, layer);

      this.m_out.Print(`(shape ${shapeName(layer)})`);
      this.m_out.Print(`(size ${formatInternalUnitsPt(sizeOf(layer))})`);

      const delta = deltaOf(layer);

      if (delta.x !== 0 || delta.y !== 0)
        this.m_out.Print(`(rect_delta ${formatInternalUnitsPt(delta)})`);

      shapeoffset = offsetOf(layer);

      if (shapeoffset.x !== 0 || shapeoffset.y !== 0)
        this.m_out.Print(`(offset ${formatInternalUnitsPt(shapeoffset)})`);

      formatCornerProperties(layer);

      if (shapeOf(layer) === 'custom') {
        this.m_out.Print('(options');

        // Output the anchor pad shape (circle/rect)
        this.m_out.Print(`(anchor ${anchorShape(layer)})`);

        this.m_out.Print(')'); // end of (options ...

        // Output graphic primitive of the pad shape
        formatPrimitives(layer);
      }

      let defaultLayerAngle = 90;

      if (
        shapeOf(layer) === 'circle' ||
        (shapeOf(layer) === 'custom' && props.shape.anchorShape === 'circle')
      )
        defaultLayerAngle = 45;

      const layerSpokeAngle = padstackThermalSpokeAngle(ps, layer);

      if (layerSpokeAngle !== defaultLayerAngle)
        this.m_out.Print(`(thermal_bridge_angle ${FormatAngle(layerSpokeAngle)})`);

      if (props.thermalGap !== undefined)
        this.m_out.Print(`(thermal_gap ${formatInternalUnits(props.thermalGap)})`);

      if (props.thermalSpokeWidth !== undefined)
        this.m_out.Print(`(thermal_bridge_width ${formatInternalUnits(props.thermalSpokeWidth)})`);

      if (props.clearance !== undefined)
        this.m_out.Print(`(clearance ${formatInternalUnits(props.clearance)})`);

      if (props.zoneConnection !== undefined)
        this.m_out.Print(`(zone_connect ${props.zoneConnection})`);
    };

    if (ps.mode !== 'normal') {
      if (ps.mode === 'front_inner_back') {
        this.m_out.Print('(padstack (mode front_inner_back)');

        this.m_out.Print('(layer "Inner"');
        formatPadLayer(PADSTACK_INNER_LAYERS);
        this.m_out.Print(')');
        this.m_out.Print('(layer "B.Cu"');
        formatPadLayer(B_Cu);
        this.m_out.Print(')');
      } else {
        this.m_out.Print('(padstack (mode custom)');

        const layerCount = board ? board.copperLayerCount : MAX_CU_LAYERS;

        for (const layer of LAYER_RANGE(F_Cu, B_Cu, layerCount)) {
          if (layer === F_Cu) continue;

          this.m_out.Print(`(layer ${this.m_out.Quotew(LSET_Name(layer))}`);
          formatPadLayer(layer);
          this.m_out.Print(')');
        }
      }

      this.m_out.Print(')');
    }

    this.m_out.Print(')');
  }

  /** The `formatPostMachining` lambda of `format( PAD )` and `format( PCB_TRACK )`. */
  formatPostMachining(name: string, props: PostMachiningProps): void {
    if (props.mode === undefined || props.mode === 'not_post_machined') return;

    this.m_out.Print(`(${name} ${props.mode === 'counterbore' ? 'counterbore' : 'countersink'}`);

    if (props.size > 0) this.m_out.Print(` (size ${formatInternalUnits(props.size)})`);

    if (props.depth > 0) this.m_out.Print(` (depth ${formatInternalUnits(props.depth)})`);

    if (props.angle > 0) this.m_out.Print(` (angle ${FormatDouble2Str(props.angle / 10.0)})`);

    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // PCB_BARCODE (:2198), PCB_TEXT (:2264), PCB_TEXTBOX (:2328), PCB_TABLE (:2400)
  // -------------------------------------------------------------------------

  /** `format( const PCB_BARCODE* aBarcode )` (:2198). */
  formatBarcode(bc: KPcbBarcode): void {
    this.m_out.Print('(barcode');

    if (bc.locked) FormatBool(this.m_out, 'locked', true);

    this.m_out.Print(`(at ${formatInternalUnitsPt(bc.pos)} ${FormatAngle(bc.angle)})`);

    this.formatLayer(bc.layer);

    this.m_out.Print(`(size ${formatInternalUnits(bc.width)} ${formatInternalUnits(bc.height)})`);

    this.m_out.Print(`(text ${this.m_out.Quotew(bc.text)})`);

    this.m_out.Print(`(text_height ${formatInternalUnits(bc.textHeight)})`);

    this.m_out.Print(`(type ${bc.kind})`);

    if (bc.kind === 'qr' || bc.kind === 'microqr') this.m_out.Print(`(ecc_level ${bc.ecc})`);

    FormatBool(this.m_out, 'hide', !bc.showText);
    FormatBool(this.m_out, 'knockout', bc.knockout);

    if (bc.margin.x !== 0 || bc.margin.y !== 0)
      this.m_out.Print(
        `(margins ${formatInternalUnits(bc.margin.x)} ${formatInternalUnits(bc.margin.y)})`,
      );

    FormatUuid(this.m_out, bc.uuid);

    this.m_out.Print(')');
  }

  /**
   * `format( const PCB_TEXT* aText )` (:2264). `isDimension` forces the
   * `gr_text` form; `isField` is the `PCB_FIELD` branch, which prints only
   * the body inside the footprint's `(property …)`.
   */
  formatText(
    text: KPcbText,
    parentFP: ParentFP | null,
    isDimension = false,
    isField = false,
  ): void {
    // Always format dimension text as gr_text
    if (isDimension) parentFP = null;

    const prefix = parentFP ? 'fp' : 'gr';
    const type = parentFP ? 'user' : '';

    // The model holds the footprint-relative position already.
    const pos = text.pos;

    if (!isField) {
      this.m_out.Print(`(${prefix}_text ${type} ${this.m_out.Quotew(text.text)}`);

      if (text.locked) FormatBool(this.m_out, 'locked', true);
    }

    this.m_out.Print(`(at ${formatInternalUnitsPt(pos)} ${FormatAngle(text.angle)})`);

    if (parentFP && !text.keepUpright) FormatBool(this.m_out, 'unlocked', true);

    this.formatLayer(text.layer, text.knockout);

    if (isField && !text.visible) FormatBool(this.m_out, 'hide', true);

    FormatUuid(this.m_out, text.uuid);

    // Currently, texts have no specific color and no hyperlink.
    // so ensure they are never written in kicad_pcb file
    formatEdaText(this.m_out, text, CTL_OMIT_COLOR | CTL_OMIT_HYPERLINK);

    if (text.renderCache) this.formatRenderCache(text);

    if (!isField) this.m_out.Print(')');
  }

  /** `format( const PCB_TEXTBOX* aTextBox )` (:2328); `isCell` for a `PCB_TABLECELL`. */
  formatTextBox(tb: KPcbTextBox, parentFP: ParentFP | null, isCell: boolean): void {
    this.m_out.Print(
      `(${isCell ? 'table_cell' : parentFP ? 'fp_text_box' : 'gr_text_box'} ${this.m_out.Quotew(tb.text)}`,
    );

    if (tb.locked) FormatBool(this.m_out, 'locked', true);

    if (tb.shape === 'rectangle') {
      this.m_out.Print(
        `(start ${formatInternalUnitsPt(tb.start)}) (end ${formatInternalUnitsPt(tb.end)})`,
      );
    } else {
      this.formatPolyPts(tb.outline ?? []);
    }

    this.m_out.Print(
      `(margins ${formatInternalUnits(tb.marginLeft)} ${formatInternalUnits(tb.marginTop)} ${formatInternalUnits(tb.marginRight)} ${formatInternalUnits(tb.marginBottom)})`,
    );

    if (isCell) {
      const cell = tb as KPcbTableCell;
      this.m_out.Print(`(span ${cell.colSpan} ${cell.rowSpan})`);
    }

    // The model keeps the footprint-relative angle (`Normalize720`ed on read).
    const angle = tb.angle;

    if (angle !== 0) this.m_out.Print(`(angle ${FormatAngle(angle)})`);

    this.formatLayer(tb.layer);

    FormatUuid(this.m_out, tb.uuid);

    formatEdaText(this.m_out, tb, 0);

    if (!isCell) {
      FormatBool(this.m_out, 'border', tb.borderEnabled);
      this.formatStroke(tb.stroke);

      FormatBool(this.m_out, 'knockout', tb.knockout);
    }

    if (tb.renderCache) this.formatRenderCache(tb);

    this.m_out.Print(')');
  }

  /** `format( const PCB_TABLE* aTable )` (:2400). */
  formatTable(table: KPcbTable, parentFP: ParentFP | null): void {
    this.m_out.Print(`(table (column_count ${table.colCount})`);

    FormatUuid(this.m_out, table.uuid);

    if (table.locked) FormatBool(this.m_out, 'locked', true);

    this.formatLayer(table.layer);

    this.m_out.Print('(border');
    FormatBool(this.m_out, 'external', table.strokeExternal);
    FormatBool(this.m_out, 'header', table.strokeHeaderSeparator);

    if (table.strokeExternal || table.strokeHeaderSeparator) this.formatStroke(table.borderStroke);

    this.m_out.Print(')'); // Close `border` token.

    this.m_out.Print('(separators');
    FormatBool(this.m_out, 'rows', table.strokeRows);
    FormatBool(this.m_out, 'cols', table.strokeColumns);

    if (table.strokeRows || table.strokeColumns) this.formatStroke(table.separatorsStroke);

    this.m_out.Print(')'); // Close `separators` token.

    this.m_out.Print('(column_widths');

    for (let col = 0; col < table.colCount; ++col)
      this.m_out.Print(` ${formatInternalUnits(table.colWidths[col] ?? 0)}`);

    this.m_out.Print(')');

    this.m_out.Print('(row_heights');

    const rowCount = tableRowCount(table);
    for (let row = 0; row < rowCount; ++row)
      this.m_out.Print(` ${formatInternalUnits(table.rowHeights[row] ?? 0)}`);

    this.m_out.Print(')');

    this.m_out.Print('(cells');

    for (const cell of table.cells) this.formatTextBox(cell, parentFP, true);

    this.m_out.Print(')'); // Close `cells` token.
    this.m_out.Print(')'); // Close `table` token.
  }

  // -------------------------------------------------------------------------
  // PCB_GROUP (:2455), PCB_GENERATOR (:2509)
  // -------------------------------------------------------------------------

  /** The resolved member uuids of a group, `memberIds.Sort()`ed. */
  private groupMemberIds(group: KPcbGroup): string[] {
    const ids = this.m_groupMembers?.get(group.uuid) ?? group.memberUuids;
    return [...ids].sort(cmpWxString);
  }

  /** `format( const PCB_GROUP* aGroup )` (:2455). */
  formatGroup(group: KPcbGroup): void {
    const memberIds = this.groupMemberIds(group);

    if (memberIds.length === 0) return;

    this.m_out.Print(`(group ${this.m_out.Quotew(group.name)}`);

    FormatUuid(this.m_out, group.uuid);

    if (group.locked) FormatBool(this.m_out, 'locked', true);

    if (libIdIsValid(group.libId)) this.m_out.Print(`(lib_id "${group.libId}")`);

    this.m_out.Print('(members');

    for (const memberId of memberIds) this.m_out.Print(` ${this.m_out.Quotew(memberId)}`);

    this.m_out.Print(')'); // Close `members` token.
    this.m_out.Print(')'); // Close `group` token.
  }

  /** `format( const PCB_GENERATOR* aGenerator )` (:2509). */
  formatGenerator(gen: KPcbGenerator): void {
    const memberIds = this.groupMemberIds(gen);

    // Some conditions appear to still be creating ghost tuning patterns.  Don't save them.
    if (gen.generatorType === 'tuning_pattern' && memberIds.length === 0) return;

    this.m_out.Print('(generated');

    FormatUuid(this.m_out, gen.uuid);

    this.m_out.Print(
      `(type ${gen.generatorType}) (name ${this.m_out.Quotew(gen.name)}) (layer ${this.m_out.Quotew(LSET_Name(gen.layer))})`,
    );

    if (gen.locked) FormatBool(this.m_out, 'locked', true);

    for (const { key, value } of gen.properties) {
      switch (value.kind) {
        case 'number':
          // Don't quote numbers
          this.m_out.Print(`(${key} ${formatG(value.value, 10)})`);
          break;
        case 'bool':
          FormatBool(this.m_out, key, value.value);
          break;
        case 'xy':
          this.m_out.Print(`(${key} (xy ${formatInternalUnitsPt(value.value)}))`);
          break;
        case 'pts':
          this.m_out.Print(`(${key} `);
          this.formatPolyPts(value.value);
          this.m_out.Print(')');
          break;
        case 'string':
          this.m_out.Print(`(${key} ${this.m_out.Quotew(value.value)})`);
          break;
      }
    }

    this.m_out.Print('(members');

    for (const memberId of memberIds) this.m_out.Print(` ${this.m_out.Quotew(memberId)}`);

    this.m_out.Print(')'); // Close `members` token.
    this.m_out.Print(')'); // Close `generated` token.
  }

  // -------------------------------------------------------------------------
  // PCB_TRACK / PCB_ARC / PCB_VIA (:2607)
  // -------------------------------------------------------------------------

  /** `format( const PCB_TRACK* aTrack )` (:2607) for a via. */
  formatVia(via: KPcbVia): void {
    const board = this.m_board;
    const ps = via.padstack;

    this.m_out.Print('(via');

    const layer1 = via.layer1;
    const layer2 = via.layer2;

    switch (via.viaType) {
      case 'through': //  Default shape not saved.
        break;
      case 'blind':
        this.m_out.Print(' blind ');
        break;
      case 'buried':
        this.m_out.Print(' buried ');
        break;
      case 'micro':
        this.m_out.Print(' micro ');
        break;
    }

    this.m_out.Print(
      `(at ${formatInternalUnitsPt(via.at)}) (size ${formatInternalUnits(copperLayerPropsConst(ps, F_Cu).shape.size.x)})`,
    );

    // Old boards were using UNDEFINED_DRILL_DIAMETER value in file for via drill when
    // via drill was the netclass value.
    // recent boards always set the via drill to the actual value, but now we need to
    // always store the drill value, because netclass value is not stored in the board file.
    // Otherwise the drill value of some (old) vias can be unknown
    if (via.drill !== UNDEFINED_DRILL_DIAMETER)
      this.m_out.Print(`(drill ${formatInternalUnits(via.drill)})`);
    else this.m_out.Print(`(drill ${formatInternalUnits(viaDrillValue(via))})`);

    if (ps.secondaryDrill.size.x > 0) {
      this.m_out.Print(
        `(backdrill (size ${formatInternalUnits(ps.secondaryDrill.size.x)}) (layers ${this.m_out.Quotew(LSET_Name(ps.secondaryDrill.start))} ${this.m_out.Quotew(LSET_Name(ps.secondaryDrill.end))}))`,
      );
    }

    if (ps.tertiaryDrill.size.x > 0) {
      this.m_out.Print(
        `(tertiary_drill (size ${formatInternalUnits(ps.tertiaryDrill.size.x)}) (layers ${this.m_out.Quotew(LSET_Name(ps.tertiaryDrill.start))} ${this.m_out.Quotew(LSET_Name(ps.tertiaryDrill.end))}))`,
      );
    }

    this.formatPostMachining('front_post_machining', ps.frontPostMachining);
    this.formatPostMachining('back_post_machining', ps.backPostMachining);

    this.m_out.Print(
      `(layers ${this.m_out.Quotew(LSET_Name(layer1))} ${this.m_out.Quotew(LSET_Name(layer2))})`,
    );

    switch (ps.unconnectedLayerMode) {
      case 'remove_all':
        FormatBool(this.m_out, 'remove_unused_layers', true);
        FormatBool(this.m_out, 'keep_end_layers', false);
        break;
      case 'remove_except_start_and_end':
        FormatBool(this.m_out, 'remove_unused_layers', true);
        FormatBool(this.m_out, 'keep_end_layers', true);
        break;
      case 'start_end_only':
        FormatBool(this.m_out, 'start_end_only', true);
        break;
      case 'keep_all':
        break;
    }

    if (via.locked) FormatBool(this.m_out, 'locked', true);

    if (via.isFree) FormatBool(this.m_out, 'free', true);

    // `GetRemoveUnconnected()`: any mode but KEEP_ALL.
    if (ps.unconnectedLayerMode !== 'keep_all') {
      this.m_out.Print('(zone_layer_connections');

      for (const layer of board.enabledLayers.CuStack()) {
        if (via.zoneLayerForceFlashed.has(layer))
          this.m_out.Print(` ${this.m_out.Quotew(LSET_Name(layer))}`);
      }

      this.m_out.Print(')');
    }

    if (
      ps.frontOuterLayers.hasSolderMask !== undefined ||
      ps.backOuterLayers.hasSolderMask !== undefined
    ) {
      this.m_out.Print(0, ' (tenting ');
      FormatOptBool(this.m_out, 'front', ps.frontOuterLayers.hasSolderMask);
      FormatOptBool(this.m_out, 'back', ps.backOuterLayers.hasSolderMask);
      this.m_out.Print(0, ')');
    }

    if (ps.drill.isCapped !== undefined) FormatOptBool(this.m_out, 'capping', ps.drill.isCapped);

    if (
      ps.frontOuterLayers.hasCovering !== undefined ||
      ps.backOuterLayers.hasCovering !== undefined
    ) {
      this.m_out.Print(0, ' (covering ');
      FormatOptBool(this.m_out, 'front', ps.frontOuterLayers.hasCovering);
      FormatOptBool(this.m_out, 'back', ps.backOuterLayers.hasCovering);
      this.m_out.Print(0, ')');
    }

    if (
      ps.frontOuterLayers.hasPlugging !== undefined ||
      ps.backOuterLayers.hasPlugging !== undefined
    ) {
      this.m_out.Print(0, ' (plugging ');
      FormatOptBool(this.m_out, 'front', ps.frontOuterLayers.hasPlugging);
      FormatOptBool(this.m_out, 'back', ps.backOuterLayers.hasPlugging);
      this.m_out.Print(0, ')');
    }

    if (ps.drill.isFilled !== undefined) FormatOptBool(this.m_out, 'filling', ps.drill.isFilled);

    if (ps.mode !== 'normal') {
      this.m_out.Print('(padstack');

      if (ps.mode === 'front_inner_back') {
        this.m_out.Print('(mode front_inner_back)');

        this.m_out.Print('(layer "Inner"');
        this.m_out.Print(
          `(size ${formatInternalUnits(copperLayerPropsConst(ps, PADSTACK_INNER_LAYERS).shape.size.x)})`,
        );
        this.m_out.Print(')');
        this.m_out.Print('(layer "B.Cu"');
        this.m_out.Print(
          `(size ${formatInternalUnits(copperLayerPropsConst(ps, B_Cu).shape.size.x)})`,
        );
        this.m_out.Print(')');
      } else {
        this.m_out.Print('(mode custom)');

        for (const layer of LAYER_RANGE(F_Cu, B_Cu, board.copperLayerCount)) {
          if (layer === F_Cu) continue;

          this.m_out.Print(`(layer ${this.m_out.Quotew(LSET_Name(layer))}`);
          this.m_out.Print(
            `(size ${formatInternalUnits(copperLayerPropsConst(ps, layer).shape.size.x)})`,
          );
          this.m_out.Print(')');
        }
      }

      this.m_out.Print(')');
    }

    if (!isDefaultTeardropParameters(via.teardrops)) this.formatTeardropParameters(via.teardrops);

    this.m_out.Print(`(net ${this.m_out.Quotew(this.netName(via.net).name)})`);

    FormatUuid(this.m_out, via.uuid);
    this.m_out.Print(')');
  }

  /** `format( const PCB_TRACK* aTrack )` (:2607) for a segment or an arc. */
  formatTrack(track: KPcbTrack): void {
    const pt = formatInternalUnitsPt;

    if (track.type === 'arc') {
      this.m_out.Print(
        `(arc (start ${pt(track.start)}) (mid ${pt(track.mid!)}) (end ${pt(track.end)}) (width ${formatInternalUnits(track.width)})`,
      );
    } else {
      this.m_out.Print(
        `(segment (start ${pt(track.start)}) (end ${pt(track.end)}) (width ${formatInternalUnits(track.width)})`,
      );
    }

    if (track.locked) FormatBool(this.m_out, 'locked', true);

    const layerSet = trackLayerSet(track);
    if (layerSet.count() > 1) this.formatLayers(layerSet, false /* enumerate layers */);
    else this.formatLayer(track.layer);

    if (
      track.hasSolderMask &&
      track.solderMaskMargin !== undefined &&
      IsExternalCopperLayer(track.layer)
    )
      this.m_out.Print(`(solder_mask_margin ${formatInternalUnits(track.solderMaskMargin)})`);

    this.m_out.Print(`(net ${this.m_out.Quotew(this.netName(track.net).name)})`);

    FormatUuid(this.m_out, track.uuid);
    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // ZONE (:2864)
  // -------------------------------------------------------------------------

  /** `format( const ZONE* aZone )` (:2864). */
  formatZone(zone: KZone): void {
    this.m_out.Print('(zone');

    const onCopper = zone.layerSet.and(LSET.AllCuMask()).any();
    const net = this.netName(zone.net);

    if (onCopper && !zone.isRuleArea && net.code > 0)
      this.m_out.Print(`(net ${this.m_out.Quotew(net.name)})`);

    if (zone.locked) FormatBool(this.m_out, 'locked', true);

    // If a zone exists on multiple layers, format accordingly
    let layers = zone.layerSet;

    layers = layers.and(this.m_board.enabledLayers);

    // Always enumerate every layer for a zone on a copper layer
    if (layers.count() > 1) this.formatLayers(layers, onCopper, true);
    else this.formatLayer(zoneFirstLayer(zone));

    if (!zone.isTeardropArea) FormatUuid(this.m_out, zone.uuid);

    if (zone.name !== '' && !zone.isTeardropArea)
      this.m_out.Print(`(name ${this.m_out.Quotew(zone.name)})`);

    // Save the outline aux info
    let hatch: string;

    switch (zone.hatchStyle) {
      default:
        hatch = 'none';
        break;
      case 'edge':
        hatch = 'edge';
        break;
      case 'full':
        hatch = 'full';
        break;
    }

    this.m_out.Print(`(hatch ${hatch} ${formatInternalUnits(zone.hatchPitch)})`);

    if (zone.priority > 0) this.m_out.Print(`(priority ${zone.priority})`);

    // Add teardrop keywords in file: (attr (teardrop (type xxx))) where xxx is the teardrop type
    if (zone.isTeardropArea)
      this.m_out.Print(
        `(attr (teardrop (type ${zone.teardropType === 'padvia' ? 'padvia' : 'track_end'})))`,
      );

    this.m_out.Print('(connect_pads');

    switch (zone.padConnection) {
      default:
      case 1: // ZONE_CONNECTION::THERMAL: Default option not saved or loaded.
        break;
      case 3: // ZONE_CONNECTION::THT_THERMAL
        this.m_out.Print(' thru_hole_only');
        break;
      case 2: // ZONE_CONNECTION::FULL
        this.m_out.Print(' yes');
        break;
      case 0: // ZONE_CONNECTION::NONE
        this.m_out.Print(' no');
        break;
    }

    this.m_out.Print(`(clearance ${formatInternalUnits(zone.localClearance)})`);

    this.m_out.Print(')');

    this.m_out.Print(`(min_thickness ${formatInternalUnits(zone.minThickness)})`);

    if (zone.isRuleArea) {
      // Keepout settings
      const na = (b: boolean): string => (b ? 'not_allowed' : 'allowed');
      this.m_out.Print(
        `(keepout (tracks ${na(zone.doNotAllowTracks)}) (vias ${na(zone.doNotAllowVias)}) (pads ${na(zone.doNotAllowPads)}) (copperpour ${na(zone.doNotAllowZoneFills)}) (footprints ${na(zone.doNotAllowFootprints)}))`,
      );

      // Multichannel settings
      this.m_out.Print('(placement');
      FormatBool(this.m_out, 'enabled', zone.placementEnabled);

      switch (zone.placementSourceType) {
        case 'sheetname':
          this.m_out.Print(`(sheetname ${this.m_out.Quotew(zone.placementSource)})`);
          break;
        case 'component_class':
          this.m_out.Print(`(component_class ${this.m_out.Quotew(zone.placementSource)})`);
          break;
        case 'group':
          this.m_out.Print(`(group ${this.m_out.Quotew(zone.placementSource)})`);
          break;
        // These are transitory and should not be saved
        case 'design_block':
          break;
      }

      this.m_out.Print(')');
    }

    this.m_out.Print('(fill');

    // Default is not filled.
    if (zone.isFilled) this.m_out.Print(' yes');

    // Default is polygon filled.
    if (zone.fillMode === 'hatch_pattern') this.m_out.Print('(mode hatch)');

    if (!zone.isTeardropArea) {
      this.m_out.Print(
        `(thermal_gap ${formatInternalUnits(zone.thermalReliefGap)}) (thermal_bridge_width ${formatInternalUnits(zone.thermalReliefSpokeWidth)})`,
      );
    }

    if (zone.cornerSmoothingType !== 0) {
      switch (zone.cornerSmoothingType) {
        case 1: // SMOOTHING_CHAMFER
          this.m_out.Print('(smoothing chamfer)');
          break;
        case 2: // SMOOTHING_FILLET
          this.m_out.Print('(smoothing fillet)');
          break;
        default:
          throw new Error(`unknown zone corner smoothing type ${zone.cornerSmoothingType}`);
      }

      if (zone.cornerRadius !== 0)
        this.m_out.Print(`(radius ${formatInternalUnits(zone.cornerRadius)})`);
    }

    this.m_out.Print(`(island_removal_mode ${zone.islandRemovalMode})`);

    if (zone.islandRemovalMode === 2) {
      // AREA: `formatInternalUnits( int )` of a double — truncated.
      this.m_out.Print(
        `(island_area_min ${formatInternalUnits(Math.trunc(zone.minIslandArea / pcbIUScale.IU_PER_MM))})`,
      );
    }

    if (zone.fillMode === 'hatch_pattern') {
      this.m_out.Print(
        `(hatch_thickness ${formatInternalUnits(zone.hatchThickness)}) (hatch_gap ${formatInternalUnits(zone.hatchGap)}) (hatch_orientation ${FormatDouble2Str(zone.hatchOrientation)})`,
      );

      if (zone.hatchSmoothingLevel > 0) {
        this.m_out.Print(
          `(hatch_smoothing_level ${zone.hatchSmoothingLevel}) (hatch_smoothing_value ${FormatDouble2Str(zone.hatchSmoothingValue)})`,
        );
      }

      this.m_out.Print(
        `(hatch_border_algorithm ${zone.hatchBorderAlgorithm ? 'hatch_thickness' : 'min_thickness'}) (hatch_min_hole_area ${FormatDouble2Str(zone.hatchHoleMinArea)})`,
      );
    }

    this.m_out.Print(')');

    // `LayerProperties()`: a `std::map` by layer id.
    for (const [layer, properties] of [...zone.layerProperties.entries()].sort(([a], [b]) => a - b))
      this.formatZoneLayerProperties(properties, 0, layer);

    if (zoneNumCorners(zone)) {
      for (const chain of zone.outline) {
        if (chain.length === 0) continue;

        this.m_out.Print('(polygon');
        this.formatPolyPts(chain);
        this.m_out.Print(')');
      }
    }

    // Save the PolysList (filled areas)
    for (const layer of zone.layerSet.Seq()) {
      for (const fill of zone.filledPolygons) {
        if (fill.layer !== layer) continue;

        this.m_out.Print('(filled_polygon');
        this.m_out.Print(`(layer ${this.m_out.Quotew(LSET_Name(layer))})`);

        if (fill.island) FormatBool(this.m_out, 'island', true);

        this.formatPolyPts(fill.outline);
        this.m_out.Print(')');
      }
    }

    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // BOARD (:802)
  // -------------------------------------------------------------------------

  /** `format( const BOARD* aBoard )` (:802): the header, then every item list sorted. */
  formatBoard(board: KBoard): void {
    this.m_groupMembers = board.groupMembers;

    const sortedFootprints = stdSet(board.footprints, ptrCmpFootprint);
    const sortedDrawings = stdSet(board.drawings, cmpBoardDrawings);
    const sortedTracks = stdSet(board.tracks, cmpTracks(this));
    const sortedPoints = stdSet(board.points, cmpPoints);
    const sortedZones = stdSet(board.zones, ptrCmpZone);
    const layerSets = boardItemLayerSets(board);
    const sortedGroups = stdSet(board.groups, (a, b, ia, ib) =>
      ptrCmpGroup(a, b, ia, ib, layerSets),
    );
    const sortedGenerators = stdSet(board.generators, (a, b, ia, ib) =>
      ptrCmpGroup(a, b, ia, ib, layerSets),
    );

    this.formatHeader();

    // Save the footprints.
    for (const fp of sortedFootprints) this.formatFootprint(fp);

    // Save the graphical items on the board (not owned by a footprint)
    for (const item of sortedDrawings) {
      if (item.kind === 'target') this.formatTarget(item.item);
      else this.formatFpGraphicalItem(item, null);
    }

    // Save the points
    for (const point of sortedPoints) this.formatPoint(point);

    // Do not save PCB_MARKERs, they can be regenerated easily.

    // Save the tracks and vias.
    for (const t of sortedTracks) {
      if (t.kind === 'via') this.formatVia(t.item);
      else this.formatTrack(t.item);
    }

    // Save the polygon (which are the newer technology) zones.
    for (const zone of sortedZones) this.formatZone(zone);

    // Save the groups
    for (const group of sortedGroups) this.formatGroup(group);

    // Save the generators
    for (const gen of sortedGenerators) this.formatGenerator(gen);

    // Save any embedded files
    // Consolidate the embedded models in footprints into a single map
    // to avoid duplicating the same model in the board file.
    const filesToWrite: EmbeddedFiles = { files: new Map(), areFontsEmbedded: false };

    for (const [name, file] of board.embeddedFiles.files)
      if (!filesToWrite.files.has(name)) filesToWrite.files.set(name, file);

    for (const fp of sortedFootprints) {
      for (const [name, file] of fp.embeddedFiles.files)
        if (!filesToWrite.files.has(name)) filesToWrite.files.set(name, file);
    }

    this.m_out.Print(`(embedded_fonts ${board.embeddedFiles.areFontsEmbedded ? 'yes' : 'no'})`);

    if (filesToWrite.files.size > 0)
      writeEmbeddedFiles(this.m_out, filesToWrite, true /* CTL_FOR_BOARD */);
  }
}

/** `PAGE_INFO::Format( aFormatter )` (common/page_info.cpp). */
export function formatPageInfo(out: OUTPUTFORMATTER, page: PageInfo): void {
  out.Print(`(paper ${out.Quotew(page.type)}`);
  // The page dimensions are only required for user defined page sizes.
  // Internally, the page size is in mils
  if (page.type === 'User') {
    out.Print(
      ` ${FormatDouble2Str((page.widthMils * 25.4) / 1000.0)} ${FormatDouble2Str((page.heightMils * 25.4) / 1000.0)}`,
    );
  }
  // `IsCustom()` is `m_type == User`.
  if (page.type !== 'User' && page.portrait) out.Print(' portrait');
  out.Print(')');
}

/** `TITLE_BLOCK::Format( aFormatter )` (common/title_block.cpp). */
export function formatTitleBlock(out: OUTPUTFORMATTER, tb: TitleBlock): void {
  // Don't write the title block information if there is nothing to write.
  const texts = [tb.title, tb.date, tb.revision, tb.company, ...tb.comments];
  if (!texts.some((t) => t !== undefined && t !== '')) return;
  out.Print('(title_block');
  if (tb.title !== '') out.Print(`(title ${out.Quotew(tb.title)})`);
  if (tb.date !== '') out.Print(`(date ${out.Quotew(tb.date)})`);
  if (tb.revision !== '') out.Print(`(rev ${out.Quotew(tb.revision)})`);
  if (tb.company !== '') out.Print(`(company ${out.Quotew(tb.company)})`);
  for (let ii = 0; ii < 9; ii++) {
    const c = tb.comments[ii];
    if (c !== undefined && c !== '') out.Print(`(comment ${ii + 1} ${out.Quotew(c)})`);
  }
  out.Print(')');
}

/** `BOARD_STACKUP::FormatBoardStackup( aFormatter, aBoard )` (board_stackup.cpp). */
export function formatBoardStackup(out: OUTPUTFORMATTER, stackup: BoardStackup): void {
  // Board stackup is the ordered list from top to bottom of
  // physical layers and substrate used to build the board.
  if (stackup.list.length === 0) return;
  out.Print('(stackup');
  // Note:
  // Unspecified parameters are not stored in file.
  for (const item of stackup.list) {
    const layerName =
      item.brdLayerId === UNDEFINED_LAYER
        ? `dielectric ${item.dielectricLayerId}`
        : LSET_Name(item.brdLayerId);
    out.Print(`(layer ${out.Quotew(layerName)} (type ${out.Quotew(item.typeName)})`);

    const isColorEditable =
      item.type === 'dielectric' || item.type === 'soldermask' || item.type === 'silkscreen';
    const isThicknessEditable =
      item.type === 'copper' || item.type === 'dielectric' || item.type === 'soldermask';
    const isMaterialEditable = isColorEditable;
    const hasEpsilonRValue = item.type === 'dielectric' || item.type === 'soldermask';
    const hasLossTangentValue = hasEpsilonRValue;

    // Output other parameters (in sub layer list there is at least one item)
    for (let idx = 0; idx < item.sublayers.length; idx++) {
      const prms = item.sublayers[idx]!;
      if (idx) out.Print(' addsublayer'); // not for the main (first) layer.

      if (isColorEditable && IsPrmSpecified(prms.color))
        out.Print(`(color ${out.Quotew(prms.color)})`);

      if (isThicknessEditable) {
        out.Print(`(thickness ${formatInternalUnits(prms.thickness)}`);
        if (item.type === 'dielectric' && prms.thicknessLocked) out.Print(' locked');
        out.Print(')');
      }

      const hasMaterialValue = isMaterialEditable && IsPrmSpecified(prms.material);
      if (hasMaterialValue) out.Print(`(material ${out.Quotew(prms.material)})`);

      if (hasEpsilonRValue && hasMaterialValue)
        out.Print(`(epsilon_r ${FormatDouble2Str(prms.epsilonR)})`);

      if (hasLossTangentValue && hasMaterialValue)
        out.Print(`(loss_tangent ${FormatDouble2Str(prms.lossTangent)})`);
    }
    out.Print(')');
  }

  // Other infos about board, related to layers and other fabrication specifications
  if (IsPrmSpecified(stackup.finishType))
    out.Print(`(copper_finish ${out.Quotew(stackup.finishType)})`);

  FormatBool(out, 'dielectric_constraints', stackup.hasDielectricConstraints);

  if (stackup.edgeConnectorConstraints > 0)
    out.Print(`(edge_connector ${stackup.edgeConnectorConstraints > 1 ? 'bevelled' : 'yes'})`);

  if (stackup.edgePlating) FormatBool(out, 'edge_plating', true);

  out.Print(')');
}

/** `PCB_PLOT_PARAMS::Format( aFormatter )` (pcbnew/pcb_plot_params.cpp). */
export function formatPlotParams(out: OUTPUTFORMATTER, p: PcbPlotParams): void {
  out.Print('(pcbplotparams');
  out.Print(`(layerselection 0x${p.layerSelection.FmtHex()})`);
  out.Print(`(plot_on_all_layers_selection 0x${p.plotOnAllLayersSelection.FmtHex()})`);
  FormatBool(out, 'disableapertmacros', p.gerberDisableApertMacros);
  FormatBool(out, 'usegerberextensions', p.useGerberProtelExtensions);
  FormatBool(out, 'usegerberattributes', p.useGerberX2format);
  FormatBool(out, 'usegerberadvancedattributes', p.includeGerberNetlistInfo);
  FormatBool(out, 'creategerberjobfile', p.createGerberJobFile);
  // save this option only if it is not the default value,
  // to avoid incompatibility with older Pcbnew version
  if (p.gerberPrecision !== 6) out.Print(`(gerberprecision ${p.gerberPrecision})`);
  out.Print(`(dashed_line_dash_ratio ${FormatDouble2Str(p.dashedLineDashRatio)})`);
  out.Print(`(dashed_line_gap_ratio ${FormatDouble2Str(p.dashedLineGapRatio)})`);
  // SVG options
  out.Print(`(svgprecision ${p.svgPrecision})`);
  FormatBool(out, 'plotframeref', p.plotDrawingSheet);
  out.Print(`(mode ${p.dxfPlotModeSketch ? 2 : 1})`);
  FormatBool(out, 'useauxorigin', p.useAuxOrigin);
  // PDF options
  FormatBool(out, 'pdf_front_fp_property_popups', p.pdfFrontFPPropertyPopups);
  FormatBool(out, 'pdf_back_fp_property_popups', p.pdfBackFPPropertyPopups);
  FormatBool(out, 'pdf_metadata', p.pdfMetadata);
  FormatBool(out, 'pdf_single_document', p.pdfSingle);
  // DXF options
  FormatBool(out, 'dxfpolygonmode', p.dxfPolygonMode);
  FormatBool(out, 'dxfimperialunits', p.dxfImperialUnits);
  FormatBool(out, 'dxfusepcbnewfont', p.dxfUsePcbnewFont);
  FormatBool(out, 'psnegative', p.negative);
  FormatBool(out, 'psa4output', p.a4Output);
  FormatBool(out, 'plot_black_and_white', p.blackAndWhite);
  FormatBool(out, 'sketchpadsonfab', p.sketchPadsOnFabLayers);
  FormatBool(out, 'plotpadnumbers', p.plotPadNumbers);
  FormatBool(out, 'hidednponfab', p.hideDNPFPsOnFabLayers);
  FormatBool(out, 'sketchdnponfab', p.sketchDNPFPsOnFabLayers);
  FormatBool(out, 'crossoutdnponfab', p.crossoutDNPFPsOnFabLayers);
  FormatBool(out, 'subtractmaskfromsilk', p.subtractMaskFromSilk);
  out.Print(`(outputformat ${p.format})`);
  FormatBool(out, 'mirror', p.mirror);
  out.Print(`(drillshape ${p.drillMarks})`);
  out.Print(`(scaleselection ${p.scaleSelection})`);
  out.Print(`(outputdirectory ${out.Quotew(p.outputDirectory)})`);
  out.Print(')');
}

/**
 * `FormatBoardToFormatter` (:322) for the header alone: the prettified text
 * of `(kicad_pcb (version …) … <header> )`, with `items` printed between the
 * header and the close — the item formatters of part 2, or nothing.
 */
export function formatBoardText(
  board: BoardHeaderView,
  items: (io: PCB_IO_KICAD_SEXPR, out: OUTPUTFORMATTER) => void = () => {},
): string {
  const out = new PRETTIFIED_STRING_FORMATTER();
  out.Print(
    `(kicad_pcb (version ${SEXPR_BOARD_FILE_VERSION}) (generator ${out.Quotew(board.generator)}) (generator_version ${out.Quotew(MAJOR_MINOR_VERSION)})`,
  );
  const io = new PCB_IO_KICAD_SEXPR(out, board);
  io.formatHeader();
  items(io, out);
  out.Print(')');
  return out.Finish();
}

export { FormatAngle };

// ---------------------------------------------------------------------------
// EDA_TEXT::Format (common/eda_text.cpp:1061)
// ---------------------------------------------------------------------------

export const CTL_OMIT_COLOR = 1 << 9;
export const CTL_OMIT_HYPERLINK = 1 << 10;

/** `EDA_TEXT::Format( aFormatter, aControlBits )` (eda_text.cpp:1061). */
export function formatEdaText(out: OUTPUTFORMATTER, text: KEdaText, controlBits: number): void {
  out.Print('(effects');

  out.Print('(font');

  if (text.fontName !== '') out.Print(`(face ${out.Quotew(text.fontName)})`);

  // Text size
  out.Print(`(size ${formatInternalUnits(text.size.y)} ${formatInternalUnits(text.size.x)})`);

  if (text.lineSpacing !== 1.0) out.Print(`(line_spacing ${FormatDouble2Str(text.lineSpacing)})`);

  if (!text.autoThickness) out.Print(`(thickness ${formatInternalUnits(text.thickness)})`);

  if (text.bold) FormatBool(out, 'bold', true);

  if (text.italic) FormatBool(out, 'italic', true);

  if (!(controlBits & CTL_OMIT_COLOR) && text.color) {
    const c = text.color;
    out.Print(
      `(color ${KiROUND(c.r * 255.0)} ${KiROUND(c.g * 255.0)} ${KiROUND(c.b * 255.0)} ${FormatDouble2Str(c.a)})`,
    );
  }

  out.Print(')'); // (font

  if (text.mirrored || text.hJustify !== 'center' || text.vJustify !== 'center') {
    out.Print('(justify');

    if (text.hJustify !== 'center') out.Print(text.hJustify === 'left' ? ' left' : ' right');

    if (text.vJustify !== 'center') out.Print(text.vJustify === 'top' ? ' top' : ' bottom');

    if (text.mirrored) out.Print(' mirror');

    out.Print(')'); // (justify
  }

  if (!(controlBits & CTL_OMIT_HYPERLINK) && text.hyperlink !== '')
    out.Print(`(href ${out.Quotew(text.hyperlink)})`);

  out.Print(')'); // (effects
}

// ---------------------------------------------------------------------------
// EMBEDDED_FILES::WriteEmbeddedFiles (common/embedded_files.cpp:190)
// ---------------------------------------------------------------------------

/** `EMBEDDED_FILES::WriteEmbeddedFiles( aOut, aWriteData )`. */
export function writeEmbeddedFiles(
  out: OUTPUTFORMATTER,
  files: EmbeddedFiles,
  writeData: boolean,
): void {
  const MIME_BASE64_LENGTH = 76;
  out.Print('(embedded_files ');

  // `m_files` is a `std::map`: name order.
  for (const [, file] of [...files.files.entries()].sort(([a], [b]) => cmpWxString(a, b))) {
    // Skip empty files
    if (file.compressedEncodedData === '') continue;

    out.Print('(file ');
    out.Print(`(name ${out.Quotew(file.name)})`);

    out.Print(`(type ${file.type})`);

    if (writeData) {
      out.Print('(data');

      let first = 0;
      const data = file.compressedEncodedData;

      while (first < data.length) {
        const remaining = data.length - first;
        const length = Math.min(remaining, MIME_BASE64_LENGTH);
        out.Print(
          `\n${first ? '' : '|'}${data.slice(first, first + length)}${remaining === length ? '|' : ''}\n`,
        );
        first += MIME_BASE64_LENGTH;
      }

      out.Print(')'); // Close data
    }

    out.Print(`(checksum ${out.Quotew(file.dataHash)})`);
    out.Print(')'); // Close file
  }

  out.Print(')'); // Close embedded_files
}

// ---------------------------------------------------------------------------
// Small helpers the C++ gets from its classes
// ---------------------------------------------------------------------------

/** `wxString::Cmp`: code point order. */
export function cmpWxString(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const na = ia.next();
    const nb = ib.next();
    if (na.done) return nb.done ? 0 : -1;
    if (nb.done) return 1;
    const ca = na.value.codePointAt(0)!;
    const cb = nb.value.codePointAt(0)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}

/** `LIB_ID::IsValid()` on a `nickname:item` string: both halves present. */
export function libIdIsValid(libId: string): boolean {
  const i = libId.indexOf(':');
  return i > 0 && i < libId.length - 1;
}

/** `PCB_TABLE::GetRowCount()`. */
export function tableRowCount(table: KPcbTable): number {
  return Math.trunc(table.cells.length / table.colCount);
}

/** `ZONE::GetNumCorners()`: `Outline()->TotalVertices()`. */
export function zoneNumCorners(zone: KZone): number {
  let n = 0;
  for (const chain of zone.outline) n += chain.length;
  return n;
}

/** `DEFAULT_VIA_DRILL` / `DEFAULT_UVIA_DRILL` (common/netclass.cpp:41): the netclass defaults. */
export const DEFAULT_VIA_DRILL = pcbIUScale.mmToIU(0.3);
export const DEFAULT_UVIA_DRILL = pcbIUScale.mmToIU(0.1);

/**
 * `PCB_VIA::GetDrillValue()` (pcb_track.cpp:694) for a via whose drill is
 * the netclass value. The board file carries no netclasses, so this is the
 * `NETCLASS` constructor default — the value a board loaded without its
 * project gets.
 */
export function viaDrillValue(via: KPcbVia): number {
  if (via.drill > 0) return via.drill;
  return via.viaType === 'micro' ? DEFAULT_UVIA_DRILL : DEFAULT_VIA_DRILL;
}

/** `isDefaultTeardropParameters( tdParams )` (:765). */
export function isDefaultTeardropParameters(td: TeardropParams): boolean {
  const d = defaultTeardropParams();
  return (
    td.enabled === d.enabled &&
    td.bestLengthRatio === d.bestLengthRatio &&
    td.tdMaxLen === d.tdMaxLen &&
    td.bestWidthRatio === d.bestWidthRatio &&
    td.tdMaxWidth === d.tdMaxWidth &&
    td.curvedEdges === d.curvedEdges &&
    td.widthtoSizeFilterRatio === d.widthtoSizeFilterRatio &&
    td.allowUseTwoTracks === d.allowUseTwoTracks &&
    td.tdOnPadsInZones === d.tdOnPadsInZones
  );
}

/** The `(data …)` base64 of a reference image, back to the bytes `SaveImageData` writes. */
export function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** `RotatePoint( rel, θ ) + pos`: a footprint child's board position, as `GetPosition()` returns it. */
function toBoard(pt: Vec2, fp: ParentFP | null): Vec2 {
  if (!fp) return pt;
  const p = fp.angle === 0 ? { x: pt.x, y: pt.y } : RotatePoint(pt, new EDA_ANGLE(fp.angle));
  return { x: p.x + fp.at.x, y: p.y + fp.at.y };
}

// ---------------------------------------------------------------------------
// The sort comparators: std::set< …, cmp > in format( BOARD ) and format( FOOTPRINT )
// ---------------------------------------------------------------------------

/**
 * `std::set<T, less>` built from a list: sorted, and an element equivalent
 * to one already present (neither orders before the other) is not inserted —
 * so KiCad drops, on save, a drawing that compares equal to an earlier one.
 * `less` gets the insertion indices for the C++'s final pointer compare.
 */
export function stdSet<T>(
  items: readonly T[],
  less: (a: T, b: T, ia: number, ib: number) => boolean,
): T[] {
  const indexed = items.map((item, i) => ({ item, i }));
  indexed.sort((a, b) =>
    less(a.item, b.item, a.i, b.i) ? -1 : less(b.item, a.item, b.i, a.i) ? 1 : 0,
  );
  const out: T[] = [];
  let prev: { item: T; i: number } | null = null;
  for (const e of indexed) {
    if (prev && !less(prev.item, e.item, prev.i, e.i) && !less(e.item, prev.item, e.i, prev.i))
      continue;
    out.push(e.item);
    prev = e;
  }
  return out;
}

/** `KICAD_T` (include/core/typeinfo.h), the part of the order the comparators need. */
const enum KT {
  FOOTPRINT = 0,
  PAD,
  SHAPE,
  REFERENCE_IMAGE,
  FIELD,
  GENERATOR,
  TEXT,
  TEXTBOX,
  TABLE,
  TABLECELL,
  TRACE,
  VIA,
  ARC,
  MARKER,
  DIMENSION,
  BARCODE,
  DIM_ALIGNED,
  DIM_LEADER,
  DIM_CENTER,
  DIM_RADIAL,
  DIM_ORTHOGONAL,
  TARGET,
  ZONE,
  GROUP,
  POINT,
}

function drawingType(d: KBoardDrawing): KT {
  switch (d.kind) {
    case 'shape':
      return KT.SHAPE;
    case 'image':
      return KT.REFERENCE_IMAGE;
    case 'text':
      return KT.TEXT;
    case 'textbox':
      return KT.TEXTBOX;
    case 'table':
      return KT.TABLE;
    case 'barcode':
      return KT.BARCODE;
    case 'dimension':
      switch (d.item.type) {
        case 'aligned':
          return KT.DIM_ALIGNED;
        case 'leader':
          return KT.DIM_LEADER;
        case 'center':
          return KT.DIM_CENTER;
        case 'radial':
          return KT.DIM_RADIAL;
        case 'orthogonal':
          return KT.DIM_ORTHOGONAL;
      }
      break;
    case 'target':
      return KT.TARGET;
  }
  return KT.SHAPE;
}

/** `BOARD_ITEM::GetLayer()` of a drawing. */
function drawingLayer(d: KBoardDrawing): number {
  return d.item.layer;
}

/** `SHAPE_T` order. */
const SHAPE_T_ORDER: Record<ShapeT, number> = {
  segment: 0,
  rectangle: 1,
  arc: 2,
  circle: 3,
  poly: 4,
  bezier: 5,
};
/** `LINE_STYLE` order (`DEFAULT` is -1). */
const LINE_STYLE_ORDER: Record<StrokeType, number> = {
  default: -1,
  solid: 0,
  dash: 1,
  dot: 2,
  dash_dot: 3,
  dash_dot_dot: 4,
};
/** `FILL_T` order. */
const FILL_T_ORDER: Record<FillT, number> = {
  no_fill: 1,
  filled_shape: 2,
  hatch: 3,
  reverse_hatch: 4,
  cross_hatch: 5,
};
/** `PAD_SHAPE` order. */
const PAD_SHAPE_ORDER: Record<PadShape, number> = {
  circle: 0,
  rectangle: 1,
  oval: 2,
  trapezoid: 3,
  roundrect: 4,
  chamfered_rect: 5,
  custom: 6,
};
/** `GR_TEXT_H_ALIGN_T` / `GR_TEXT_V_ALIGN_T`: LEFT/TOP -1, CENTER 0, RIGHT/BOTTOM 1. */
const H_ALIGN_ORDER = { left: -1, center: 0, right: 1 } as const;
const V_ALIGN_ORDER = { top: -1, center: 0, bottom: 1 } as const;
/** `BARCODE_T` and `BARCODE_ECC_T` orders. */
const BARCODE_T_ORDER = { code39: 0, code128: 1, datamatrix: 2, qr: 3, microqr: 4 } as const;
const BARCODE_ECC_ORDER = { L: 0, M: 1, Q: 2, H: 3 } as const;

/**
 * The vertices `SHAPE_POLY_SET::CVertex( ii )` walks: an arc entry stands
 * for the points KiCad approximates it into; the three it names are used
 * here, which orders two outlines the same way unless they differ only
 * inside an arc.
 */
function outlineVertices(outline: readonly OutlineEntry[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const e of outline) {
    if ('xy' in e) pts.push(e.xy);
    else pts.push(e.arc.start, e.arc.mid, e.arc.end);
  }
  return pts;
}

/** `cmp_points_opt` (footprint.cpp:4333). */
function cmpPointsOpt(a: Vec2, b: Vec2): boolean | undefined {
  if (a.x !== b.x) return a.x < b.x;
  if (a.y !== b.y) return a.y < b.y;
  return undefined;
}

/** `EDA_SHAPE::Compare( aOther )` (eda_shape.cpp:2449). */
export function edaShapeCompare(a: KPcbShape, b: KPcbShape, fp: ParentFP | null): number {
  const EPSILON = 2; // Should be enough for rounding errors on calculated items
  const TEST = (x: number, y: number): number | undefined => (x !== y ? x - y : undefined);
  const TEST_E = (x: number, y: number): number | undefined =>
    Math.abs(x - y) > EPSILON ? x - y : undefined;
  const TEST_PT = (p: Vec2, q: Vec2): number | undefined => TEST_E(p.x, q.x) ?? TEST_E(p.y, q.y);
  let r: number | undefined;

  r = TEST_PT(toBoard(a.start, fp), toBoard(b.start, fp));
  if (r !== undefined) return r;
  r = TEST_PT(toBoard(a.end, fp), toBoard(b.end, fp));
  if (r !== undefined) return r;

  r = TEST(SHAPE_T_ORDER[a.shape], SHAPE_T_ORDER[b.shape]);
  if (r !== undefined) return r;

  if (a.shape === 'rectangle') {
    r = TEST(a.cornerRadius, b.cornerRadius);
    if (r !== undefined) return r;
  } else if (a.shape === 'arc') {
    r = TEST_PT(toBoard(a.arcMid!, fp), toBoard(b.arcMid!, fp));
    if (r !== undefined) return r;
  } else if (a.shape === 'bezier') {
    r = TEST_PT(toBoard(a.bezierC1!, fp), toBoard(b.bezierC1!, fp));
    if (r !== undefined) return r;
    r = TEST_PT(toBoard(a.bezierC2!, fp), toBoard(b.bezierC2!, fp));
    if (r !== undefined) return r;
  } else if (a.shape === 'poly') {
    const va = outlineVertices(a.outline ?? []);
    const vb = outlineVertices(b.outline ?? []);
    r = TEST(va.length, vb.length);
    if (r !== undefined) return r;
    for (let ii = 0; ii < va.length; ++ii) {
      r = TEST_PT(toBoard(va[ii]!, fp), toBoard(vb[ii]!, fp));
      if (r !== undefined) return r;
    }
  }

  // (The `m_bezierPoints` loop: the segment approximation, which two beziers
  // whose control points agree within EPSILON share.)

  r = TEST_E(a.stroke.width, b.stroke.width);
  if (r !== undefined) return r;
  r = TEST(LINE_STYLE_ORDER[a.stroke.type], LINE_STYLE_ORDER[b.stroke.type]);
  if (r !== undefined) return r;
  r = TEST(FILL_T_ORDER[a.fill], FILL_T_ORDER[b.fill]);
  if (r !== undefined) return r;

  return 0;
}

/** `TEXT_ATTRIBUTES::Compare` (text_attributes.cpp:44) then the rest of `EDA_TEXT::Compare` (eda_text.cpp:1201). */
export function edaTextCompare(
  a: KEdaText,
  b: KEdaText,
  fp: ParentFP | null,
  keepUprightA = false,
  keepUprightB = false,
): number {
  let retv = cmpWxString(a.fontName, b.fontName);
  if (retv) return retv;

  if (a.size.x !== b.size.x) return a.size.x - b.size.x;
  if (a.size.y !== b.size.y) return a.size.y - b.size.y;
  if (a.thickness !== b.thickness) return a.thickness - b.thickness;
  if (a.angle !== b.angle) return a.angle < b.angle ? -1 : 1;
  if (a.lineSpacing !== b.lineSpacing) return a.lineSpacing < b.lineSpacing ? -1 : 1;
  if (a.hJustify !== b.hJustify) return H_ALIGN_ORDER[a.hJustify] - H_ALIGN_ORDER[b.hJustify];
  if (a.vJustify !== b.vJustify) return V_ALIGN_ORDER[a.vJustify] - V_ALIGN_ORDER[b.vJustify];
  if (a.italic !== b.italic) return Number(a.italic) - Number(b.italic);
  if (a.bold !== b.bold) return Number(a.bold) - Number(b.bold);
  // m_Underlined: never set on a board text.
  // COLOR4D::Compare; UNSPECIFIED is (0, 0, 0, 0).
  const ca = a.color ?? { r: 0, g: 0, b: 0, a: 0 };
  const cb = b.color ?? { r: 0, g: 0, b: 0, a: 0 };
  if (ca.r !== cb.r) return ca.r < cb.r ? -1 : 1;
  if (ca.g !== cb.g) return ca.g < cb.g ? -1 : 1;
  if (ca.b !== cb.b) return ca.b < cb.b ? -1 : 1;
  if (ca.a !== cb.a) return ca.a < cb.a ? -1 : 1;
  if (a.mirrored !== b.mirrored) return Number(a.mirrored) - Number(b.mirrored);
  // m_Multiline: every PCB_TEXT allows it.
  retv = Number(keepUprightA) - Number(keepUprightB);
  if (retv) return retv;

  const pa = toBoard(a.pos, fp);
  const pb = toBoard(b.pos, fp);
  if (pa.x !== pb.x) return pa.x - pb.x;
  if (pa.y !== pb.y) return pa.y - pb.y;

  retv = cmpWxString(a.fontName, b.fontName);
  if (retv) return retv;

  return cmpWxString(a.text, b.text);
}

/** The textbox as a `PCB_SHAPE` for `PCB_SHAPE::Compare`. */
function textBoxAsShape(tb: KPcbTextBox): KPcbShape {
  return {
    shape: tb.shape === 'rectangle' ? 'rectangle' : 'poly',
    start: tb.start,
    end: tb.end,
    outline: tb.outline,
    cornerRadius: 0,
    stroke: tb.stroke,
    fill: 'no_fill',
    locked: tb.locked,
    layer: tb.layer,
    hasSolderMask: false,
    net: null,
    uuid: tb.uuid,
    proxy: false,
  };
}

/** `PCB_TABLE::Compare( aTable, aOther )` (pcb_table.cpp:730). */
export function pcbTableCompare(a: KPcbTable, b: KPcbTable, fp: ParentFP | null): number {
  let diff: number;

  diff = a.cells.length - b.cells.length;
  if (diff !== 0) return diff;

  diff = a.colCount - b.colCount;
  if (diff !== 0) return diff;

  for (let col = 0; col < a.colCount; ++col) {
    diff = (a.colWidths[col] ?? 0) - (b.colWidths[col] ?? 0);
    if (diff !== 0) return diff;
  }

  const rows = tableRowCount(a);
  for (let row = 0; row < rows; ++row) {
    diff = (a.rowHeights[row] ?? 0) - (b.rowHeights[row] ?? 0);
    if (diff !== 0) return diff;
  }

  for (let row = 0; row < rows; ++row) {
    for (let col = 0; col < a.colCount; ++col) {
      const cell = a.cells[row * a.colCount + col]!;
      const other = b.cells[row * b.colCount + col]!;

      diff = edaShapeCompare(textBoxAsShape(cell), textBoxAsShape(other), fp);
      if (diff !== 0) return diff;

      diff = edaTextCompare(cell, other, fp);
      if (diff !== 0) return diff;
    }
  }

  return 0;
}

/** `PCB_BARCODE::Compare( aBarcode, aOther )` (pcb_barcode.cpp:832). */
export function pcbBarcodeCompare(a: KPcbBarcode, b: KPcbBarcode): number {
  let diff: number;

  diff = a.pos.x - b.pos.x;
  if (diff !== 0) return diff;
  diff = a.pos.y - b.pos.y;
  if (diff !== 0) return diff;
  diff = cmpWxString(a.text, b.text);
  if (diff !== 0) return diff;
  diff = a.width - b.width;
  if (diff !== 0) return diff;
  diff = a.height - b.height;
  if (diff !== 0) return diff;
  diff = a.textHeight - b.textHeight;
  if (diff !== 0) return diff;
  diff = BARCODE_T_ORDER[a.kind] - BARCODE_T_ORDER[b.kind];
  if (diff !== 0) return diff;
  diff = KiROUND(a.angle * 10) - KiROUND(b.angle * 10);
  if (diff !== 0) return diff;
  diff = BARCODE_ECC_ORDER[a.ecc] - BARCODE_ECC_ORDER[b.ecc];
  if (diff !== 0) return diff;

  return 0;
}

/** `LSET::Seq() <` on two sets: `std::vector<PCB_LAYER_ID>` lexicographic. */
function seqLess(a: LSET, b: LSET): boolean {
  const sa = a.Seq();
  const sb = b.Seq();
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    if (sa[i]! !== sb[i]!) return sa[i]! < sb[i]!;
  }
  return sa.length < sb.length;
}

/** `KIID::operator<`: the 16 bytes, which for canonical lowercase strings is string order. */
function uuidLess(a: string, b: string): boolean {
  return a < b;
}

/** `BOARD_ITEM::ptr_cmp` (board_item.cpp:320) on items of one type. */
function ptrCmp(
  layerSetA: LSET,
  layerSetB: LSET,
  uuidA: string,
  uuidB: string,
  ia: number,
  ib: number,
): boolean {
  if (!layerSetA.equals(layerSetB)) return seqLess(layerSetA, layerSetB);

  if (uuidA !== uuidB) return uuidLess(uuidA, uuidB); // UUIDs *should* always be unique (for valid boards anyway)

  return ia < ib; // But just in case; ptrs are guaranteed to be different
}

/** `BOARD_ITEM::GetLayerSet()` (board_item.h:257): the one layer, none when UNDEFINED. */
function oneLayerSet(layer: number): LSET {
  return layer === UNDEFINED_LAYER ? new LSET() : new LSET([layer]);
}

/** `PCB_VIA::GetLayerSet()` (pcb_track.cpp:1565). */
function viaLayerSet(via: KPcbVia, copperLayerCount: number): LSET {
  if (via.viaType === 'through') return LSET.AllCuMask(copperLayerCount);
  const layermask = new LSET();
  let cnt = copperLayerCount;
  // PCB_LAYER_IDs are numbered from front to back, this is top to bottom.
  for (const id of LAYER_RANGE(via.layer1, via.layer2, copperLayerCount)) {
    layermask.set(id);
    if (--cnt <= 0) break;
  }
  return layermask;
}

/** An item's `GetLayerSet()` by uuid, for `PCB_GROUP::GetLayerSet()`: the union of its members'. */
type LayerSetLookup = {
  sets: Map<string, LSET>;
  /** Group uuid -> resolved member uuids. */
  members: Map<string, string[]>;
};

function groupLayerSet(uuid: string, lookup: LayerSetLookup, depth = 0): LSET {
  let set = new LSET();
  const members = lookup.members.get(uuid) ?? [];
  for (const m of members) {
    if (lookup.members.has(m)) {
      // A nested group: its own union. (`GroupsSanityCheck` forbids cycles.)
      if (depth < 64) set = set.or(groupLayerSet(m, lookup, depth + 1));
    } else {
      const s = lookup.sets.get(m);
      if (s) set = set.or(s);
    }
  }
  const own = lookup.sets.get(uuid);
  return own ? set.or(own) : set;
}

/** `GetItemByIdCache()`-like layer sets of the board's top-level items. */
function boardItemLayerSets(board: KBoard): LayerSetLookup {
  const sets = new Map<string, LSET>();
  for (const fp of board.footprints) sets.set(fp.uuid, oneLayerSet(fp.layer));
  for (const d of board.drawings)
    sets.set(d.item.uuid, d.kind === 'shape' ? shapeLayerSet(d.item) : oneLayerSet(d.item.layer));
  for (const t of board.tracks)
    sets.set(
      t.item.uuid,
      t.kind === 'via' ? viaLayerSet(t.item, board.copperLayerCount) : trackLayerSet(t.item),
    );
  for (const pt of board.points) sets.set(pt.uuid, oneLayerSet(pt.layer));
  for (const z of board.zones) sets.set(z.uuid, z.layerSet);
  // `PCB_GENERATOR::GetLayerSet()`: the members' plus its own layer.
  for (const g of board.generators) sets.set(g.uuid, oneLayerSet(g.layer));
  return { sets, members: board.groupMembers };
}

/** The same for a footprint's children. */
function footprintChildLayerSets(fp: KFootprint): LayerSetLookup {
  const sets = new Map<string, LSET>();
  for (const d of fp.graphicalItems)
    sets.set(d.item.uuid, d.kind === 'shape' ? shapeLayerSet(d.item) : oneLayerSet(d.item.layer));
  for (const f of fp.fields) sets.set(f.uuid, oneLayerSet(f.layer));
  for (const pad of fp.pads) sets.set(pad.uuid, pad.padstack.layerSet);
  for (const z of fp.zones) sets.set(z.uuid, z.layerSet);
  for (const pt of fp.points) sets.set(pt.uuid, oneLayerSet(pt.layer));
  const members = new Map<string, string[]>();
  for (const g of fp.groups) members.set(g.uuid, fp.groupMembers?.get(g.uuid) ?? g.memberUuids);
  return { sets, members };
}

function ptrCmpFootprint(a: KFootprint, b: KFootprint, ia: number, ib: number): boolean {
  return ptrCmp(oneLayerSet(a.layer), oneLayerSet(b.layer), a.uuid, b.uuid, ia, ib);
}

function ptrCmpZone(a: KZone, b: KZone, ia: number, ib: number): boolean {
  return ptrCmp(a.layerSet, b.layerSet, a.uuid, b.uuid, ia, ib);
}

/** `BOARD_ITEM::ptr_cmp` on groups and generators, whose layer set is their members'. */
function ptrCmpGroup(
  a: KPcbGroup,
  b: KPcbGroup,
  ia: number,
  ib: number,
  lookup: LayerSetLookup,
): boolean {
  return ptrCmp(
    groupLayerSet(a.uuid, lookup),
    groupLayerSet(b.uuid, lookup),
    a.uuid,
    b.uuid,
    ia,
    ib,
  );
}

/** `BOARD::cmp_drawings` (board.cpp:3507). */
function cmpBoardDrawings(a: KBoardDrawing, b: KBoardDrawing, ia: number, ib: number): boolean {
  const ta = drawingType(a);
  const tb = drawingType(b);
  if (ta !== tb) return ta < tb;

  if (drawingLayer(a) !== drawingLayer(b)) return drawingLayer(a) < drawingLayer(b);

  if (a.kind === 'shape' && b.kind === 'shape') return edaShapeCompare(a.item, b.item, null) < 0;
  if (a.kind === 'text' && b.kind === 'text') return edaTextCompare(a.item, b.item, null) < 0;
  if (a.kind === 'textbox' && b.kind === 'textbox') {
    const shapeCmp = edaShapeCompare(textBoxAsShape(a.item), textBoxAsShape(b.item), null);
    if (shapeCmp !== 0) return shapeCmp < 0;
    return edaTextCompare(a.item, b.item, null) < 0;
  }
  if (a.kind === 'table' && b.kind === 'table') return pcbTableCompare(a.item, b.item, null) < 0;
  if (a.kind === 'barcode' && b.kind === 'barcode') return pcbBarcodeCompare(a.item, b.item) < 0;

  if (a.item.uuid !== b.item.uuid) return uuidLess(a.item.uuid, b.item.uuid);
  return ia < ib;
}

/** `PCB_TRACK::cmp_tracks` (pcb_track.cpp:2718). */
function cmpTracks(
  io: PCB_IO_KICAD_SEXPR,
): (a: KBoardTrack, b: KBoardTrack, ia: number, ib: number) => boolean {
  const netCode = (t: KBoardTrack): number => io.netName(t.item.net).code;
  const layer = (t: KBoardTrack): number => (t.kind === 'via' ? t.item.layer1 : t.item.layer);
  const type = (t: KBoardTrack): KT =>
    t.kind === 'via' ? KT.VIA : t.item.type === 'arc' ? KT.ARC : KT.TRACE;
  return (a, b, ia, ib) => {
    if (netCode(a) !== netCode(b)) return netCode(a) < netCode(b);

    if (layer(a) !== layer(b)) return layer(a) < layer(b);

    if (type(a) !== type(b)) return type(a) < type(b);

    if (a.item.uuid !== b.item.uuid) return uuidLess(a.item.uuid, b.item.uuid);

    return ia < ib;
  };
}

/** `PCB_POINT::cmp_points` (pcb_point.cpp:62). */
function cmpPoints(a: KPcbPoint, b: KPcbPoint, ia: number, ib: number): boolean {
  if (a.layer !== b.layer) return a.layer < b.layer;

  if (a.pos.x !== b.pos.x) return a.pos.x < b.pos.x;

  if (a.pos.y !== b.pos.y) return a.pos.y < b.pos.y;

  if (a.size !== b.size) return a.size < b.size;

  if (a.uuid !== b.uuid) return uuidLess(a.uuid, b.uuid);

  return ia < ib;
}

/** `FOOTPRINT::cmp_drawings` (footprint.cpp:4345). */
function cmpFpDrawings(
  a: KFpGraphicalItem,
  b: KFpGraphicalItem,
  ia: number,
  ib: number,
  fp: ParentFP,
): boolean {
  {
    const ta = drawingType(a);
    const tb = drawingType(b);
    if (ta !== tb) return ta < tb;

    if (a.item.layer !== b.item.layer) return a.item.layer < b.item.layer;

    if (a.kind === 'shape' && b.kind === 'shape') {
      const dwgA = a.item;
      const dwgB = b.item;
      let cmp: boolean | undefined;

      if (dwgA.shape !== dwgB.shape) return SHAPE_T_ORDER[dwgA.shape] < SHAPE_T_ORDER[dwgB.shape];

      // GetStart() and GetEnd() have no meaning with polygons.
      // We cannot use them for sorting polygons
      if (dwgA.shape !== 'poly') {
        cmp = cmpPointsOpt(toBoard(dwgA.start, fp), toBoard(dwgB.start, fp));
        if (cmp !== undefined) return cmp;

        cmp = cmpPointsOpt(toBoard(dwgA.end, fp), toBoard(dwgB.end, fp));
        if (cmp !== undefined) return cmp;
      }

      if (dwgA.shape === 'arc') {
        cmp = cmpPointsOpt(toBoard(dwgA.arcCenter!, fp), toBoard(dwgB.arcCenter!, fp));
        if (cmp !== undefined) return cmp;
      } else if (dwgA.shape === 'bezier') {
        cmp = cmpPointsOpt(toBoard(dwgA.bezierC1!, fp), toBoard(dwgB.bezierC1!, fp));
        if (cmp !== undefined) return cmp;

        cmp = cmpPointsOpt(toBoard(dwgA.bezierC2!, fp), toBoard(dwgB.bezierC2!, fp));
        if (cmp !== undefined) return cmp;
      } else if (dwgA.shape === 'poly') {
        const va = outlineVertices(dwgA.outline ?? []);
        const vb = outlineVertices(dwgB.outline ?? []);
        if (va.length !== vb.length) return va.length < vb.length;

        for (let ii = 0; ii < va.length; ++ii) {
          cmp = cmpPointsOpt(toBoard(va[ii]!, fp), toBoard(vb[ii]!, fp));
          if (cmp !== undefined) return cmp;
        }
      }

      if (dwgA.stroke.width !== dwgB.stroke.width) return dwgA.stroke.width < dwgB.stroke.width;
    } else if (a.kind === 'text' && b.kind === 'text') {
      const textA = a.item;
      const textB = b.item;
      let cmp: boolean | undefined;

      cmp = cmpPointsOpt(toBoard(textA.pos, fp), toBoard(textB.pos, fp));
      if (cmp !== undefined) return cmp;

      if (textA.angle !== textB.angle) return textA.angle < textB.angle;

      cmp = cmpPointsOpt(textA.size, textB.size);
      if (cmp !== undefined) return cmp;

      if (textA.thickness !== textB.thickness) return textA.thickness < textB.thickness;

      if (textA.bold !== textB.bold) return Number(textA.bold) < Number(textB.bold);

      if (textA.italic !== textB.italic) return Number(textA.italic) < Number(textB.italic);

      if (textA.mirrored !== textB.mirrored) return Number(textA.mirrored) < Number(textB.mirrored);

      if (textA.lineSpacing !== textB.lineSpacing) return textA.lineSpacing < textB.lineSpacing;

      if (textA.text !== textB.text) return cmpWxString(textA.text, textB.text) < 0;
    }
    // These items don't have their own specific sorting criteria.

    if (a.item.uuid !== b.item.uuid) return uuidLess(a.item.uuid, b.item.uuid);

    return ia < ib;
  }
}

/** `FOOTPRINT::cmp_pads` (footprint.cpp:4455). */
function cmpPads(aFirst: KPad, aSecond: KPad, ia: number, ib: number): boolean {
  if (aFirst.number !== aSecond.number) return strNumCmp(aFirst.number, aSecond.number) < 0;

  const cmp = cmpPointsOpt(aFirst.at, aSecond.at);
  if (cmp !== undefined) return cmp;

  let padCopperMatches: boolean | undefined;

  // Pick the "most complex" padstack to iterate
  let checkPad = aFirst;

  if (
    aSecond.padstack.mode === 'custom' ||
    (aSecond.padstack.mode === 'front_inner_back' && aFirst.padstack.mode === 'normal')
  ) {
    checkPad = aSecond;
  }

  for (const layer of uniquePadstackLayers(checkPad.padstack)) {
    const sa = copperLayerPropsConst(aFirst.padstack, layer).shape;
    const sb = copperLayerPropsConst(aSecond.padstack, layer).shape;
    if (sa.size.x !== sb.size.x) padCopperMatches = sa.size.x < sb.size.x;
    else if (sa.size.y !== sb.size.y) padCopperMatches = sa.size.y < sb.size.y;
    else if (sa.shape !== sb.shape)
      padCopperMatches = PAD_SHAPE_ORDER[sa.shape] < PAD_SHAPE_ORDER[sb.shape];
  }

  if (padCopperMatches !== undefined) return padCopperMatches;

  if (!aFirst.padstack.layerSet.equals(aSecond.padstack.layerSet))
    return seqLess(aFirst.padstack.layerSet, aSecond.padstack.layerSet);

  if (aFirst.uuid !== aSecond.uuid) return uuidLess(aFirst.uuid, aSecond.uuid);

  return ia < ib;
}

/** `FOOTPRINT::cmp_zones` (footprint.cpp:4556). */
function cmpZones(aFirst: KZone, aSecond: KZone, ia: number, ib: number): boolean {
  if (aFirst.priority !== aSecond.priority) return aFirst.priority < aSecond.priority;

  if (!aFirst.layerSet.equals(aSecond.layerSet)) return seqLess(aFirst.layerSet, aSecond.layerSet);

  const va = outlineVertices(aFirst.outline.flat());
  const vb = outlineVertices(aSecond.outline.flat());
  if (va.length !== vb.length) return va.length < vb.length;

  for (let ii = 0; ii < va.length; ++ii) {
    const cmp = cmpPointsOpt(va[ii]!, vb[ii]!);
    if (cmp !== undefined) return cmp;
  }

  if (aFirst.uuid !== aSecond.uuid) return uuidLess(aFirst.uuid, aSecond.uuid);

  return ia < ib;
}

/**
 * `FormatBoardToFormatter( aOut, aBoard )` (:322) through a
 * `PRETTIFIED_STRING_FORMATTER`: the whole `.kicad_pcb` text KiCad writes.
 */
export function FormatBoard(board: KBoard, generator: string = GENERATOR): string {
  const out = new PRETTIFIED_STRING_FORMATTER();
  out.Print(
    `(kicad_pcb (version ${SEXPR_BOARD_FILE_VERSION}) (generator ${out.Quotew(generator)}) (generator_version ${out.Quotew(MAJOR_MINOR_VERSION)})`,
  );
  const io = new PCB_IO_KICAD_SEXPR(out, board);
  io.formatBoard(board);
  out.Print(')');
  return out.Finish();
}
