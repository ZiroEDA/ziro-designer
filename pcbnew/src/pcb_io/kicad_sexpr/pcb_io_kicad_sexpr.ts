// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_IO_KICAD_SEXPR` (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.cpp):
 * the `.kicad_pcb` / `.kicad_mod` writer over the item classes, `Format`
 * per item in the C++ order. The file-system half of the plugin — the
 * library cache, `FootprintEnumerate`, `SaveBoard` to a path — is not
 * here; `FormatBoardToFormatter` and `Format( aItem )` are the writer.
 */

import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/src/eda_text.js';
import { CTL_OMIT_COLOR, CTL_OMIT_HYPERLINK } from '@ziroeda/common/src/ctl_flags.js';
import {
  type FileDataType,
  FormatAngle,
  FormatInternalUnits,
  pcbIUScale,
} from '@ziroeda/common/src/eda_units.js';
import { CALLBACK_GAL } from '@ziroeda/common/src/callback_gal.js';
import { GENERATOR } from '@ziroeda/common/src/generator.js';
import {
  FormatBool,
  FormatOptBool,
  FormatStreamData,
  FormatUuid,
} from '@ziroeda/common/src/io/kicad/kicad_io_utils.js';
import { kiidPathAsString } from '@ziroeda/common/src/kiid.js';
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
  MAX_CU_LAYERS,
  PCB_LAYER_ID,
  User_1,
} from '@ziroeda/common/src/layer_ids.js';
import { LAYER_RANGE } from '@ziroeda/common/src/layer_range.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { type OUTPUTFORMATTER, PRETTIFIED_STRING_FORMATTER } from '@ziroeda/common/src/richio.js';
import { FormatDouble2Str, formatF, formatG } from '@ziroeda/common/src/string_utils.js';
import {
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_BOTTOM_RIGHT,
  RECT_CHAMFER_TOP_LEFT,
  RECT_CHAMFER_TOP_RIGHT,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_45, ANGLE_90, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { BOARD } from '../../board.js';
import { BOARD_ITEM, ZONE_LAYER_OVERRIDE } from '../../board_item.js';
import { LAYER, LAYER_T } from '../../board_types.js';
import {
  FOOTPRINT,
  FOOTPRINT_STACKUP,
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_SMD,
  FP_THROUGH_HOLE,
} from '../../footprint.js';
import { PAD } from '../../pad.js';
import {
  CUSTOM_SHAPE_ZONE_MODE,
  PAD_ATTRIB,
  PAD_DRILL_POST_MACHINING_MODE,
  PAD_DRILL_SHAPE,
  PAD_PROP,
  PAD_SHAPE,
  PADSTACK,
  PADSTACK_MODE,
  type PADSTACK_POST_MACHINING_PROPS,
  UNCONNECTED_LAYER_MODE,
} from '../../padstack.js';
import { BARCODE_ECC_T, BARCODE_T, PCB_BARCODE } from '../../pcb_barcode.js';
import { DIM_ARROW_DIRECTION } from '../../pcb_dimension_types.js';
import {
  PCB_DIM_ALIGNED,
  PCB_DIM_CENTER,
  PCB_DIM_LEADER,
  PCB_DIM_ORTHOGONAL,
  PCB_DIM_RADIAL,
  PCB_DIMENSION_BASE,
} from '../../pcb_dimension.js';
import { PCB_FIELD } from '../../pcb_field.js';
import type { PCB_GENERATOR } from '../../pcb_generator.js';
import { PCB_GROUP } from '../../pcb_group.js';
import { PCB_POINT } from '../../pcb_point.js';
import { PCB_REFERENCE_IMAGE } from '../../pcb_reference_image.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TABLE, PCB_TABLECELL } from '../../pcb_table.js';
import { PCB_TARGET } from '../../pcb_target.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_TEXTBOX } from '../../pcb_textbox.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA, UNDEFINED_DRILL_DIAMETER, VIATYPE } from '../../pcb_track.js';
import { TEARDROP_PARAMETERS } from '../../teardrop/teardrop_parameters.js';
import { TEARDROP_TYPE } from '../../teardrop/teardrop_types.js';
import { ZONE } from '../../zone.js';
import {
  ISLAND_REMOVAL_MODE,
  PLACEMENT_SOURCE_T,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
  type ZONE_LAYER_PROPERTIES,
  ZONE_SETTINGS,
} from '../../zone_settings.js';
import { ZONE_CONNECTION } from '../../zones.js';
import { SEXPR_BOARD_FILE_VERSION } from './pcb_io_kicad_sexpr_parser.js';

/** `GetMajorMinorVersion()`: the `generator_version` a 10.0.x build writes. */
export const MAJOR_MINOR_VERSION = '10.0';

/** The `CTL_*` control bits (pcb_io_kicad_sexpr.h:200-223). */
export const CTL_OMIT_INITIAL_COMMENTS = 1 << 0;
export const CTL_OMIT_FOOTPRINT_VERSION = 1 << 1;
export const CTL_OMIT_PAD_NETS = 1 << 2;
export const CTL_OMIT_UUIDS = 1 << 3;
export const CTL_OMIT_PATH = 1 << 4;
export const CTL_OMIT_AT = 1 << 5;
export const CTL_OMIT_LIBNAME = 1 << 6;
/** Format output for a footprint library instead of clipboard or BOARD. */
export const CTL_FOR_LIBRARY =
  CTL_OMIT_PAD_NETS | CTL_OMIT_UUIDS | CTL_OMIT_PATH | CTL_OMIT_AT | CTL_OMIT_LIBNAME;
/** The zero arg constructor when PCB_PLUGIN is used for PLUGIN::Load() and PLUGIN::Save()ing a BOARD file. */
export const CTL_FOR_BOARD = CTL_OMIT_INITIAL_COMMENTS | CTL_OMIT_FOOTPRINT_VERSION;

/** `formatInternalUnits( int, aDataType )` (:454). */
export function formatInternalUnits(aValue: number, aDataType: FileDataType = 'distance'): string {
  return FormatInternalUnits(pcbIUScale, aValue, aDataType);
}

/** `formatInternalUnits( const VECTOR2I& )` (:460). */
export function formatInternalUnitsPt(aCoord: VECTOR2I): string {
  return `${FormatInternalUnits(pcbIUScale, aCoord.x)} ${FormatInternalUnits(pcbIUScale, aCoord.y)}`;
}

/** `formatInternalUnits( const VECTOR2I&, const FOOTPRINT* )` (:466). */
export function formatInternalUnitsFp(aCoord: VECTOR2I, aParentFP: FOOTPRINT | null): string {
  if (aParentFP) {
    const pos = aParentFP.GetPosition();
    let coord: VECTOR2I = { x: aCoord.x - pos.x, y: aCoord.y - pos.y };
    coord = RotatePoint(coord, aParentFP.GetOrientation().negate());
    return formatInternalUnitsPt(coord);
  }

  return formatInternalUnitsPt(aCoord);
}

/** `isDefaultTeardropParameters( tdParams )` (:766). */
function isDefaultTeardropParameters(tdParams: TEARDROP_PARAMETERS): boolean {
  const defaults = new TEARDROP_PARAMETERS();

  return (
    tdParams.m_Enabled === defaults.m_Enabled &&
    tdParams.m_BestLengthRatio === defaults.m_BestLengthRatio &&
    tdParams.m_TdMaxLen === defaults.m_TdMaxLen &&
    tdParams.m_BestWidthRatio === defaults.m_BestWidthRatio &&
    tdParams.m_TdMaxWidth === defaults.m_TdMaxWidth &&
    tdParams.m_CurvedEdges === defaults.m_CurvedEdges &&
    tdParams.m_WidthtoSizeFilterRatio === defaults.m_WidthtoSizeFilterRatio &&
    tdParams.m_AllowUseTwoTracks === defaults.m_AllowUseTwoTracks &&
    tdParams.m_TdOnPadsInZones === defaults.m_TdOnPadsInZones
  );
}

/** `std::set<T, Cmp>`: the items in the comparator's order, duplicates (never equal) dropped. */
function sortedSet<T>(aItems: readonly T[], aLess: (a: T, b: T) => boolean): T[] {
  const out = [...aItems];
  out.sort((a, b) => (aLess(a, b) ? -1 : aLess(b, a) ? 1 : 0));
  return out;
}

/** `wxArrayString::Sort()`: `wxStrcmp`, code-unit order. */
function sortStrings(aStrings: string[]): string[] {
  return aStrings.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `wxString::CmpNoCase` order, for a `CASE_INSENSITIVE_MAP`. */
function cmpNoCase(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : 0;
}

export class PCB_IO_KICAD_SEXPR {
  /** `m_out`: the output formatter. */
  private m_out: OUTPUTFORMATTER;
  private readonly m_ctl: number;
  /** `m_board`: which BOARD, no ownership here. */
  private m_board: BOARD | null = null;
  /** `m_groupValidPtrs`: the board's items, for validating group members. */
  private readonly m_groupValidPtrs = new Set<BOARD_ITEM>();
  /**
   * The `(generator …)` written after a `(version …)`: the C++ writes its own
   * program name, "pcbnew", as a literal; ours is the one place it deviates.
   */
  private readonly m_generator: string;

  constructor(
    aOut: OUTPUTFORMATTER,
    aControlFlags: number = CTL_FOR_BOARD,
    aGenerator: string = GENERATOR,
  ) {
    this.m_out = aOut;
    this.m_ctl = aControlFlags;
    this.m_generator = aGenerator;
  }

  /** `m_board`, for the item formatters that ask it (`GetBoard()` is null in a library). */
  SetBoard(aBoard: BOARD | null): void {
    this.m_board = aBoard;
  }

  /** `FormatBoardToFormatter( aOut, aBoard )` (:322). */
  FormatBoardToFormatter(aOut: OUTPUTFORMATTER, aBoard: BOARD): void {
    for (const _ of this.FormatBoardToFormatterSteps(aOut, aBoard)) {
      // drained synchronously
    }
  }

  /**
   * `FormatBoardToFormatter`, as steps: the same text, yielded to the caller
   * between items so a save that runs while the editor is live can hand the
   * thread back between them (`FormatBoardAsync`). Draining it without a
   * pause is `FormatBoardToFormatter`.
   */
  *FormatBoardToFormatterSteps(aOut: OUTPUTFORMATTER, aBoard: BOARD): Generator<void, void> {
    this.m_board = aBoard; // after init()

    // If the user wants fonts embedded, make sure that they are added to the board.  Otherwise,
    // remove any fonts that were previously embedded.
    if (this.m_board.GetAreFontsEmbedded()) this.m_board.EmbedFonts();
    else this.m_board.GetEmbeddedFiles().ClearEmbeddedFonts();

    this.m_out = aOut;

    this.m_out.Print(
      `(kicad_pcb (version ${SEXPR_BOARD_FILE_VERSION}) (generator ${this.m_out.Quotew(this.m_generator)}) (generator_version ${this.m_out.Quotew(MAJOR_MINOR_VERSION)})`,
    );

    yield* this.formatBoardSteps(aBoard);

    this.m_out.Print(')');
  }

  /** `Format( aItem )` (:371). */
  Format(aItem: BOARD_ITEM): void {
    switch (aItem.Type()) {
      case KICAD_T.PCB_T:
        this.formatBoard(aItem as BOARD);
        break;

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
        this.formatDimension(aItem as PCB_DIMENSION_BASE);
        break;

      case KICAD_T.PCB_SHAPE_T:
        this.formatShape(aItem as PCB_SHAPE);
        break;

      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        this.formatReferenceImage(aItem as PCB_REFERENCE_IMAGE);
        break;

      case KICAD_T.PCB_POINT_T:
        this.formatPoint(aItem as PCB_POINT);
        break;

      case KICAD_T.PCB_TARGET_T:
        this.formatTarget(aItem as PCB_TARGET);
        break;

      case KICAD_T.PCB_FOOTPRINT_T:
        this.formatFootprint(aItem as FOOTPRINT);
        break;

      case KICAD_T.PCB_PAD_T:
        this.formatPad(aItem as PAD);
        break;

      case KICAD_T.PCB_FIELD_T:
        // Handled in the footprint formatter when properties are formatted
        break;

      case KICAD_T.PCB_TEXT_T:
        this.formatText(aItem as PCB_TEXT);
        break;

      case KICAD_T.PCB_TEXTBOX_T:
        this.formatTextBox(aItem as PCB_TEXTBOX);
        break;

      case KICAD_T.PCB_BARCODE_T:
        this.formatBarcode(aItem as PCB_BARCODE);
        break;

      case KICAD_T.PCB_TABLE_T:
        this.formatTable(aItem as PCB_TABLE);
        break;

      case KICAD_T.PCB_GROUP_T:
        this.formatGroup(aItem as PCB_GROUP);
        break;

      case KICAD_T.PCB_GENERATOR_T:
        this.formatGenerator(aItem as PCB_GENERATOR);
        break;

      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_ARC_T:
      case KICAD_T.PCB_VIA_T:
        this.formatTrack(aItem as PCB_TRACK);
        break;

      case KICAD_T.PCB_ZONE_T:
        this.formatZone(aItem as ZONE);
        break;

      default:
        throw new Error(`Cannot format item ${aItem.GetClass()}`); // wxFAIL_MSG
    }
  }

  // -------------------------------------------------------------------------
  // formatLayer (:480), formatPolyPts (:488), formatRenderCache (:523)
  // -------------------------------------------------------------------------

  private formatLayer(aLayer: PCB_LAYER_ID, aIsKnockout = false): void {
    this.m_out.Print(
      `(layer ${this.m_out.Quotew(LSET.Name(aLayer))} ${aIsKnockout ? 'knockout' : ''})`,
    );
  }

  private formatPolyPts(outline: SHAPE_LINE_CHAIN, aParentFP: FOOTPRINT | null = null): void {
    this.m_out.Print('(pts');

    for (let ii = 0; ii < outline.PointCount(); ++ii) {
      const ind = outline.ArcIndex(ii);

      if (ind < 0) {
        this.m_out.Print(`(xy ${formatInternalUnitsFp(outline.CPoint(ii), aParentFP)})`);
      } else {
        const arc = outline.Arc(ind);
        this.m_out.Print(
          `(arc (start ${formatInternalUnitsFp(arc.GetP0(), aParentFP)}) (mid ${formatInternalUnitsFp(arc.GetArcMid(), aParentFP)}) (end ${formatInternalUnitsFp(arc.GetP1(), aParentFP)}))`,
        );

        do {
          ++ii;
        } while (ii < outline.PointCount() && outline.ArcIndex(ii) === ind);

        --ii;
      }
    }

    this.m_out.Print(')');
  }

  private formatRenderCache(aText: EDA_TEXT): void {
    const resolvedText = aText.GetShownText(true);
    const cache = aText.GetRenderCache(aText.GetFont()!, resolvedText);

    this.m_out.Print(
      `(render_cache ${this.m_out.Quotew(resolvedText)} ${FormatAngle(aText.GetDrawRotation().AsDegrees())}`,
    );

    const callback_gal = new CALLBACK_GAL(
      // Polygon callback
      (aPoly: SHAPE_LINE_CHAIN) => {
        this.m_out.Print('(polygon');
        this.formatPolyPts(aPoly);
        this.m_out.Print(')');
      },
    );

    callback_gal.SetLineWidth(aText.GetTextThickness());
    callback_gal.DrawGlyphs(cache ?? []);

    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // The header: formatSetup (:551), formatGeneral (:641), formatBoardLayers (:659),
  // formatProperties (:711), formatVariants (:722), formatHeader (:747)
  // -------------------------------------------------------------------------

  private formatSetup(aBoard: BOARD): void {
    // Setup
    this.m_out.Print('(setup');

    // Save the board physical stackup structure
    const stackup = aBoard.GetDesignSettings().GetStackupDescriptor();

    if (aBoard.GetDesignSettings().m_HasStackup) stackup.FormatBoardStackup(this.m_out);

    const dsnSettings = aBoard.GetDesignSettings();

    this.m_out.Print(
      `(pad_to_mask_clearance ${formatInternalUnits(dsnSettings.m_SolderMaskExpansion)})`,
    );

    if (dsnSettings.m_SolderMaskMinWidth) {
      this.m_out.Print(
        `(solder_mask_min_width ${formatInternalUnits(dsnSettings.m_SolderMaskMinWidth)})`,
      );
    }

    if (dsnSettings.m_SolderPasteMargin !== 0) {
      this.m_out.Print(
        `(pad_to_paste_clearance ${formatInternalUnits(dsnSettings.m_SolderPasteMargin)})`,
      );
    }

    if (dsnSettings.m_SolderPasteMarginRatio !== 0) {
      this.m_out.Print(
        `(pad_to_paste_clearance_ratio ${FormatDouble2Str(dsnSettings.m_SolderPasteMarginRatio)})`,
      );
    }

    FormatBool(
      this.m_out,
      'allow_soldermask_bridges_in_footprints',
      dsnSettings.m_AllowSoldermaskBridgesInFPs,
    );

    this.m_out.Print(0, ' (tenting ');
    FormatBool(this.m_out, 'front', dsnSettings.m_TentViasFront);
    FormatBool(this.m_out, 'back', dsnSettings.m_TentViasBack);
    this.m_out.Print(0, ')');

    this.m_out.Print(0, ' (covering ');
    FormatBool(this.m_out, 'front', dsnSettings.m_CoverViasFront);
    FormatBool(this.m_out, 'back', dsnSettings.m_CoverViasBack);
    this.m_out.Print(0, ')');

    this.m_out.Print(0, ' (plugging ');
    FormatBool(this.m_out, 'front', dsnSettings.m_PlugViasFront);
    FormatBool(this.m_out, 'back', dsnSettings.m_PlugViasBack);
    this.m_out.Print(0, ')');

    FormatBool(this.m_out, 'capping', dsnSettings.m_CapVias);

    FormatBool(this.m_out, 'filling', dsnSettings.m_FillVias);

    if (dsnSettings.m_ZoneLayerProperties.size > 0) {
      this.m_out.Print(0, ' (zone_defaults');

      // std::map<PCB_LAYER_ID, …>: layer order
      for (const layer of [...dsnSettings.m_ZoneLayerProperties.keys()].sort((a, b) => a - b))
        this.formatZoneLayerProperties(dsnSettings.m_ZoneLayerProperties.get(layer)!, 0, layer);

      this.m_out.Print(0, ')\n');
    }

    let origin = dsnSettings.GetAuxOrigin();

    if (origin.x !== 0 || origin.y !== 0) {
      this.m_out.Print(
        `(aux_axis_origin ${formatInternalUnits(origin.x)} ${formatInternalUnits(origin.y)})`,
      );
    }

    origin = dsnSettings.GetGridOrigin();

    if (origin.x !== 0 || origin.y !== 0) {
      this.m_out.Print(
        `(grid_origin ${formatInternalUnits(origin.x)} ${formatInternalUnits(origin.y)})`,
      );
    }

    aBoard.GetPlotOptions().Format(this.m_out);

    this.m_out.Print(')');
  }

  private formatGeneral(aBoard: BOARD): void {
    const dsnSettings = aBoard.GetDesignSettings();

    this.m_out.Print('(general');

    this.m_out.Print(`(thickness ${formatInternalUnits(dsnSettings.GetBoardThickness())})`);

    FormatBool(this.m_out, 'legacy_teardrops', aBoard.LegacyTeardrops());

    this.m_out.Print(')');

    aBoard.GetPageSettings().Format(this.m_out);
    aBoard.GetTitleBlock().Format(this.m_out);
  }

  /** `formatBoardLayers`, which `CLIPBOARD_IO::SaveSelection` calls from outside. */
  FormatBoardLayers(aBoard: BOARD): void {
    this.formatBoardLayers(aBoard);
  }

  private formatBoardLayers(aBoard: BOARD): void {
    this.m_out.Print('(layers');

    // Save only the used copper layers from front to back.

    for (const layer of aBoard.GetEnabledLayers().CuStack()) {
      this.m_out.Print(
        `(${layer} ${this.m_out.Quotew(LSET.Name(layer))} ${LAYER.ShowType(aBoard.GetLayerType(layer))} ${
          LSET.Name(layer) === this.m_board!.GetLayerName(layer)
            ? ''
            : this.m_out.Quotew(this.m_board!.GetLayerName(layer))
        })`,
      );
    }

    // Save used non-copper layers in the order they are defined.
    const seq = aBoard.GetEnabledLayers().TechAndUserUIOrder();

    for (const layer of seq) {
      let print_type = false;

      // User layers (layer id >= User_1) have a qualifier
      // default is "user", but other qualifiers exist
      if (layer >= User_1) {
        if (IsCopperLayer(layer)) print_type = true;

        if (
          aBoard.GetLayerType(layer) === LAYER_T.LT_FRONT ||
          aBoard.GetLayerType(layer) === LAYER_T.LT_BACK
        )
          print_type = true;
      }

      this.m_out.Print(
        `(${layer} ${this.m_out.Quotew(LSET.Name(layer))} ${
          print_type ? LAYER.ShowType(aBoard.GetLayerType(layer)) : 'user'
        } ${
          this.m_board!.GetLayerName(layer) === LSET.Name(layer)
            ? ''
            : this.m_out.Quotew(this.m_board!.GetLayerName(layer))
        })`,
      );
    }

    this.m_out.Print(')');
  }

  private formatProperties(aBoard: BOARD): void {
    // std::map<wxString, wxString>: key order
    const props = [...aBoard.GetProperties().entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );

    for (const [first, second] of props) {
      this.m_out.Print(`(property ${this.m_out.Quotew(first)} ${this.m_out.Quotew(second)})`);
    }
  }

  private formatVariants(aBoard: BOARD): void {
    const variantNames = aBoard.GetVariantNames();

    if (variantNames.length === 0) return;

    this.m_out.Print('(variants');

    for (const variantName of variantNames) {
      this.m_out.Print(`(variant (name ${this.m_out.Quotew(variantName)})`);

      const description = aBoard.GetVariantDescription(variantName);

      if (description !== '') this.m_out.Print(`(description ${this.m_out.Quotew(description)})`);

      this.m_out.Print(')');
    }

    this.m_out.Print(')');
  }

  private formatHeader(aBoard: BOARD): void {
    this.formatGeneral(aBoard);

    // Layers list.
    this.formatBoardLayers(aBoard);

    // Setup
    this.formatSetup(aBoard);

    // Properties
    this.formatProperties(aBoard);

    // Variants
    this.formatVariants(aBoard);
  }

  private formatTeardropParameters(tdParams: TEARDROP_PARAMETERS): void {
    this.m_out.Print(
      `(teardrops (best_length_ratio ${FormatDouble2Str(tdParams.m_BestLengthRatio)}) (max_length ${formatInternalUnits(tdParams.m_TdMaxLen)}) (best_width_ratio ${FormatDouble2Str(tdParams.m_BestWidthRatio)}) (max_width ${formatInternalUnits(tdParams.m_TdMaxWidth)})`,
    );

    FormatBool(this.m_out, 'curved_edges', tdParams.m_CurvedEdges);

    this.m_out.Print(`(filter_ratio ${FormatDouble2Str(tdParams.m_WidthtoSizeFilterRatio)})`);

    FormatBool(this.m_out, 'enabled', tdParams.m_Enabled);
    FormatBool(this.m_out, 'allow_two_segments', tdParams.m_AllowUseTwoTracks);
    FormatBool(this.m_out, 'prefer_zone_connections', !tdParams.m_TdOnPadsInZones);
    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // format( const BOARD* ) (:802)
  // -------------------------------------------------------------------------

  private formatBoard(aBoard: BOARD): void {
    for (const _ of this.formatBoardSteps(aBoard)) {
      // drained synchronously
    }
  }

  /** `formatBoard`, yielding after every item (see FormatBoardToFormatterSteps). */
  private *formatBoardSteps(aBoard: BOARD): Generator<void, void> {
    // Rebuild once per board-level save rather than lazily on first use, so a caller that
    // reuses this plugin instance to save the same board pointer more than once (e.g. after
    // items were added to or removed from a group) never formats groups against a stale cache.
    this.m_groupValidPtrs.clear();

    for (const [, item] of aBoard.GetItemByIdCache()) this.m_groupValidPtrs.add(item);

    const sorted_footprints = sortedSet<BOARD_ITEM>(aBoard.Footprints(), BOARD_ITEM.ptr_cmp);
    const sorted_drawings = sortedSet<BOARD_ITEM>(aBoard.Drawings(), BOARD.cmp_drawings);
    const sorted_tracks = sortedSet<PCB_TRACK>(aBoard.Tracks(), PCB_TRACK.cmp_tracks);
    const sorted_points = sortedSet<PCB_POINT>(aBoard.Points(), PCB_POINT.cmp_points);
    const sorted_zones = sortedSet<BOARD_ITEM>(aBoard.Zones(), BOARD_ITEM.ptr_cmp);
    const sorted_groups = sortedSet<BOARD_ITEM>(aBoard.Groups(), BOARD_ITEM.ptr_cmp);
    const sorted_generators = sortedSet<BOARD_ITEM>(aBoard.Generators(), BOARD_ITEM.ptr_cmp);
    this.formatHeader(aBoard);

    yield;

    // Save the footprints.
    for (const footprint of sorted_footprints) {
      this.Format(footprint);
      yield;
    }

    // Save the graphical items on the board (not owned by a footprint)
    for (const item of sorted_drawings) {
      this.Format(item);
      yield;
    }

    // Save the points
    for (const point of sorted_points) {
      this.Format(point);
      yield;
    }

    // Do not save PCB_MARKERs, they can be regenerated easily.

    // Save the tracks and vias.
    for (const track of sorted_tracks) {
      this.Format(track);
      yield;
    }

    // Save the polygon (which are the newer technology) zones.
    for (const zone of sorted_zones) {
      this.Format(zone);
      yield;
    }

    // Save the groups
    for (const group of sorted_groups) {
      this.Format(group);
      yield;
    }

    // Save the generators
    for (const gen of sorted_generators) {
      this.Format(gen);
      yield;
    }

    // Save any embedded files
    // Consolidate the embedded models in footprints into a single map
    // to avoid duplicating the same model in the board file.
    const files_to_write = new EMBEDDED_FILES();

    for (const [, file] of aBoard.GetEmbeddedFiles().EmbeddedFileMap())
      files_to_write.AddFile(file);

    for (const item of sorted_footprints) {
      const fp = item as FOOTPRINT;

      for (const [, file] of fp.GetEmbeddedFiles().EmbeddedFileMap()) files_to_write.AddFile(file);
    }

    this.m_out.Print(
      `(embedded_fonts ${aBoard.GetEmbeddedFiles().GetAreFontsEmbedded() ? 'yes' : 'no'})`,
    );

    if (!files_to_write.IsEmpty())
      files_to_write.WriteEmbeddedFiles(this.m_out, (this.m_ctl & CTL_FOR_BOARD) !== 0);

    // Remove the files so that they are not freed in the DTOR
    files_to_write.ClearEmbeddedFiles(false);
  }

  // -------------------------------------------------------------------------
  // format( const PCB_DIMENSION_BASE* ) (:885)
  // -------------------------------------------------------------------------

  private formatDimension(aDimension: PCB_DIMENSION_BASE): void {
    const aligned = aDimension instanceof PCB_DIM_ALIGNED ? aDimension : null;
    const ortho = aDimension instanceof PCB_DIM_ORTHOGONAL ? aDimension : null;
    const center = aDimension instanceof PCB_DIM_CENTER ? aDimension : null;
    const radial = aDimension instanceof PCB_DIM_RADIAL ? aDimension : null;
    const leader = aDimension instanceof PCB_DIM_LEADER ? aDimension : null;

    this.m_out.Print('(dimension');

    if (ortho)
      // must be tested before aligned, because ortho is derived from aligned
      // and aligned is not null
      this.m_out.Print('(type orthogonal)');
    else if (aligned) this.m_out.Print('(type aligned)');
    else if (leader) this.m_out.Print('(type leader)');
    else if (center) this.m_out.Print('(type center)');
    else if (radial) this.m_out.Print('(type radial)');
    else throw new Error('Cannot format unknown dimension type!'); // wxFAIL_MSG

    if (aDimension.IsLocked()) FormatBool(this.m_out, 'locked', aDimension.IsLocked());

    this.formatLayer(aDimension.GetLayer());

    FormatUuid(this.m_out, aDimension.m_Uuid);

    this.m_out.Print(
      `(pts (xy ${formatInternalUnits(aDimension.GetStart().x)} ${formatInternalUnits(aDimension.GetStart().y)}) (xy ${formatInternalUnits(aDimension.GetEnd().x)} ${formatInternalUnits(aDimension.GetEnd().y)}))`,
    );

    if (aligned) this.m_out.Print(`(height ${formatInternalUnits(aligned.GetHeight())})`);

    if (radial) {
      this.m_out.Print(`(leader_length ${formatInternalUnits(radial.GetLeaderLength())})`);
    }

    if (ortho) this.m_out.Print(`(orientation ${ortho.GetOrientation()})`);

    if (!center) {
      this.m_out.Print(
        `(format (prefix ${this.m_out.Quotew(aDimension.GetPrefix())}) (suffix ${this.m_out.Quotew(aDimension.GetSuffix())}) (units ${aDimension.GetUnitsMode()}) (units_format ${aDimension.GetUnitsFormat()}) (precision ${aDimension.GetPrecision()})`,
      );

      if (aDimension.GetOverrideTextEnabled()) {
        this.m_out.Print(`(override_value ${this.m_out.Quotew(aDimension.GetOverrideText())})`);
      }

      if (aDimension.GetSuppressZeroes()) FormatBool(this.m_out, 'suppress_zeroes', true);

      this.m_out.Print(')');
    }

    this.m_out.Print(
      `(style (thickness ${formatInternalUnits(aDimension.GetLineThickness())}) (arrow_length ${formatInternalUnits(aDimension.GetArrowLength())}) (text_position_mode ${aDimension.GetTextPositionMode()})`,
    );

    if (ortho || aligned) {
      switch (aDimension.GetArrowDirection()) {
        case DIM_ARROW_DIRECTION.OUTWARD:
          this.m_out.Print('(arrow_direction outward)');
          break;
        case DIM_ARROW_DIRECTION.INWARD:
          this.m_out.Print('(arrow_direction inward)');
          break;
        // No default, handle all cases
      }
    }

    if (aligned) {
      this.m_out.Print(`(extension_height ${formatInternalUnits(aligned.GetExtensionHeight())})`);
    }

    if (leader) this.m_out.Print(`(text_frame ${leader.GetTextBorder()})`);

    this.m_out.Print(`(extension_offset ${formatInternalUnits(aDimension.GetExtensionOffset())})`);

    if (aDimension.GetKeepTextAligned()) FormatBool(this.m_out, 'keep_text_aligned', true);

    this.m_out.Print(')');

    // Write dimension text after all other options to be sure the
    // text options are known when reading the file
    if (!center) this.formatText(aDimension);

    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // format( const PCB_SHAPE* ) (:1000)
  // -------------------------------------------------------------------------

  private formatShape(aShape: PCB_SHAPE): void {
    const parentFP = aShape.GetParentFootprint();
    const prefix = parentFP ? 'fp' : 'gr';

    switch (aShape.GetShape()) {
      case SHAPE_T.SEGMENT:
        this.m_out.Print(
          `(${prefix}_line (start ${formatInternalUnitsFp(aShape.GetStart(), parentFP)}) (end ${formatInternalUnitsFp(aShape.GetEnd(), parentFP)})`,
        );
        break;

      case SHAPE_T.RECTANGLE:
        this.m_out.Print(
          `(${prefix}_rect (start ${formatInternalUnitsFp(aShape.GetStart(), parentFP)}) (end ${formatInternalUnitsFp(aShape.GetEnd(), parentFP)})`,
        );

        if (aShape.GetCornerRadius() > 0)
          this.m_out.Print(` (radius ${formatInternalUnits(aShape.GetCornerRadius())})`);
        break;

      case SHAPE_T.CIRCLE:
        this.m_out.Print(
          `(${prefix}_circle (center ${formatInternalUnitsFp(aShape.GetStart(), parentFP)}) (end ${formatInternalUnitsFp(aShape.GetEnd(), parentFP)})`,
        );
        break;

      case SHAPE_T.ARC:
        this.m_out.Print(
          `(${prefix}_arc (start ${formatInternalUnitsFp(aShape.GetStart(), parentFP)}) (mid ${formatInternalUnitsFp(aShape.GetArcMid(), parentFP)}) (end ${formatInternalUnitsFp(aShape.GetEnd(), parentFP)})`,
        );
        break;

      case SHAPE_T.POLY:
        if (aShape.IsPolyShapeValid()) {
          const poly = aShape.GetPolyShape();
          const outline = poly.Outline(0);

          this.m_out.Print(`(${prefix}_poly`);
          this.formatPolyPts(outline, parentFP);
        } else {
          return;
        }

        break;

      case SHAPE_T.BEZIER:
        this.m_out.Print(
          `(${prefix}_curve (pts (xy ${formatInternalUnitsFp(aShape.GetStart(), parentFP)}) (xy ${formatInternalUnitsFp(aShape.GetBezierC1(), parentFP)}) (xy ${formatInternalUnitsFp(aShape.GetBezierC2(), parentFP)}) (xy ${formatInternalUnitsFp(aShape.GetEnd(), parentFP)}))`,
        );
        break;

      default:
        // UNIMPLEMENTED_FOR( aShape->SHAPE_T_asString() )
        return;
    }

    aShape.GetStroke().Format(this.m_out, pcbIUScale);

    // The filled flag represents if a solid fill is present on circles, rectangles and polygons
    if (
      aShape.GetShape() === SHAPE_T.POLY ||
      aShape.GetShape() === SHAPE_T.RECTANGLE ||
      aShape.GetShape() === SHAPE_T.CIRCLE
    ) {
      switch (aShape.GetFillMode()) {
        case FILL_T.HATCH:
          this.m_out.Print('(fill hatch)');
          break;

        case FILL_T.REVERSE_HATCH:
          this.m_out.Print('(fill reverse_hatch)');
          break;

        case FILL_T.CROSS_HATCH:
          this.m_out.Print('(fill cross_hatch)');
          break;

        case FILL_T.FILLED_SHAPE:
          FormatBool(this.m_out, 'fill', true);
          break;

        default:
          FormatBool(this.m_out, 'fill', false);
          break;
      }
    }

    if (aShape.IsLocked()) FormatBool(this.m_out, 'locked', true);

    if (aShape.GetLayerSet().count() > 1)
      this.formatLayers(aShape.GetLayerSet(), false /* enumerate layers */);
    else this.formatLayer(aShape.GetLayer());

    if (
      aShape.HasSolderMask() &&
      aShape.GetLocalSolderMaskMargin() !== undefined &&
      IsExternalCopperLayer(aShape.GetLayer())
    ) {
      this.m_out.Print(
        `(solder_mask_margin ${formatInternalUnits(aShape.GetLocalSolderMaskMargin()!)})`,
      );
    }

    if (!(this.m_ctl & CTL_OMIT_PAD_NETS) && aShape.GetNetCode() > 0)
      this.m_out.Print(`(net ${this.m_out.Quotew(aShape.GetNetname())})`);

    FormatUuid(this.m_out, aShape.m_Uuid);
    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // format( const PCB_REFERENCE_IMAGE* ) (:1124), PCB_POINT (:1156), PCB_TARGET (:1170)
  // -------------------------------------------------------------------------

  private formatReferenceImage(aBitmap: PCB_REFERENCE_IMAGE): void {
    const refImage = aBitmap.GetReferenceImage();

    const image = refImage.GetImage().GetImageData();

    if (!image) return; // wxCHECK_RET( image != nullptr, "wxImage* is NULL" )

    this.m_out.Print(
      `(image (at ${formatInternalUnits(aBitmap.GetPosition().x)} ${formatInternalUnits(aBitmap.GetPosition().y)})`,
    );

    this.formatLayer(aBitmap.GetLayer());

    if (refImage.GetImageScale() !== 1.0)
      this.m_out.Print(`(scale ${formatG(refImage.GetImageScale(), 6)})`);

    if (aBitmap.IsLocked()) FormatBool(this.m_out, 'locked', true);

    const ostream = refImage.GetImage().SaveImageData();

    FormatStreamData(this.m_out, ostream ?? new Uint8Array(0));

    FormatUuid(this.m_out, aBitmap.m_Uuid);
    this.m_out.Print(')'); // Closes image token.
  }

  private formatPoint(aPoint: PCB_POINT): void {
    this.m_out.Print(
      `(point (at ${formatInternalUnitsPt(aPoint.GetPosition())}) (size ${formatInternalUnits(aPoint.GetSize())})`,
    );

    this.formatLayer(aPoint.GetLayer());

    FormatUuid(this.m_out, aPoint.m_Uuid);
    this.m_out.Print(')');
  }

  private formatTarget(aTarget: PCB_TARGET): void {
    this.m_out.Print(
      `(target ${aTarget.GetShape() ? 'x' : 'plus'} (at ${formatInternalUnitsPt(aTarget.GetPosition())}) (size ${formatInternalUnits(aTarget.GetSize())})`,
    );

    if (aTarget.GetWidth() !== 0)
      this.m_out.Print(`(width ${formatInternalUnits(aTarget.GetWidth())})`);

    this.formatLayer(aTarget.GetLayer());
    FormatUuid(this.m_out, aTarget.m_Uuid);
    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // format( const FOOTPRINT* ) (:1186)
  // -------------------------------------------------------------------------

  private formatFootprint(aFootprint: FOOTPRINT): void {
    if (!(this.m_ctl & CTL_OMIT_INITIAL_COMMENTS)) {
      const initial_comments = aFootprint.GetInitialComments();

      if (initial_comments) {
        for (let i = 0; i < initial_comments.length; ++i)
          this.m_out.Print(`${initial_comments[i]}\n`);
      }
    }

    if (this.m_ctl & CTL_OMIT_LIBNAME) {
      this.m_out.Print(`(footprint ${this.m_out.Quotes(aFootprint.GetFPID().GetLibItemName())}`);
    } else {
      this.m_out.Print(`(footprint ${this.m_out.Quotes(aFootprint.GetFPID().Format())}`);
    }

    if (!(this.m_ctl & CTL_OMIT_FOOTPRINT_VERSION)) {
      this.m_out.Print(
        `(version ${SEXPR_BOARD_FILE_VERSION}) (generator ${this.m_out.Quotew(this.m_generator)}) (generator_version ${this.m_out.Quotew(MAJOR_MINOR_VERSION)})`,
      );
    }

    if (aFootprint.IsLocked()) FormatBool(this.m_out, 'locked', true);

    if (aFootprint.IsPlaced()) FormatBool(this.m_out, 'placed', true);

    this.formatLayer(aFootprint.GetLayer());

    if (!(this.m_ctl & CTL_OMIT_UUIDS)) FormatUuid(this.m_out, aFootprint.m_Uuid);

    if (!(this.m_ctl & CTL_OMIT_AT)) {
      this.m_out.Print(
        `(at ${formatInternalUnitsPt(aFootprint.GetPosition())} ${
          aFootprint.GetOrientation().IsZero()
            ? ''
            : FormatAngle(aFootprint.GetOrientation().AsDegrees())
        })`,
      );
    }

    if (aFootprint.GetLibDescription() !== '')
      this.m_out.Print(`(descr ${this.m_out.Quotew(aFootprint.GetLibDescription())})`);

    if (aFootprint.GetKeywords() !== '')
      this.m_out.Print(`(tags ${this.m_out.Quotew(aFootprint.GetKeywords())})`);

    for (const field of aFootprint.GetFields()) {
      if (!field) continue;

      this.m_out.Print(
        `(property ${this.m_out.Quotew(field.GetCanonicalName())} ${this.m_out.Quotew(field.GetText())}`,
      );

      this.formatText(field);

      this.m_out.Print(')');
    }

    const compClass = aFootprint.GetStaticComponentClass();

    if (compClass) {
      if (!compClass.IsEmpty()) {
        this.m_out.Print('(component_classes');

        for (const constituent of compClass.GetConstituentClasses())
          this.m_out.Print(`(class ${this.m_out.Quotew(constituent.GetName())})`);

        this.m_out.Print(')');
      }
    }

    if (aFootprint.GetFilters() !== '') {
      this.m_out.Print(`(property ki_fp_filters ${this.m_out.Quotew(aFootprint.GetFilters())})`);
    }

    if (!(this.m_ctl & CTL_OMIT_PATH) && aFootprint.GetPath().length > 0)
      this.m_out.Print(`(path ${this.m_out.Quotew(kiidPathAsString(aFootprint.GetPath()))})`);

    if (aFootprint.GetSheetname() !== '')
      this.m_out.Print(`(sheetname ${this.m_out.Quotew(aFootprint.GetSheetname())})`);

    if (aFootprint.GetSheetfile() !== '')
      this.m_out.Print(`(sheetfile ${this.m_out.Quotew(aFootprint.GetSheetfile())})`);

    // Emit unit info for gate swapping metadata (flat pin list form)
    if (aFootprint.GetUnitInfo().length > 0) {
      this.m_out.Print('(units');

      for (const u of aFootprint.GetUnitInfo()) {
        this.m_out.Print(`(unit (name ${this.m_out.Quotew(u.m_unitName)})`);
        this.m_out.Print('(pins');

        for (const n of u.m_pins) this.m_out.Print(` ${this.m_out.Quotew(n)}`);

        this.m_out.Print(')'); // </pins>
        this.m_out.Print(')'); // </unit>
      }

      this.m_out.Print(')'); // </units>
    }

    if (aFootprint.GetLocalSolderMaskMargin() !== undefined) {
      this.m_out.Print(
        `(solder_mask_margin ${formatInternalUnits(aFootprint.GetLocalSolderMaskMargin()!)})`,
      );
    }

    if (aFootprint.GetLocalSolderPasteMargin() !== undefined) {
      this.m_out.Print(
        `(solder_paste_margin ${formatInternalUnits(aFootprint.GetLocalSolderPasteMargin()!)})`,
      );
    }

    if (aFootprint.GetLocalSolderPasteMarginRatio() !== undefined) {
      this.m_out.Print(
        `(solder_paste_margin_ratio ${FormatDouble2Str(aFootprint.GetLocalSolderPasteMarginRatio()!)})`,
      );
    }

    if (aFootprint.GetLocalClearance() !== undefined) {
      this.m_out.Print(`(clearance ${formatInternalUnits(aFootprint.GetLocalClearance()!)})`);
    }

    if (aFootprint.GetLocalZoneConnection() !== ZONE_CONNECTION.INHERITED) {
      this.m_out.Print(`(zone_connect ${aFootprint.GetLocalZoneConnection()})`);
    }

    // Attributes
    if (
      aFootprint.GetAttributes() ||
      aFootprint.AllowMissingCourtyard() ||
      aFootprint.AllowSolderMaskBridges()
    ) {
      this.m_out.Print('(attr');

      if (aFootprint.GetAttributes() & FP_SMD) this.m_out.Print(' smd');

      if (aFootprint.GetAttributes() & FP_THROUGH_HOLE) this.m_out.Print(' through_hole');

      if (aFootprint.GetAttributes() & FP_BOARD_ONLY) this.m_out.Print(' board_only');

      if (aFootprint.GetAttributes() & FP_EXCLUDE_FROM_POS_FILES)
        this.m_out.Print(' exclude_from_pos_files');

      if (aFootprint.GetAttributes() & FP_EXCLUDE_FROM_BOM) this.m_out.Print(' exclude_from_bom');

      if (aFootprint.AllowMissingCourtyard()) this.m_out.Print(' allow_missing_courtyard');

      if (aFootprint.GetAttributes() & FP_DNP) this.m_out.Print(' dnp');

      if (aFootprint.AllowSolderMaskBridges()) this.m_out.Print(' allow_soldermask_bridges');

      this.m_out.Print(')');
    }

    // Expand inner layers is the default stackup mode
    if (aFootprint.GetStackupMode() !== FOOTPRINT_STACKUP.EXPAND_INNER_LAYERS) {
      this.m_out.Print('(stackup');

      const fpLset = aFootprint.GetStackupLayers();
      for (const layer of fpLset.Seq()) {
        const canonicalName = LSET.Name(layer);
        this.m_out.Print(`(layer ${this.m_out.Quotew(canonicalName)})`);
      }

      this.m_out.Print(')');
    }

    if (aFootprint.GetPrivateLayers().any()) {
      this.m_out.Print('(private_layers');

      for (const layer of aFootprint.GetPrivateLayers().Seq()) {
        const canonicalName = LSET.Name(layer);
        this.m_out.Print(` ${this.m_out.Quotew(canonicalName)}`);
      }

      this.m_out.Print(')');
    }

    if (aFootprint.IsNetTie()) {
      this.m_out.Print('(net_tie_pad_groups');

      for (const group of aFootprint.GetNetTiePadGroups())
        this.m_out.Print(` ${this.m_out.Quotew(group)}`);

      this.m_out.Print(')');
    }

    FormatBool(
      this.m_out,
      'duplicate_pad_numbers_are_jumpers',
      aFootprint.GetDuplicatePadNumbersAreJumpers(),
    );

    const jumperGroups = aFootprint.JumperPadGroups();

    if (jumperGroups.length > 0) {
      this.m_out.Print('(jumper_pad_groups');

      for (const group of jumperGroups) {
        this.m_out.Print('(');

        // std::set<wxString>: name order
        for (const padName of sortStrings([...group]))
          this.m_out.Print(`${this.m_out.Quotew(padName)} `);

        this.m_out.Print(')');
      }

      this.m_out.Print(')');
    }

    this.Format(aFootprint.Reference());
    this.Format(aFootprint.Value());

    const sorted_pads = sortedSet<PAD>(aFootprint.Pads(), FOOTPRINT.cmp_pads);
    const sorted_drawings = sortedSet<BOARD_ITEM>(
      aFootprint.GraphicalItems(),
      FOOTPRINT.cmp_drawings,
    );
    const sorted_points = sortedSet<PCB_POINT>(aFootprint.Points(), PCB_POINT.cmp_points);
    const sorted_zones = sortedSet<ZONE>(aFootprint.Zones(), FOOTPRINT.cmp_zones);
    const sorted_groups = sortedSet<BOARD_ITEM>(aFootprint.Groups(), BOARD_ITEM.ptr_cmp);

    // Save drawing elements.

    for (const gr of sorted_drawings) this.Format(gr);

    for (const point of sorted_points) this.Format(point);

    // Save pads.
    for (const pad of sorted_pads) this.Format(pad);

    // Save zones.
    for (const zone of sorted_zones) this.Format(zone);

    // Save groups.
    for (const group of sorted_groups) this.Format(group);

    // Save variants.
    const baseDnp = aFootprint.IsDNP();
    const baseExcludedFromBOM = aFootprint.IsExcludedFromBOM();
    const baseExcludedFromPosFiles = aFootprint.IsExcludedFromPosFiles();

    // CASE_INSENSITIVE_MAP: CmpNoCase order
    const variantNames = [...aFootprint.GetVariants().keys()].sort(cmpNoCase);

    for (const variantName of variantNames) {
      const variant = aFootprint.GetVariants().get(variantName)!;

      this.m_out.Print(`(variant (name ${this.m_out.Quotew(variantName)})`);

      if (variant.GetDNP() !== baseDnp) FormatBool(this.m_out, 'dnp', variant.GetDNP());

      if (variant.GetExcludedFromBOM() !== baseExcludedFromBOM)
        FormatBool(this.m_out, 'exclude_from_bom', variant.GetExcludedFromBOM());

      if (variant.GetExcludedFromPosFiles() !== baseExcludedFromPosFiles) {
        FormatBool(this.m_out, 'exclude_from_pos_files', variant.GetExcludedFromPosFiles());
      }

      // std::map<wxString, wxString>: key order
      const fieldNames = [...variant.GetFields().keys()].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      );

      for (const fieldName of fieldNames) {
        const fieldValue = variant.GetFields().get(fieldName)!;
        const baseField = aFootprint.GetField(fieldName);
        const baseValue = baseField ? baseField.GetText() : '';

        if (fieldValue === baseValue) continue;

        this.m_out.Print(
          `(field (name ${this.m_out.Quotew(fieldName)}) (value ${this.m_out.Quotew(fieldValue)}))`,
        );
      }

      this.m_out.Print(')');
    }

    FormatBool(this.m_out, 'embedded_fonts', aFootprint.GetEmbeddedFiles().GetAreFontsEmbedded());

    if (!aFootprint.GetEmbeddedFiles().IsEmpty())
      aFootprint.WriteEmbeddedFiles(this.m_out, !(this.m_ctl & CTL_FOR_BOARD));

    // Save 3D info.
    for (const bs3D of aFootprint.Models()) {
      if (bs3D.m_Filename !== '') {
        this.m_out.Print(`(model ${this.m_out.Quotew(bs3D.m_Filename)}`);

        if (!bs3D.m_Show) FormatBool(this.m_out, 'hide', !bs3D.m_Show);

        if (bs3D.m_Opacity !== 1.0) this.m_out.Print(`(opacity ${formatF(bs3D.m_Opacity, 4)})`);

        this.m_out.Print(
          `(offset (xyz ${FormatDouble2Str(bs3D.m_Offset.x)} ${FormatDouble2Str(bs3D.m_Offset.y)} ${FormatDouble2Str(bs3D.m_Offset.z)}))`,
        );

        this.m_out.Print(
          `(scale (xyz ${FormatDouble2Str(bs3D.m_Scale.x)} ${FormatDouble2Str(bs3D.m_Scale.y)} ${FormatDouble2Str(bs3D.m_Scale.z)}))`,
        );

        this.m_out.Print(
          `(rotate (xyz ${FormatDouble2Str(bs3D.m_Rotation.x)} ${FormatDouble2Str(bs3D.m_Rotation.y)} ${FormatDouble2Str(bs3D.m_Rotation.z)}))`,
        );

        this.m_out.Print(')');
      }
    }

    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // formatLayers (:1549)
  // -------------------------------------------------------------------------

  private formatLayers(aLayerMask: LSET, aEnumerateLayers: boolean, aIsZone = false): void {
    const cu_all = LSET.AllCuMask();
    const fr_bk = new LSET([B_Cu, F_Cu]);
    const adhes = new LSET([B_Adhes, F_Adhes]);
    const paste = new LSET([B_Paste, F_Paste]);
    const silks = new LSET([B_SilkS, F_SilkS]);
    const mask = new LSET([B_Mask, F_Mask]);
    const crt_yd = new LSET([B_CrtYd, F_CrtYd]);
    const fab = new LSET([B_Fab, F_Fab]);

    const cu_board_mask = LSET.AllCuMask(
      this.m_board ? this.m_board.GetCopperLayerCount() : MAX_CU_LAYERS,
    );

    let output = '';
    let layerMask = new LSET(aLayerMask);

    if (!aEnumerateLayers) {
      // If all copper layers present on the board are enabled, then output the wildcard
      if (new LSET(layerMask).and(cu_board_mask).equals(cu_board_mask)) {
        output += ` ${this.m_out.Quotew('*.Cu')}`;

        // Clear all copper bits because pads might have internal layers that aren't part of the
        // board enabled, and we don't want to output those in the layers listing if we already
        // output the wildcard.
        layerMask = layerMask.and(new LSET(cu_all).not());
      } else if (new LSET(layerMask).and(cu_board_mask).equals(fr_bk)) {
        if (aIsZone) output += ` ${this.m_out.Quotew('F&B.Cu')}`;
        else output += ` ${this.m_out.Quotew('*.Cu')}`;

        layerMask = layerMask.and(new LSET(fr_bk).not());
      }

      if (new LSET(layerMask).and(adhes).equals(adhes)) {
        output += ` ${this.m_out.Quotew('*.Adhes')}`;
        layerMask = layerMask.and(new LSET(adhes).not());
      }

      if (new LSET(layerMask).and(paste).equals(paste)) {
        output += ` ${this.m_out.Quotew('*.Paste')}`;
        layerMask = layerMask.and(new LSET(paste).not());
      }

      if (new LSET(layerMask).and(silks).equals(silks)) {
        output += ` ${this.m_out.Quotew('*.SilkS')}`;
        layerMask = layerMask.and(new LSET(silks).not());
      }

      if (new LSET(layerMask).and(mask).equals(mask)) {
        output += ` ${this.m_out.Quotew('*.Mask')}`;
        layerMask = layerMask.and(new LSET(mask).not());
      }

      if (new LSET(layerMask).and(crt_yd).equals(crt_yd)) {
        output += ` ${this.m_out.Quotew('*.CrtYd')}`;
        layerMask = layerMask.and(new LSET(crt_yd).not());
      }

      if (new LSET(layerMask).and(fab).equals(fab)) {
        output += ` ${this.m_out.Quotew('*.Fab')}`;
        layerMask = layerMask.and(new LSET(fab).not());
      }
    }

    // output any individual layers not handled in wildcard combos above
    for (let layer = 0; layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT; ++layer) {
      if (layerMask.test(layer))
        output += ` ${this.m_out.Quotew(LSET.Name(layer as PCB_LAYER_ID))}`;
    }

    this.m_out.Print(`(layers ${output})`);
  }

  // -------------------------------------------------------------------------
  // format( const PAD* ) (:1634)
  // -------------------------------------------------------------------------

  private formatPad(aPad: PAD): void {
    const board = aPad.GetBoard();

    const shapeName = (aLayer: PCB_LAYER_ID): string => {
      switch (aPad.GetShape(aLayer)) {
        case PAD_SHAPE.CIRCLE:
          return 'circle';
        case PAD_SHAPE.RECTANGLE:
          return 'rect';
        case PAD_SHAPE.OVAL:
          return 'oval';
        case PAD_SHAPE.TRAPEZOID:
          return 'trapezoid';
        case PAD_SHAPE.CHAMFERED_RECT:
        case PAD_SHAPE.ROUNDRECT:
          return 'roundrect';
        case PAD_SHAPE.CUSTOM:
          return 'custom';

        default:
          throw new Error(`unknown pad type: ${aPad.GetShape(aLayer)}`); // THROW_IO_ERROR
      }
    };

    let type: string;

    switch (aPad.GetAttribute()) {
      case PAD_ATTRIB.PTH:
        type = 'thru_hole';
        break;
      case PAD_ATTRIB.SMD:
        type = 'smd';
        break;
      case PAD_ATTRIB.CONN:
        type = 'connect';
        break;
      case PAD_ATTRIB.NPTH:
        type = 'np_thru_hole';
        break;

      default:
        throw new Error(`unknown pad attribute: ${aPad.GetAttribute()}`); // THROW_IO_ERROR
    }

    let property: string | null = null;

    switch (aPad.GetProperty()) {
      case PAD_PROP.NONE:
        break; // could be "none"
      case PAD_PROP.BGA:
        property = 'pad_prop_bga';
        break;
      case PAD_PROP.FIDUCIAL_GLBL:
        property = 'pad_prop_fiducial_glob';
        break;
      case PAD_PROP.FIDUCIAL_LOCAL:
        property = 'pad_prop_fiducial_loc';
        break;
      case PAD_PROP.TESTPOINT:
        property = 'pad_prop_testpoint';
        break;
      case PAD_PROP.HEATSINK:
        property = 'pad_prop_heatsink';
        break;
      case PAD_PROP.CASTELLATED:
        property = 'pad_prop_castellated';
        break;
      case PAD_PROP.MECHANICAL:
        property = 'pad_prop_mechanical';
        break;
      case PAD_PROP.PRESSFIT:
        property = 'pad_prop_pressfit';
        break;

      default:
        throw new Error(`unknown pad property: ${aPad.GetProperty()}`); // THROW_IO_ERROR
    }

    this.m_out.Print(
      `(pad ${this.m_out.Quotew(aPad.GetNumber())} ${type} ${shapeName(PADSTACK.ALL_LAYERS)}`,
    );

    this.m_out.Print(
      `(at ${formatInternalUnitsPt(aPad.GetFPRelativePosition())} ${
        aPad.GetOrientation().IsZero() ? '' : FormatAngle(aPad.GetOrientation().AsDegrees())
      })`,
    );

    this.m_out.Print(`(size ${formatInternalUnitsPt(aPad.GetSize(PADSTACK.ALL_LAYERS))})`);

    if (aPad.GetDelta(PADSTACK.ALL_LAYERS).x !== 0 || aPad.GetDelta(PADSTACK.ALL_LAYERS).y !== 0) {
      this.m_out.Print(`(rect_delta ${formatInternalUnitsPt(aPad.GetDelta(PADSTACK.ALL_LAYERS))})`);
    }

    const drill = aPad.GetDrillSize();
    let shapeoffset = aPad.GetOffset(PADSTACK.ALL_LAYERS);
    let forceShapeOffsetOutput = false;

    aPad.Padstack().ForEachUniqueLayer((layer: PCB_LAYER_ID) => {
      const off = aPad.GetOffset(layer);

      if (off.x !== shapeoffset.x || off.y !== shapeoffset.y) forceShapeOffsetOutput = true;
    });

    if (
      drill.x > 0 ||
      drill.y > 0 ||
      shapeoffset.x !== 0 ||
      shapeoffset.y !== 0 ||
      forceShapeOffsetOutput
    ) {
      this.m_out.Print('(drill');

      if (aPad.GetDrillShape() === PAD_DRILL_SHAPE.OBLONG) this.m_out.Print(' oval');

      if (drill.x > 0) this.m_out.Print(` ${formatInternalUnits(drill.x)}`);

      if (drill.y > 0 && drill.x !== drill.y) this.m_out.Print(` ${formatInternalUnits(drill.y)}`);

      // NOTE: Shape offest is a property of the copper shape, not of the drill, but this was put
      // in the file format under the drill section.  So, it is left here to minimize file format
      // changes, but note that the other padstack layers (if present) will have an offset stored
      // separately.
      if (shapeoffset.x !== 0 || shapeoffset.y !== 0 || forceShapeOffsetOutput)
        this.m_out.Print(`(offset ${formatInternalUnitsPt(aPad.GetOffset(PADSTACK.ALL_LAYERS))})`);

      this.m_out.Print(')');
    }

    if (aPad.Padstack().SecondaryDrill().size.x > 0) {
      this.m_out.Print(
        `(backdrill (size ${formatInternalUnits(aPad.Padstack().SecondaryDrill().size.x)}) (layers ${this.m_out.Quotew(LSET.Name(aPad.Padstack().SecondaryDrill().start))} ${this.m_out.Quotew(LSET.Name(aPad.Padstack().SecondaryDrill().end))}))`,
      );
    }

    if (aPad.Padstack().TertiaryDrill().size.x > 0) {
      this.m_out.Print(
        `(tertiary_drill (size ${formatInternalUnits(aPad.Padstack().TertiaryDrill().size.x)}) (layers ${this.m_out.Quotew(LSET.Name(aPad.Padstack().TertiaryDrill().start))} ${this.m_out.Quotew(LSET.Name(aPad.Padstack().TertiaryDrill().end))}))`,
      );
    }

    this.formatPostMachining('front_post_machining', aPad.Padstack().FrontPostMachining());
    this.formatPostMachining('back_post_machining', aPad.Padstack().BackPostMachining());

    // Add pad property, if exists.
    if (property) this.m_out.Print(`(property ${property})`);

    this.formatLayers(aPad.GetLayerSet(), false /* enumerate layers */);

    if (aPad.GetAttribute() === PAD_ATTRIB.PTH) {
      FormatBool(this.m_out, 'remove_unused_layers', aPad.GetRemoveUnconnected());

      if (aPad.GetRemoveUnconnected()) {
        FormatBool(this.m_out, 'keep_end_layers', aPad.GetKeepTopBottom());

        if (board) {
          // Will be nullptr in footprint library
          this.m_out.Print('(zone_layer_connections');

          for (const layer of board.GetEnabledLayers().CuStack()) {
            if (aPad.GetZoneLayerOverride(layer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED)
              this.m_out.Print(` ${this.m_out.Quotew(LSET.Name(layer))}`);
          }

          this.m_out.Print(')');
        }
      }
    }

    const formatCornerProperties = (aLayer: PCB_LAYER_ID): void => {
      // Output the radius ratio for rounded and chamfered rect pads
      if (
        aPad.GetShape(aLayer) === PAD_SHAPE.ROUNDRECT ||
        aPad.GetShape(aLayer) === PAD_SHAPE.CHAMFERED_RECT
      ) {
        this.m_out.Print(
          `(roundrect_rratio ${FormatDouble2Str(aPad.GetRoundRectRadiusRatio(aLayer))})`,
        );
      }

      // Output the chamfer corners for chamfered rect pads
      if (aPad.GetShape(aLayer) === PAD_SHAPE.CHAMFERED_RECT) {
        this.m_out.Print(`(chamfer_ratio ${FormatDouble2Str(aPad.GetChamferRectRatio(aLayer))})`);

        this.m_out.Print('(chamfer');

        if (aPad.GetChamferPositions(aLayer) & RECT_CHAMFER_TOP_LEFT) this.m_out.Print(' top_left');

        if (aPad.GetChamferPositions(aLayer) & RECT_CHAMFER_TOP_RIGHT)
          this.m_out.Print(' top_right');

        if (aPad.GetChamferPositions(aLayer) & RECT_CHAMFER_BOTTOM_LEFT)
          this.m_out.Print(' bottom_left');

        if (aPad.GetChamferPositions(aLayer) & RECT_CHAMFER_BOTTOM_RIGHT)
          this.m_out.Print(' bottom_right');

        this.m_out.Print(')');
      }
    };

    // For normal padstacks, this is the one and only set of properties.  For complex ones, this
    // will represent the front layer properties, and other layers will be formatted below
    formatCornerProperties(PADSTACK.ALL_LAYERS);

    // Unconnected pad is default net so don't save it.
    if (!(this.m_ctl & CTL_OMIT_PAD_NETS) && aPad.GetNetCode() > 0)
      this.m_out.Print(`(net ${this.m_out.Quotew(aPad.GetNetname())})`);

    // Pin functions and types are closely related to nets, so if CTL_OMIT_NETS is set, omit
    // them as well (for instance when saved from library editor).
    if (!(this.m_ctl & CTL_OMIT_PAD_NETS)) {
      if (aPad.GetPinFunction() !== '')
        this.m_out.Print(`(pinfunction ${this.m_out.Quotew(aPad.GetPinFunction())})`);

      if (aPad.GetPinType() !== '')
        this.m_out.Print(`(pintype ${this.m_out.Quotew(aPad.GetPinType())})`);
    }

    if (aPad.GetPadToDieLength() !== 0) {
      this.m_out.Print(`(die_length ${formatInternalUnits(aPad.GetPadToDieLength())})`);
    }

    if (aPad.GetPadToDieDelay() !== 0) {
      this.m_out.Print(`(die_delay ${formatInternalUnits(aPad.GetPadToDieDelay(), 'time')})`);
    }

    if (aPad.GetLocalSolderMaskMargin() !== undefined) {
      this.m_out.Print(
        `(solder_mask_margin ${formatInternalUnits(aPad.GetLocalSolderMaskMargin()!)})`,
      );
    }

    if (aPad.GetLocalSolderPasteMargin() !== undefined) {
      this.m_out.Print(
        `(solder_paste_margin ${formatInternalUnits(aPad.GetLocalSolderPasteMargin()!)})`,
      );
    }

    if (aPad.GetLocalSolderPasteMarginRatio() !== undefined) {
      this.m_out.Print(
        `(solder_paste_margin_ratio ${FormatDouble2Str(aPad.GetLocalSolderPasteMarginRatio()!)})`,
      );
    }

    if (aPad.GetLocalClearance() !== undefined) {
      this.m_out.Print(`(clearance ${formatInternalUnits(aPad.GetLocalClearance()!)})`);
    }

    if (aPad.GetLocalZoneConnection() !== ZONE_CONNECTION.INHERITED) {
      this.m_out.Print(`(zone_connect ${aPad.GetLocalZoneConnection()})`);
    }

    if (aPad.GetLocalThermalSpokeWidthOverride() !== undefined) {
      this.m_out.Print(
        `(thermal_bridge_width ${formatInternalUnits(aPad.GetLocalThermalSpokeWidthOverride()!)})`,
      );
    }

    let defaultThermalSpokeAngle: EDA_ANGLE = ANGLE_90;

    if (
      aPad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CIRCLE ||
      (aPad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CUSTOM &&
        aPad.GetAnchorPadShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CIRCLE)
    ) {
      defaultThermalSpokeAngle = ANGLE_45;
    }

    if (!aPad.GetThermalSpokeAngle().equals(defaultThermalSpokeAngle)) {
      this.m_out.Print(
        `(thermal_bridge_angle ${FormatAngle(aPad.GetThermalSpokeAngle().AsDegrees())})`,
      );
    }

    if (aPad.GetLocalThermalGapOverride() !== undefined) {
      this.m_out.Print(`(thermal_gap ${formatInternalUnits(aPad.GetLocalThermalGapOverride()!)})`);
    }

    const anchorShape = (aLayer: PCB_LAYER_ID): string => {
      switch (aPad.GetAnchorPadShape(aLayer)) {
        case PAD_SHAPE.RECTANGLE:
          return 'rect';
        default:
          return 'circle';
      }
    };

    const formatPrimitives = (aLayer: PCB_LAYER_ID): void => {
      this.m_out.Print('(primitives');

      // Output all basic shapes
      for (const primitive of aPad.GetPrimitives(aLayer)) {
        switch (primitive.GetShape()) {
          case SHAPE_T.SEGMENT:
            if (primitive.IsProxyItem()) {
              this.m_out.Print(
                `(gr_vector (start ${formatInternalUnitsPt(primitive.GetStart())}) (end ${formatInternalUnitsPt(primitive.GetEnd())})`,
              );
            } else {
              this.m_out.Print(
                `(gr_line (start ${formatInternalUnitsPt(primitive.GetStart())}) (end ${formatInternalUnitsPt(primitive.GetEnd())})`,
              );
            }
            break;

          case SHAPE_T.RECTANGLE:
            if (primitive.IsProxyItem()) {
              this.m_out.Print(
                `(gr_bbox (start ${formatInternalUnitsPt(primitive.GetStart())}) (end ${formatInternalUnitsPt(primitive.GetEnd())})`,
              );
            } else {
              this.m_out.Print(
                `(gr_rect (start ${formatInternalUnitsPt(primitive.GetStart())}) (end ${formatInternalUnitsPt(primitive.GetEnd())})`,
              );

              if (primitive.GetCornerRadius() > 0) {
                this.m_out.Print(` (radius ${formatInternalUnits(primitive.GetCornerRadius())})`);
              }
            }
            break;

          case SHAPE_T.ARC:
            this.m_out.Print(
              `(gr_arc (start ${formatInternalUnitsPt(primitive.GetStart())}) (mid ${formatInternalUnitsPt(primitive.GetArcMid())}) (end ${formatInternalUnitsPt(primitive.GetEnd())})`,
            );
            break;

          case SHAPE_T.CIRCLE:
            this.m_out.Print(
              `(gr_circle (center ${formatInternalUnitsPt(primitive.GetStart())}) (end ${formatInternalUnitsPt(primitive.GetEnd())})`,
            );
            break;

          case SHAPE_T.BEZIER:
            this.m_out.Print(
              `(gr_curve (pts (xy ${formatInternalUnitsPt(primitive.GetStart())}) (xy ${formatInternalUnitsPt(primitive.GetBezierC1())}) (xy ${formatInternalUnitsPt(primitive.GetBezierC2())}) (xy ${formatInternalUnitsPt(primitive.GetEnd())}))`,
            );
            break;

          case SHAPE_T.POLY:
            if (primitive.IsPolyShapeValid()) {
              const poly = primitive.GetPolyShape();
              const outline = poly.Outline(0);

              this.m_out.Print('(gr_poly');
              this.formatPolyPts(outline);
            }
            break;

          default:
            break;
        }

        if (!primitive.IsProxyItem())
          this.m_out.Print(`(width ${formatInternalUnits(primitive.GetWidth())})`);

        // The filled flag represents if a solid fill is present on circles,
        // rectangles and polygons
        if (
          primitive.GetShape() === SHAPE_T.POLY ||
          primitive.GetShape() === SHAPE_T.RECTANGLE ||
          primitive.GetShape() === SHAPE_T.CIRCLE
        ) {
          FormatBool(this.m_out, 'fill', primitive.IsSolidFill());
        }

        this.m_out.Print(')');
      }

      this.m_out.Print(')'); // end of (primitives
    };

    if (aPad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CUSTOM) {
      this.m_out.Print('(options');

      if (aPad.GetCustomShapeInZoneOpt() === CUSTOM_SHAPE_ZONE_MODE.CONVEXHULL)
        this.m_out.Print('(clearance convexhull)');
      else this.m_out.Print('(clearance outline)');

      // Output the anchor pad shape (circle/rect)
      this.m_out.Print(`(anchor ${anchorShape(PADSTACK.ALL_LAYERS)})`);

      this.m_out.Print(')'); // end of (options ...

      // Output graphic primitive of the pad shape
      formatPrimitives(PADSTACK.ALL_LAYERS);
    }

    if (!isDefaultTeardropParameters(aPad.GetTeardropParams()))
      this.formatTeardropParameters(aPad.GetTeardropParams());

    if (
      aPad.Padstack().FrontOuterLayers().has_solder_mask !== undefined ||
      aPad.Padstack().BackOuterLayers().has_solder_mask !== undefined
    ) {
      this.m_out.Print(0, ' (tenting ');
      FormatOptBool(this.m_out, 'front', aPad.Padstack().FrontOuterLayers().has_solder_mask);
      FormatOptBool(this.m_out, 'back', aPad.Padstack().BackOuterLayers().has_solder_mask);
      this.m_out.Print(0, ')');
    }

    FormatUuid(this.m_out, aPad.m_Uuid);

    // TODO: Refactor so that we call formatPadLayer( ALL_LAYERS ) above instead of redundant code
    const formatPadLayer = (aLayer: PCB_LAYER_ID): void => {
      const padstack = aPad.Padstack();

      this.m_out.Print(`(shape ${shapeName(aLayer)})`);
      this.m_out.Print(`(size ${formatInternalUnitsPt(aPad.GetSize(aLayer))})`);

      const delta = aPad.GetDelta(aLayer);

      if (delta.x !== 0 || delta.y !== 0)
        this.m_out.Print(`(rect_delta ${formatInternalUnitsPt(delta)})`);

      shapeoffset = aPad.GetOffset(aLayer);

      if (shapeoffset.x !== 0 || shapeoffset.y !== 0)
        this.m_out.Print(`(offset ${formatInternalUnitsPt(shapeoffset)})`);

      formatCornerProperties(aLayer);

      if (aPad.GetShape(aLayer) === PAD_SHAPE.CUSTOM) {
        this.m_out.Print('(options');

        // Output the anchor pad shape (circle/rect)
        this.m_out.Print(`(anchor ${anchorShape(aLayer)})`);

        this.m_out.Print(')'); // end of (options ...

        // Output graphic primitive of the pad shape
        formatPrimitives(aLayer);
      }

      let defaultLayerAngle: EDA_ANGLE = ANGLE_90;

      if (
        aPad.GetShape(aLayer) === PAD_SHAPE.CIRCLE ||
        (aPad.GetShape(aLayer) === PAD_SHAPE.CUSTOM &&
          aPad.GetAnchorPadShape(aLayer) === PAD_SHAPE.CIRCLE)
      ) {
        defaultLayerAngle = ANGLE_45;
      }

      const layerSpokeAngle = padstack.ThermalSpokeAngle(aLayer);

      if (!layerSpokeAngle.equals(defaultLayerAngle)) {
        this.m_out.Print(`(thermal_bridge_angle ${FormatAngle(layerSpokeAngle.AsDegrees())})`);
      }

      if (padstack.ThermalGap(aLayer) !== undefined) {
        this.m_out.Print(`(thermal_gap ${formatInternalUnits(padstack.ThermalGap(aLayer)!)})`);
      }

      if (padstack.ThermalSpokeWidth(aLayer) !== undefined) {
        this.m_out.Print(
          `(thermal_bridge_width ${formatInternalUnits(padstack.ThermalSpokeWidth(aLayer)!)})`,
        );
      }

      if (padstack.Clearance(aLayer) !== undefined) {
        this.m_out.Print(`(clearance ${formatInternalUnits(padstack.Clearance(aLayer)!)})`);
      }

      if (padstack.ZoneConnection(aLayer) !== undefined) {
        this.m_out.Print(`(zone_connect ${padstack.ZoneConnection(aLayer)})`);
      }
    };

    if (aPad.Padstack().Mode() !== PADSTACK_MODE.NORMAL) {
      if (aPad.Padstack().Mode() === PADSTACK_MODE.FRONT_INNER_BACK) {
        this.m_out.Print('(padstack (mode front_inner_back)');

        this.m_out.Print('(layer "Inner"');
        formatPadLayer(PADSTACK.INNER_LAYERS);
        this.m_out.Print(')');
        this.m_out.Print('(layer "B.Cu"');
        formatPadLayer(B_Cu);
        this.m_out.Print(')');
      } else {
        this.m_out.Print('(padstack (mode custom)');

        const layerCount = board ? board.GetCopperLayerCount() : MAX_CU_LAYERS;

        for (const layer of new LAYER_RANGE(F_Cu, B_Cu, layerCount)) {
          if (layer === F_Cu) continue;

          this.m_out.Print(`(layer ${this.m_out.Quotew(LSET.Name(layer))}`);
          formatPadLayer(layer);
          this.m_out.Print(')');
        }
      }

      this.m_out.Print(')');
    }

    this.m_out.Print(')');
  }

  private formatPostMachining(aName: string, aProps: PADSTACK_POST_MACHINING_PROPS): void {
    if (
      aProps.mode === undefined ||
      aProps.mode === PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED
    )
      return;

    this.m_out.Print(
      `(${aName} ${aProps.mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE ? 'counterbore' : 'countersink'}`,
    );

    if (aProps.size > 0) this.m_out.Print(` (size ${formatInternalUnits(aProps.size)})`);

    if (aProps.depth > 0) this.m_out.Print(` (depth ${formatInternalUnits(aProps.depth)})`);

    if (aProps.angle > 0) this.m_out.Print(` (angle ${FormatDouble2Str(aProps.angle / 10.0)})`);

    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // format( const PCB_BARCODE* ) (:2198)
  // -------------------------------------------------------------------------

  private formatBarcode(aBarcode: PCB_BARCODE): void {
    this.m_out.Print('(barcode');

    if (aBarcode.IsLocked()) FormatBool(this.m_out, 'locked', true);

    this.m_out.Print(
      `(at ${formatInternalUnitsPt(aBarcode.GetPosition())} ${FormatAngle(aBarcode.GetAngle().AsDegrees())})`,
    );

    this.formatLayer(aBarcode.GetLayer());

    this.m_out.Print(
      `(size ${formatInternalUnits(aBarcode.GetWidth())} ${formatInternalUnits(aBarcode.GetHeight())})`,
    );

    this.m_out.Print(`(text ${this.m_out.Quotew(aBarcode.GetText())})`);

    this.m_out.Print(`(text_height ${formatInternalUnits(aBarcode.GetTextSize())})`);

    let typeStr = 'code39';

    switch (aBarcode.GetKind()) {
      case BARCODE_T.CODE_39:
        typeStr = 'code39';
        break;
      case BARCODE_T.CODE_128:
        typeStr = 'code128';
        break;
      case BARCODE_T.DATA_MATRIX:
        typeStr = 'datamatrix';
        break;
      case BARCODE_T.QR_CODE:
        typeStr = 'qr';
        break;
      case BARCODE_T.MICRO_QR_CODE:
        typeStr = 'microqr';
        break;
    }

    this.m_out.Print(`(type ${typeStr})`);

    if (
      aBarcode.GetKind() === BARCODE_T.QR_CODE ||
      aBarcode.GetKind() === BARCODE_T.MICRO_QR_CODE
    ) {
      let eccStr = 'L';
      switch (aBarcode.GetErrorCorrection()) {
        case BARCODE_ECC_T.L:
          eccStr = 'L';
          break;
        case BARCODE_ECC_T.M:
          eccStr = 'M';
          break;
        case BARCODE_ECC_T.Q:
          eccStr = 'Q';
          break;
        case BARCODE_ECC_T.H:
          eccStr = 'H';
          break;
      }

      this.m_out.Print(`(ecc_level ${eccStr})`);
    }

    FormatBool(this.m_out, 'hide', !aBarcode.GetShowText());
    FormatBool(this.m_out, 'knockout', aBarcode.IsKnockout());

    if (aBarcode.GetMargin().x !== 0 || aBarcode.GetMargin().y !== 0) {
      this.m_out.Print(
        `(margins ${formatInternalUnits(aBarcode.GetMargin().x)} ${formatInternalUnits(aBarcode.GetMargin().y)})`,
      );
    }

    FormatUuid(this.m_out, aBarcode.m_Uuid);

    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // format( const PCB_TEXT* ) (:2264), format( const PCB_TEXTBOX* ) (:2328),
  // format( const PCB_TABLE* ) (:2400)
  // -------------------------------------------------------------------------

  private formatText(aText: PCB_TEXT): void {
    let parentFP = aText.GetParentFootprint();
    let prefix: string;
    let type = '';
    let pos: VECTOR2I = aText.GetTextPos();
    const field = aText instanceof PCB_FIELD ? aText : null;

    // Always format dimension text as gr_text
    if (aText instanceof PCB_DIMENSION_BASE) parentFP = null;

    if (parentFP) {
      prefix = 'fp';
      type = 'user';

      const fpPos = parentFP.GetPosition();
      pos = { x: pos.x - fpPos.x, y: pos.y - fpPos.y };
      pos = RotatePoint(pos, parentFP.GetOrientation().negate());
    } else {
      prefix = 'gr';
    }

    if (!field) {
      this.m_out.Print(`(${prefix}_text ${type} ${this.m_out.Quotew(aText.GetText())}`);

      if (aText.IsLocked()) FormatBool(this.m_out, 'locked', true);
    }

    this.m_out.Print(
      `(at ${formatInternalUnitsPt(pos)} ${FormatAngle(aText.GetTextAngle().AsDegrees())})`,
    );

    if (parentFP && !aText.IsKeepUpright()) FormatBool(this.m_out, 'unlocked', true);

    this.formatLayer(aText.GetLayer(), aText.IsKnockout());

    if (field && !field.IsVisible()) FormatBool(this.m_out, 'hide', true);

    FormatUuid(this.m_out, aText.m_Uuid);

    // Currently, texts have no specific color and no hyperlink.
    // so ensure they are never written in kicad_pcb file
    const ctl_flags = CTL_OMIT_COLOR | CTL_OMIT_HYPERLINK;

    EDA_TEXT.prototype.Format.call(aText as unknown as EDA_TEXT, this.m_out, ctl_flags);

    if (aText.GetFont()?.IsOutline()) this.formatRenderCache(aText as unknown as EDA_TEXT);

    if (!field) this.m_out.Print(')');
  }

  private formatTextBox(aTextBox: PCB_TEXTBOX): void {
    const parentFP = aTextBox.GetParentFootprint();

    this.m_out.Print(
      `(${
        aTextBox.Type() === KICAD_T.PCB_TABLECELL_T
          ? 'table_cell'
          : parentFP
            ? 'fp_text_box'
            : 'gr_text_box'
      } ${this.m_out.Quotew(aTextBox.GetText())}`,
    );

    if (aTextBox.IsLocked()) FormatBool(this.m_out, 'locked', true);

    if (aTextBox.GetShape() === SHAPE_T.RECTANGLE) {
      this.m_out.Print(
        `(start ${formatInternalUnitsFp(aTextBox.GetStart(), parentFP)}) (end ${formatInternalUnitsFp(aTextBox.GetEnd(), parentFP)})`,
      );
    } else if (aTextBox.GetShape() === SHAPE_T.POLY) {
      const poly = aTextBox.GetPolyShape();
      const outline = poly.Outline(0);

      this.formatPolyPts(outline, parentFP);
    } else {
      // UNIMPLEMENTED_FOR( aTextBox->SHAPE_T_asString() )
    }

    this.m_out.Print(
      `(margins ${formatInternalUnits(aTextBox.GetMarginLeft())} ${formatInternalUnits(aTextBox.GetMarginTop())} ${formatInternalUnits(aTextBox.GetMarginRight())} ${formatInternalUnits(aTextBox.GetMarginBottom())})`,
    );

    if (aTextBox instanceof PCB_TABLECELL)
      this.m_out.Print(`(span ${aTextBox.GetColSpan()} ${aTextBox.GetRowSpan()})`);

    let angle = aTextBox.GetTextAngle();

    if (parentFP) {
      angle = angle.sub(parentFP.GetOrientation());
      angle.Normalize720();
    }

    if (!angle.IsZero()) this.m_out.Print(`(angle ${FormatAngle(angle.AsDegrees())})`);

    this.formatLayer(aTextBox.GetLayer());

    FormatUuid(this.m_out, aTextBox.m_Uuid);

    EDA_TEXT.prototype.Format.call(aTextBox as unknown as EDA_TEXT, this.m_out, 0);

    if (aTextBox.Type() !== KICAD_T.PCB_TABLECELL_T) {
      FormatBool(this.m_out, 'border', aTextBox.IsBorderEnabled());
      aTextBox.GetStroke().Format(this.m_out, pcbIUScale);

      FormatBool(this.m_out, 'knockout', aTextBox.IsKnockout());
    }

    if (aTextBox.GetFont()?.IsOutline()) this.formatRenderCache(aTextBox as unknown as EDA_TEXT);

    this.m_out.Print(')');
  }

  private formatTable(aTable: PCB_TABLE): void {
    this.m_out.Print(`(table (column_count ${aTable.GetColCount()})`);

    FormatUuid(this.m_out, aTable.m_Uuid);

    if (aTable.IsLocked()) FormatBool(this.m_out, 'locked', true);

    this.formatLayer(aTable.GetLayer());

    this.m_out.Print('(border');
    FormatBool(this.m_out, 'external', aTable.StrokeExternal());
    FormatBool(this.m_out, 'header', aTable.StrokeHeaderSeparator());

    if (aTable.StrokeExternal() || aTable.StrokeHeaderSeparator())
      aTable.GetBorderStroke().Format(this.m_out, pcbIUScale);

    this.m_out.Print(')'); // Close `border` token.

    this.m_out.Print('(separators');
    FormatBool(this.m_out, 'rows', aTable.StrokeRows());
    FormatBool(this.m_out, 'cols', aTable.StrokeColumns());

    if (aTable.StrokeRows() || aTable.StrokeColumns())
      aTable.GetSeparatorsStroke().Format(this.m_out, pcbIUScale);

    this.m_out.Print(')'); // Close `separators` token.

    this.m_out.Print('(column_widths');

    for (let col = 0; col < aTable.GetColCount(); ++col)
      this.m_out.Print(` ${formatInternalUnits(aTable.GetColWidth(col))}`);

    this.m_out.Print(')');

    this.m_out.Print('(row_heights');

    for (let row = 0; row < aTable.GetRowCount(); ++row)
      this.m_out.Print(` ${formatInternalUnits(aTable.GetRowHeight(row))}`);

    this.m_out.Print(')');

    this.m_out.Print('(cells');

    for (const cell of aTable.GetCells()) this.formatTextBox(cell);

    this.m_out.Print(')'); // Close `cells` token.
    this.m_out.Print(')'); // Close `table` token.
  }

  // -------------------------------------------------------------------------
  // format( const PCB_GROUP* ) (:2455), format( const PCB_GENERATOR* ) (:2509)
  // -------------------------------------------------------------------------

  private formatGroup(aGroup: PCB_GROUP): void {
    const memberIds: string[] = [];

    // Validate member pointers against the board cache to avoid use-after-free on dangling
    // pointers (e.g. when a group held a reference to a deleted item).  This validation only
    // applies when the group itself is part of m_board; for groups created off-board (e.g. a
    // DeepClone() used by the clipboard) the cache contains the originals, not our clones, so
    // skip the validation in that case and trust the member pointers.
    //
    // m_groupValidPtrs is rebuilt once per board-level save (see format( const BOARD* )) rather
    // than once per group; formatting scaled as O(Groups * BoardItems) when the pointer set was
    // rebuilt inside this function.
    const validateAgainstBoard = this.m_board !== null && this.m_groupValidPtrs.has(aGroup);

    if (validateAgainstBoard) {
      for (const member of aGroup.GetItems()) {
        if (this.m_groupValidPtrs.has(member as BOARD_ITEM)) memberIds.push(member.m_Uuid);
      }
    } else {
      for (const member of aGroup.GetItems()) memberIds.push(member.m_Uuid);
    }

    if (memberIds.length === 0) return;

    this.m_out.Print(`(group ${this.m_out.Quotew(aGroup.GetName())}`);

    FormatUuid(this.m_out, aGroup.m_Uuid);

    if (aGroup.IsLocked()) FormatBool(this.m_out, 'locked', true);

    if (aGroup.HasDesignBlockLink())
      this.m_out.Print(`(lib_id "${aGroup.GetDesignBlockLibId().Format()}")`);

    sortStrings(memberIds);

    this.m_out.Print('(members');

    for (const memberId of memberIds) this.m_out.Print(` ${this.m_out.Quotew(memberId)}`);

    this.m_out.Print(')'); // Close `members` token.
    this.m_out.Print(')'); // Close `group` token.
  }

  private formatGenerator(aGenerator: PCB_GENERATOR): void {
    // Some conditions appear to still be creating ghost tuning patterns.  Don't save them.
    if (aGenerator.GetGeneratorType() === 'tuning_pattern' && aGenerator.GetItems().size === 0) {
      return;
    }

    this.m_out.Print('(generated');

    FormatUuid(this.m_out, aGenerator.m_Uuid);

    this.m_out.Print(
      `(type ${aGenerator.GetGeneratorType()}) (name ${this.m_out.Quotew(aGenerator.GetName())}) (layer ${this.m_out.Quotew(LSET.Name(aGenerator.GetLayer()))})`,
    );

    if (aGenerator.IsLocked()) FormatBool(this.m_out, 'locked', true);

    // STRING_ANY_MAP is a std::map<std::string, wxAny>: key order
    const props = aGenerator.GetProperties();
    const keys = [...props.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    for (const key of keys) {
      const value = props.get(key);

      if (typeof value === 'number') {
        const buf = formatG(value, 10);

        // Don't quote numbers
        this.m_out.Print(`(${key} ${buf})`);
      } else if (typeof value === 'boolean') {
        FormatBool(this.m_out, key, value);
      } else if (value instanceof SHAPE_LINE_CHAIN) {
        this.m_out.Print(`(${key} `);
        this.formatPolyPts(value);
        this.m_out.Print(')');
      } else if (isVector2(value)) {
        this.m_out.Print(`(${key} (xy ${formatInternalUnitsPt(value)}))`);
      } else {
        const val = typeof value === 'string' ? value : '';

        this.m_out.Print(`(${key} ${this.m_out.Quotew(val)})`);
      }
    }

    const memberIds: string[] = [];

    for (const member of aGenerator.GetItems()) memberIds.push(member.m_Uuid);

    sortStrings(memberIds);

    this.m_out.Print('(members');

    for (const memberId of memberIds) this.m_out.Print(` ${this.m_out.Quotew(memberId)}`);

    this.m_out.Print(')'); // Close `members` token.
    this.m_out.Print(')'); // Close `generated` token.
  }

  // -------------------------------------------------------------------------
  // format( const PCB_TRACK* ) (:2607)
  // -------------------------------------------------------------------------

  private formatTrack(aTrack: PCB_TRACK): void {
    if (aTrack.Type() === KICAD_T.PCB_VIA_T) {
      const via = aTrack as PCB_VIA;
      const board = via.GetBoard();

      if (!board) return; // wxCHECK_RET( board != nullptr, "Via has no parent." )

      this.m_out.Print('(via');

      const [layer1, layer2] = via.LayerPair();

      switch (via.GetViaType()) {
        case VIATYPE.THROUGH: //  Default shape not saved.
          break;

        case VIATYPE.BLIND:
          this.m_out.Print(' blind ');
          break;

        case VIATYPE.BURIED:
          this.m_out.Print(' buried ');
          break;

        case VIATYPE.MICROVIA:
          this.m_out.Print(' micro ');
          break;

        default:
          throw new Error(`unknown via type ${via.GetViaType()}`); // THROW_IO_ERROR
      }

      this.m_out.Print(
        `(at ${formatInternalUnitsPt(aTrack.GetStart())}) (size ${formatInternalUnits(via.GetWidth(F_Cu))})`,
      );

      // Old boards were using UNDEFINED_DRILL_DIAMETER value in file for via drill when
      // via drill was the netclass value.
      // recent boards always set the via drill to the actual value, but now we need to
      // always store the drill value, because netclass value is not stored in the board file.
      // Otherwise the drill value of some (old) vias can be unknown
      if (via.GetDrill() !== UNDEFINED_DRILL_DIAMETER)
        this.m_out.Print(`(drill ${formatInternalUnits(via.GetDrill())})`);
      else this.m_out.Print(`(drill ${formatInternalUnits(via.GetDrillValue())})`);

      if (via.Padstack().SecondaryDrill().size.x > 0) {
        this.m_out.Print(
          `(backdrill (size ${formatInternalUnits(via.Padstack().SecondaryDrill().size.x)}) (layers ${this.m_out.Quotew(LSET.Name(via.Padstack().SecondaryDrill().start))} ${this.m_out.Quotew(LSET.Name(via.Padstack().SecondaryDrill().end))}))`,
        );
      }

      if (via.Padstack().TertiaryDrill().size.x > 0) {
        this.m_out.Print(
          `(tertiary_drill (size ${formatInternalUnits(via.Padstack().TertiaryDrill().size.x)}) (layers ${this.m_out.Quotew(LSET.Name(via.Padstack().TertiaryDrill().start))} ${this.m_out.Quotew(LSET.Name(via.Padstack().TertiaryDrill().end))}))`,
        );
      }

      this.formatPostMachining('front_post_machining', via.Padstack().FrontPostMachining());
      this.formatPostMachining('back_post_machining', via.Padstack().BackPostMachining());

      this.m_out.Print(
        `(layers ${this.m_out.Quotew(LSET.Name(layer1))} ${this.m_out.Quotew(LSET.Name(layer2))})`,
      );

      switch (via.Padstack().UnconnectedLayerMode()) {
        case UNCONNECTED_LAYER_MODE.REMOVE_ALL:
          FormatBool(this.m_out, 'remove_unused_layers', true);
          FormatBool(this.m_out, 'keep_end_layers', false);
          break;

        case UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END:
          FormatBool(this.m_out, 'remove_unused_layers', true);
          FormatBool(this.m_out, 'keep_end_layers', true);
          break;

        case UNCONNECTED_LAYER_MODE.START_END_ONLY:
          FormatBool(this.m_out, 'start_end_only', true);
          break;

        case UNCONNECTED_LAYER_MODE.KEEP_ALL:
          break;
      }

      if (via.IsLocked()) FormatBool(this.m_out, 'locked', true);

      if (via.GetIsFree()) FormatBool(this.m_out, 'free', true);

      if (via.GetRemoveUnconnected()) {
        this.m_out.Print('(zone_layer_connections');

        for (const layer of board.GetEnabledLayers().CuStack()) {
          if (via.GetZoneLayerOverride(layer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED)
            this.m_out.Print(` ${this.m_out.Quotew(LSET.Name(layer))}`);
        }

        this.m_out.Print(')');
      }

      const padstack = via.Padstack();

      if (
        padstack.FrontOuterLayers().has_solder_mask !== undefined ||
        padstack.BackOuterLayers().has_solder_mask !== undefined
      ) {
        this.m_out.Print(0, ' (tenting ');
        FormatOptBool(this.m_out, 'front', padstack.FrontOuterLayers().has_solder_mask);
        FormatOptBool(this.m_out, 'back', padstack.BackOuterLayers().has_solder_mask);
        this.m_out.Print(0, ')');
      }

      if (padstack.Drill().is_capped !== undefined)
        FormatOptBool(this.m_out, 'capping', padstack.Drill().is_capped);

      if (
        padstack.FrontOuterLayers().has_covering !== undefined ||
        padstack.BackOuterLayers().has_covering !== undefined
      ) {
        this.m_out.Print(0, ' (covering ');
        FormatOptBool(this.m_out, 'front', padstack.FrontOuterLayers().has_covering);
        FormatOptBool(this.m_out, 'back', padstack.BackOuterLayers().has_covering);
        this.m_out.Print(0, ')');
      }

      if (
        padstack.FrontOuterLayers().has_plugging !== undefined ||
        padstack.BackOuterLayers().has_plugging !== undefined
      ) {
        this.m_out.Print(0, ' (plugging ');
        FormatOptBool(this.m_out, 'front', padstack.FrontOuterLayers().has_plugging);
        FormatOptBool(this.m_out, 'back', padstack.BackOuterLayers().has_plugging);
        this.m_out.Print(0, ')');
      }

      if (padstack.Drill().is_filled !== undefined)
        FormatOptBool(this.m_out, 'filling', padstack.Drill().is_filled);

      if (padstack.Mode() !== PADSTACK_MODE.NORMAL) {
        this.m_out.Print('(padstack');

        if (padstack.Mode() === PADSTACK_MODE.FRONT_INNER_BACK) {
          this.m_out.Print('(mode front_inner_back)');

          this.m_out.Print('(layer "Inner"');
          this.m_out.Print(`(size ${formatInternalUnits(padstack.Size(PADSTACK.INNER_LAYERS).x)})`);
          this.m_out.Print(')');
          this.m_out.Print('(layer "B.Cu"');
          this.m_out.Print(`(size ${formatInternalUnits(padstack.Size(B_Cu).x)})`);
          this.m_out.Print(')');
        } else {
          this.m_out.Print('(mode custom)');

          for (const layer of new LAYER_RANGE(F_Cu, B_Cu, board.GetCopperLayerCount())) {
            if (layer === F_Cu) continue;

            this.m_out.Print(`(layer ${this.m_out.Quotew(LSET.Name(layer))}`);
            this.m_out.Print(`(size ${formatInternalUnits(padstack.Size(layer).x)})`);
            this.m_out.Print(')');
          }
        }

        this.m_out.Print(')');
      }

      if (!isDefaultTeardropParameters(via.GetTeardropParams()))
        this.formatTeardropParameters(via.GetTeardropParams());
    } else {
      if (aTrack.Type() === KICAD_T.PCB_ARC_T) {
        const arc = aTrack as PCB_ARC;

        this.m_out.Print(
          `(arc (start ${formatInternalUnitsPt(arc.GetStart())}) (mid ${formatInternalUnitsPt(arc.GetMid())}) (end ${formatInternalUnitsPt(arc.GetEnd())}) (width ${formatInternalUnits(arc.GetWidth())})`,
        );
      } else {
        this.m_out.Print(
          `(segment (start ${formatInternalUnitsPt(aTrack.GetStart())}) (end ${formatInternalUnitsPt(aTrack.GetEnd())}) (width ${formatInternalUnits(aTrack.GetWidth())})`,
        );
      }

      if (aTrack.IsLocked()) FormatBool(this.m_out, 'locked', true);

      if (aTrack.GetLayerSet().count() > 1)
        this.formatLayers(aTrack.GetLayerSet(), false /* enumerate layers */);
      else this.formatLayer(aTrack.GetLayer());

      if (
        aTrack.HasSolderMask() &&
        aTrack.GetLocalSolderMaskMargin() !== undefined &&
        IsExternalCopperLayer(aTrack.GetLayer())
      ) {
        this.m_out.Print(
          `(solder_mask_margin ${formatInternalUnits(aTrack.GetLocalSolderMaskMargin()!)})`,
        );
      }
    }

    if (!(this.m_ctl & CTL_OMIT_PAD_NETS))
      this.m_out.Print(`(net ${this.m_out.Quotew(aTrack.GetNetname())})`);

    FormatUuid(this.m_out, aTrack.m_Uuid);
    this.m_out.Print(')');
  }

  // -------------------------------------------------------------------------
  // format( const ZONE* ) (:2864), format( const ZONE_LAYER_PROPERTIES& ) (:3096)
  // -------------------------------------------------------------------------

  private formatZone(aZone: ZONE): void {
    this.m_out.Print('(zone');

    if (
      !(this.m_ctl & CTL_OMIT_PAD_NETS) &&
      aZone.IsOnCopperLayer() &&
      !aZone.GetIsRuleArea() &&
      aZone.GetNetCode() > 0
    ) {
      this.m_out.Print(`(net ${this.m_out.Quotew(aZone.GetNetname())})`);
    }

    if (aZone.IsLocked()) FormatBool(this.m_out, 'locked', true);

    // If a zone exists on multiple layers, format accordingly
    let layers = new LSET(aZone.GetLayerSet());

    const zoneBoard = aZone.GetBoard();

    if (zoneBoard) layers = layers.and(zoneBoard.GetEnabledLayers());

    // Always enumerate every layer for a zone on a copper layer
    if (layers.count() > 1) this.formatLayers(layers, aZone.IsOnCopperLayer(), true);
    else this.formatLayer(aZone.GetFirstLayer());

    if (!aZone.IsTeardropArea()) FormatUuid(this.m_out, aZone.m_Uuid);

    if (aZone.GetZoneName() !== '' && !aZone.IsTeardropArea())
      this.m_out.Print(`(name ${this.m_out.Quotew(aZone.GetZoneName())})`);

    // Save the outline aux info
    let hatch: string;

    switch (aZone.GetHatchStyle()) {
      default:
      case ZONE_BORDER_DISPLAY_STYLE.NO_HATCH:
        hatch = 'none';
        break;
      case ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE:
        hatch = 'edge';
        break;
      case ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL:
        hatch = 'full';
        break;
    }

    this.m_out.Print(`(hatch ${hatch} ${formatInternalUnits(aZone.GetBorderHatchPitch())})`);

    if (aZone.GetAssignedPriority() > 0)
      this.m_out.Print(`(priority ${aZone.GetAssignedPriority()})`);

    // Add teardrop keywords in file: (attr (teardrop (type xxx))) where xxx is the teardrop type
    if (aZone.IsTeardropArea()) {
      this.m_out.Print(
        `(attr (teardrop (type ${aZone.GetTeardropAreaType() === TEARDROP_TYPE.TD_VIAPAD ? 'padvia' : 'track_end'})))`,
      );
    }

    this.m_out.Print('(connect_pads');

    switch (aZone.GetPadConnection()) {
      default:
      case ZONE_CONNECTION.THERMAL: // Default option not saved or loaded.
        break;

      case ZONE_CONNECTION.THT_THERMAL:
        this.m_out.Print(' thru_hole_only');
        break;

      case ZONE_CONNECTION.FULL:
        this.m_out.Print(' yes');
        break;

      case ZONE_CONNECTION.NONE:
        this.m_out.Print(' no');
        break;
    }

    this.m_out.Print(`(clearance ${formatInternalUnits(aZone.GetLocalClearance()!)})`);

    this.m_out.Print(')');

    this.m_out.Print(`(min_thickness ${formatInternalUnits(aZone.GetMinThickness())})`);

    if (aZone.GetIsRuleArea()) {
      // Keepout settings
      this.m_out.Print(
        `(keepout (tracks ${aZone.GetDoNotAllowTracks() ? 'not_allowed' : 'allowed'}) (vias ${aZone.GetDoNotAllowVias() ? 'not_allowed' : 'allowed'}) (pads ${aZone.GetDoNotAllowPads() ? 'not_allowed' : 'allowed'}) (copperpour ${aZone.GetDoNotAllowZoneFills() ? 'not_allowed' : 'allowed'}) (footprints ${aZone.GetDoNotAllowFootprints() ? 'not_allowed' : 'allowed'}))`,
      );

      // Multichannel settings
      this.m_out.Print('(placement');
      FormatBool(this.m_out, 'enabled', aZone.GetPlacementAreaEnabled());

      switch (aZone.GetPlacementAreaSourceType()) {
        case PLACEMENT_SOURCE_T.SHEETNAME:
          this.m_out.Print(`(sheetname ${this.m_out.Quotew(aZone.GetPlacementAreaSource())})`);
          break;
        case PLACEMENT_SOURCE_T.COMPONENT_CLASS:
          this.m_out.Print(
            `(component_class ${this.m_out.Quotew(aZone.GetPlacementAreaSource())})`,
          );
          break;
        case PLACEMENT_SOURCE_T.GROUP_PLACEMENT:
          this.m_out.Print(`(group ${this.m_out.Quotew(aZone.GetPlacementAreaSource())})`);
          break;
        // These are transitory and should not be saved
        case PLACEMENT_SOURCE_T.DESIGN_BLOCK:
          break;
      }

      this.m_out.Print(')');
    }

    this.m_out.Print('(fill');

    // Default is not filled.
    if (aZone.IsFilled()) this.m_out.Print(' yes');

    // Default is polygon filled.
    if (aZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN) this.m_out.Print('(mode hatch)');

    if (!aZone.IsTeardropArea()) {
      this.m_out.Print(
        `(thermal_gap ${formatInternalUnits(aZone.GetThermalReliefGap())}) (thermal_bridge_width ${formatInternalUnits(aZone.GetThermalReliefSpokeWidth())})`,
      );
    }

    if (aZone.GetCornerSmoothingType() !== ZONE_SETTINGS.SMOOTHING_NONE) {
      switch (aZone.GetCornerSmoothingType()) {
        case ZONE_SETTINGS.SMOOTHING_CHAMFER:
          this.m_out.Print('(smoothing chamfer)');
          break;

        case ZONE_SETTINGS.SMOOTHING_FILLET:
          this.m_out.Print('(smoothing fillet)');
          break;

        default:
          throw new Error(`unknown zone corner smoothing type ${aZone.GetCornerSmoothingType()}`); // THROW_IO_ERROR
      }

      if (aZone.GetCornerRadius() !== 0)
        this.m_out.Print(`(radius ${formatInternalUnits(aZone.GetCornerRadius())})`);
    }

    this.m_out.Print(`(island_removal_mode ${aZone.GetIslandRemovalMode()})`);

    if (aZone.GetIslandRemovalMode() === ISLAND_REMOVAL_MODE.AREA) {
      this.m_out.Print(
        `(island_area_min ${formatInternalUnits(aZone.GetMinIslandArea() / pcbIUScale.IU_PER_MM)})`,
      );
    }

    if (aZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN) {
      this.m_out.Print(
        `(hatch_thickness ${formatInternalUnits(aZone.GetHatchThickness())}) (hatch_gap ${formatInternalUnits(aZone.GetHatchGap())}) (hatch_orientation ${FormatDouble2Str(aZone.GetHatchOrientation().AsDegrees())})`,
      );

      if (aZone.GetHatchSmoothingLevel() > 0) {
        this.m_out.Print(
          `(hatch_smoothing_level ${aZone.GetHatchSmoothingLevel()}) (hatch_smoothing_value ${FormatDouble2Str(aZone.GetHatchSmoothingValue())})`,
        );
      }

      this.m_out.Print(
        `(hatch_border_algorithm ${aZone.GetHatchBorderAlgorithm() ? 'hatch_thickness' : 'min_thickness'}) (hatch_min_hole_area ${FormatDouble2Str(aZone.GetHatchHoleMinArea())})`,
      );
    }

    this.m_out.Print(')');

    // std::map<PCB_LAYER_ID, …>: layer order
    for (const layer of [...aZone.LayerProperties().keys()].sort((a, b) => a - b)) {
      this.formatZoneLayerProperties(aZone.LayerProperties().get(layer)!, 0, layer);
    }

    if (aZone.GetNumCorners()) {
      const poly = aZone.Outline().Polygon(0);

      for (const chain of poly) {
        if (chain.PointCount() === 0) continue;

        this.m_out.Print('(polygon');
        this.formatPolyPts(chain);
        this.m_out.Print(')');
      }
    }

    // Save the PolysList (filled areas)
    for (const layer of aZone.GetLayerSet().Seq()) {
      const fv = aZone.GetFilledPolysList(layer);

      for (let ii = 0; ii < fv.OutlineCount(); ++ii) {
        this.m_out.Print('(filled_polygon');
        this.m_out.Print(`(layer ${this.m_out.Quotew(LSET.Name(layer))})`);

        if (aZone.IsIsland(layer, ii)) FormatBool(this.m_out, 'island', true);

        const chain = fv.COutline(ii);

        this.formatPolyPts(chain);
        this.m_out.Print(')');
      }
    }

    this.m_out.Print(')');
  }

  private formatZoneLayerProperties(
    aZoneLayerProperties: ZONE_LAYER_PROPERTIES,
    aNestLevel: number,
    aLayer: PCB_LAYER_ID,
  ): void {
    // Do not store the layer properties if no value is actually set.
    if (aZoneLayerProperties.hatching_offset === undefined) return;

    this.m_out.Print(aNestLevel, '(property\n');
    this.m_out.Print(aNestLevel, `(layer ${this.m_out.Quotew(LSET.Name(aLayer))})\n`);

    if (aZoneLayerProperties.hatching_offset !== undefined) {
      this.m_out.Print(
        aNestLevel,
        `(hatch_position (xy ${formatInternalUnitsPt(aZoneLayerProperties.hatching_offset)}))`,
      );
    }

    this.m_out.Print(aNestLevel, ')\n');
  }
}

/** `wxAny::CheckType<VECTOR2I>()`. */
function isVector2(aValue: unknown): aValue is VECTOR2I {
  return (
    typeof aValue === 'object' &&
    aValue !== null &&
    typeof (aValue as VECTOR2I).x === 'number' &&
    typeof (aValue as VECTOR2I).y === 'number'
  );
}

/**
 * `PCB_IO_KICAD_SEXPR::SaveBoard` to a string: `FormatBoardToFormatter` on a
 * `PRETTIFIED_FILE_OUTPUTFORMATTER`, `Finish()`ed.
 */
export function FormatBoard(aBoard: BOARD, aGenerator: string = GENERATOR): string {
  // wxString sanityResult = aBoard->GroupsSanityCheck(): the "Internal Group Data Error" query
  // is not ported; a cycle is repaired at load.
  const formatter = new PRETTIFIED_STRING_FORMATTER();
  const pcb_io = new PCB_IO_KICAD_SEXPR(formatter, CTL_FOR_BOARD, aGenerator);
  pcb_io.FormatBoardToFormatter(formatter, aBoard);
  return formatter.Finish();
}

/**
 * `FormatBoard`, byte for byte, without holding the thread: the formatter's
 * items and the prettifier's characters are walked in slices of `aBudgetMs`,
 * and `aYield` (a macrotask, so input and frames get through) is awaited
 * between slices. `aAbort` read true between slices ends it with null: a
 * board edited while its text is being built would come out inconsistent,
 * so the caller starts over instead.
 *
 * pcbnew has no such thing because it never formats a board except on save
 * (`SavePcbFile`) or on the autosave timer, a modal wait either way; the
 * editor here hands every edit to the project's storage a moment after it,
 * and a board this size formats for seconds (KiCad's own SaveBoard of the
 * jetson demo is 2.1 s natively).
 */
export async function FormatBoardAsync(
  aBoard: BOARD,
  aYield: () => Promise<void>,
  aAbort: () => boolean = () => false,
  aBudgetMs = 8,
  aGenerator: string = GENERATOR,
): Promise<string | null> {
  const formatter = new PRETTIFIED_STRING_FORMATTER();
  const pcb_io = new PCB_IO_KICAD_SEXPR(formatter, CTL_FOR_BOARD, aGenerator);
  const steps = pcb_io.FormatBoardToFormatterSteps(formatter, aBoard);
  let sliceStart = performance.now();

  for (;;) {
    if (steps.next().done) break;

    if (performance.now() - sliceStart >= aBudgetMs) {
      await aYield();
      if (aAbort()) return null;
      sliceStart = performance.now();
    }
  }

  return formatter.FinishAsync(aYield, aAbort, aBudgetMs);
}

/**
 * `PCB_IO_KICAD_SEXPR::FootprintSave`'s text (:3360): `Format( aFootprint )`
 * with `CTL_FOR_LIBRARY`, prettified.
 */
export function FormatFootprintForLibrary(
  aFootprint: FOOTPRINT,
  aGenerator: string = GENERATOR,
): string {
  const formatter = new PRETTIFIED_STRING_FORMATTER();
  const pcb_io = new PCB_IO_KICAD_SEXPR(formatter, CTL_FOR_LIBRARY, aGenerator);
  pcb_io.SetBoard(aFootprint.GetBoard());
  pcb_io.Format(aFootprint);
  return formatter.Finish();
}

/** `CTL_FOR_CLIPBOARD` (pcb_io_kicad_sexpr.h:215). */
export const CTL_FOR_CLIPBOARD = CTL_OMIT_INITIAL_COMMENTS;

/**
 * `CLIPBOARD_IO::SaveSelection` (kicad_clipboard.cpp:322) for a board
 * selection, over a payload BOARD the caller has already reduced to the
 * selection: "we will fake being a .kicad_pcb to get the full parser
 * kicking" — the file header, the layer table, then every item, and nothing
 * else (no setup, no nets table: a 10.0 item names its net).
 */
export function FormatClipboardBoard(aBoard: BOARD, aGenerator: string = GENERATOR): string {
  const formatter = new PRETTIFIED_STRING_FORMATTER();
  const pcb_io = new PCB_IO_KICAD_SEXPR(formatter, CTL_FOR_CLIPBOARD, aGenerator);
  pcb_io.SetBoard(aBoard);
  formatter.Print(
    `(kicad_pcb (version ${SEXPR_BOARD_FILE_VERSION}) (generator ${formatter.Quotew(aGenerator)}) (generator_version ${formatter.Quotew(MAJOR_MINOR_VERSION)})`,
  );
  pcb_io.FormatBoardLayers(aBoard);
  for (const fp of aBoard.Footprints()) pcb_io.Format(fp);
  for (const item of aBoard.Drawings()) pcb_io.Format(item);
  for (const point of aBoard.Points()) pcb_io.Format(point);
  for (const track of aBoard.Tracks()) pcb_io.Format(track);
  for (const zone of aBoard.Zones()) pcb_io.Format(zone);
  for (const group of aBoard.Groups()) pcb_io.Format(group);
  for (const generator of aBoard.Generators()) pcb_io.Format(generator);
  formatter.Print(')');
  return formatter.Finish();
}

/**
 * `CLIPBOARD_IO::SaveSelection` for a lone footprint (kicad_clipboard.cpp:207):
 * `Format( &newFootprint )` with `CTL_FOR_CLIPBOARD`, so the footprint's own
 * version and generator are written and its uuids and placement kept.
 */
export function FormatClipboardFootprint(
  aFootprint: FOOTPRINT,
  aGenerator: string = GENERATOR,
): string {
  const formatter = new PRETTIFIED_STRING_FORMATTER();
  const pcb_io = new PCB_IO_KICAD_SEXPR(formatter, CTL_FOR_CLIPBOARD, aGenerator);
  pcb_io.SetBoard(aFootprint.GetBoard());
  pcb_io.Format(aFootprint);
  return formatter.Finish();
}
