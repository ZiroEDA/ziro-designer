// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcbnew_printout.cpp` + `.h`: PCBNEW_PRINTOUT_SETTINGS, PCBNEW_PRINTOUT
 * (one page per layer or all layers on one page, drawn by the board's VIEW on
 * GAL_PRINT) and PCB_PRINT_PAINTER (the drill marks).
 */

import { BOARD_PRINTOUT, BOARD_PRINTOUT_SETTINGS } from '@ziroeda/common/board_printout.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { COLOR4D_BLACK, COLOR4D_UNSPECIFIED } from '@ziroeda/common/gal/color4d.js';
import type { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import type { PAINTER } from '@ziroeda/common/gal/painter.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { GAL_LAYER_ID, PCB_LAYER_ID, PCBNEW_LAYER_ID_START } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { PAGE_INFO } from '@ziroeda/common/page_info.js';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from './board.js';
import type { PAD } from './pad.js';
import { PAD_DRILL_SHAPE } from './padstack.js';
import { PCB_PAINTER } from './pcb_painter.js';
import { DRILL_MARKS } from './pcb_plot_params.js';
import type { PCB_VIA } from './pcb_track.js';

export enum PAGINATION_T {
  LAYER_PER_PAGE,
  ALL_LAYERS,
}

export class PCBNEW_PRINTOUT_SETTINGS extends BOARD_PRINTOUT_SETTINGS {
  ///< Drill marks type
  m_DrillMarks: DRILL_MARKS;
  m_Pagination: PAGINATION_T;
  ///< Print board edges on all pages
  m_PrintEdgeCutsOnAllPages: boolean;
  ///< Honor checkboxes in the Items tab of the Layers Manager
  m_AsItemCheckboxes: boolean;

  constructor(aPageInfo: PAGE_INFO) {
    super(aPageInfo);
    this.m_DrillMarks = DRILL_MARKS.SMALL_DRILL_SHAPE;
    this.m_Pagination = PAGINATION_T.ALL_LAYERS;
    this.m_PrintEdgeCutsOnAllPages = true;
    this.m_AsItemCheckboxes = false;
  }

  override Load(aConfig: APP_SETTINGS_BASE): void {
    super.Load(aConfig);

    this.m_DrillMarks = aConfig.m_Printing.drill_marks as DRILL_MARKS;
    this.m_Pagination = aConfig.m_Printing.pagination as PAGINATION_T;
    this.m_PrintEdgeCutsOnAllPages = aConfig.m_Printing.edge_cuts_on_all_pages;
    this.m_AsItemCheckboxes = aConfig.m_Printing.as_item_checkboxes;
  }

  override Save(aConfig: APP_SETTINGS_BASE): void {
    super.Save(aConfig);

    aConfig.m_Printing.drill_marks = this.m_DrillMarks;
    aConfig.m_Printing.pagination = this.m_Pagination;
    aConfig.m_Printing.edge_cuts_on_all_pages = this.m_PrintEdgeCutsOnAllPages;
    aConfig.m_Printing.as_item_checkboxes = this.m_AsItemCheckboxes;
  }
}

export class PCBNEW_PRINTOUT extends BOARD_PRINTOUT {
  private readonly m_board: BOARD;
  private readonly m_pcbnewSettings: PCBNEW_PRINTOUT_SETTINGS;

  constructor(aBoard: BOARD, aParams: PCBNEW_PRINTOUT_SETTINGS, aView: VIEW, aTitle: string) {
    super(aParams, aView, aTitle);
    this.m_pcbnewSettings = aParams;
    this.m_board = aBoard;
  }

  override OnPrintPage(aPage: number): boolean {
    // Store the layerset, as it is going to be modified below and the original settings are
    // needed.
    const lset = this.m_settings.m_LayerSet;
    const pageCount = lset.count();
    let layerName: string;

    // compute layer mask from page number if we want one page per layer
    if (this.m_pcbnewSettings.m_Pagination === PAGINATION_T.LAYER_PER_PAGE) {
      // This sequence is TBD, call a different sequencer if needed, such as Seq().
      // Could not find documentation on page order.
      const seq = lset.UIOrder();

      // aPage starts at 1, not 0
      if (aPage - 1 >= 0 && aPage - 1 < seq.length)
        this.m_settings.m_LayerSet = new LSET([seq[aPage - 1]!]);
    }

    if (!this.m_settings.m_LayerSet.any()) return false;

    const extractLayer = this.m_settings.m_LayerSet.ExtractLayer();

    if (extractLayer === PCB_LAYER_ID.UNDEFINED_LAYER) layerName = 'Multiple Layers';
    else layerName = this.m_board.GetLayerName(extractLayer);

    // In Pcbnew we can want the layer EDGE always printed
    if (this.m_pcbnewSettings.m_PrintEdgeCutsOnAllPages) {
      // LSET is a value type upstream; the set above may still be `lset` itself.
      this.m_settings.m_LayerSet = new LSET(this.m_settings.m_LayerSet.Seq());
      this.m_settings.m_LayerSet.set(PCB_LAYER_ID.Edge_Cuts);
    }

    this.DrawPage(layerName, aPage, pageCount);

    // Restore the original layer set, so the next page can be printed
    this.m_settings.m_LayerSet = lset;

    return true;
  }

  protected override milsToIU(aMils: number): number {
    return KiROUND(pcbIUScale.IU_PER_MILS * aMils);
  }

  protected override setupViewLayers(aView: VIEW, aLayerSet: LSET): void {
    super.setupViewLayers(aView, aLayerSet);

    for (const layer of this.m_settings.m_LayerSet.Seq()) {
      aView.SetLayerVisible(PCBNEW_LAYER_ID_START + layer, true);

      // Enable the corresponding zone layer (copper layers and other layers)
      aView.SetLayerVisible(GAL_LAYER_ID.LAYER_ZONE_START + layer, true);
      aView.SetLayerVisible(GAL_LAYER_ID.LAYER_PAD_COPPER_START + layer, true);
      aView.SetLayerVisible(GAL_LAYER_ID.LAYER_VIA_COPPER_START + layer, true);
    }

    const renderSettings = aView.GetPainter()!.GetSettings();
    // A color to do not print objects on some layers, when the layer must be enabled
    // to print some other objects
    const invisible_color = COLOR4D_UNSPECIFIED;

    if (this.m_pcbnewSettings.m_AsItemCheckboxes) {
      const setVisibility = (aLayer: GAL_LAYER_ID): void => {
        if (this.m_board.IsElementVisible(aLayer)) aView.SetLayerVisible(aLayer, true);
        else renderSettings.SetLayerColor(aLayer, invisible_color);
      };

      setVisibility(GAL_LAYER_ID.LAYER_FOOTPRINTS_FR);
      setVisibility(GAL_LAYER_ID.LAYER_FOOTPRINTS_BK);
      setVisibility(GAL_LAYER_ID.LAYER_FP_VALUES);
      setVisibility(GAL_LAYER_ID.LAYER_FP_REFERENCES);
      setVisibility(GAL_LAYER_ID.LAYER_FP_TEXT);
      setVisibility(GAL_LAYER_ID.LAYER_PADS);

      setVisibility(GAL_LAYER_ID.LAYER_TRACKS);
      setVisibility(GAL_LAYER_ID.LAYER_VIAS);
      setVisibility(GAL_LAYER_ID.LAYER_VIA_MICROVIA);
      setVisibility(GAL_LAYER_ID.LAYER_VIA_BLIND);
      setVisibility(GAL_LAYER_ID.LAYER_VIA_BURIED);
      setVisibility(GAL_LAYER_ID.LAYER_VIA_THROUGH);
      setVisibility(GAL_LAYER_ID.LAYER_ZONES);
      setVisibility(GAL_LAYER_ID.LAYER_FILLED_SHAPES);

      setVisibility(GAL_LAYER_ID.LAYER_DRC_WARNING);
      setVisibility(GAL_LAYER_ID.LAYER_DRC_ERROR);
      setVisibility(GAL_LAYER_ID.LAYER_DRC_SHAPES);
      setVisibility(GAL_LAYER_ID.LAYER_DRC_EXCLUSION);
      setVisibility(GAL_LAYER_ID.LAYER_ANCHOR);
      setVisibility(GAL_LAYER_ID.LAYER_DRAWINGSHEET);
      setVisibility(GAL_LAYER_ID.LAYER_GRID);
    } else {
      // Enable items on copper layers, but do not draw holes
      for (const layer of [
        GAL_LAYER_ID.LAYER_VIA_THROUGH,
        GAL_LAYER_ID.LAYER_VIA_MICROVIA,
        GAL_LAYER_ID.LAYER_VIA_BLIND,
        GAL_LAYER_ID.LAYER_VIA_BURIED,
      ]) {
        // Items visible on any copper layer
        if (aLayerSet.and(LSET.AllCuMask()).any()) aView.SetLayerVisible(layer, true);
        else renderSettings.SetLayerColor(layer, invisible_color);
      }

      // Keep certain items always enabled/disabled and just rely on the layer visibility
      // Note LAYER_PADS_SMD_FR, LAYER_PADS_SMD_BK, LAYER_PADS_TH are enabled here because paths must
      // be drawn on some other (technical) layers.
      const alwaysEnabled = [
        GAL_LAYER_ID.LAYER_FP_TEXT,
        GAL_LAYER_ID.LAYER_FP_VALUES,
        GAL_LAYER_ID.LAYER_FP_REFERENCES,
        GAL_LAYER_ID.LAYER_FOOTPRINTS_FR,
        GAL_LAYER_ID.LAYER_FOOTPRINTS_BK,
        GAL_LAYER_ID.LAYER_TRACKS,
        GAL_LAYER_ID.LAYER_VIAS,
        GAL_LAYER_ID.LAYER_ZONES,
        GAL_LAYER_ID.LAYER_FILLED_SHAPES,
        GAL_LAYER_ID.LAYER_PADS,
      ];

      for (const layer of alwaysEnabled) aView.SetLayerVisible(layer, true);
    }

    if (this.m_pcbnewSettings.m_DrillMarks !== DRILL_MARKS.NO_DRILL_SHAPE) {
      // Enable hole layers to draw drill marks
      for (const layer of [
        GAL_LAYER_ID.LAYER_PAD_PLATEDHOLES,
        GAL_LAYER_ID.LAYER_NON_PLATEDHOLES,
        GAL_LAYER_ID.LAYER_VIA_HOLES,
      ]) {
        aView.SetLayerVisible(layer, true);
        aView.SetTopLayer(layer, true);
      }

      if (
        this.m_pcbnewSettings.m_DrillMarks === DRILL_MARKS.FULL_DRILL_SHAPE &&
        !this.m_settings.m_blackWhite
      ) {
        for (const layer of [GAL_LAYER_ID.LAYER_PAD_HOLEWALLS, GAL_LAYER_ID.LAYER_VIA_HOLEWALLS]) {
          aView.SetLayerVisible(layer, true);
          aView.SetTopLayer(layer, true);
        }
      }
    }
  }

  protected override setupPainter(aPainter: PAINTER): void {
    super.setupPainter(aPainter);

    const painter = aPainter as PCB_PRINT_PAINTER;

    switch (this.m_pcbnewSettings.m_DrillMarks) {
      case DRILL_MARKS.NO_DRILL_SHAPE:
        painter.SetDrillMarks(false, 0);
        break;

      case DRILL_MARKS.SMALL_DRILL_SHAPE:
        painter.SetDrillMarks(false, pcbIUScale.mmToIU(ADVANCED_CFG.GetCfg().m_SmallDrillMarkSize));

        painter.GetSettings().SetLayerColor(GAL_LAYER_ID.LAYER_PAD_PLATEDHOLES, COLOR4D_BLACK);
        painter.GetSettings().SetLayerColor(GAL_LAYER_ID.LAYER_NON_PLATEDHOLES, COLOR4D_BLACK);
        painter.GetSettings().SetLayerColor(GAL_LAYER_ID.LAYER_VIA_HOLES, COLOR4D_BLACK);
        break;

      case DRILL_MARKS.FULL_DRILL_SHAPE:
        painter.SetDrillMarks(true);

        painter.GetSettings().SetLayerColor(GAL_LAYER_ID.LAYER_PAD_PLATEDHOLES, COLOR4D_BLACK);
        painter.GetSettings().SetLayerColor(GAL_LAYER_ID.LAYER_NON_PLATEDHOLES, COLOR4D_BLACK);
        painter.GetSettings().SetLayerColor(GAL_LAYER_ID.LAYER_VIA_HOLES, COLOR4D_BLACK);
        break;
    }
  }

  protected override setupGal(aGal: GAL): void {
    super.setupGal(aGal);
    aGal.SetWorldUnitLength(
      0.001 / pcbIUScale.IU_PER_MM /* 1 nm */ / 0.0254 /* 1 inch in meters */,
    );
  }

  protected override getBoundingBox(): BOX2I {
    return this.m_board.ComputeBoundingBox(false, false);
  }

  protected override getPainter(aGal: GAL): PAINTER {
    return new PCB_PRINT_PAINTER(aGal);
  }
}

/**
 * Special flavor of PCB_PAINTER that contains modifications to handle printing options.
 */
export class PCB_PRINT_PAINTER extends PCB_PAINTER {
  ///< Flag deciding whether use the actual hole size or user-specified size for drill marks
  private m_drillMarkReal = false;
  ///< User-specified size for drill marks (expressed in internal units)
  private m_drillMarkSize = 0;

  constructor(aGal: GAL) {
    super(aGal, FRAME_T.FRAME_PCB_EDITOR);
  }

  /**
   * Set drill marks visibility and options.
   *
   * @param aRealSize when enabled, drill marks represent actual holes. Otherwise aSize
   *                  parameter is used.
   * @param aSize is drill mark size (internal units), valid only when aRealSize == false.
   */
  SetDrillMarks(aRealSize: boolean, aSize = 0): void {
    this.m_drillMarkReal = aRealSize;
    this.m_drillMarkSize = aSize;
  }

  protected override getDrillShape(aPad: PAD): PAD_DRILL_SHAPE {
    return this.m_drillMarkReal ? super.getDrillShape(aPad) : PAD_DRILL_SHAPE.CIRCLE;
  }

  protected override getPadHoleShape(aPad: PAD): SHAPE_SEGMENT {
    if (this.m_drillMarkReal) return super.getPadHoleShape(aPad);

    return new SHAPE_SEGMENT(aPad.GetPosition(), aPad.GetPosition(), this.m_drillMarkSize);
  }

  protected override getViaDrillSize(aVia: PCB_VIA): number {
    return this.m_drillMarkReal ? super.getViaDrillSize(aVia) : this.m_drillMarkSize;
  }
}
