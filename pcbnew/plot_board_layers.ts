// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/plot_board_layers.cpp`: plot one board layer (or a sequence of
 * them) through a PLOTTER, and `StartPlotBoard`, which makes the plotter and
 * prepares its page and header.
 *
 * Divergences, each an absence rather than an approximation:
 * - `StartPlotBoard` makes the Gerber plotter only; the plot dialog offers
 *   no other format yet, and the colour back-ends need `COLOR_SETTINGS` in
 *   the plot params first (plot_brditems_plotter.ts).
 * - `PlotInteractiveLayer` (PDF property popups and bookmarks) is PDF-only,
 *   so it waits on the same thing.
 * - The drawing sheet (`PlotDrawingSheet`) is drawn when `GetPlotFrameRef()`.
 */

import { COLOR4D_BLACK, COLOR4D_WHITE } from '@ziroeda/common/gal/color4d.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { LSEQ } from '@ziroeda/common/lseq.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { GERBER_PLOTTER } from '@ziroeda/common/plotters/GERBER_plotter.js';
import { FILL_T, PLOT_FORMAT, PLOTTER } from '@ziroeda/common/plotters/plotter.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { DISABLE_ARC_RADIUS_CORRECTION } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { GBR_APERTURE_ATTRIB, GBR_METADATA } from '@ziroeda/common/gbr_metadata.js';
import { GBR_NETINFO_TYPE } from '@ziroeda/common/gbr_netlist_metadata.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from './board.js';
import { NETINFO_ITEM } from './netinfo.js';
import { PAD } from './pad.js';
import { PAD_ATTRIB, PAD_SHAPE } from './padstack.js';
import { DRILL_MARKS, PCB_PLOT_PARAMS } from './pcb_plot_params.js';
import { PCB_RENDER_SETTINGS } from './pcb_painter.js';
import type { PCB_TEXT } from './pcb_text.js';
import type { PCB_ARC, PCB_VIA } from './pcb_track.js';
import type { FOOTPRINT } from './footprint.js';
import { LAYER_CLASS_FAB } from './board_design_settings.js';
import { AddGerberX2Attribute } from './pcbplot.js';
import { BRDITEMS_PLOTTER } from './plot_brditems_plotter.js';
import { ZONE } from './zone.js';

/** `PlotLayer`: outlines for a DXF in polygon mode, the standard plot otherwise. */
export function PlotLayer(
  aBoard: BOARD,
  aPlotter: PLOTTER,
  layerMask: LSET,
  plotOpts: PCB_PLOT_PARAMS,
): void {
  // PlotLayerOutlines() is designed only for DXF plotters.
  if (plotOpts.GetFormat() === PLOT_FORMAT.DXF && plotOpts.GetDXFPlotPolygonMode())
    PlotLayerOutlines(aBoard, aPlotter, layerMask, plotOpts);
  else PlotStandardLayer(aBoard, aPlotter, layerMask, plotOpts);
}

/** `PlotPolySet`: plot a polygon set as the filled areas of a dummy zone. */
export function PlotPolySet(
  aBoard: BOARD,
  aPlotter: PLOTTER,
  aPlotOpt: PCB_PLOT_PARAMS,
  aPolySet: SHAPE_POLY_SET,
  aLayer: PCB_LAYER_ID,
): void {
  const itemplotter = new BRDITEMS_PLOTTER(aPlotter, aBoard, aPlotOpt);
  const layers = new LSET([aLayer]);

  itemplotter.SetLayerSet(layers);

  // To avoid a lot of code, use a ZONE to handle and plot polygons, because our polygons look
  // exactly like filled areas in zones.
  // Note, also this code is not optimized: it creates a lot of copy/duplicate data.
  // However it is not complex, and fast enough for plot purposes (copy/convert data is only a
  // very small calculation time for these calculations).
  const zone = new ZONE(aBoard);
  zone.SetMinThickness(0);
  zone.SetLayer(aLayer);

  aPolySet.Fracture();
  itemplotter.PlotZone(zone, aLayer, aPolySet);
}

/**
 * Plot a solder mask layer.
 *
 * Solder mask layers have a minimum thickness value and cannot be drawn like standard layers,
 * unless the minimum thickness is 0.
 */
export function PlotSolderMaskLayer(
  aBoard: BOARD,
  aPlotter: PLOTTER,
  aLayerMask: LSET,
  aPlotOpt: PCB_PLOT_PARAMS,
): void {
  if (aBoard.GetDesignSettings().m_SolderMaskMinWidth === 0) {
    PlotLayer(aBoard, aPlotter, aLayerMask, aPlotOpt);
    return;
  }

  const solderMask = new SHAPE_POLY_SET();
  const layer = aLayerMask.test(PCB_LAYER_ID.B_Mask) ? PCB_LAYER_ID.B_Mask : PCB_LAYER_ID.F_Mask;

  GenerateLayerPoly(
    solderMask,
    aBoard,
    aPlotter,
    layer,
    aPlotOpt.GetPlotFPText(),
    aPlotOpt.GetPlotReference(),
    aPlotOpt.GetPlotValue(),
  );

  PlotPolySet(aBoard, aPlotter, aPlotOpt, solderMask, layer);
}

/** `PlotClippedSilkLayer`: the silkscreen with the solder mask openings subtracted. */
export function PlotClippedSilkLayer(
  aBoard: BOARD,
  aPlotter: PLOTTER,
  aLayerMask: LSET,
  aPlotOpt: PCB_PLOT_PARAMS,
): void {
  const silkscreen = new SHAPE_POLY_SET();
  const solderMask = new SHAPE_POLY_SET();
  const front = aLayerMask.test(PCB_LAYER_ID.F_SilkS);
  const silkLayer = front ? PCB_LAYER_ID.F_SilkS : PCB_LAYER_ID.B_SilkS;
  const maskLayer = front ? PCB_LAYER_ID.F_Mask : PCB_LAYER_ID.B_Mask;

  GenerateLayerPoly(
    silkscreen,
    aBoard,
    aPlotter,
    silkLayer,
    aPlotOpt.GetPlotFPText(),
    aPlotOpt.GetPlotReference(),
    aPlotOpt.GetPlotValue(),
  );
  GenerateLayerPoly(
    solderMask,
    aBoard,
    aPlotter,
    maskLayer,
    aPlotOpt.GetPlotFPText(),
    aPlotOpt.GetPlotReference(),
    aPlotOpt.GetPlotValue(),
  );

  silkscreen.BooleanSubtract(solderMask);
  PlotPolySet(aBoard, aPlotter, aPlotOpt, silkscreen, silkLayer);
}

/** `PlotBoardLayers`: each layer of the sequence, then the drill marks. */
export function PlotBoardLayers(
  aBoard: BOARD,
  aPlotter: PLOTTER,
  aLayers: LSEQ,
  aPlotOptions: PCB_PLOT_PARAMS,
): void {
  if (!aBoard || !aPlotter || aLayers.length === 0) return;

  for (const layer of aLayers)
    PlotOneBoardLayer(aBoard, aPlotter, layer, aPlotOptions, layer === aLayers[0]);

  // Drill marks are plotted in white to knockout the pad if any layers of the pad are
  // being plotted, and in black if the pad is not being plotted. For the former, this
  // must happen after all other layers are plotted.
  if (aPlotOptions.GetDrillMarksType() !== DRILL_MARKS.NO_DRILL_SHAPE) {
    const itemplotter = new BRDITEMS_PLOTTER(aPlotter, aBoard, aPlotOptions);
    itemplotter.SetLayerSet(new LSET(aLayers));
    itemplotter.PlotDrillMarks();
  }
}

/** `PlotOneBoardLayer`: dispatch one layer to the plot routine its kind needs. */
export function PlotOneBoardLayer(
  aBoard: BOARD,
  aPlotter: PLOTTER,
  aLayer: PCB_LAYER_ID,
  aPlotOpt: PCB_PLOT_PARAMS,
  isPrimaryLayer: boolean,
): void {
  const plotOpt = new PCB_PLOT_PARAMS();
  plotOpt.assign(aPlotOpt);

  // Set a default color and the text mode for this layer
  aPlotter.SetColor(COLOR4D_BLACK);
  aPlotter.SetTextMode(aPlotOpt.GetTextMode());

  // Specify that the contents of the "Edges Pcb" layer are to be plotted in addition to the
  // contents of the currently specified layer.
  let layer_mask = new LSET([aLayer]);

  if (IsCopperLayer(aLayer)) {
    // Skip NPTH pads on copper layers ( only if hole size == pad size ):
    // Drill mark will be plotted if drill mark is SMALL_DRILL_SHAPE or FULL_DRILL_SHAPE
    if (plotOpt.GetFormat() === PLOT_FORMAT.DXF) plotOpt.SetDXFPlotPolygonMode(true);
    else plotOpt.SetSkipPlotNPTH_Pads(true);

    PlotLayer(aBoard, aPlotter, layer_mask, plotOpt);
  } else {
    switch (aLayer) {
      case PCB_LAYER_ID.B_Mask:
      case PCB_LAYER_ID.F_Mask:
        // Use outline mode for DXF
        plotOpt.SetDXFPlotPolygonMode(true);

        // Plot solder mask:
        PlotSolderMaskLayer(aBoard, aPlotter, layer_mask, plotOpt);

        break;

      case PCB_LAYER_ID.B_Adhes:
      case PCB_LAYER_ID.F_Adhes:
      case PCB_LAYER_ID.B_Paste:
      case PCB_LAYER_ID.F_Paste:
        // Disable plot pad holes
        plotOpt.SetDrillMarksType(DRILL_MARKS.NO_DRILL_SHAPE);

        // Use outline mode for DXF
        plotOpt.SetDXFPlotPolygonMode(true);

        PlotLayer(aBoard, aPlotter, layer_mask, plotOpt);

        break;

      case PCB_LAYER_ID.F_SilkS:
      case PCB_LAYER_ID.B_SilkS:
        if (plotOpt.GetSubtractMaskFromSilk()) {
          if (aPlotter.GetPlotterType() === PLOT_FORMAT.GERBER && isPrimaryLayer) {
            // Use old-school, positive/negative mask plotting which preserves utilization
            // of Gerber aperture masks.  This method can only be used when the given silk
            // layer is the primary layer as the negative mask will also knockout any other
            // (non-silk) layers that were plotted before the silk layer.

            PlotStandardLayer(aBoard, aPlotter, layer_mask, plotOpt);

            // Create the mask to subtract by creating a negative layer polarity
            aPlotter.SetLayerPolarity(false);

            // Disable plot pad holes
            plotOpt.SetDrillMarksType(DRILL_MARKS.NO_DRILL_SHAPE);

            // Plot the mask
            layer_mask =
              aLayer === PCB_LAYER_ID.F_SilkS
                ? new LSET([PCB_LAYER_ID.F_Mask])
                : new LSET([PCB_LAYER_ID.B_Mask]);
            PlotSolderMaskLayer(aBoard, aPlotter, layer_mask, plotOpt);

            // Disable the negative polarity
            aPlotter.SetLayerPolarity(true);
          } else {
            PlotClippedSilkLayer(aBoard, aPlotter, layer_mask, plotOpt);
          }

          break;
        }

        PlotLayer(aBoard, aPlotter, layer_mask, plotOpt);
        break;

      default:
        // Dwgs_User, Cmts_User, Eco1_User, Eco2_User, Edge_Cuts, Margin, F_CrtYd, B_CrtYd,
        // F_Fab, B_Fab, and every other layer
        PlotLayer(aBoard, aPlotter, layer_mask, plotOpt);
        break;
    }
  }
}

/**
 * Plot any layer EXCEPT a solder-mask with an enforced minimum width.
 */
export function PlotStandardLayer(
  aBoard: BOARD,
  aPlotter: PLOTTER,
  aLayerMask: LSET,
  aPlotOpt: PCB_PLOT_PARAMS,
): void {
  const itemplotter = new BRDITEMS_PLOTTER(aPlotter, aBoard, aPlotOpt);
  const maxError = aBoard.GetDesignSettings().m_MaxError;

  itemplotter.SetLayerSet(aLayerMask);

  const onCopperLayer = LSET.AllCuMask().and(aLayerMask).any();
  const onSolderMaskLayer = new LSET([PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask])
    .and(aLayerMask)
    .any();
  const onSolderPasteLayer = new LSET([PCB_LAYER_ID.F_Paste, PCB_LAYER_ID.B_Paste])
    .and(aLayerMask)
    .any();
  const onFrontFab = aLayerMask.test(PCB_LAYER_ID.F_Fab);
  const onBackFab = aLayerMask.test(PCB_LAYER_ID.B_Fab);
  const sketchPads = (onFrontFab || onBackFab) && aPlotOpt.GetSketchPadsOnFabLayers();
  const variantName = aBoard.GetCurrentVariant();

  // Plot edge layer and graphic items
  for (const item of aBoard.Drawings()) itemplotter.PlotBoardGraphicItem(item);

  // Draw footprint texts:
  for (const footprint of aBoard.Footprints()) itemplotter.PlotFootprintTextItems(footprint);

  // Draw footprint other graphic items:
  for (const footprint of aBoard.Footprints()) itemplotter.PlotFootprintGraphicItems(footprint);

  // Plot footprint pads
  for (const footprint of aBoard.Footprints()) {
    const dnp = footprint.GetDNPForVariant(variantName);

    aPlotter.StartBlock(null);

    for (const pad of footprint.Pads()) {
      let doSketchPads = false;

      if (!pad.GetLayerSet().and(aLayerMask).any()) {
        if (
          sketchPads &&
          ((onFrontFab && pad.GetLayerSet().Contains(PCB_LAYER_ID.F_Cu)) ||
            (onBackFab && pad.GetLayerSet().Contains(PCB_LAYER_ID.B_Cu)))
        ) {
          doSketchPads = true;
        } else {
          continue;
        }
      }

      if (onCopperLayer && !pad.IsOnCopperLayer()) continue;

      /// pads not connected to copper are optionally not drawn
      if (onCopperLayer && !pad.FlashLayer(aLayerMask)) continue;

      // TODO(JE) padstacks - different behavior for single layer or multilayer

      // `aPlotOpt.ColorSettings()->GetColor( … )`: see plot_brditems_plotter.ts.
      const color = itemplotter.getColor(aLayerMask.Seq()[0] ?? PCB_LAYER_ID.F_Cu);

      if (
        sketchPads &&
        ((onFrontFab && pad.GetLayerSet().Contains(PCB_LAYER_ID.F_Cu)) ||
          (onBackFab && pad.GetLayerSet().Contains(PCB_LAYER_ID.B_Cu)))
      ) {
        if (aPlotOpt.GetPlotPadNumbers()) itemplotter.PlotPadNumber(pad, color);
      }

      const plotPadLayer = (aLayer: PCB_LAYER_ID): void => {
        let margin = { x: 0, y: 0 };
        let width_adj = 0;

        if (onCopperLayer) width_adj = itemplotter.getFineWidthAdj();

        if (onSolderMaskLayer) {
          const expansion = pad.GetSolderMaskExpansion(aLayer);
          margin = { x: expansion, y: expansion };
        }

        if (onSolderPasteLayer) margin = pad.GetSolderPasteMargin(aLayer);

        // not all shapes can have a different margin for x and y axis
        // in fact only oval and rect shapes can have different values.
        // Round shape have always the same x,y margin
        // so define a unique value for other shapes that do not support different values
        const mask_clearance = margin.x;
        // When clearance is same for x and y pad axis, calculations are more easy
        const sameXYClearance = margin.x === margin.y;

        // Now offset the pad size by margin + width_adj
        const size = pad.GetSize(aLayer);
        const padPlotsSize = {
          x: size.x + margin.x * 2 + width_adj,
          y: size.y + margin.y * 2 + width_adj,
        };

        // Store these parameters that can be modified to plot inflated/deflated pads shape
        const padShape = pad.GetShape(aLayer);
        const padSize = { ...pad.GetSize(aLayer) };
        const padDelta = { ...pad.GetDelta(aLayer) }; // has meaning only for trapezoidal pads
        // CornerRadius and CornerRadiusRatio can be modified
        // the radius is built from the ratio, so saving/restoring the ratio is enough
        const padCornerRadiusRatio = pad.GetRoundRectRadiusRatio(aLayer);

        // Don't draw a 0 sized pad.
        // Note: a custom pad can have its pad anchor with size = 0
        if (padShape !== PAD_SHAPE.CUSTOM && (padPlotsSize.x <= 0 || padPlotsSize.y <= 0)) return;

        switch (padShape) {
          case PAD_SHAPE.CIRCLE:
          case PAD_SHAPE.OVAL: {
            pad.SetSize(aLayer, padPlotsSize);

            const drill = pad.GetDrillSize();
            const plotted = pad.GetSize(aLayer);

            if (
              aPlotOpt.GetSkipPlotNPTH_Pads() &&
              aPlotOpt.GetDrillMarksType() === DRILL_MARKS.NO_DRILL_SHAPE &&
              plotted.x === drill.x &&
              plotted.y === drill.y &&
              pad.GetAttribute() === PAD_ATTRIB.NPTH
            ) {
              break;
            }

            itemplotter.PlotPad(pad, aLayer, color, doSketchPads);
            break;
          }

          case PAD_SHAPE.RECTANGLE:
            pad.SetSize(aLayer, padPlotsSize);

            if (mask_clearance > 0) {
              pad.SetShape(aLayer, PAD_SHAPE.ROUNDRECT);
              pad.SetRoundRectCornerRadius(aLayer, mask_clearance);
            }

            itemplotter.PlotPad(pad, aLayer, color, doSketchPads);
            break;

          case PAD_SHAPE.TRAPEZOID:
            // inflate/deflate a trapezoid is a bit complex.
            // so if the margin is not null, build a similar polygonal pad shape,
            // and inflate/deflate the polygonal shape
            // because inflating/deflating using different values for y and y
            // we are using only margin.x as inflate/deflate value
            if (mask_clearance === 0) {
              itemplotter.PlotPad(pad, aLayer, color, doSketchPads);
            } else {
              const dummy = PAD.copyOfPad(pad);
              dummy.SetAnchorPadShape(aLayer, PAD_SHAPE.CIRCLE);
              dummy.SetShape(aLayer, PAD_SHAPE.CUSTOM);
              const outline = new SHAPE_POLY_SET();
              outline.NewOutline();
              const dx = Math.trunc(padSize.x / 2);
              const dy = Math.trunc(padSize.y / 2);
              const ddx = Math.trunc(padDelta.x / 2);
              const ddy = Math.trunc(padDelta.y / 2);

              outline.Append({ x: -dx - ddy, y: dy + ddx });
              outline.Append({ x: dx + ddy, y: dy - ddx });
              outline.Append({ x: dx - ddy, y: -dy + ddx });
              outline.Append({ x: -dx + ddy, y: -dy - ddx });

              // Shape polygon can have holes so use InflateWithLinkedHoles(), not Inflate()
              // which can create bad shapes if margin.x is < 0
              outline.InflateWithLinkedHoles(
                mask_clearance,
                CornerStrategy.ROUND_ALL_CORNERS,
                maxError,
              );
              dummy.DeletePrimitivesList();
              dummy.AddPrimitivePoly(aLayer, outline, 0, true);

              // Be sure the anchor pad is not bigger than the deflated shape because this
              // anchor will be added to the pad shape when plotting the pad. So now the
              // polygonal shape is built, we can clamp the anchor size
              dummy.SetSize(aLayer, { x: 0, y: 0 });

              itemplotter.PlotPad(dummy, aLayer, color, doSketchPads);
            }

            break;

          case PAD_SHAPE.ROUNDRECT:
            // The Minkowski sum of a rounded rectangle with a disk of radius R is
            // another rounded rectangle whose sides grow by 2R and whose corner
            // radius grows by R. Preserving the original radius_ratio instead
            // produces visibly inconsistent expansion at the corners (issue 24327).
            if (sameXYClearance) {
              const originalRadius = pad.GetRoundRectCornerRadius(aLayer);
              const newRadius = Math.max(0, originalRadius + mask_clearance);
              pad.SetSize(aLayer, padPlotsSize);
              pad.SetRoundRectCornerRadius(aLayer, newRadius);
            } else {
              // Asymmetric X/Y clearance (e.g. solder paste ratio on a
              // non-square pad) is not a Minkowski sum with a disk. Fall back
              // to the historical behavior of scaling both axes by the per-axis
              // margin while keeping the radius_ratio. This is approximate at
              // the corners but preserves the bounding box, which is the
              // dimension users rely on for paste apertures.
              const radiusRatio = pad.GetRoundRectRadiusRatio(aLayer);
              pad.SetSize(aLayer, padPlotsSize);
              pad.SetRoundRectRadiusRatio(aLayer, radiusRatio);
            }

            itemplotter.PlotPad(pad, aLayer, color, doSketchPads);
            break;

          case PAD_SHAPE.CHAMFERED_RECT:
            // for smaller/same rect size than initial shape (i.e. mask_clearance <= 0)
            // use the rect with size set to padPlotsSize. It gives a good shape
            if (mask_clearance <= 0) {
              // the size can be slightly inflated by width_adj (PS/PDF only)
              pad.SetSize(aLayer, padPlotsSize);
              itemplotter.PlotPad(pad, aLayer, color, doSketchPads);
            } else {
              // Due to the polygonal shape of a CHAMFERED_RECT pad, the best way is to
              // convert the pad shape to a full polygon and inflate it
              // and use a dummy  CUSTOM pad to plot the final shape.
              // However one can inflate polygon only if X,Y has same inflate value
              // if not the case, just use a rectangle having the padPlotsSize new size
              const dummy = PAD.copyOfPad(pad);
              // Build the dummy pad outline with coordinates relative to the pad position
              // pad offset and orientation 0. The actual pos, offset and rotation will be
              // taken in account later by the plot function
              dummy.SetPosition({ x: 0, y: 0 });
              dummy.SetOffset(aLayer, { x: 0, y: 0 });

              if (!sameXYClearance) dummy.SetSize(aLayer, padPlotsSize);

              dummy.SetOrientation(ANGLE_0);
              const outline = new SHAPE_POLY_SET();
              dummy.TransformShapeToPolygon(outline, aLayer, 0, maxError, ERROR_LOC.ERROR_INSIDE);

              if (sameXYClearance)
                outline.InflateWithLinkedHoles(
                  mask_clearance,
                  CornerStrategy.ROUND_ALL_CORNERS,
                  maxError,
                );

              // Initialize the dummy pad shape:
              dummy.SetAnchorPadShape(aLayer, PAD_SHAPE.CIRCLE);
              dummy.SetShape(aLayer, PAD_SHAPE.CUSTOM);
              dummy.DeletePrimitivesList();
              dummy.AddPrimitivePoly(aLayer, outline, 0, true);

              // Be sure the anchor pad is not bigger than the deflated shape because this
              // anchor will be added to the pad shape when plotting the pad.
              // So we set the anchor size to 0
              dummy.SetSize(aLayer, { x: 0, y: 0 });
              // Restore pad position and offset
              dummy.SetPosition(pad.GetPosition());
              dummy.SetOffset(aLayer, pad.GetOffset(aLayer));
              dummy.SetOrientation(pad.GetOrientation());

              itemplotter.PlotPad(dummy, aLayer, color, doSketchPads);
            }

            break;

          case PAD_SHAPE.CUSTOM: {
            // inflate/deflate a custom shape is a bit complex.
            // so build a similar pad shape, and inflate/deflate the polygonal shape
            const dummy = PAD.copyOfPad(pad);
            dummy.SetParentGroup(null);

            const shape = new SHAPE_POLY_SET();
            pad.MergePrimitivesAsPolygon(aLayer, shape);

            // Shape polygon can have holes so use InflateWithLinkedHoles(), not Inflate()
            // which can create bad shapes if margin.x is < 0
            shape.InflateWithLinkedHoles(
              mask_clearance,
              CornerStrategy.ROUND_ALL_CORNERS,
              maxError,
            );
            dummy.DeletePrimitivesList();
            dummy.AddPrimitivePoly(aLayer, shape, 0, true);

            // Be sure the anchor pad is not bigger than the deflated shape because this
            // anchor will be added to the pad shape when plotting the pad. So now the
            // polygonal shape is built, we can clamp the anchor size
            if (mask_clearance < 0) {
              // we expect margin.x = margin.y for custom pads
              dummy.SetSize(aLayer, {
                x: Math.max(0, padPlotsSize.x),
                y: Math.max(0, padPlotsSize.y),
              });
            }

            itemplotter.PlotPad(dummy, aLayer, color, doSketchPads);
            break;
          }
        }

        // Restore the pad parameters modified by the plot code
        pad.SetSize(aLayer, padSize);
        pad.SetDelta(aLayer, padDelta);
        pad.SetShape(aLayer, padShape);
        pad.SetRoundRectRadiusRatio(aLayer, padCornerRadiusRatio);
      };

      for (const layer of aLayerMask.SeqStackupForPlotting()) plotPadLayer(layer);
    }

    if (
      dnp &&
      !itemplotter.GetHideDNPFPsOnFabLayers() &&
      itemplotter.GetCrossoutDNPFPsOnFabLayers() &&
      ((onFrontFab && footprint.GetLayer() === PCB_LAYER_ID.F_Cu) ||
        (onBackFab && footprint.GetLayer() === PCB_LAYER_ID.B_Cu))
    ) {
      plotDnpCrossout(aBoard, aPlotter, footprint);
    }

    aPlotter.EndBlock(null);
  }

  // Plot vias on copper layers, and if aPlotOpt.GetPlotViaOnMaskLayer() is true,

  const gbr_metadata = new GBR_METADATA();

  if (onCopperLayer) {
    gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_VIAPAD);
    gbr_metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_NET);
  }

  const getMetadata = (): unknown => {
    if (aPlotter.GetPlotterType() === PLOT_FORMAT.GERBER) return gbr_metadata;
    else if (aPlotter.GetPlotterType() === PLOT_FORMAT.DXF) return aPlotOpt;
    else return null;
  };

  aPlotter.StartBlock(null);

  for (const track of aBoard.Tracks()) {
    if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

    const via = track as PCB_VIA;

    // vias are not plotted if not on selected layer
    const via_mask_layer = via.GetLayerSet();

    if (!via_mask_layer.and(aLayerMask).any()) continue;

    let via_margin = 0;
    let width_adj = 0;

    // TODO(JE) padstacks - separate top/bottom margin
    if (onSolderMaskLayer) via_margin = via.GetSolderMaskExpansion();

    if (aLayerMask.and(LSET.AllCuMask()).any()) width_adj = itemplotter.getFineWidthAdj();

    /// Vias not connected to copper are optionally not drawn
    if (onCopperLayer && !via.FlashLayer(aLayerMask)) continue;

    let diameter = 0;

    for (const layer of aLayerMask.Seq()) diameter = Math.max(diameter, via.GetWidth(layer));

    // `int diameter += 2 * via_margin + width_adj`, width_adj a double
    diameter = Math.trunc(diameter + 2 * via_margin + width_adj);

    // Don't draw a null size item :
    if (diameter <= 0) continue;

    // Some vias can be not connected (no net).
    // Set the m_NotInNet for these vias to force a empty net name in gerber file
    gbr_metadata.m_NetlistMetadata.m_NotInNet = via.GetNetname() === '';

    gbr_metadata.SetNetName(via.GetNetname());

    // (the via's colour: see plot_brditems_plotter.ts)
    aPlotter.SetColor(itemplotter.getColor(aLayerMask.Seq()[0] ?? PCB_LAYER_ID.F_Cu));
    aPlotter.FlashPadCircle(via.GetStart(), diameter, getMetadata());
  }

  aPlotter.EndBlock(null);
  aPlotter.StartBlock(null);

  if (onCopperLayer) {
    gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CONDUCTOR);
    gbr_metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_NET);
  } else {
    // Reset attributes if non-copper (soldermask) layer
    gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_NONE);
    gbr_metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_UNSPECIFIED);
  }

  // Plot tracks (not vias) :
  for (const track of aBoard.Tracks()) {
    if (track.Type() === KICAD_T.PCB_VIA_T) continue;

    if (!aLayerMask.and(track.GetLayerSet()).any()) continue;

    // Some track segments can be not connected (no net).
    // Set the m_NotInNet for these segments to force a empty net name in gerber file
    gbr_metadata.m_NetlistMetadata.m_NotInNet = track.GetNetname() === '';

    gbr_metadata.SetNetName(track.GetNetname());

    let margin = 0;

    if (onSolderMaskLayer) margin = track.GetSolderMaskExpansion();

    const width = track.GetWidth() + 2 * margin + itemplotter.getFineWidthAdj();

    aPlotter.SetColor(itemplotter.getColor(track.GetLayer()));

    if (track.Type() === KICAD_T.PCB_ARC_T) {
      const arc = track as PCB_ARC;

      // Too small arcs cannot be really handled: arc center (and arc radius)
      // cannot be safely computed
      if (!arc.IsDegenerated(10 /* in IU */)) {
        aPlotter.ThickArc(
          arc.GetCenter(),
          arc.GetArcAngleStart(),
          arc.GetAngle(),
          arc.GetRadius(),
          width,
          getMetadata(),
        );
      } else {
        // Approximate this very small arc by a segment.
        aPlotter.ThickSegment(track.GetStart(), track.GetEnd(), width, getMetadata());
      }
    } else {
      aPlotter.ThickSegment(track.GetStart(), track.GetEnd(), width, getMetadata());
    }
  }

  aPlotter.EndBlock(null);

  // Plot filled ares
  aPlotter.StartBlock(null);

  const nonet = new NETINFO_ITEM(aBoard);

  for (const zone of aBoard.Zones()) {
    if (zone.GetIsRuleArea()) continue;

    for (const layer of zone.GetLayerSet().Seq()) {
      if (!aLayerMask.test(layer)) continue;

      const mainArea = zone.GetFilledPolysList(layer).CloneDropTriangulation();
      const islands = new SHAPE_POLY_SET();

      for (let i = mainArea.OutlineCount() - 1; i >= 0; i--) {
        if (zone.IsIsland(layer, i)) {
          islands.AddOutline(mainArea.CPolygon(i)[0]!);
          mainArea.DeletePolygon(i);
        }
      }

      itemplotter.PlotZone(zone, layer, mainArea);

      if (!islands.IsEmpty()) {
        const dummy = ZONE.copyOfZone(zone);
        dummy.SetNet(nonet);
        itemplotter.PlotZone(dummy, layer, islands);
      }
    }
  }

  aPlotter.EndBlock(null);
}

/** The DNP cross-out on a fab layer: `PlotStandardLayer`'s inline block. */
function plotDnpCrossout(aBoard: BOARD, aPlotter: PLOTTER, footprint: FOOTPRINT): void {
  const courtyard = footprint.GetCourtyard(footprint.GetLayer());
  const center = footprint.GetPosition();
  const orient = footprint.GetOrientation();

  // Compute a tight oriented bounding box by un-rotating the shape into the
  // footprint's local frame, taking the axis-aligned BBox there, then rotating
  // the four corners back into world coordinates.
  let localRect: BOX2I;

  if (courtyard.IsEmpty()) {
    const shape = footprint.GetEffectiveShape();
    shape.Rotate(orient.negate(), center);
    localRect = shape.BBox();
  } else {
    const temp = courtyard.Clone();
    temp.Rotate(orient.negate(), center);
    localRect = temp.BBox();
  }

  const corner1 = RotatePoint({ x: localRect.GetLeft(), y: localRect.GetTop() }, center, orient);
  const corner2 = RotatePoint({ x: localRect.GetRight(), y: localRect.GetTop() }, center, orient);
  const corner3 = RotatePoint(
    { x: localRect.GetRight(), y: localRect.GetBottom() },
    center,
    orient,
  );
  const corner4 = RotatePoint({ x: localRect.GetLeft(), y: localRect.GetBottom() }, center, orient);

  const width = aBoard.GetDesignSettings().m_LineThickness[LAYER_CLASS_FAB]!;

  // DNP cross colour: `LAYER_DNP_MARKER` from the colour scheme (not ported).
  aPlotter.SetColor(COLOR4D_BLACK);

  aPlotter.ThickSegment(corner1, corner3, width, null);
  aPlotter.ThickSegment(corner2, corner4, width, null);
}

/**
 * Plot outlines.
 */
export function PlotLayerOutlines(
  aBoard: BOARD,
  aPlotter: PLOTTER,
  aLayerMask: LSET,
  aPlotOpt: PCB_PLOT_PARAMS,
): void {
  const itemplotter = new BRDITEMS_PLOTTER(aPlotter, aBoard, aPlotOpt);
  itemplotter.SetLayerSet(aLayerMask);

  const smallDrill = pcbIUScale.mmToIU(ADVANCED_CFG.GetCfg().m_SmallDrillMarkSize);

  const outlines = new SHAPE_POLY_SET();

  for (const layer of aLayerMask.Seq(aLayerMask.SeqStackupForPlotting())) {
    outlines.RemoveAllContours();
    aBoard.ConvertBrdLayerToPolygonalContours(layer, outlines, aPlotter.RenderSettings() as never);

    outlines.Simplify();

    // Now we have one or more basic polygons: plot each polygon
    for (let ii = 0; ii < outlines.OutlineCount(); ii++) {
      for (let kk = 0; kk <= outlines.HoleCount(ii); kk++) {
        const path = kk === 0 ? outlines.COutline(ii) : outlines.CHole(ii, kk - 1);

        aPlotter.PlotPolyLineChain(path, FILL_T.NO_FILL, PLOTTER.USE_DEFAULT_LINE_WIDTH, null);
      }
    }

    // Plot pad holes
    if (aPlotOpt.GetDrillMarksType() !== DRILL_MARKS.NO_DRILL_SHAPE) {
      for (const footprint of aBoard.Footprints()) {
        for (const pad of footprint.Pads()) {
          if (pad.HasHole()) {
            if (pad.GetDrillSizeX() === pad.GetDrillSizeY()) {
              let drill = pad.GetDrillSizeX();

              if (aPlotOpt.GetDrillMarksType() === DRILL_MARKS.SMALL_DRILL_SHAPE)
                drill = Math.min(smallDrill, drill);

              aPlotter.ThickCircle(
                pad.ShapePos(layer),
                drill,
                PLOTTER.USE_DEFAULT_LINE_WIDTH,
                null,
              );
            } else {
              // Note: small drill marks have no significance when applied to slots

              aPlotter.ThickOval(
                pad.ShapePos(layer),
                pad.GetSize(layer),
                pad.GetOrientation(),
                PLOTTER.USE_DEFAULT_LINE_WIDTH,
                null,
              );
            }
          }
        }
      }
    }

    // Plot vias holes
    for (const track of aBoard.Tracks()) {
      if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = track as PCB_VIA;

      if (via.GetLayerSet().Contains(layer)) {
        // via holes can be not through holes
        aPlotter.Circle(
          via.GetPosition(),
          via.GetDrillValue(),
          FILL_T.NO_FILL,
          PLOTTER.USE_DEFAULT_LINE_WIDTH,
        );
      }
    }
  }
}

/**
 * Generates a SHAPE_POLY_SET representing the plotted items on a layer.
 */
export function GenerateLayerPoly(
  aResult: SHAPE_POLY_SET,
  aBoard: BOARD,
  aPlotter: PLOTTER,
  aLayer: PCB_LAYER_ID,
  aPlotFPText: boolean,
  aPlotReferences: boolean,
  aPlotValues: boolean,
): void {
  const maxError = aBoard.GetDesignSettings().m_MaxError;
  let inflate = 0;

  if (aLayer === PCB_LAYER_ID.F_Mask || aLayer === PCB_LAYER_ID.B_Mask) {
    // We remove 1nm as we expand both sides of the shapes, so allowing for a strictly greater
    // than or equal comparison in the shape separation (boolean add)
    inflate = Math.trunc(aBoard.GetDesignSettings().m_SolderMaskMinWidth / 2) - 1;
  }

  // Build polygons for each pad shape.  The size of the shape on solder mask should be size
  // of pad + clearance around the pad, where clearance = solder mask clearance + extra margin.
  // Extra margin is half the min width for solder mask, which is used to merge too-close shapes
  // (distance < SolderMaskMinWidth).

  // Will contain exact shapes of all items on solder mask.  We add this back in at the end just
  // to make sure that any artefacts introduced by the inflate/deflate don't remove parts of the
  // individual shapes.
  const exactPolys = new SHAPE_POLY_SET();

  const handleFPTextItem = (aText: PCB_TEXT): void => {
    if (!aPlotFPText) return;

    if (aText.GetText() === '${REFERENCE}' && !aPlotReferences) return;

    if (aText.GetText() === '${VALUE}' && !aPlotValues) return;

    if (inflate !== 0)
      aText.TransformTextToPolySet(exactPolys, 0, maxError, ERROR_LOC.ERROR_OUTSIDE);

    aText.TransformTextToPolySet(aResult, inflate, maxError, ERROR_LOC.ERROR_OUTSIDE);
  };

  const renderSettings = aPlotter.RenderSettings() as never;

  // Generate polygons with arcs inside the shape or exact shape to minimize shape changes
  // created by arc to segment size correction.
  const disabler = new DISABLE_ARC_RADIUS_CORRECTION();

  try {
    // Plot footprint pads and graphics
    for (const footprint of aBoard.Footprints()) {
      if (inflate !== 0)
        footprint.TransformPadsToPolySet(exactPolys, aLayer, 0, maxError, ERROR_LOC.ERROR_OUTSIDE);

      footprint.TransformPadsToPolySet(aResult, aLayer, inflate, maxError, ERROR_LOC.ERROR_OUTSIDE);

      for (const field of footprint.GetFields()) {
        if (!field) continue;

        if (field.IsReference() && !aPlotReferences) continue;

        if (field.IsValue() && !aPlotValues) continue;

        if (field.IsVisible() && field.IsOnLayer(aLayer)) handleFPTextItem(field);
      }

      for (const item of footprint.GraphicalItems()) {
        if (item.IsOnLayer(aLayer)) {
          if (item.Type() === KICAD_T.PCB_TEXT_T) {
            handleFPTextItem(item as unknown as PCB_TEXT);
          } else {
            if (inflate !== 0)
              item.TransformShapeToPolySet(
                exactPolys,
                aLayer,
                0,
                maxError,
                ERROR_LOC.ERROR_OUTSIDE,
              );

            item.TransformShapeToPolySet(
              aResult,
              aLayer,
              inflate,
              maxError,
              ERROR_LOC.ERROR_OUTSIDE,
            );
          }
        }
      }
    }

    // Plot untented vias and tracks
    for (const track of aBoard.Tracks()) {
      // Note: IsOnLayer() checks relevant mask layers of untented vias and tracks
      if (!track.IsOnLayer(aLayer)) continue;

      const clearance = track.GetSolderMaskExpansion();

      if (inflate !== 0)
        track.TransformShapeToPolygon(
          exactPolys,
          aLayer,
          clearance,
          maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );

      track.TransformShapeToPolygon(
        aResult,
        aLayer,
        clearance + inflate,
        maxError,
        ERROR_LOC.ERROR_OUTSIDE,
      );
    }

    for (const item of aBoard.Drawings()) {
      if (item.IsOnLayer(aLayer)) {
        if (item.Type() === KICAD_T.PCB_TEXT_T) {
          const text = item as unknown as PCB_TEXT;

          if (inflate !== 0)
            text.TransformTextToPolySet(exactPolys, 0, maxError, ERROR_LOC.ERROR_OUTSIDE);

          text.TransformTextToPolySet(aResult, inflate, maxError, ERROR_LOC.ERROR_OUTSIDE);
        } else {
          if (inflate !== 0)
            item.TransformShapeToPolySet(
              exactPolys,
              aLayer,
              0,
              maxError,
              ERROR_LOC.ERROR_OUTSIDE,
              renderSettings,
            );

          item.TransformShapeToPolySet(
            aResult,
            aLayer,
            inflate,
            maxError,
            ERROR_LOC.ERROR_OUTSIDE,
            renderSettings,
          );
        }
      }
    }

    // Add filled zone areas.
    for (const zone of aBoard.Zones()) {
      if (zone.GetIsRuleArea()) continue;

      if (!zone.IsOnLayer(aLayer)) continue;

      const fillData = zone.GetFill(aLayer);

      if (!fillData) continue;

      const area = fillData.CloneDropTriangulation();

      if (inflate !== 0) exactPolys.Append(area);

      area.Inflate(inflate, CornerStrategy.CHAMFER_ALL_CORNERS, maxError);
      aResult.Append(area);
    }

    // Merge all polygons
    aResult.Simplify();

    if (inflate !== 0) {
      aResult.Deflate(inflate, CornerStrategy.CHAMFER_ALL_CORNERS, maxError);
      // Add back in the exact polys. This is mandatory because inflate/deflate transform is
      // not perfect, and we want the initial areas perfectly kept.
      aResult.BooleanAdd(exactPolys);
    }
  } finally {
    disabler.dispose();
  }
}

/**
 * Set up most plot options for plotting a board (especially the viewport)
 * Important thing:
 *      page size is the 'drawing' page size,
 *      paper size is the physical page size
 */
function initializePlotter(aPlotter: PLOTTER, aBoard: BOARD, aPlotOpts: PCB_PLOT_PARAMS): void {
  const pageA4 = new PAGE_INFO(PAGE_SIZE_TYPE.A4);
  const pageInfo = aBoard.GetPageSettings();
  let sheet_info: PAGE_INFO;
  let paperscale: number; // Page-to-paper ratio
  let paperSizeIU: { x: number; y: number };
  const pageSizeIU = pageInfo.GetSizeIU(pcbIUScale.IU_PER_MILS);
  let autocenter = false;

  // Special options: to fit the sheet to an A4 sheet replace the paper size. However there
  // is a difference between the autoscale and the a4paper option:
  //  - Autoscale fits the board to the paper size
  //  - A4paper fits the original paper size to an A4 sheet
  //  - Both of them fit the board to an A4 sheet
  if (aPlotOpts.GetA4Output()) {
    sheet_info = pageA4;
    paperSizeIU = pageA4.GetSizeIU(pcbIUScale.IU_PER_MILS);
    paperscale = paperSizeIU.x / pageSizeIU.x;
    autocenter = true;
  } else {
    sheet_info = pageInfo;
    paperSizeIU = pageSizeIU;
    paperscale = 1;

    // Need autocentering only if scale is not 1:1
    autocenter = aPlotOpts.GetScale() !== 1.0 || aPlotOpts.GetAutoScale();
  }

  const bbox = aBoard.ComputeBoundingBox(false, false);
  const boardCenter = bbox.Centre();
  const boardSize = bbox.GetSize();

  let compound_scale: number;

  // Fit to 80% of the page if asked; it could be that the board is empty, in this case
  // regress to 1:1 scale
  if (aPlotOpts.GetAutoScale() && boardSize.x > 0 && boardSize.y > 0) {
    const xscale = (paperSizeIU.x * 0.8) / boardSize.x;
    const yscale = (paperSizeIU.y * 0.8) / boardSize.y;

    compound_scale = Math.min(xscale, yscale) * paperscale;
  } else {
    compound_scale = aPlotOpts.GetScale() * paperscale;
  }

  // For the plot offset we have to keep in mind the auxiliary origin too: if autoscaling is
  // off we check that plot option (i.e. autoscaling overrides auxiliary origin)
  let offset = { x: 0, y: 0 };

  if (autocenter) {
    offset = {
      x: KiROUND(boardCenter.x - paperSizeIU.x / 2.0 / compound_scale),
      y: KiROUND(boardCenter.y - paperSizeIU.y / 2.0 / compound_scale),
    };
  } else {
    if (aPlotOpts.GetUseAuxOrigin()) offset = aBoard.GetDesignSettings().GetAuxOrigin();
  }

  aPlotter.SetPageSettings(sheet_info);

  aPlotter.SetViewport(offset, pcbIUScale.IU_PER_MILS / 10, compound_scale, aPlotOpts.GetMirror());

  // Has meaning only for gerber plotter. Must be called only after SetViewport
  aPlotter.SetGerberCoordinatesFormat(aPlotOpts.GetGerberPrecision());

  // Has meaning only for SVG plotter. Must be called only after SetViewport
  aPlotter.SetSvgCoordinatesFormat(aPlotOpts.GetSvgPrecision());

  aPlotter.SetCreator('PCBNEW');
  aPlotter.SetColorMode(!aPlotOpts.GetBlackAndWhite()); // default is plot in Black and White.
  aPlotter.SetTextMode(aPlotOpts.GetTextMode());
}

/**
 * Prefill in black an area a little bigger than the board to prepare for the negative plot
 */
function FillNegativeKnockout(aPlotter: PLOTTER, aBbbox: BOX2I): void {
  const margin = 5 * pcbIUScale.IU_PER_MM; // Add a 5 mm margin around the board
  aPlotter.SetNegative(true);
  aPlotter.SetColor(COLOR4D_WHITE); // Which will be plotted as black

  const area = aBbbox.Clone();
  area.Inflate(margin);
  aPlotter.Rect(area.GetOrigin(), area.GetEnd(), FILL_T.FILLED_SHAPE, 0, 0);
  aPlotter.SetColor(COLOR4D_BLACK);
}

/**
 * Open a new plotfile using the options (and especially the format) specified in the options
 * and prepare the page for plotting.
 *
 * @param aDate is "now" for the Gerber header's date attributes; upstream reads the clock.
 * @return the plotter object if OK, null if the file is not created (or has a problem).
 */
export function StartPlotBoard(
  aBoard: BOARD,
  aPlotOpts: PCB_PLOT_PARAMS,
  aLayer: PCB_LAYER_ID,
  aLayerName: string,
  aFullFileName: string,
  _aSheetName = '',
  _aSheetPath = '',
  aPageName = '',
  _aPageNumber = '1',
  _aPageCount = 1,
  aDate: Date = new Date(),
): PLOTTER | null {
  // Create the plotter driver and set the few plotter specific options
  let plotter: PLOTTER;

  switch (aPlotOpts.GetFormat()) {
    case PLOT_FORMAT.GERBER:
      // For Gerber plotter, a valid board layer must be set, in order to create a valid
      // Gerber header, especially the TF.FileFunction and .FilePolarity data
      if (aLayer < PCB_LAYER_ID.F_Cu || aLayer >= PCB_LAYER_ID.PCB_LAYER_ID_COUNT)
        console.error(`Invalid board layer ${aLayer}, cannot build a valid Gerber file header`);

      plotter = new GERBER_PLOTTER();
      (plotter as GERBER_PLOTTER).SetDate(aDate);
      break;

    default:
      // DXF, POST, PDF and SVG: see the file comment. HPGL: "HPGL plotting is no
      // longer supported as of KiCad 10.0".
      return null;
  }

  const renderSettings = new PCB_RENDER_SETTINGS();
  renderSettings.SetDefaultPenWidth(pcbIUScale.mmToIU(0.0212)); // Hairline at 1200dpi
  renderSettings.SetLayerName(aLayerName);
  renderSettings.SetDashLengthRatio(aPlotOpts.GetDashedLineDashRatio());
  renderSettings.SetGapLengthRatio(aPlotOpts.GetDashedLineGapRatio());

  plotter.SetRenderSettings(renderSettings);

  // Compute the viewport and set the other options

  // page layout is not mirrored, so temporarily change mirror option for the page layout
  const plotOpts = new PCB_PLOT_PARAMS();
  plotOpts.assign(aPlotOpts);

  if (plotOpts.GetPlotFrameRef()) {
    if (plotOpts.GetMirror()) plotOpts.SetMirror(false);
    if (plotOpts.GetScale() !== 1.0) plotOpts.SetScale(1.0);
    if (plotOpts.GetAutoScale()) plotOpts.SetAutoScale(false);
  }

  initializePlotter(plotter, aBoard, plotOpts);

  if (plotter.OpenFile(aFullFileName)) {
    plotter.ClearHeaderLinesList();

    // For the Gerber "file function" attribute, set the layer number
    if (plotter.GetPlotterType() === PLOT_FORMAT.GERBER) {
      const useX2mode = plotOpts.GetUseGerberX2format();

      const gbrplotter = plotter as GERBER_PLOTTER;
      gbrplotter.DisableApertMacros(plotOpts.GetDisableGerberMacros());
      gbrplotter.UseX2format(useX2mode);
      gbrplotter.UseX2NetAttributes(plotOpts.GetIncludeGerberNetlistInfo());

      // Attributes can be added using X2 format or as comment (X1 format)
      AddGerberX2Attribute(plotter, aBoard, aLayer, !useX2mode, aDate);
    }

    let startPlotSuccess = false;

    try {
      startPlotSuccess = plotter.StartPlot(aPageName);
    } catch {
      startPlotSuccess = false;
    }

    if (startPlotSuccess) {
      // (plotPdfBackground: PDF only, see the file comment)

      // When plotting a negative board: draw a black rectangle (background for plot board
      // in white) and switch the current color to WHITE; note the color inversion is actually
      // done in the driver (if supported)
      if (aPlotOpts.GetNegative()) {
        const bbox = aBoard.ComputeBoundingBox(false, false);
        FillNegativeKnockout(plotter, bbox);
      }

      return plotter;
    }
  }

  return null;
}
