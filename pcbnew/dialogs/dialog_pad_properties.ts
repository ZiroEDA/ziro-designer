// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Pad Properties (board side), headless.
 * Counterpart: `pcbnew/dialogs/dialog_pad_properties.cpp`.
 *
 * The wrinkle that is specific to the board editor: this model stores a pad's
 * position **board-absolute** (the reader bakes the footprint transform in),
 * but the file stores it **footprint-local**. So editing the position means
 * converting back through the parent's rotation and anchor before patching
 * `(at …)`. The angle needs no conversion — the file already holds a
 * board-frame absolute value, as `parsePAD` notes.
 *
 * The decision logic lives here so it can be tested without a UI.
 */
import { teardropParamsView } from '../teardrop/teardrop_parameters.js';
import type { TeardropParams } from '../teardrop/teardrop_parameters.js';

/** `BOARD_CONNECTED_ITEM::GetTeardropParams()`: the item's own, or the defaults. */
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { BRIGHTENED, SELECTED } from '@ziroeda/common/eda_item_flags.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { B_Cu, F_Cu } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { layerSetOfTokens, layerTokens } from './layer_tokens.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { DRCE_PAD_TH_WITH_NO_HOLE, DRCE_PADSTACK_INVALID } from '../drc/drc_item.js';
import type { FOOTPRINT } from '../footprint.js';
import { UNCONNECTED_NET } from '../netinfo.js';
import { PAD } from '../pad.js';
import { GetDefaultIpcRoundingRatio, PadHasMeaningfulRoundingRadius } from '../pad_utils.js';
import {
  CUSTOM_SHAPE_ZONE_MODE,
  PAD_ATTRIB,
  PAD_DRILL_SHAPE,
  PAD_PROP,
  PAD_SHAPE,
  PADSTACK,
  UNCONNECTED_LAYER_MODE,
} from '../padstack.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { ZONE_CONNECTION } from '../zones.js';
import type { TransferResult } from './dialog_text_properties.js';
import type { ZoneConnection } from '../zone_connection.js';

export type PadShape = 'circle' | 'rect' | 'oval' | 'trapezoid' | 'roundrect' | 'custom';

export type PadType = 'thru_hole' | 'smd' | 'connect' | 'np_thru_hole';

/**
 * `UNCONNECTED_LAYER_MODE` (pcbnew/padstack.h): what a through-hole pad or via
 * does with a copper layer it is not connected on. The removal is never applied
 * to the stored layer set — it is re-evaluated by `FlashLayer()` every time the
 * item is drawn, filled or plotted, so it tracks the routing.
 *
 * `start_end_only` has no pad spelling in the file format (the pad parser has
 * no token for it), so it can only round-trip on a via.
 */
export type UnconnectedLayerMode =
  /** Copper on every layer of the span, connected or not. KiCad's default. */
  | 'keep_all'
  /** Copper only where connected — outer layers included. */
  | 'remove_all'
  /** Copper where connected, plus the end layers: "Keep outside layers". */
  | 'remove_except_start_and_end'
  /** Copper on the two end layers and nowhere else, connections ignored. */
  | 'start_end_only';

/** Every field the dialog edits. */
export interface PadValues {
  number: string;
  net: number;
  type: PadType;
  shape: PadShape;
  /** Board-absolute anchor, IU — the dialog shows it relative to the footprint. */
  x: number;
  y: number;
  /** Degrees, board-frame absolute. */
  orientation: number;
  sizeX: number;
  sizeY: number;
  /** `(roundrect_rratio …)`, a fraction of the pad's smaller side. */
  roundrectRatio: number;
  /** `(rect_delta …)`, the trapezoid's taper. */
  deltaX: number;
  deltaY: number;
  /** Hole: absent for an SMD pad. */
  hasHole: boolean;
  holeOblong: boolean;
  holeW: number;
  holeH: number;
  holeOffsetX: number;
  holeOffsetY: number;
  layers: string[];
  /** Overrides; null is blank, meaning inherit. Zero is a real override. */
  localClearance: number | null;
  localSolderMaskMargin: number | null;
  localSolderPasteMargin: number | null;
  localSolderPasteMarginRatio: number | null;
  zoneConnection: ZoneConnection;
  /**
   * `(pinfunction …)` / `(pintype …)` — the schematic's pin name and electrical
   * type, pushed onto the pad by the netlist. DIALOG_PAD_PROPERTIES shows them
   * and does not edit them; PAD_DESC registers both with real setters
   * (pad.cpp:3462-3478), so the Properties panel does.
   */
  pinFunction: string;
  pinType: string;
  /**
   * `UNCONNECTED_LAYER_MODE`, PAD_DESC's "Copper Layers" enum
   * (pad.cpp:3757-3759): which copper layers a through-hole pad keeps where it
   * is not connected. Not a layer LIST — that is `layers`.
   */
  unconnectedLayerMode: UnconnectedLayerMode;
  thermalBridgeWidth: number | null;
  thermalGap: number | null;
  padToDieLength: number | null;
  /**
   * `(teardrops …)`, the per-item TEARDROP_PARAMETERS `BOARD_CONNECTED_ITEM`
   * carries. DIALOG_PAD_PROPERTIES has no teardrop page — these are the
   * Properties panel's rows (board_connected_item.cpp's `groupTeardrops`), whose
   * setters are BOARD_CONNECTED_ITEM's own and so apply to a pad exactly as they
   * do to a via.
   */
  teardrops: TeardropParams;
}

/** DIALOG_PAD_PROPERTIES::TransferDataToWindow. */
// ---------------------------------------------------------------------------
// The live dialog: DIALOG_PAD_PROPERTIES on a PAD (#636 stage 6)
// ---------------------------------------------------------------------------

/** `m_padType`'s rows (dialog_pad_properties.cpp:104-109). */
const enum DLG_TYPE {
  PTH = 0,
  SMD = 1,
  CONN = 2,
  NPTH = 3,
  APERTURE = 4,
}

/** `code_type[]` (:93-101): the aperture row is an SMD pad with no copper. */
const CODE_TYPE: readonly PAD_ATTRIB[] = [
  PAD_ATTRIB.PTH,
  PAD_ATTRIB.SMD,
  PAD_ATTRIB.CONN,
  PAD_ATTRIB.NPTH,
  PAD_ATTRIB.SMD,
];

const PAD_ATTRIB_OF_TYPE: Record<PadType, PAD_ATTRIB> = {
  thru_hole: PAD_ATTRIB.PTH,
  smd: PAD_ATTRIB.SMD,
  connect: PAD_ATTRIB.CONN,
  np_thru_hole: PAD_ATTRIB.NPTH,
};

const TYPE_OF_ATTRIB: Record<number, PadType> = {
  [PAD_ATTRIB.PTH]: 'thru_hole',
  [PAD_ATTRIB.SMD]: 'smd',
  [PAD_ATTRIB.CONN]: 'connect',
  [PAD_ATTRIB.NPTH]: 'np_thru_hole',
};

/** `m_PadShapeSelector`'s rows, as the dialog's CHOICE_SHAPE_* names them. */
type ShapeChoice =
  | 'circle'
  | 'oval'
  | 'rect'
  | 'trapezoid'
  | 'roundrect'
  | 'chamfered'
  | 'chamfered_rounded'
  | 'custom_circ'
  | 'custom_rect';

/** `code_shape[]`. */
const CODE_SHAPE: Record<ShapeChoice, PAD_SHAPE> = {
  circle: PAD_SHAPE.CIRCLE,
  oval: PAD_SHAPE.OVAL,
  rect: PAD_SHAPE.RECTANGLE,
  trapezoid: PAD_SHAPE.TRAPEZOID,
  roundrect: PAD_SHAPE.ROUNDRECT,
  chamfered: PAD_SHAPE.CHAMFERED_RECT,
  chamfered_rounded: PAD_SHAPE.CHAMFERED_RECT,
  custom_circ: PAD_SHAPE.CUSTOM,
  custom_rect: PAD_SHAPE.CUSTOM,
};

/** `m_ZoneConnectionChoice`'s rows (:746-752, :1979-1986). */
const ZONE_CHOICE: readonly [ZoneConnection & string, ZONE_CONNECTION][] = [
  ['inherited', ZONE_CONNECTION.INHERITED],
  ['full', ZONE_CONNECTION.FULL],
  ['thermal', ZONE_CONNECTION.THERMAL],
  ['none', ZONE_CONNECTION.NONE],
];

/**
 * `updatePadLayersList` (:1437-1531): the copper radio's row for a layer set
 * and unconnected-layer mode, and the set the technical checkboxes show (the
 * type's default mask stands in when an SMD or connector pad has no copper).
 */
function padLayersWindow(
  aType: DLG_TYPE,
  aMask: LSET,
  aRemoveUnconnected: boolean,
  aKeepTopBottom: boolean,
): { choice: number; mask: LSET } {
  const allCu = LSET.AllCuMask();
  let mask = aMask;
  let choice = 0;

  switch (aType) {
    case DLG_TYPE.PTH:
      if (mask.and(allCu).none()) choice = 3;
      else if (!aRemoveUnconnected) choice = 0;
      else if (aKeepTopBottom) choice = 1;
      else choice = 2;
      break;

    case DLG_TYPE.SMD:
    case DLG_TYPE.CONN:
      if (mask.and(allCu).none()) mask = aType === DLG_TYPE.SMD ? PAD.SMDMask() : PAD.ConnSMDMask();
      choice = mask.test(F_Cu) ? 0 : 1;
      break;

    case DLG_TYPE.NPTH:
      if (mask.test(F_Cu) && mask.test(B_Cu)) choice = 0;
      else if (mask.test(F_Cu)) choice = 1;
      else if (mask.test(B_Cu)) choice = 2;
      else choice = 3;
      break;

    case DLG_TYPE.APERTURE:
      choice = 0;
      break;
  }

  return { choice, mask };
}

/** The technical-layer checkboxes of the Layers box (:2229-2261). */
const TECH_LAYERS: readonly PCB_LAYER_ID[] = [
  PCB_LAYER_ID.F_Adhes,
  PCB_LAYER_ID.B_Adhes,
  PCB_LAYER_ID.F_Paste,
  PCB_LAYER_ID.B_Paste,
  PCB_LAYER_ID.F_SilkS,
  PCB_LAYER_ID.B_SilkS,
  PCB_LAYER_ID.F_Mask,
  PCB_LAYER_ID.B_Mask,
  PCB_LAYER_ID.Eco1_User,
  PCB_LAYER_ID.Eco2_User,
  PCB_LAYER_ID.Dwgs_User,
];

/**
 * transferDataToPad's layer block (:2171-2263): the copper the radio row
 * means for the type, the unconnected-layer mode it sets, and the checked
 * technical layers.
 */
function padLayersOfWindow(
  aType: DLG_TYPE,
  aChoice: number,
  aTech: LSET,
): { mask: LSET; mode: UNCONNECTED_LAYER_MODE } {
  let mask = new LSET();
  let mode = UNCONNECTED_LAYER_MODE.KEEP_ALL;

  switch (aType) {
    case DLG_TYPE.PTH:
      if (aChoice === 0) mask = mask.or(LSET.AllCuMask());
      else if (aChoice === 1) {
        mask = mask.or(LSET.AllCuMask());
        mode = UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END;
      } else if (aChoice === 2) {
        mask = mask.or(LSET.AllCuMask());
        mode = UNCONNECTED_LAYER_MODE.REMOVE_ALL;
      }
      break;

    case DLG_TYPE.NPTH:
      if (aChoice === 0) mask.set(F_Cu).set(B_Cu);
      else if (aChoice === 1) mask.set(F_Cu);
      else if (aChoice === 2) mask.set(B_Cu);
      break;

    case DLG_TYPE.SMD:
    case DLG_TYPE.CONN:
      if (aChoice === 0) mask.set(F_Cu);
      else if (aChoice === 1) mask.set(B_Cu);
      break;

    case DLG_TYPE.APERTURE:
      break;
  }

  for (const layer of TECH_LAYERS) if (aTech.test(layer)) mask.set(layer);

  return { mask, mode };
}

const UNCONNECTED_VIEW: Record<number, UnconnectedLayerMode> = {
  [UNCONNECTED_LAYER_MODE.KEEP_ALL]: 'keep_all',
  [UNCONNECTED_LAYER_MODE.REMOVE_ALL]: 'remove_all',
  [UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END]: 'remove_except_start_and_end',
  [UNCONNECTED_LAYER_MODE.START_END_ONLY]: 'start_end_only',
};

/**
 * `DIALOG_PAD_PROPERTIES` (dialog_pad_properties.cpp) on a live PAD, board
 * side, NORMAL padstack mode's edit layer (PADSTACK::ALL_LAYERS, which is
 * F_Cu, is also the first layer the other modes edit).
 *
 * Construction is the constructor plus initValues (:170-208, :652-680): the
 * preview is `*m_previewPad = *aPad` (parent included), its rounding ratio
 * zeroed where it is not meaningful, flipped top-to-bottom when the
 * footprint is flipped, and given the pad's footprint-relative orientation.
 * The window reads the preview; the position box shows the absolute one.
 *
 * OK (:1701-1778) runs transferDataToPad on the preview and checks it
 * (padValuesOK), writes the design settings' master pad the same way and
 * clears its net, then copies onto the pad: the preview's padstack, the
 * master's attribute, orientation (footprint-relative), die length and delay,
 * layer set, number and teardrops, the net (none for NPTH), the fabrication
 * property and custom-shape zone mode, a top-to-bottom flip when the
 * footprint is flipped, and the master's position. One BOARD_COMMIT, "Edit
 * Pad Properties".
 *
 * Where the values differ from the view-model form above, the C++ decides:
 * the orientation is footprint-relative, not board-absolute; a flipped
 * footprint's pad is shown front-side (layers mirrored); the copper layers
 * are the radio's meaning for the type, so a PTH pad with any copper
 * becomes all-copper. `pinFunction`/`pinType` are shown, not written - the
 * dialog does not edit them. Fields the window holds that the values do not
 * (spoke angle, chamfers, primitives, anchor, fabrication property, die
 * delay, zone-fill mode) carry the preview's own values through, as an
 * untouched window does.
 */
export class DIALOG_PAD_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_currentPad: PAD;
  private readonly m_previewPad: PAD;
  // Window state the values do not carry, as initValues left it.
  private readonly m_primitives: PCB_SHAPE[];
  private readonly m_initialShape: PAD_SHAPE;
  private readonly m_spokeAngle: EDA_ANGLE;
  private readonly m_chamferPositions: number;
  private readonly m_chamferRatio: number;
  private readonly m_property: PAD_PROP;
  private readonly m_customShapeInZone: CUSTOM_SHAPE_ZONE_MODE;
  private readonly m_padToDieDelay: number;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aPad: PAD) {
    this.m_frame = aFrame;
    this.m_currentPad = aPad;

    const L = PADSTACK.ALL_LAYERS;
    const preview = new PAD(null);
    preview.assignPad(aPad);
    preview.ClearFlags(SELECTED | BRIGHTENED);

    preview.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      if (!PadHasMeaningfulRoundingRadius(preview, aLayer))
        preview.SetRoundRectRadiusRatio(aLayer, 0.0);
    });

    const footprint = aPad.GetParentFootprint() as FOOTPRINT | null;

    if (footprint) {
      const relPos = { ...aPad.GetFPRelativePosition() };

      if (footprint.IsFlipped()) {
        // flip pad (up/down) around its position
        preview.Flip(preview.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
        relPos.y = -relPos.y;
      }

      preview.SetPosition(relPos);
      preview.SetOrientation(aPad.GetFPRelativeOrientation());
    }

    this.m_previewPad = preview;
    this.m_primitives = preview.GetPrimitives(L).map((p) => PCB_SHAPE.copyOf(p));
    this.m_initialShape = preview.GetShape(L);
    this.m_spokeAngle = preview.GetThermalSpokeAngle().Clone();
    this.m_chamferPositions = preview.GetChamferPositions(L);
    this.m_chamferRatio = preview.GetChamferRectRatio(L);
    this.m_property = preview.GetProperty();
    this.m_customShapeInZone = preview.GetCustomShapeInZoneOpt();
    this.m_padToDieDelay = preview.GetPadToDieDelay();
  }

  private copperLayerCount(): number {
    return this.m_currentPad.GetBoard()?.GetCopperLayerCount() ?? 2;
  }

  /** The `m_padType` row a pad reads as (:761-775). */
  private static dlgTypeOf(aAttrib: PAD_ATTRIB, aMask: LSET): DLG_TYPE {
    if (aAttrib === PAD_ATTRIB.SMD && aMask.and(LSET.AllCuMask()).none()) return DLG_TYPE.APERTURE;

    switch (aAttrib) {
      case PAD_ATTRIB.PTH:
        return DLG_TYPE.PTH;
      case PAD_ATTRIB.CONN:
        return DLG_TYPE.CONN;
      case PAD_ATTRIB.NPTH:
        return DLG_TYPE.NPTH;
      default:
        return DLG_TYPE.SMD;
    }
  }

  TransferDataToWindow(): PadValues {
    const p = this.m_previewPad;
    const L = PADSTACK.ALL_LAYERS;
    const shape = p.GetShape(L);
    const size = p.GetSize(L);
    const delta = p.GetDelta(L);
    const offset = p.GetOffset(L);
    const drill = p.GetDrillSize();
    const zc = ZONE_CHOICE.find(([, z]) => z === p.GetLocalZoneConnection());
    const type = DIALOG_PAD_PROPERTIES.dlgTypeOf(p.GetAttribute(), p.GetLayerSet());
    const { choice, mask } = padLayersWindow(
      type,
      p.GetLayerSet(),
      p.GetRemoveUnconnected(),
      p.GetKeepTopBottom(),
    );
    const shown = padLayersOfWindow(type, choice, mask);

    return {
      number: p.GetNumber(),
      net: p.GetNetCode(),
      type: TYPE_OF_ATTRIB[p.GetAttribute()] ?? 'smd',
      shape:
        shape === PAD_SHAPE.CHAMFERED_RECT
          ? 'roundrect'
          : shape === PAD_SHAPE.CIRCLE
            ? 'circle'
            : shape === PAD_SHAPE.OVAL
              ? 'oval'
              : shape === PAD_SHAPE.TRAPEZOID
                ? 'trapezoid'
                : shape === PAD_SHAPE.ROUNDRECT
                  ? 'roundrect'
                  : shape === PAD_SHAPE.CUSTOM
                    ? 'custom'
                    : 'rect',
      x: this.m_currentPad.GetPosition().x,
      y: this.m_currentPad.GetPosition().y,
      orientation: p.GetOrientation().AsDegrees(),
      sizeX: size.x,
      sizeY: size.y,
      roundrectRatio: p.GetRoundRectRadiusRatio(L),
      // One trapezoid axis at a time (:898-908).
      deltaX: delta.x,
      deltaY: delta.x ? 0 : delta.y,
      hasHole: drill.x > 0 || drill.y > 0,
      holeOblong: p.GetDrillShape() === PAD_DRILL_SHAPE.OBLONG,
      holeW: drill.x,
      holeH: drill.y,
      holeOffsetX: offset.x,
      holeOffsetY: offset.y,
      layers: layerTokens(shown.mask, this.copperLayerCount()),
      localClearance: p.GetLocalClearance() ?? null,
      localSolderMaskMargin: p.GetLocalSolderMaskMargin() ?? null,
      localSolderPasteMargin: p.GetLocalSolderPasteMargin() ?? null,
      localSolderPasteMarginRatio: p.GetLocalSolderPasteMarginRatio() ?? null,
      zoneConnection: zc ? zc[0] : 'inherited',
      pinFunction: p.GetPinFunction(),
      pinType: p.GetPinType(),
      unconnectedLayerMode: UNCONNECTED_VIEW[shown.mode] ?? 'keep_all',
      thermalBridgeWidth: p.GetLocalThermalSpokeWidthOverride() ?? null,
      thermalGap: p.GetLocalThermalGapOverride() ?? null,
      padToDieLength: p.GetPadToDieLength() !== 0 ? p.GetPadToDieLength() : null,
      teardrops: teardropParamsView(p.GetTeardropParams()),
    };
  }

  /** The shape selector's row for the values (a chamfered pad stays chamfered). */
  private shapeChoiceOf(v: PadValues): ShapeChoice {
    const L = PADSTACK.ALL_LAYERS;
    const p = this.m_previewPad;

    switch (v.shape) {
      case 'circle':
      case 'oval':
      case 'rect':
      case 'trapezoid':
        return v.shape;
      case 'roundrect':
        if (this.m_initialShape === PAD_SHAPE.CHAMFERED_RECT)
          return v.roundrectRatio > 0 ? 'chamfered_rounded' : 'chamfered';
        return 'roundrect';
      case 'custom':
        return p.GetShape(L) === PAD_SHAPE.CUSTOM && p.GetAnchorPadShape(L) === PAD_SHAPE.RECTANGLE
          ? 'custom_rect'
          : 'custom_circ';
    }
  }

  /** The window's copper radio row and technical layers for the values. */
  private layersOf(v: PadValues, aType: DLG_TYPE): { mask: LSET; mode: UNCONNECTED_LAYER_MODE } {
    const tokens = layerSetOfTokens(v.layers);
    const { choice, mask } = padLayersWindow(
      aType,
      tokens,
      v.unconnectedLayerMode !== 'keep_all',
      v.unconnectedLayerMode === 'remove_except_start_and_end',
    );

    return padLayersOfWindow(aType, choice, mask);
  }

  /**
   * `transferDataToPad` (:1900-2350), for the controls the values carry.
   * Returns false where the dialog's validators refuse (:1905-1916).
   */
  private transferDataToPad(aPad: PAD, v: PadValues): boolean {
    // m_spokeWidth.Validate( 0, INT_MAX )
    if (v.thermalBridgeWidth !== null && v.thermalBridgeWidth < 0) return false;

    const L = PADSTACK.ALL_LAYERS;
    const layersType = DIALOG_PAD_PROPERTIES.dlgTypeOf(
      PAD_ATTRIB_OF_TYPE[v.type],
      layerSetOfTokens(v.layers),
    );
    const sel = this.shapeChoiceOf(v);

    aPad.SetAttribute(CODE_TYPE[layersType]!);
    aPad.SetShape(L, CODE_SHAPE[sel]);
    aPad.SetAnchorPadShape(L, sel === 'custom_rect' ? PAD_SHAPE.RECTANGLE : PAD_SHAPE.CIRCLE);

    if (aPad.GetShape(L) === PAD_SHAPE.CUSTOM) aPad.ReplacePrimitives(L, this.m_primitives);

    const td = aPad.GetTeardropParams();
    td.m_Enabled = v.teardrops.enabled;
    td.m_AllowUseTwoTracks = v.teardrops.allowUseTwoTracks;
    td.m_TdOnPadsInZones = v.teardrops.tdOnPadsInZones;
    td.m_TdMaxLen = v.teardrops.tdMaxLen;
    td.m_TdMaxWidth = v.teardrops.tdMaxWidth;
    td.m_BestLengthRatio = v.teardrops.bestLengthRatio;
    td.m_BestWidthRatio = v.teardrops.bestWidthRatio;
    td.m_CurvedEdges = v.teardrops.curvedEdges;
    td.m_WidthtoSizeFilterRatio = v.teardrops.widthtoSizeFilterRatio;

    // Read pad clearances values:
    aPad.SetLocalClearance(v.localClearance ?? undefined);
    aPad.SetLocalSolderMaskMargin(v.localSolderMaskMargin ?? undefined);
    aPad.SetLocalSolderPasteMargin(v.localSolderPasteMargin ?? undefined);
    aPad.SetLocalSolderPasteMarginRatio(v.localSolderPasteMarginRatio ?? undefined);
    aPad.SetLocalThermalSpokeWidthOverride(v.thermalBridgeWidth ?? undefined);
    aPad.SetLocalThermalGapOverride(v.thermalGap ?? undefined);

    // onPadShapeSelection( true ) (:1123-1136): a shape change between circle
    // and anything else swaps a default spoke angle for the other default.
    let spokeAngle = this.m_spokeAngle;
    const wasCircle = this.m_initialShape === PAD_SHAPE.CIRCLE;

    if (sel === 'circle' && !wasCircle && spokeAngle.AsDegrees() === 90)
      spokeAngle = new EDA_ANGLE(45);
    else if (sel !== 'circle' && wasCircle && spokeAngle.AsDegrees() === 45)
      spokeAngle = new EDA_ANGLE(90);

    aPad.SetThermalSpokeAngle(spokeAngle);

    // And rotation
    aPad.SetOrientation(new EDA_ANGLE(v.orientation));

    const zc = ZONE_CHOICE.find(([name]) => name === v.zoneConnection);
    aPad.SetLocalZoneConnection(zc ? zc[1] : ZONE_CONNECTION.INHERITED);

    const pos = { x: v.x, y: v.y };
    const fp = aPad.GetParentFootprint() as FOOTPRINT | null;

    if (fp) {
      const rel = RotatePoint(
        { x: pos.x - fp.GetPosition().x, y: pos.y - fp.GetPosition().y },
        fp.GetOrientation().negate(),
      );
      pos.x = rel.x;
      pos.y = rel.y;
    }

    aPad.SetPosition(pos);

    if (!v.holeOblong) {
      aPad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
      aPad.SetDrillSize({ x: v.holeW, y: v.holeW });
    } else {
      aPad.SetDrillShape(PAD_DRILL_SHAPE.OBLONG);
      aPad.SetDrillSize({ x: v.holeW, y: v.holeH });
    }

    if (aPad.GetShape(L) === PAD_SHAPE.CIRCLE) aPad.SetSize(L, { x: v.sizeX, y: v.sizeX });
    else aPad.SetSize(L, { x: v.sizeX, y: v.sizeY });

    // For a trapezoid, test delta value (be sure delta is not too large for pad size)
    // remember DeltaSize.x is the Y size variation
    const delta = { x: 0, y: 0 };

    if (aPad.GetShape(L) === PAD_SHAPE.TRAPEZOID) {
      const size = aPad.GetSize(L);

      // For a trapezoid, only one of delta.x or delta.y is not 0, depending on axis.
      if (v.deltaX !== 0) delta.x = v.deltaX;
      else delta.y = v.deltaY;

      if (delta.x < 0 && delta.x < -size.y) delta.x = -size.y + 2;
      if (delta.x > 0 && delta.x > size.y) delta.x = size.y - 2;
      if (delta.y < 0 && delta.y < -size.x) delta.y = -size.x + 2;
      if (delta.y > 0 && delta.y > size.x) delta.y = size.x - 2;
    }

    aPad.SetDelta(L, delta);
    aPad.SetOffset(L, { x: v.holeOffsetX, y: v.holeOffsetY });

    aPad.SetPadToDieLength(v.padToDieLength ?? 0);
    aPad.SetPadToDieDelay(this.m_padToDieDelay);

    aPad.SetNumber(v.number);
    aPad.SetNetCode(v.net);

    aPad.SetChamferPositions(
      L,
      sel === 'chamfered' || sel === 'chamfered_rounded' ? this.m_chamferPositions : 0,
    );

    if (aPad.GetShape(L) === PAD_SHAPE.CUSTOM) {
      // The anchor pad of a custom shape
      if (aPad.GetAnchorPadShape(L) === PAD_SHAPE.CIRCLE)
        aPad.SetSize(L, { x: v.sizeX, y: v.sizeX });
    }

    aPad.SetCustomShapeInZoneOpt(this.m_customShapeInZone);

    switch (aPad.GetAttribute()) {
      case PAD_ATTRIB.CONN:
      case PAD_ATTRIB.SMD:
        // SMD and PAD_ATTRIB::CONN has no hole.
        aPad.SetDrillSize({ x: 0, y: 0 });
        break;

      case PAD_ATTRIB.NPTH:
        // Mechanical purpose only: no net name, no pad name allowed
        aPad.SetNumber('');
        aPad.SetNetCode(UNCONNECTED_NET);
        break;

      default:
    }

    if (aPad.GetShape(L) === PAD_SHAPE.ROUNDRECT) {
      // onPadShapeSelection's "Reasonable defaults" (:1062-1068): a pad newly
      // made round-rect with no ratio of its own gets the IPC one.
      const ratio =
        v.roundrectRatio === 0 && this.m_initialShape !== PAD_SHAPE.ROUNDRECT
          ? GetDefaultIpcRoundingRatio(this.m_previewPad, L)
          : v.roundrectRatio;

      aPad.SetRoundRectRadiusRatio(L, ratio);
    } else if (aPad.GetShape(L) === PAD_SHAPE.CHAMFERED_RECT) {
      aPad.SetChamferRectRatio(L, this.m_chamferRatio);
      aPad.SetRoundRectRadiusRatio(L, sel === 'chamfered_rounded' ? v.roundrectRatio : 0);
    }

    aPad.SetProperty(this.m_property);

    const layers = this.layersOf(v, layersType);
    aPad.Padstack().SetUnconnectedLayerMode(layers.mode);
    aPad.SetLayerSet(layers.mask);

    return true;
  }

  /** padValuesOK (:1574-1614): the preview's CheckPad errors refuse OK. */
  private padValuesOK(v: PadValues): TransferResult {
    if (!this.transferDataToPad(this.m_previewPad, v)) return { ok: false };

    const errors: string[] = [];

    this.m_previewPad.CheckPad(this.m_frame.GetUnitsProvider(), true, (errorCode, msg) => {
      if (errorCode === DRCE_PADSTACK_INVALID) errors.push(`Error: ${msg}`);
      else if (errorCode === DRCE_PAD_TH_WITH_NO_HOLE)
        errors.push('Error: Through hole pad has no hole.');
    });

    return errors.length ? { ok: false, message: errors.join('\n') } : { ok: true };
  }

  TransferDataFromWindow(v: PadValues): TransferResult {
    const check = this.padValuesOK(v);

    if (!check.ok) return check;

    const master = this.m_frame.GetDesignSettings().m_Pad_Master;

    if (!this.transferDataToPad(master, v)) return { ok: false };

    // m_masterPad is a pattern: ensure there is no net for this pad:
    master.SetNetCode(UNCONNECTED_NET);

    const pad = this.m_currentPad;
    const commit = new BOARD_COMMIT(this.m_frame);
    commit.Modify(pad);

    // transferDataToPad only handles the current edit layer, so m_masterPad isn't accurate
    pad.SetPadstack(this.m_previewPad.Padstack());

    pad.SetAttribute(master.GetAttribute());
    pad.SetFPRelativeOrientation(master.GetOrientation());
    pad.SetPadToDieLength(master.GetPadToDieLength());
    pad.SetPadToDieDelay(master.GetPadToDieDelay());
    pad.SetLayerSet(master.GetLayerSet());
    pad.SetNumber(master.GetNumber());

    // For PAD_ATTRIB::NPTH, ensure there is no net name selected
    pad.SetNetCode(master.GetAttribute() !== PAD_ATTRIB.NPTH ? v.net : UNCONNECTED_NET);

    pad.GetTeardropParams().assign(master.GetTeardropParams());

    // Set the fabrication property:
    pad.SetProperty(this.m_property);

    // define the way the clearance area is defined in zones
    pad.SetCustomShapeInZoneOpt(master.GetCustomShapeInZoneOpt());

    const fp = pad.GetParentFootprint() as FOOTPRINT | null;

    // flip pad (up/down) around its position
    if (fp?.IsFlipped()) pad.Flip(pad.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);

    pad.SetPosition(master.GetPosition());

    commit.Push('Edit Pad Properties');

    return { ok: true };
  }
}
