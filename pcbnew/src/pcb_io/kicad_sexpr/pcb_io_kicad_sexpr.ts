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
import { FormatBool } from '@ziroeda/common/src/io/kicad/kicad_io_utils.js';
import { type OUTPUTFORMATTER, PRETTIFIED_STRING_FORMATTER } from '@ziroeda/common/src/richio.js';
import { FormatDouble2Str } from '@ziroeda/common/src/string_utils.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
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
import { LSET_Name, UNDEFINED_LAYER, User_1, IsCopperLayer } from '../../layer_ids.js';
import type { LSET } from '../../lset.js';
import { SEXPR_BOARD_FILE_VERSION } from './pcb_io_kicad_sexpr_parser.js';

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
