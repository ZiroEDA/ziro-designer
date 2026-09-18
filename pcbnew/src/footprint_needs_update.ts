// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT::FootprintNeedsUpdate` and its helpers, which the C++ keeps in
 * `pcbnew/drc/drc_test_provider_library_parity.cpp`: a board footprint against
 * its library copy, either reporting every difference (aReporter given) or
 * stopping at the first (DRC mode).
 *
 * The TEST*() macros have two modes:
 * In "Report" mode (aReporter != nullptr) all properties are checked and reported on.
 * In "DRC" mode (aReporter == nulltpr) properties are only checked until a difference is found.
 */
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { LayerName, PCB_LAYER_ID, UNDEFINED_LAYER } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import type { Reporter } from '@ziroeda/common/src/reporter.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { EuclideanNorm, equal, sub, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from './board.js';
import { BOARD_ITEM } from './board_item.js';
import { FOOTPRINT, FOOTPRINT_ATTR_T, FOOTPRINT_STACKUP } from './footprint.js';
import type { PAD } from './pad.js';
import { PAD_SHAPE } from './padstack.js';
import type { PCB_BARCODE } from './pcb_barcode.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import type { ZONE } from './zone.js';
import { ZONE_CONNECTION } from './zones.js';

const EPSILON = 10;
const EPSILON_D = 0.00001;

const g_unitsProvider = new UNITS_PROVIDER(pcbIUScale, 'mm');

const ITEM_DESC = (item: BOARD_ITEM): string => item.GetItemDescription(g_unitsProvider, true);
const PAD_DESC = (pad: PAD): string => `Pad ${pad.GetNumber()}`;

/**
 * The TEST macros as a small state machine: `test` records a difference and
 * says whether the caller must return now (DRC mode).
 */
class DIFF {
  diff = false;

  constructor(private readonly aReporter: Reporter | null) {}

  /** `TEST( a, b, msg )`: true when the caller has to `return diff` now. */
  test(aDiffers: boolean, msg: string): boolean {
    if (aDiffers) {
      this.diff = true;

      if (this.aReporter && msg.length) this.aReporter.report(msg);
    }

    return this.diff && !this.aReporter;
  }

  /** `TEST_PT( a, b, msg )`. */
  testPt(a: VECTOR2I, b: VECTOR2I, msg: string): boolean {
    return this.test(Math.abs(a.x - b.x) > EPSILON || Math.abs(a.y - b.y) > EPSILON, msg);
  }

  /** `TEST_D( a, b, msg )`. */
  testD(a: number, b: number, msg: string): boolean {
    return this.test(Math.abs(a - b) > EPSILON_D, msg);
  }

  /** `REPORT( msg )`. */
  report(msg: string): void {
    if (this.aReporter) this.aReporter.report(msg);
  }
}

/** `LAYER_UTILS::AccumulateNames` (layer_utils.cpp:27). */
function AccumulateNames(aLayers: Iterable<PCB_LAYER_ID>, aBoard: BOARD | null): string {
  let result = '';

  for (const layer of aLayers) {
    if (result !== '') result += ', ';

    result += aBoard ? aBoard.GetLayerName(layer) : LayerName(layer);
  }

  return result;
}

function getBoardNormalizedLayerSet(aLibItem: BOARD_ITEM, aBoard: BOARD | null): LSET {
  const lset = aLibItem.GetLayerSet();

  if (aBoard) lset.andAssign(aBoard.GetEnabledLayers());

  return lset;
}

function boardLayersMatchWithInnerLayerExpansion(
  aItem: LSET,
  bLib: LSET,
  aAllowCuExpansion: boolean,
): boolean {
  if (!aAllowCuExpansion) return aItem.equals(bLib);

  // first test non copper layers, these should exact match
  const nonCuMask = LSET.AllNonCuMask();
  const aNonCu = aItem.and(nonCuMask);
  const bNonCu = bLib.and(nonCuMask);

  if (!aNonCu.equals(bNonCu)) return false;

  // top and bottom copper must match exactly
  if (!aItem.and(LSET.ExternalCuMask()).equals(bLib.and(LSET.ExternalCuMask()))) return false;

  // technically we can ignore the inner layers entirely due to aAllowCuExpansion at this point
  // since its assumed the layers got expanded elsewhere
  // but it feels weird not to sanity this

  // extract the inner layers to compare prescence
  const aInner = aItem.and(LSET.AllCuMask()).and(new LSET(LSET.ExternalCuMask()).flip());
  const bInner = bLib.and(LSET.AllCuMask()).and(new LSET(LSET.ExternalCuMask()).flip());

  const missingInnerInA = bInner.and(new LSET(aInner).flip());
  if (missingInnerInA.count()) return false;

  return true;
}

function primitiveNeedsUpdate(a: PCB_SHAPE, b: PCB_SHAPE): boolean {
  const d = new DIFF(null);

  if (d.test(a.GetShape() !== b.GetShape(), '')) return d.diff;

  switch (a.GetShape()) {
    case SHAPE_T.RECTANGLE: {
      const aRect = new BOX2I(a.GetStart(), sub(a.GetEnd(), a.GetStart()));
      const bRect = new BOX2I(b.GetStart(), sub(b.GetEnd(), b.GetStart()));

      aRect.Normalize();
      bRect.Normalize();

      if (d.testPt(aRect.GetOrigin(), bRect.GetOrigin(), '')) return d.diff;
      if (d.testPt(aRect.GetEnd(), bRect.GetEnd(), '')) return d.diff;
      break;
    }

    case SHAPE_T.SEGMENT:
    case SHAPE_T.CIRCLE:
      if (d.testPt(a.GetStart(), b.GetStart(), '')) return d.diff;
      if (d.testPt(a.GetEnd(), b.GetEnd(), '')) return d.diff;
      break;

    case SHAPE_T.ARC:
      if (d.testPt(a.GetStart(), b.GetStart(), '')) return d.diff;
      if (d.testPt(a.GetEnd(), b.GetEnd(), '')) return d.diff;

      // Arc center is calculated and so may have round-off errors when parents are
      // differentially rotated.
      if (EuclideanNorm(sub(a.GetArcMid(), b.GetArcMid())) > pcbIUScale.mmToIU(0.0005)) return true;

      break;

    case SHAPE_T.BEZIER:
      if (d.testPt(a.GetStart(), b.GetStart(), '')) return d.diff;
      if (d.testPt(a.GetEnd(), b.GetEnd(), '')) return d.diff;
      if (d.testPt(a.GetBezierC1(), b.GetBezierC1(), '')) return d.diff;
      if (d.testPt(a.GetBezierC2(), b.GetBezierC2(), '')) return d.diff;
      break;

    case SHAPE_T.POLY: {
      if (d.test(a.GetPolyShape().TotalVertices() !== b.GetPolyShape().TotalVertices(), ''))
        return d.diff;

      for (let poly = 0; poly < a.GetPolyShape().CPolygons().length; poly++) {
        const aPolygon = a.GetPolyShape().CPolygon(poly);
        const bPolygon = b.GetPolyShape().CPolygon(poly);

        if (
          aPolygon.length === 0 ||
          bPolygon.length === 0 ||
          !aPolygon[0]!.CompareGeometry(bPolygon[0]!, true, EPSILON)
        ) {
          d.diff = true;
          return d.diff;
        }
      }

      break;
    }

    default:
      // UNIMPLEMENTED_FOR( a->SHAPE_T_asString() )
      break;
  }

  if (d.test(a.GetStroke().notEquals(b.GetStroke()), '')) return d.diff;
  if (d.test(a.GetFillMode() !== b.GetFillMode(), '')) return d.diff;

  return d.diff;
}

function padHasOverrides(a: PAD, b: PAD, aReporter: Reporter): boolean {
  let diff = false;

  const REPORT_MSG = (s: string, p: string): void => {
    aReporter.report(s.replace('%s', p));
  };

  if (a.GetLocalClearance() !== undefined && a.GetLocalClearance() !== b.GetLocalClearance()) {
    diff = true;
    REPORT_MSG('%s has clearance override.', PAD_DESC(a));
  }

  if (
    a.GetLocalSolderMaskMargin() !== undefined &&
    a.GetLocalSolderMaskMargin() !== b.GetLocalSolderMaskMargin()
  ) {
    diff = true;
    REPORT_MSG('%s has solder mask expansion override.', PAD_DESC(a));
  }

  if (
    a.GetLocalSolderPasteMargin() !== undefined &&
    a.GetLocalSolderPasteMargin() !== b.GetLocalSolderPasteMargin()
  ) {
    diff = true;
    REPORT_MSG('%s has solder paste clearance override.', PAD_DESC(a));
  }

  if (
    a.GetLocalSolderPasteMarginRatio() !== undefined &&
    a.GetLocalSolderPasteMarginRatio() !== b.GetLocalSolderPasteMarginRatio()
  ) {
    diff = true;
    REPORT_MSG('%s has solder paste clearance override.', PAD_DESC(a));
  }

  if (
    a.GetLocalZoneConnection() !== ZONE_CONNECTION.INHERITED &&
    a.GetLocalZoneConnection() !== b.GetLocalZoneConnection()
  ) {
    diff = true;
    REPORT_MSG('%s has zone connection override.', PAD_DESC(a));
  }

  if (a.GetLocalThermalGapOverride() !== undefined && a.GetThermalGap() !== b.GetThermalGap()) {
    diff = true;
    REPORT_MSG('%s has thermal relief gap override.', PAD_DESC(a));
  }

  if (
    a.GetLocalThermalSpokeWidthOverride() !== undefined &&
    a.GetLocalThermalSpokeWidthOverride() !== b.GetLocalThermalSpokeWidthOverride()
  ) {
    diff = true;
    REPORT_MSG('%s has thermal relief spoke width override.', PAD_DESC(a));
  }

  if (!a.GetThermalSpokeAngle().equals(b.GetThermalSpokeAngle())) {
    diff = true;
    REPORT_MSG('%s has thermal relief spoke angle override.', PAD_DESC(a));
  }

  if (a.GetCustomShapeInZoneOpt() !== b.GetCustomShapeInZoneOpt()) {
    diff = true;
    REPORT_MSG('%s has zone knockout setting override.', PAD_DESC(a));
  }

  return diff;
}

function padNeedsUpdate(a: PAD, bLib: PAD, aReporter: Reporter | null): boolean {
  const d = new DIFF(aReporter);

  if (
    d.test(
      a.GetPadToDieLength() !== bLib.GetPadToDieLength(),
      `${PAD_DESC(a)} pad to die length differs.`,
    )
  )
    return d.diff;
  if (
    d.testPt(
      a.GetFPRelativePosition(),
      bLib.GetFPRelativePosition(),
      `${PAD_DESC(a)} position differs.`,
    )
  )
    return d.diff;

  if (d.test(a.GetNumber() !== bLib.GetNumber(), `${PAD_DESC(a)} has different numbers.`))
    return d.diff;

  // These are assigned from the schematic and not from the library
  // TEST( a->GetPinFunction(), b->GetPinFunction() );
  // TEST( a->GetPinType(), b->GetPinType() );

  let layerSettingsDiffer = a.GetRemoveUnconnected() !== bLib.GetRemoveUnconnected();

  // NB: KeepTopBottom is undefined if RemoveUnconnected is NOT set.
  if (a.GetRemoveUnconnected())
    layerSettingsDiffer ||= a.GetKeepTopBottom() !== bLib.GetKeepTopBottom();

  let allowExpansion = false;
  const fp = a.GetParentFootprint();

  if (fp) allowExpansion = fp.GetStackupMode() === FOOTPRINT_STACKUP.EXPAND_INNER_LAYERS;

  if (
    layerSettingsDiffer ||
    !boardLayersMatchWithInnerLayerExpansion(
      getBoardNormalizedLayerSet(a, a.GetBoard()),
      getBoardNormalizedLayerSet(bLib, a.GetBoard()),
      allowExpansion,
    )
  ) {
    d.diff = true;

    if (aReporter) aReporter.report(`${PAD_DESC(a)} layers differ.`);
    else return true;
  }

  if (d.test(a.GetAttribute() !== bLib.GetAttribute(), `${PAD_DESC(a)} pad type differs.`))
    return d.diff;
  if (
    d.test(a.GetProperty() !== bLib.GetProperty(), `${PAD_DESC(a)} fabrication property differs.`)
  )
    return d.diff;

  // The pad orientation, for historical reasons is the pad rotation + parent rotation.
  if (
    d.testD(
      a.GetFPRelativeOrientation().Normalize().AsDegrees(),
      bLib.GetFPRelativeOrientation().Normalize().AsDegrees(),
      `${PAD_DESC(a)} orientation differs.`,
    )
  ) {
    return d.diff;
  }

  const layers = a.Padstack().UniqueLayers();
  const board = a.GetBoard();
  let layerName: string;

  for (const layer of layers) {
    layerName = board ? board.GetLayerName(layer) : LayerName(layer);

    if (
      d.test(
        a.GetShape(layer) !== bLib.GetShape(layer),
        `${PAD_DESC(a)} pad shape type differs on layer ${layerName}.`,
      )
    ) {
      return d.diff;
    }

    if (
      d.test(
        !equal(a.GetSize(layer), bLib.GetSize(layer)),
        `${PAD_DESC(a)} size differs on layer ${layerName}.`,
      )
    )
      return d.diff;

    if (
      d.test(
        !equal(a.GetDelta(layer), bLib.GetDelta(layer)),
        `${PAD_DESC(a)} trapezoid delta differs on layer ${layerName}.`,
      )
    ) {
      return d.diff;
    }

    if (
      a.GetShape(layer) === PAD_SHAPE.ROUNDRECT ||
      a.GetShape(layer) === PAD_SHAPE.CHAMFERED_RECT
    ) {
      if (
        d.testD(
          a.GetRoundRectRadiusRatio(layer),
          bLib.GetRoundRectRadiusRatio(layer),
          `${PAD_DESC(a)} rounded corners differ on layer ${layerName}.`,
        )
      ) {
        return d.diff;
      }
    }

    if (a.GetShape(layer) === PAD_SHAPE.CHAMFERED_RECT) {
      if (
        d.testD(
          a.GetChamferRectRatio(layer),
          bLib.GetChamferRectRatio(layer),
          `${PAD_DESC(a)} chamfered corner sizes differ on layer ${layerName}.`,
        )
      ) {
        return d.diff;
      }

      if (
        d.test(
          a.GetChamferPositions(layer) !== bLib.GetChamferPositions(layer),
          `${PAD_DESC(a)} chamfered corners differ on layer ${layerName}.`,
        )
      ) {
        return d.diff;
      }
    }

    if (
      d.testPt(
        a.GetOffset(layer),
        bLib.GetOffset(layer),
        `${PAD_DESC(a)} shape offset from hole differs on layer ${layerName}.`,
      )
    ) {
      return d.diff;
    }
  }

  if (d.test(a.GetDrillShape() !== bLib.GetDrillShape(), `${PAD_DESC(a)} drill shape differs.`))
    return d.diff;
  if (d.test(!equal(a.GetDrillSize(), bLib.GetDrillSize()), `${PAD_DESC(a)} drill size differs.`))
    return d.diff;

  // Clearance and zone connection overrides are as likely to be set at the board level as in
  // the library.
  //
  // If we ignore them and someone *does* change one of them in the library, then stale
  // footprints won't be caught.
  //
  // On the other hand, if we report them then boards that override at the board level are
  // going to be VERY noisy.
  //
  // So we just do it when we have a reporter.
  if (aReporter && padHasOverrides(a, bLib, aReporter)) d.diff = true;

  let primitivesDiffer = false;
  let firstDifferingLayer: PCB_LAYER_ID = UNDEFINED_LAYER;

  a.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
    if (a.GetPrimitives(aLayer).length !== bLib.GetPrimitives(aLayer).length) {
      primitivesDiffer = true;
    } else {
      for (let ii = 0; ii < a.GetPrimitives(aLayer).length; ++ii) {
        if (primitiveNeedsUpdate(a.GetPrimitives(aLayer)[ii]!, bLib.GetPrimitives(aLayer)[ii]!)) {
          primitivesDiffer = true;
          break;
        }
      }
    }

    if (primitivesDiffer && firstDifferingLayer === UNDEFINED_LAYER) firstDifferingLayer = aLayer;
  });

  if (primitivesDiffer) {
    d.diff = true;
    layerName = board ? board.GetLayerName(firstDifferingLayer) : LayerName(firstDifferingLayer);

    if (aReporter) {
      aReporter.report(`${PAD_DESC(a)} shape primitives differ on layer ${layerName}.`);
    } else {
      return true;
    }
  }

  return d.diff;
}

function barcodeNeedsUpdate(curr_barcode: PCB_BARCODE, ref_barcode: PCB_BARCODE): boolean {
  const d = new DIFF(null);

  if (
    d.test(
      curr_barcode.GetText() !== ref_barcode.GetText(),
      `${ITEM_DESC(curr_barcode)} text differs.`,
    )
  )
    return d.diff;

  if (
    d.testPt(
      curr_barcode.GetPosition(),
      ref_barcode.GetPosition(),
      `${ITEM_DESC(curr_barcode)} position differs.`,
    )
  )
    return d.diff;

  if (
    d.test(
      curr_barcode.GetWidth() !== ref_barcode.GetWidth(),
      `${ITEM_DESC(curr_barcode)} width differs.`,
    )
  )
    return d.diff;
  if (
    d.test(
      curr_barcode.GetHeight() !== ref_barcode.GetHeight(),
      `${ITEM_DESC(curr_barcode)} height differs.`,
    )
  )
    return d.diff;

  if (
    d.test(
      curr_barcode.GetTextSize() !== ref_barcode.GetTextSize(),
      `${ITEM_DESC(curr_barcode)} text size differs.`,
    )
  )
    return d.diff;

  if (
    d.test(
      curr_barcode.GetKind() !== ref_barcode.GetKind(),
      `${ITEM_DESC(curr_barcode)} code differs.`,
    )
  )
    return d.diff;
  if (
    d.test(
      curr_barcode.GetErrorCorrection() !== ref_barcode.GetErrorCorrection(),
      `${ITEM_DESC(curr_barcode)} error correction level differs.`,
    )
  ) {
    return d.diff;
  }

  return d.diff;
}

function shapeNeedsUpdate(curr_shape: PCB_SHAPE, ref_shape: PCB_SHAPE): boolean {
  // curr_shape and ref_shape are expected to be normalized, for a more reliable test.
  const d = new DIFF(null);

  if (d.test(curr_shape.GetShape() !== ref_shape.GetShape(), '')) return d.diff;

  switch (curr_shape.GetShape()) {
    case SHAPE_T.RECTANGLE: {
      const aRect = new BOX2I(
        curr_shape.GetStart(),
        sub(curr_shape.GetEnd(), curr_shape.GetStart()),
      );
      const bRect = new BOX2I(ref_shape.GetStart(), sub(ref_shape.GetEnd(), ref_shape.GetStart()));

      aRect.Normalize();
      bRect.Normalize();

      if (d.testPt(aRect.GetOrigin(), bRect.GetOrigin(), '')) return d.diff;
      if (d.testPt(aRect.GetEnd(), bRect.GetEnd(), '')) return d.diff;
      break;
    }

    case SHAPE_T.SEGMENT:
    case SHAPE_T.CIRCLE:
      if (d.testPt(curr_shape.GetStart(), ref_shape.GetStart(), '')) return d.diff;
      if (d.testPt(curr_shape.GetEnd(), ref_shape.GetEnd(), '')) return d.diff;
      break;

    case SHAPE_T.ARC:
      if (d.testPt(curr_shape.GetStart(), ref_shape.GetStart(), '')) return d.diff;
      if (d.testPt(curr_shape.GetEnd(), ref_shape.GetEnd(), '')) return d.diff;

      // Arc center is calculated and so may have round-off errors when parents are
      // differentially rotated.
      if (
        EuclideanNorm(sub(curr_shape.GetArcMid(), ref_shape.GetArcMid())) >
        pcbIUScale.mmToIU(0.0005)
      )
        return true;

      break;

    case SHAPE_T.BEZIER:
      if (d.testPt(curr_shape.GetStart(), ref_shape.GetStart(), '')) return d.diff;
      if (d.testPt(curr_shape.GetEnd(), ref_shape.GetEnd(), '')) return d.diff;
      if (d.testPt(curr_shape.GetBezierC1(), ref_shape.GetBezierC1(), '')) return d.diff;
      if (d.testPt(curr_shape.GetBezierC2(), ref_shape.GetBezierC2(), '')) return d.diff;
      break;

    case SHAPE_T.POLY: {
      if (
        d.test(
          curr_shape.GetPolyShape().TotalVertices() !== ref_shape.GetPolyShape().TotalVertices(),
          '',
        )
      )
        return d.diff;

      for (let poly = 0; poly < curr_shape.GetPolyShape().CPolygons().length; poly++) {
        const curr_polygon = curr_shape.GetPolyShape().CPolygon(poly);
        const ref_polygon = ref_shape.GetPolyShape().CPolygon(poly);

        if (
          curr_polygon.length === 0 ||
          ref_polygon.length === 0 ||
          !curr_polygon[0]!.CompareGeometry(ref_polygon[0]!, true, EPSILON)
        ) {
          d.diff = true;
          return d.diff;
        }
      }
      break;
    }

    default:
      // UNIMPLEMENTED_FOR( curr_shape.SHAPE_T_asString() )
      break;
  }

  if (curr_shape.IsOnCopperLayer()) {
    if (d.test(curr_shape.GetStroke().notEquals(ref_shape.GetStroke()), '')) return d.diff;
  }

  if (d.test(curr_shape.GetFillMode() !== ref_shape.GetFillMode(), '')) return d.diff;

  if (d.test(curr_shape.GetLayer() !== ref_shape.GetLayer(), '')) return d.diff;

  return d.diff;
}

function zoneNeedsUpdate(a: ZONE, b: ZONE, aReporter: Reporter | null): boolean {
  const d = new DIFF(aReporter);

  if (
    d.test(
      a.GetCornerSmoothingType() !== b.GetCornerSmoothingType(),
      `${ITEM_DESC(a)} corner smoothing setting differs.`,
    )
  ) {
    return d.diff;
  }
  if (
    d.test(
      a.GetCornerRadius() !== b.GetCornerRadius(),
      `${ITEM_DESC(a)} corner smoothing radius differs.`,
    )
  )
    return d.diff;
  if (d.test(a.GetZoneName() !== b.GetZoneName(), `${ITEM_DESC(a)} name differs.`)) return d.diff;
  if (
    d.test(a.GetAssignedPriority() !== b.GetAssignedPriority(), `${ITEM_DESC(a)} priority differs.`)
  )
    return d.diff;

  if (d.test(a.GetIsRuleArea() !== b.GetIsRuleArea(), `${ITEM_DESC(a)} keep-out property differs.`))
    return d.diff;
  if (
    d.test(
      a.GetDoNotAllowZoneFills() !== b.GetDoNotAllowZoneFills(),
      `${ITEM_DESC(a)} keep out zone fill setting differs.`,
    )
  ) {
    return d.diff;
  }
  if (
    d.test(
      a.GetDoNotAllowFootprints() !== b.GetDoNotAllowFootprints(),
      `${ITEM_DESC(a)} keep out footprints setting differs.`,
    )
  ) {
    return d.diff;
  }
  if (
    d.test(
      a.GetDoNotAllowPads() !== b.GetDoNotAllowPads(),
      `${ITEM_DESC(a)} keep out pads setting differs.`,
    )
  )
    return d.diff;
  if (
    d.test(
      a.GetDoNotAllowTracks() !== b.GetDoNotAllowTracks(),
      `${ITEM_DESC(a)} keep out tracks setting differs.`,
    )
  )
    return d.diff;
  if (
    d.test(
      a.GetDoNotAllowVias() !== b.GetDoNotAllowVias(),
      `${ITEM_DESC(a)} keep out vias setting differs.`,
    )
  )
    return d.diff;

  // In1_Cu is used to indicate whether inner layer expansion is allowed on rulesets
  // Kind of annoying footprint pads use both in1_cu and have an stackup mode setting
  const innerLayerExpansionAllowed = b.GetLayerSet().Contains(PCB_LAYER_ID.In1_Cu);

  if (
    !boardLayersMatchWithInnerLayerExpansion(
      a.GetLayerSet(),
      getBoardNormalizedLayerSet(b, a.GetBoard()),
      innerLayerExpansionAllowed,
    )
  ) {
    d.diff = true;

    if (aReporter) {
      aReporter.report(`${ITEM_DESC(a)} layers differ.`);
    } else {
      return true;
    }
  }

  if (
    d.test(
      a.GetPadConnection() !== b.GetPadConnection(),
      `${ITEM_DESC(a)} pad connection property differs.`,
    )
  )
    return d.diff;
  if (
    d.test(
      a.GetLocalClearance() !== b.GetLocalClearance(),
      `${ITEM_DESC(a)} local clearance differs.`,
    )
  )
    return d.diff;
  if (
    d.test(
      a.GetThermalReliefGap() !== b.GetThermalReliefGap(),
      `${ITEM_DESC(a)} thermal relief gap differs.`,
    )
  )
    return d.diff;
  if (
    d.test(
      a.GetThermalReliefSpokeWidth() !== b.GetThermalReliefSpokeWidth(),
      `${ITEM_DESC(a)} thermal relief spoke width differs.`,
    )
  ) {
    return d.diff;
  }

  if (d.test(a.GetMinThickness() !== b.GetMinThickness(), `${ITEM_DESC(a)} min thickness differs.`))
    return d.diff;

  if (
    d.test(
      a.GetIslandRemovalMode() !== b.GetIslandRemovalMode(),
      `${ITEM_DESC(a)} remove islands setting differs.`,
    )
  )
    return d.diff;
  if (
    d.test(
      a.GetMinIslandArea() !== b.GetMinIslandArea(),
      `${ITEM_DESC(a)} minimum island size setting differs.`,
    )
  )
    return d.diff;

  if (d.test(a.GetFillMode() !== b.GetFillMode(), `${ITEM_DESC(a)} fill type differs.`))
    return d.diff;
  if (
    d.test(a.GetHatchThickness() !== b.GetHatchThickness(), `${ITEM_DESC(a)} hatch width differs.`)
  )
    return d.diff;
  if (d.test(a.GetHatchGap() !== b.GetHatchGap(), `${ITEM_DESC(a)} hatch gap differs.`))
    return d.diff;
  if (
    d.testD(
      a.GetHatchOrientation().AsDegrees(),
      b.GetHatchOrientation().AsDegrees(),
      `${ITEM_DESC(a)} hatch orientation differs.`,
    )
  ) {
    return d.diff;
  }
  if (
    d.test(
      a.GetHatchSmoothingLevel() !== b.GetHatchSmoothingLevel(),
      `${ITEM_DESC(a)} hatch smoothing level differs.`,
    )
  ) {
    return d.diff;
  }
  if (
    d.test(
      a.GetHatchSmoothingValue() !== b.GetHatchSmoothingValue(),
      `${ITEM_DESC(a)} hatch smoothing amount differs.`,
    )
  ) {
    return d.diff;
  }
  if (
    d.test(
      a.GetHatchHoleMinArea() !== b.GetHatchHoleMinArea(),
      `${ITEM_DESC(a)} minimum hatch hole setting differs.`,
    )
  ) {
    return d.diff;
  }

  // This is just a display property
  // TEST( a->GetHatchBorderAlgorithm(), b->GetHatchBorderAlgorithm() );

  if (
    d.test(
      a.Outline().TotalVertices() !== b.Outline().TotalVertices(),
      `${ITEM_DESC(a)} outline corner count differs.`,
    )
  ) {
    return d.diff;
  }

  let cornersDiffer = false;

  for (let poly = 0; poly < a.Outline().CPolygons().length; poly++) {
    const aPolygon = a.Outline().CPolygon(poly);
    const bPolygon = b.Outline().CPolygon(poly);

    if (
      aPolygon.length === 0 ||
      bPolygon.length === 0 ||
      !aPolygon[0]!.CompareGeometry(bPolygon[0]!, true, EPSILON)
    ) {
      d.diff = true;
      cornersDiffer = true;
      break;
    }
  }

  if (cornersDiffer && aReporter) aReporter.report(`${ITEM_DESC(a)} corners differ.`);

  return d.diff;
}

/**
 * Compare the stackup related settings of two footprints.
 *
 * Returns true if they differ.
 */
function stackupNeedsUpdate(a: FOOTPRINT, b: FOOTPRINT, aReporter: Reporter | null): boolean {
  const d = new DIFF(aReporter);

  if (d.test(a.GetStackupMode() !== b.GetStackupMode(), 'Footprint stackup mode differs.'))
    return d.diff;

  const aLayers = a.GetLayerSet();
  const bLayers = b.GetLayerSet();

  if (d.test(!aLayers.equals(bLayers), 'Footprint layers differ.')) return d.diff;

  return d.diff;
}

/**
 * Report board->footprint stackup differences.
 *
 * This is not necessarily a comparison failure, but may be useful information
 * for the user to see.
 *
 * @return true if there is
 */
function footprintVsBoardStackup(
  aFp: FOOTPRINT,
  aBoard: BOARD,
  aReporter: Reporter | null,
): boolean {
  if (aFp.GetStackupMode() === FOOTPRINT_STACKUP.EXPAND_INNER_LAYERS) return false;

  // Filter only layers that can differ between footprint and board
  const fpLayers = aFp.GetStackupLayers();
  const brdLayers = aBoard
    .GetEnabledLayers()
    .and(LSET.AllCuMask().or(LSET.UserDefinedLayersMask()));

  let mismatch = false;

  // Any layer in the FP and not on the board is flagged
  const onlyInFp = fpLayers.and(new LSET(brdLayers).flip());

  if (onlyInFp.count()) {
    mismatch = true;
    if (aReporter) {
      aReporter.report(
        `Footprint has ${onlyInFp.count()} layers not on board: ${AccumulateNames(onlyInFp.Seq(), aBoard)}`,
      );
    }
  }

  // Only look at copper layers here: user layers on the board and not in the FP is normal
  const cuOnlyInBoard = brdLayers.and(new LSET(fpLayers).flip()).and(LSET.AllCuMask());

  if (cuOnlyInBoard.count()) {
    mismatch = true;
    if (aReporter) {
      aReporter.report(
        `Board has ${cuOnlyInBoard.count()} copper layers not in footprint: ${AccumulateNames(cuOnlyInBoard.Seq(), aBoard)}`,
      );
    }
  }

  return mismatch;
}

/**
 * `std::set<T*, cmp>`: the items in the comparator's order, with an item the
 * comparator finds equivalent to one already there left out.
 */
function orderedSet<T>(aItems: readonly T[], aLess: (a: T, b: T) => boolean): T[] {
  const out: T[] = [];

  for (const item of aItems) {
    if (out.some((o) => !aLess(o, item) && !aLess(item, o))) continue;

    out.push(item);
  }

  out.sort((a, b) => (aLess(a, b) ? -1 : aLess(b, a) ? 1 : 0));
  return out;
}

/**
 * `FOOTPRINT::FootprintNeedsUpdate( aLibFP, aCompareFlags, aReporter )`
 * (drc_test_provider_library_parity.cpp:768).
 */
export function FootprintNeedsUpdate(
  aThis: FOOTPRINT,
  aLibFP: FOOTPRINT,
  aCompareFlags = 0,
  aReporter: Reporter | null = null,
): boolean {
  const d = new DIFF(aReporter);

  // To avoid issues when comparing the footprint on board and the footprint in library
  // use the footprint from lib flipped, rotated and at same position as this.
  // And using the footprint from lib with same changes as this minimize the issues
  // due to rounding and shape modifications

  const temp = aLibFP.Clone();

  temp.SetParent(aThis.GetBoard()); // Needed to know the copper layer count;

  if (!(aCompareFlags & BOARD_ITEM.COMPARE_FLAGS.INSTANCE_TO_INSTANCE)) {
    if (aThis.IsFlipped() !== temp.IsFlipped())
      temp.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);

    // Set position first before rotating to minimize rounding errors.
    if (!equal(aThis.GetPosition(), temp.GetPosition())) temp.SetPosition(aThis.GetPosition());

    if (!aThis.GetOrientation().equals(temp.GetOrientation()))
      temp.SetOrientation(aThis.GetOrientation());
  }

  for (const item of temp.GraphicalItems()) item.NormalizeForCompare();

  // This temporary footprint must not have a parent when it goes out of scope because it
  // must not trigger the IncrementTimestamp call in ~FOOTPRINT.
  temp.SetParent(null);

  aLibFP = temp;

  // These checks don't set off errors, they're just informational
  footprintVsBoardStackup(aThis, aThis.GetBoard()!, aReporter);

  const TEST_ATTR = (a: number, b: number, attr: number, msg: string): boolean =>
    d.test((a & attr) !== (b & attr), msg);

  if (
    TEST_ATTR(
      aThis.GetAttributes(),
      aLibFP.GetAttributes(),
      FOOTPRINT_ATTR_T.FP_THROUGH_HOLE | FOOTPRINT_ATTR_T.FP_SMD,
      'Footprint types differ.',
    )
  ) {
    return d.diff;
  }

  if (
    d.test(
      aThis.AllowSolderMaskBridges() !== aLibFP.AllowSolderMaskBridges(),
      `'Allow bridged solder mask apertures between pads' settings differ.`,
    )
  ) {
    return d.diff;
  }

  if (!(aCompareFlags & BOARD_ITEM.COMPARE_FLAGS.DRC)) {
    // These tests are skipped for DRC: they are presumed to relate to a given design.
    if (
      TEST_ATTR(
        aThis.GetAttributes(),
        aLibFP.GetAttributes(),
        FOOTPRINT_ATTR_T.FP_BOARD_ONLY,
        `'Not in schematic' settings differ.`,
      )
    ) {
      return d.diff;
    }

    if (
      TEST_ATTR(
        aThis.GetAttributes(),
        aLibFP.GetAttributes(),
        FOOTPRINT_ATTR_T.FP_EXCLUDE_FROM_POS_FILES,
        `'Exclude from position files' settings differ.`,
      )
    ) {
      return d.diff;
    }

    if (
      TEST_ATTR(
        aThis.GetAttributes(),
        aLibFP.GetAttributes(),
        FOOTPRINT_ATTR_T.FP_EXCLUDE_FROM_BOM,
        `'Exclude from bill of materials' settings differ.`,
      )
    ) {
      return d.diff;
    }

    if (
      TEST_ATTR(
        aThis.GetAttributes(),
        aLibFP.GetAttributes(),
        FOOTPRINT_ATTR_T.FP_DNP,
        `'Do not populate' settings differ.`,
      )
    ) {
      return d.diff;
    }
  }

  const CHECKPOINT = (): boolean => d.diff && !aReporter;

  if (stackupNeedsUpdate(aThis, aLibFP, aReporter)) {
    d.diff = true;
    d.report('Footprint stackup differs.');
  }

  // Clearance and zone connection overrides are as likely to be set at the board level as in
  // the library.
  //
  // If we ignore them and someone *does* change one of them in the library, then stale
  // footprints won't be caught.
  //
  // On the other hand, if we report them then boards that override at the board level are
  // going to be VERY noisy.
  //
  // For report them as different, but we DON'T generate DRC errors on them.
  if (!(aCompareFlags & BOARD_ITEM.COMPARE_FLAGS.DRC)) {
    if (
      aThis.GetLocalClearance() !== undefined &&
      aThis.GetLocalClearance() !== aLibFP.GetLocalClearance()
    ) {
      d.diff = true;
      d.report('Pad clearance overridden.');
    }

    if (
      aThis.GetLocalSolderMaskMargin() !== undefined &&
      aThis.GetLocalSolderMaskMargin() !== aLibFP.GetLocalSolderMaskMargin()
    ) {
      d.diff = true;
      d.report('Solder mask expansion overridden.');
    }

    if (
      aThis.GetLocalSolderPasteMargin() !== undefined &&
      aThis.GetLocalSolderPasteMargin() !== aLibFP.GetLocalSolderPasteMargin()
    ) {
      d.diff = true;
      d.report('Solder paste absolute clearance overridden.');
    }

    if (
      aThis.GetLocalSolderPasteMarginRatio() !== undefined &&
      aThis.GetLocalSolderPasteMarginRatio() !== aLibFP.GetLocalSolderPasteMarginRatio()
    ) {
      d.diff = true;
      d.report('Solder paste relative clearance overridden.');
    }

    if (
      aThis.GetLocalZoneConnection() !== ZONE_CONNECTION.INHERITED &&
      aThis.GetLocalZoneConnection() !== aLibFP.GetLocalZoneConnection()
    ) {
      d.diff = true;
      d.report('Zone connection overridden.');
    }
  }

  if (
    d.test(
      aThis.GetNetTiePadGroups().length !== aLibFP.GetNetTiePadGroups().length,
      'Net tie pad groups differ.',
    )
  )
    return d.diff;

  for (let ii = 0; ii < aThis.GetNetTiePadGroups().length; ++ii) {
    if (
      d.test(
        aThis.GetNetTiePadGroups()[ii] !== aLibFP.GetNetTiePadGroups()[ii],
        'Net tie pad groups differ.',
      )
    )
      return d.diff;
  }

  // Text items are really problematic.  We don't want to test the reference, but after that
  // it gets messy.
  //
  // What about the value?  Depends on whether or not it's a singleton part.
  //
  // And what about other texts?  They might be added only to instances on the board, or even
  // changed for instances on the board.  Or they might want to be tested for equality.
  //
  // Currently we punt and ignore all the text items.

  // Drawings and pads are also somewhat problematic as there's no guarantee that they'll be
  // in the same order in the two footprints.  Rather than building some sophisticated hashing
  // algorithm we use the footprint sorting functions to attempt to sort them in the same
  // order.

  // However FOOTPRINT::cmp_drawings uses PCB_SHAPE coordinates and other infos, so we have
  // already normalized graphic items in model footprint from library, so we need to normalize
  // graphic items in the footprint to test (*this). So normalize them using a copy of this
  const dummy = aThis.Clone();
  dummy.SetParentGroup(null);
  dummy.SetParent(null);

  for (const item of dummy.GraphicalItems()) item.NormalizeForCompare();

  const aShapes = orderedSet(
    dummy.GraphicalItems().filter((item) => item.Type() === KICAD_T.PCB_SHAPE_T),
    FOOTPRINT.cmp_drawings,
  );

  const bShapes = orderedSet(
    aLibFP.GraphicalItems().filter((item) => item.Type() === KICAD_T.PCB_SHAPE_T),
    FOOTPRINT.cmp_drawings,
  );

  if (aShapes.length !== bShapes.length) {
    d.diff = true;
    d.report('Graphic item count differs.');
  } else {
    for (let ii = 0; ii < aShapes.length; ii++) {
      // aShapes and bShapes are the tested footprint PCB_SHAPE and the model PCB_SHAPE.
      // These shapes are already normalized.
      const curr_shape = aShapes[ii] as PCB_SHAPE;
      const test_shape = bShapes[ii] as PCB_SHAPE;

      if (shapeNeedsUpdate(curr_shape, test_shape)) {
        d.diff = true;
        d.report(`${ITEM_DESC(aShapes[ii]!)} differs.`);
      }
    }
  }

  if (CHECKPOINT()) return d.diff;

  const aBarcodes = orderedSet(
    dummy.GraphicalItems().filter((item) => item.Type() === KICAD_T.PCB_BARCODE_T),
    FOOTPRINT.cmp_drawings,
  );

  const bBarcodes = orderedSet(
    aLibFP.GraphicalItems().filter((item) => item.Type() === KICAD_T.PCB_BARCODE_T),
    FOOTPRINT.cmp_drawings,
  );

  if (aBarcodes.length !== bBarcodes.length) {
    d.diff = true;
    d.report('Barcode count differs.');
  } else {
    for (let ii = 0; ii < aBarcodes.length; ii++) {
      // aBarcodes and bBarcodes are the tested footprint PCB_BARCODE and the model PCB_BARCODE.
      // These shapes are already normalized.
      const curr_barcode = aBarcodes[ii] as PCB_BARCODE;
      const test_barcode = bBarcodes[ii] as PCB_BARCODE;

      if (barcodeNeedsUpdate(curr_barcode, test_barcode)) {
        d.diff = true;
        d.report(`${ITEM_DESC(aBarcodes[ii]!)} differs.`);
      }
    }
  }

  if (CHECKPOINT()) return d.diff;

  const aPads = orderedSet(aThis.Pads(), FOOTPRINT.cmp_pads);
  const bLibPads = orderedSet(aLibFP.Pads(), FOOTPRINT.cmp_pads);

  if (aPads.length !== bLibPads.length) {
    d.diff = true;
    d.report('Pad count differs.');
  } else {
    for (let ii = 0; ii < aPads.length; ii++) {
      if (padNeedsUpdate(aPads[ii]!, bLibPads[ii]!, aReporter)) d.diff = true;
      else if (aReporter && padHasOverrides(aPads[ii]!, bLibPads[ii]!, aReporter)) d.diff = true;
    }
  }

  if (CHECKPOINT()) return d.diff;

  const aZones = orderedSet(aThis.Zones(), FOOTPRINT.cmp_zones);
  const bZones = orderedSet(aLibFP.Zones(), FOOTPRINT.cmp_zones);

  if (aZones.length !== bZones.length) {
    d.diff = true;
    d.report('Rule area count differs.');
  } else {
    for (let ii = 0; ii < aZones.length; ii++)
      d.diff ||= zoneNeedsUpdate(aZones[ii]!, bZones[ii]!, aReporter);
  }

  return d.diff;
}
