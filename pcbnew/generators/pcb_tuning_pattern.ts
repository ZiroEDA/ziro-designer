// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/generators/pcb_tuning_pattern.h` / `.cpp`: `PCB_TUNING_PATTERN`,
 * the one `PCB_GENERATOR` KiCad ships — a length-tuning meander on a
 * track (single, differential pair, or pair skew), stored in the file as
 * a `(generated (type "tuning_pattern") …)` with its baseline and settings.
 *
 * The item half is here whole: construction, the properties the file
 * carries (`GetProperties` / `SetProperties`), the outline, the
 * transforms, hit testing, the accessors. The tool half — `CreateNew`,
 * `EditStart` / `Update` / `EditFinish` / `EditCancel` / `Remove`, the
 * edit points, `ViewDraw`, `ShowPropertiesDialog`, `GetPreviewItems`,
 * `TUNING_STATUS_VIEW_ITEM` — drives the PNS router through
 * `GENERATOR_TOOL` and `BOARD_COMMIT` and lands with them
 * (-- pending (#636 stage 3)). `m_settings` is the router's
 * `MeanderSettings` (pns_meander.ts), which is `PNS::MEANDER_SETTINGS`.
 */

import { type EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/src/eda_item.js';
import { IN_EDIT } from '@ziroeda/common/src/eda_item_flags.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { GAL_LAYER_ID, PCB_LAYER_ID, F_Cu } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { COORD_TYPES_T } from '@ziroeda/common/src/origin_transforms.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  NO_SETTER,
  PG_CHOICES,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_CAST,
  TYPE_COLOR4D,
  TYPE_DOUBLE,
  TYPE_INT,
  TYPE_OPT_INT,
  TYPE_STRING,
} from '@ziroeda/common/src/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/src/properties/property_mgr.js';

import type { STRING_ANY_MAP } from '@ziroeda/common/src/string_any_map.js';
import { unescapeString } from '@ziroeda/common/src/string_utils.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/src/widgets/msgpanel.js';
import type { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { type VECTOR2I, add } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import { BOARD_ITEM } from '../board_item.js';
import { GENERATORS_MGR } from '../generators_mgr.js';
import type { NETCLASS } from '@ziroeda/common/src/netclass.js';
import type { NETINFO_ITEM } from '../netinfo.js';
import type { BOARD_COMMIT_LIKE } from '../board_item.js';
import {
  type EDIT_POINTS_LIKE,
  type GENERATOR_TOOL_LIKE,
  PCB_GENERATOR,
} from '../pcb_generator.js';
import { PCB_GROUP } from '../pcb_group.js';
import { PCB_TRACK } from '../pcb_track.js';
import {
  MEANDER_DELAY_UNCONSTRAINED,
  MEANDER_LENGTH_UNCONSTRAINED,
  type MeanderSettings,
  MeanderSide,
  MeanderStyle,
  defaultMeanderSettings,
  minOptMaxMax,
  minOptMaxMin,
  minOptMaxOpt,
  setTargetLength,
  setTargetLengthDelay,
  setTargetSkew,
  setTargetSkewDelay,
} from '../router/pns_meander.js';
import { PnsTuningStatus } from '../router/pns_meander_placer_base.js';
import { PnsRouterMode } from '../router/pns_router.js';

export enum LENGTH_TUNING_MODE {
  SINGLE = 0,
  DIFF_PAIR,
  DIFF_PAIR_SKEW,
}

export const { SINGLE, DIFF_PAIR, DIFF_PAIR_SKEW } = LENGTH_TUNING_MODE;

function tuningFromString(aStr: string): LENGTH_TUNING_MODE {
  if (aStr === 'single') return LENGTH_TUNING_MODE.SINGLE;
  if (aStr === 'diff_pair') return LENGTH_TUNING_MODE.DIFF_PAIR;
  if (aStr === 'diff_pair_skew') return LENGTH_TUNING_MODE.DIFF_PAIR_SKEW;

  // wxFAIL_MSG( "Unknown length tuning token" )
  return LENGTH_TUNING_MODE.SINGLE;
}

function tuningToString(aTuning: LENGTH_TUNING_MODE): string {
  switch (aTuning) {
    case LENGTH_TUNING_MODE.SINGLE:
      return 'single';
    case LENGTH_TUNING_MODE.DIFF_PAIR:
      return 'diff_pair';
    case LENGTH_TUNING_MODE.DIFF_PAIR_SKEW:
      return 'diff_pair_skew';
    default:
      return '';
  }
}

function sideFromString(aStr: string): MeanderSide {
  if (aStr === 'default') return MeanderSide.MEANDER_SIDE_DEFAULT;
  if (aStr === 'left') return MeanderSide.MEANDER_SIDE_LEFT;
  if (aStr === 'right') return MeanderSide.MEANDER_SIDE_RIGHT;

  // wxFAIL_MSG( "Unknown length-tuning side token" )
  return MeanderSide.MEANDER_SIDE_DEFAULT;
}

function statusToString(aStatus: PnsTuningStatus): string {
  switch (aStatus) {
    case PnsTuningStatus.TOO_LONG:
      return 'too_long';
    case PnsTuningStatus.TOO_SHORT:
      return 'too_short';
    case PnsTuningStatus.TUNED:
      return 'tuned';
    default:
      return '';
  }
}

function statusFromString(aStr: string): PnsTuningStatus {
  if (aStr === 'too_long') return PnsTuningStatus.TOO_LONG;
  if (aStr === 'too_short') return PnsTuningStatus.TOO_SHORT;
  if (aStr === 'tuned') return PnsTuningStatus.TUNED;

  // wxFAIL_MSG( "Unknown tuning status token" )
  return PnsTuningStatus.TUNED;
}

function sideToString(aValue: MeanderSide): string {
  switch (aValue) {
    case MeanderSide.MEANDER_SIDE_DEFAULT:
      return 'default';
    case MeanderSide.MEANDER_SIDE_LEFT:
      return 'left';
    case MeanderSide.MEANDER_SIDE_RIGHT:
      return 'right';
    default:
      return '';
  }
}

/** `PNS::MEANDER_SETTINGS`'s copy: the same values in a new object. */
function copyMeanderSettings(aSettings: MeanderSettings): MeanderSettings {
  return {
    ...aSettings,
    targetLength: { ...aSettings.targetLength },
    targetLengthDelay: { ...aSettings.targetLengthDelay },
    targetSignalLength: { ...aSettings.targetSignalLength },
    targetSignalLengthDelay: { ...aSettings.targetSignalLengthDelay },
    targetSkew: { ...aSettings.targetSkew },
    targetSkewDelay: { ...aSettings.targetSkewDelay },
  };
}

const DEG2RAD = (deg: number): number => (deg * Math.PI) / 180.0;

export class PCB_TUNING_PATTERN extends PCB_GENERATOR {
  static readonly GENERATOR_TYPE = 'tuning_pattern';
  static readonly DISPLAY_NAME = 'Tuning Pattern';

  protected m_end: VECTOR2I;

  protected m_settings: MeanderSettings;

  protected m_baseLine: SHAPE_LINE_CHAIN | null = null;
  protected m_baseLineCoupled: SHAPE_LINE_CHAIN | null = null;

  protected m_trackWidth: number;
  protected m_diffPairGap: number;

  protected m_tuningMode: LENGTH_TUNING_MODE;

  protected m_lastNetName = '';
  protected m_tuningInfo = '';
  protected m_tuningLength: number;

  protected m_tuningStatus: PnsTuningStatus;

  protected m_updateSideFromEnd: boolean;

  constructor(
    aParent: BOARD_ITEM | null = null,
    aLayer: PCB_LAYER_ID = F_Cu,
    aMode: LENGTH_TUNING_MODE = LENGTH_TUNING_MODE.SINGLE,
  ) {
    super(aParent, aLayer);
    this.m_trackWidth = 0;
    this.m_diffPairGap = 0;
    this.m_tuningMode = aMode;
    this.m_tuningLength = 0;
    this.m_tuningStatus = PnsTuningStatus.TUNED;
    this.m_updateSideFromEnd = false;
    this.m_settings = defaultMeanderSettings();

    this.m_generatorType = PCB_TUNING_PATTERN.GENERATOR_TYPE;
    this.m_name = PCB_TUNING_PATTERN.DISPLAY_NAME;
    this.m_end = { x: pcbIUScale.mmToIU(10), y: 0 };
    this.m_settings.initialSide = MeanderSide.MEANDER_SIDE_LEFT;
  }

  /** `PCB_TUNING_PATTERN( const PCB_TUNING_PATTERN& )`, the compiler-generated copy. */
  static override copyOf(aOther: PCB_TUNING_PATTERN): PCB_TUNING_PATTERN {
    const copy = new PCB_TUNING_PATTERN(aOther.GetParent() as BOARD_ITEM | null);
    copy.assignTuningPattern(aOther);
    (copy as { m_Uuid: unknown }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** The compiler-generated `operator=` for this level. */
  assignTuningPattern(aOther: PCB_TUNING_PATTERN): this {
    this.assignGenerator(aOther);
    this.m_end = { ...aOther.m_end };
    this.m_settings = copyMeanderSettings(aOther.m_settings);
    this.m_baseLine = aOther.m_baseLine ? new SHAPE_LINE_CHAIN(aOther.m_baseLine) : null;
    this.m_baseLineCoupled = aOther.m_baseLineCoupled
      ? new SHAPE_LINE_CHAIN(aOther.m_baseLineCoupled)
      : null;
    this.m_trackWidth = aOther.m_trackWidth;
    this.m_diffPairGap = aOther.m_diffPairGap;
    this.m_tuningMode = aOther.m_tuningMode;
    this.m_lastNetName = aOther.m_lastNetName;
    this.m_tuningInfo = aOther.m_tuningInfo;
    this.m_tuningLength = aOther.m_tuningLength;
    this.m_tuningStatus = aOther.m_tuningStatus;
    this.m_updateSideFromEnd = aOther.m_updateSideFromEnd;
    return this;
  }

  override GetGeneratorType(): string {
    return 'tuning_pattern';
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'Tuning Pattern';
  }

  override GetFriendlyName(): string {
    return 'Tuning Pattern';
  }

  override GetPluralName(): string {
    return 'Tuning Patterns';
  }

  override GetCommitMessage(): string {
    return 'Edit Tuning Pattern';
  }

  override GetMenuImage(): string {
    switch (this.m_tuningMode) {
      case SINGLE:
        return 'ps_tune_length';
      case DIFF_PAIR:
        return 'ps_diff_pair_tune_length';
      case DIFF_PAIR_SKEW:
        return 'ps_diff_pair_tune_phase';
    }

    return 'unknown';
  }

  // static CreateNew( GENERATOR_TOOL*, PCB_BASE_EDIT_FRAME*, BOARD_CONNECTED_ITEM*, LENGTH_TUNING_MODE )
  //                                                     -- GENERATOR_TOOL pending (#636 stage 3)

  EditStart(_aTool: GENERATOR_TOOL_LIKE, _aBoard: BOARD, _aCommit: BOARD_COMMIT_LIKE): void {
    // -- GENERATOR_TOOL / PNS::ROUTER pending (#636 stage 3)
  }

  Update(_aTool: GENERATOR_TOOL_LIKE, _aBoard: BOARD, _aCommit: BOARD_COMMIT_LIKE): boolean {
    return false; // -- GENERATOR_TOOL / PNS::ROUTER pending (#636 stage 3)
  }

  EditFinish(_aTool: GENERATOR_TOOL_LIKE, _aBoard: BOARD, _aCommit: BOARD_COMMIT_LIKE): void {
    // -- GENERATOR_TOOL / PNS::ROUTER pending (#636 stage 3)
  }

  EditCancel(_aTool: GENERATOR_TOOL_LIKE, _aBoard: BOARD, _aCommit: BOARD_COMMIT_LIKE): void {
    // -- GENERATOR_TOOL / PNS::ROUTER pending (#636 stage 3)
  }

  Remove(_aTool: GENERATOR_TOOL_LIKE, _aBoard: BOARD, _aCommit: BOARD_COMMIT_LIKE): void {
    // -- GENERATOR_TOOL / PNS::ROUTER pending (#636 stage 3)
  }

  override MakeEditPoints(_aEditPoints: EDIT_POINTS_LIKE): boolean {
    return false; // -- EDIT_POINTS pending (#636 stage 3)
  }

  override UpdateFromEditPoints(_aEditPoints: EDIT_POINTS_LIKE): boolean {
    return false; // -- EDIT_POINTS pending (#636 stage 3)
  }

  override UpdateEditPoints(_aEditPoints: EDIT_POINTS_LIKE): boolean {
    return false; // -- EDIT_POINTS pending (#636 stage 3)
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.m_origin = add(this.m_origin, aMoveVector);
    this.m_end = add(this.m_end, aMoveVector);

    if (!this.HasFlag(IN_EDIT)) {
      PCB_GROUP.prototype.Move.call(this, aMoveVector);

      if (this.m_baseLine) this.m_baseLine.Move(aMoveVector);

      if (this.m_baseLineCoupled) this.m_baseLineCoupled.Move(aMoveVector);
    }
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    if (!this.HasFlag(IN_EDIT)) {
      PCB_GENERATOR.prototype.Rotate.call(this, aRotCentre, aAngle);
      this.m_end = RotatePoint(this.m_end, aRotCentre, aAngle);

      if (this.m_baseLine) this.m_baseLine.Rotate(aAngle, aRotCentre);

      if (this.m_baseLineCoupled) this.m_baseLineCoupled.Rotate(aAngle, aRotCentre);
    }
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    if (!this.HasFlag(IN_EDIT)) {
      PCB_GENERATOR.prototype.Flip.call(this, aCentre, aFlipDirection);

      this.baseMirror(aCentre, aFlipDirection);
    }
  }

  override Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    if (!this.HasFlag(IN_EDIT)) {
      PCB_GENERATOR.prototype.Mirror.call(this, aCentre, aFlipDirection);

      this.baseMirror(aCentre, aFlipDirection);
    }
  }

  override SetLayer(aLayer: PCB_LAYER_ID): void {
    PCB_GENERATOR.prototype.SetLayer.call(this, aLayer);

    for (const item of this.GetBoardItems()) item.SetLayer(aLayer);
  }

  override GetLayer(): PCB_LAYER_ID {
    for (const item of this.GetBoardItems()) {
      if (item instanceof PCB_TRACK) return item.GetLayer();
    }

    return PCB_GENERATOR.prototype.GetLayer.call(this);
  }

  override GetBoundingBox(): BOX2I {
    return this.getOutline().BBox();
  }

  override ViewGetLayers(): number[] {
    return [GAL_LAYER_ID.LAYER_ANCHOR, this.GetLayer()];
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN, b?: number | boolean, c = 0): boolean {
    if (a instanceof BOX2I) {
      const aRect = a;
      const aContained = b as boolean;
      const aAccuracy = c;
      let anyItems = false;

      for (const item of this.GetBoardItems()) {
        anyItems = true;

        if (aContained) {
          if (!item.HitTest(aRect, true, aAccuracy)) return false;
        } else if (item.HitTest(aRect, false, aAccuracy)) {
          return true;
        }
      }

      if (anyItems) return aContained;

      const sel = new BOX2I(aRect.GetOrigin(), aRect.GetSize());

      if (aAccuracy) sel.Inflate(aAccuracy);

      const selPoly = new SHAPE_LINE_CHAIN(
        [
          sel.GetOrigin(),
          { x: sel.GetRight(), y: sel.GetTop() },
          sel.GetEnd(),
          { x: sel.GetLeft(), y: sel.GetBottom() },
        ],
        true,
      );

      return KIGEOM_ShapeHitTest(selPoly, this.getOutline(), aContained);
    }

    if (a instanceof SHAPE_LINE_CHAIN) {
      const aPoly = a;
      const aContained = b as boolean;
      let anyItems = false;

      for (const item of this.GetBoardItems()) {
        anyItems = true;

        if (aContained) {
          if (!item.HitTest(aPoly, true)) return false;
        } else if (item.HitTest(aPoly, false)) {
          return true;
        }
      }

      if (anyItems) return aContained;

      return KIGEOM_ShapeHitTest(aPoly, this.getOutline(), aContained);
    }

    const aAccuracy = (b as number | undefined) ?? 0;
    return this.getOutline().Collide(a, aAccuracy);
  }

  override ViewBBox(): BOX2I {
    return this.GetBoundingBox();
  }

  override Clone(): PCB_TUNING_PATTERN {
    return PCB_TUNING_PATTERN.copyOf(this);
  }

  // void ViewDraw( int aLayer, KIGFX::VIEW* aView ) const override final;   -- VIEW pending (#636 stage 5)

  GetEnd(): VECTOR2I {
    return this.m_end;
  }

  SetEnd(aValue: VECTOR2I): void {
    this.m_end = { x: aValue.x, y: aValue.y };
  }

  GetEndX(): number {
    return this.m_end.x;
  }

  SetEndX(aValue: number): void {
    this.m_end.x = aValue;
  }

  GetEndY(): number {
    return this.m_end.y;
  }

  SetEndY(aValue: number): void {
    this.m_end.y = aValue;
  }

  GetWidth(): number {
    for (const item of this.GetBoardItems()) if (item instanceof PCB_TRACK) return item.GetWidth();

    return this.m_trackWidth;
  }

  SetWidth(aValue: number): void {
    this.m_trackWidth = aValue;

    for (const item of this.GetBoardItems()) if (item instanceof PCB_TRACK) item.SetWidth(aValue);
  }

  GetNetCode(): number {
    for (const item of this.GetBoardItems()) if (isConnectedItem(item)) return item.GetNetCode();

    return 0;
  }

  SetNetCode(aNetCode: number): void {
    const board = this.GetBoard();

    if (board) {
      const net = board.FindNet(aNetCode);

      if (net) this.m_lastNetName = net.GetNetname();
      else this.m_lastNetName = '';
    }

    for (const item of this.GetBoardItems()) if (isConnectedItem(item)) item.SetNetCode(aNetCode);
  }

  HasSolderMask(): boolean {
    for (const item of this.GetBoardItems())
      if (item instanceof PCB_TRACK) return item.HasSolderMask();

    return true;
  }

  SetHasSolderMask(aVal: boolean): void {
    for (const item of this.GetBoardItems())
      if (item instanceof PCB_TRACK) item.SetHasSolderMask(aVal);
  }

  GetLocalSolderMaskMargin(): number | undefined {
    for (const item of this.GetBoardItems())
      if (item instanceof PCB_TRACK) return item.GetLocalSolderMaskMargin();

    return undefined;
  }

  SetLocalSolderMaskMargin(aMargin: number | undefined): void {
    for (const item of this.GetBoardItems())
      if (item instanceof PCB_TRACK) item.SetLocalSolderMaskMargin(aMargin);
  }

  GetTuningMode(): LENGTH_TUNING_MODE {
    return this.m_tuningMode;
  }

  SetTuningMode(aMode: LENGTH_TUNING_MODE): void {
    this.m_tuningMode = aMode;
  }

  GetPNSMode(): PnsRouterMode {
    switch (this.m_tuningMode) {
      case LENGTH_TUNING_MODE.SINGLE:
        return PnsRouterMode.PNS_MODE_TUNE_SINGLE;
      case LENGTH_TUNING_MODE.DIFF_PAIR:
        return PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR;
      case LENGTH_TUNING_MODE.DIFF_PAIR_SKEW:
        return PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW;
      default:
        return PnsRouterMode.PNS_MODE_TUNE_SINGLE;
    }
  }

  GetSettings(): MeanderSettings {
    return this.m_settings;
  }

  GetMinAmplitude(): number {
    return this.m_settings.minAmplitude;
  }

  SetMinAmplitude(aValue: number): void {
    aValue = Math.max(aValue, 0);

    this.m_settings.minAmplitude = aValue;

    if (this.m_settings.maxAmplitude < this.m_settings.minAmplitude)
      this.m_settings.maxAmplitude = this.m_settings.minAmplitude;
  }

  GetMaxAmplitude(): number {
    return this.m_settings.maxAmplitude;
  }

  SetMaxAmplitude(aValue: number): void {
    aValue = Math.max(aValue, 0);

    this.m_settings.maxAmplitude = aValue;

    if (this.m_settings.maxAmplitude < this.m_settings.minAmplitude)
      this.m_settings.minAmplitude = this.m_settings.maxAmplitude;
  }

  UpdateSideFromEnd(): void {
    this.m_updateSideFromEnd = true;
  }

  GetInitialSide(): MeanderSide {
    return this.m_settings.initialSide;
  }

  SetInitialSide(aValue: MeanderSide): void {
    this.m_settings.initialSide = aValue;
  }

  GetSpacing(): number {
    return this.m_settings.spacing;
  }

  SetSpacing(aValue: number): void {
    this.m_settings.spacing = aValue;
  }

  GetTargetLength(): number | undefined {
    if (minOptMaxOpt(this.m_settings.targetLength) === MEANDER_LENGTH_UNCONSTRAINED)
      return undefined;

    return minOptMaxOpt(this.m_settings.targetLength);
  }

  SetTargetLength(aValue: number | undefined): void {
    this.m_settings.isTimeDomain = false;

    if (aValue !== undefined) setTargetLength(this.m_settings, aValue);
    else setTargetLength(this.m_settings, MEANDER_LENGTH_UNCONSTRAINED);
  }

  GetTargetDelay(): number | undefined {
    if (minOptMaxOpt(this.m_settings.targetLengthDelay) === MEANDER_DELAY_UNCONSTRAINED)
      return undefined;

    return minOptMaxOpt(this.m_settings.targetLengthDelay);
  }

  SetTargetDelay(aValue: number | undefined): void {
    this.m_settings.isTimeDomain = true;

    if (aValue !== undefined) setTargetLengthDelay(this.m_settings, aValue);
    else setTargetLengthDelay(this.m_settings, MEANDER_DELAY_UNCONSTRAINED);
  }

  GetTargetSkew(): number {
    return minOptMaxOpt(this.m_settings.targetSkew);
  }

  SetTargetSkew(aValue: number): void {
    setTargetSkew(this.m_settings, aValue);
  }

  GetTargetSkewDelay(): number {
    return minOptMaxOpt(this.m_settings.targetSkewDelay);
  }

  SetTargetSkewDelay(aValue: number): void {
    setTargetSkewDelay(this.m_settings, aValue);
  }

  GetOverrideCustomRules(): boolean {
    return this.m_settings.overrideCustomRules;
  }

  SetOverrideCustomRules(aOverride: boolean): void {
    this.m_settings.overrideCustomRules = aOverride;
  }

  GetCornerRadiusPercentage(): number {
    return this.m_settings.cornerRadiusPercentage;
  }

  SetCornerRadiusPercentage(aValue: number): void {
    this.m_settings.cornerRadiusPercentage = aValue;
  }

  IsSingleSided(): boolean {
    return this.m_settings.singleSided;
  }

  SetSingleSided(aValue: boolean): void {
    this.m_settings.singleSided = aValue;
  }

  IsRounded(): boolean {
    return this.m_settings.cornerStyle === MeanderStyle.MEANDER_STYLE_ROUND;
  }

  SetRounded(aFlag: boolean): void {
    this.m_settings.cornerStyle = aFlag
      ? MeanderStyle.MEANDER_STYLE_ROUND
      : MeanderStyle.MEANDER_STYLE_CHAMFER;
  }

  override GetRowData(): [string, string][] {
    const data = PCB_GENERATOR.prototype.GetRowData.call(this);
    data.push(['Net', this.m_lastNetName]);
    data.push(['Tuning', this.m_tuningInfo]);
    return data;
  }

  override GetProperties(): STRING_ANY_MAP {
    const props = PCB_GENERATOR.prototype.GetProperties.call(this);

    props.set_('tuning_mode', tuningToString(this.m_tuningMode));
    props.set_('initial_side', sideToString(this.m_settings.initialSide));
    props.set_('last_status', statusToString(this.m_tuningStatus));
    props.set_('is_time_domain', this.m_settings.isTimeDomain);

    props.set_('end', { ...this.m_end });
    props.set_('corner_radius_percent', this.m_settings.cornerRadiusPercentage);
    props.set_('single_sided', this.m_settings.singleSided);
    props.set_('rounded', this.m_settings.cornerStyle === MeanderStyle.MEANDER_STYLE_ROUND);

    props.set_iu('max_amplitude', this.m_settings.maxAmplitude);
    props.set_iu('min_amplitude', this.m_settings.minAmplitude);
    props.set_iu('min_spacing', this.m_settings.spacing);
    props.set_iu('target_length_min', minOptMaxMin(this.m_settings.targetLength));
    props.set_iu('target_length', minOptMaxOpt(this.m_settings.targetLength));
    props.set_iu('target_length_max', minOptMaxMax(this.m_settings.targetLength));
    props.set_iu('target_delay_min', minOptMaxMin(this.m_settings.targetLengthDelay));
    props.set_iu('target_delay', minOptMaxOpt(this.m_settings.targetLengthDelay));
    props.set_iu('target_delay_max', minOptMaxMax(this.m_settings.targetLengthDelay));
    props.set_iu('target_skew_min', minOptMaxMin(this.m_settings.targetSkew));
    props.set_iu('target_skew', minOptMaxOpt(this.m_settings.targetSkew));
    props.set_iu('target_skew_max', minOptMaxMax(this.m_settings.targetSkew));
    props.set_iu('last_track_width', this.m_trackWidth);
    props.set_iu('last_diff_pair_gap', this.m_diffPairGap);
    props.set_iu('last_tuning_length', this.m_tuningLength);

    props.set_('last_netname', this.m_lastNetName);
    props.set_('override_custom_rules', this.m_settings.overrideCustomRules);

    if (this.m_baseLine) props.set_('base_line', new SHAPE_LINE_CHAIN(this.m_baseLine));

    if (this.m_baseLineCoupled)
      props.set_('base_line_coupled', new SHAPE_LINE_CHAIN(this.m_baseLineCoupled));

    return props;
  }

  override SetProperties(aProps: STRING_ANY_MAP): void {
    PCB_GENERATOR.prototype.SetProperties.call(this, aProps);

    const tuningMode = aProps.get_to<string>('tuning_mode', 'string') ?? '';
    this.m_tuningMode = tuningFromString(tuningMode);

    const side = aProps.get_to<string>('initial_side', 'string') ?? '';
    this.m_settings.initialSide = sideFromString(side);

    const status = aProps.get_to<string>('last_status', 'string') ?? '';
    this.m_tuningStatus = statusFromString(status);

    const isTimeDomain = aProps.get_to<boolean>('is_time_domain', 'boolean');
    if (isTimeDomain !== undefined) this.m_settings.isTimeDomain = isTimeDomain;

    const end = aProps.get_to<VECTOR2I>('end', 'object');
    if (end !== undefined) this.m_end = { x: end.x, y: end.y };

    const cornerRadius = aProps.get_to<number>('corner_radius_percent', 'number');
    if (cornerRadius !== undefined)
      this.m_settings.cornerRadiusPercentage = Math.trunc(cornerRadius);

    const singleSided = aProps.get_to<boolean>('single_sided', 'boolean');
    if (singleSided !== undefined) this.m_settings.singleSided = singleSided;

    // aProps.get_to( "side", m_settings.m_initialSide ): a string never converts to the enum

    const rounded = aProps.get_to<boolean>('rounded', 'boolean') ?? false;
    this.m_settings.cornerStyle = rounded
      ? MeanderStyle.MEANDER_STYLE_ROUND
      : MeanderStyle.MEANDER_STYLE_CHAMFER;

    // long long int val: a double read from the file, scaled, then truncated.
    const iuLL = (aKey: string): number | undefined => {
      const v = aProps.get_to_iu<number>(aKey, 'number');
      return v === undefined ? undefined : Math.trunc(v);
    };

    let val = iuLL('target_length') ?? 0; // `val` is uninitialised in the C++ when absent
    setTargetLength(this.m_settings, val);

    let opt = iuLL('target_length_min');
    if (opt !== undefined) this.m_settings.targetLength.min = opt;

    opt = iuLL('target_length_max');
    if (opt !== undefined) this.m_settings.targetLength.max = opt;

    val = iuLL('target_delay') ?? 0;
    setTargetLengthDelay(this.m_settings, val);

    opt = iuLL('target_delay_min');
    if (opt !== undefined) this.m_settings.targetLengthDelay.min = opt;

    opt = iuLL('target_delay_max');
    if (opt !== undefined) this.m_settings.targetLengthDelay.max = opt;

    const int_val = iuLL('target_skew') ?? 0;
    setTargetSkew(this.m_settings, int_val);

    opt = iuLL('target_skew_min');
    if (opt !== undefined) this.m_settings.targetSkew.min = opt;

    opt = iuLL('target_skew_max');
    if (opt !== undefined) this.m_settings.targetSkew.max = opt;

    const maxAmplitude = iuLL('max_amplitude');
    if (maxAmplitude !== undefined) this.m_settings.maxAmplitude = maxAmplitude;

    const minAmplitude = iuLL('min_amplitude');
    if (minAmplitude !== undefined) this.m_settings.minAmplitude = minAmplitude;

    const spacing = iuLL('min_spacing');
    if (spacing !== undefined) this.m_settings.spacing = spacing;

    const trackWidth = iuLL('last_track_width');
    if (trackWidth !== undefined) this.m_trackWidth = trackWidth;

    const diffPairGap = iuLL('last_diff_pair_gap');
    if (diffPairGap !== undefined) this.m_diffPairGap = diffPairGap;

    const tuningLength = iuLL('last_tuning_length');
    if (tuningLength !== undefined) this.m_tuningLength = tuningLength;

    const overrideCustomRules = aProps.get_to<boolean>('override_custom_rules', 'boolean');
    if (overrideCustomRules !== undefined)
      this.m_settings.overrideCustomRules = overrideCustomRules;

    const lastNetName = aProps.get_to<string>('last_netname', 'string');
    if (lastNetName !== undefined) this.m_lastNetName = lastNetName;

    const baseLine = aProps.get_opt<SHAPE_LINE_CHAIN>('base_line', 'object');

    if (baseLine instanceof SHAPE_LINE_CHAIN) this.m_baseLine = new SHAPE_LINE_CHAIN(baseLine);

    const baseLineCoupled = aProps.get_opt<SHAPE_LINE_CHAIN>('base_line_coupled', 'object');

    if (baseLineCoupled instanceof SHAPE_LINE_CHAIN)
      this.m_baseLineCoupled = new SHAPE_LINE_CHAIN(baseLineCoupled);

    // Reconstruct m_tuningInfo from loaded length and status
    if (this.m_tuningLength !== 0) {
      let statusMessage: string;

      switch (this.m_tuningStatus) {
        case PnsTuningStatus.TOO_LONG:
          statusMessage = 'too long';
          break;
        case PnsTuningStatus.TOO_SHORT:
          statusMessage = 'too short';
          break;
        case PnsTuningStatus.TUNED:
          statusMessage = 'tuned';
          break;
        default:
          statusMessage = 'unknown';
          break;
      }

      // EDA_UNITS::PS when the settings are in the time domain, MM otherwise
      //                                                     -- EDA_UNITS::PS pending (#636)
      const lengthStr = pcbIUScale.iuToMM(this.m_tuningLength).toFixed(4);

      this.m_tuningInfo = `${lengthStr} (${statusMessage})`;
    }
  }

  // void ShowPropertiesDialog( PCB_BASE_EDIT_FRAME* )                       -- dialog pending (#636 stage 3)
  // std::vector<EDA_ITEM*> GetPreviewItems( GENERATOR_TOOL*, PCB_BASE_EDIT_FRAME*, bool )
  //                                                     -- GENERATOR_TOOL pending (#636 stage 3)

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    let primaryNet: NETINFO_ITEM | null = null;
    let coupledNet: NETINFO_ITEM | null = null;
    let primaryItem: PCB_TRACK | null = null;
    let coupledItem: PCB_TRACK | null = null;
    let netclass: NETCLASS | null = null;
    let width = 0;
    let mixedWidth = false;

    aList.push(new MSG_PANEL_ITEM('Type', this.GetFriendlyName()));

    for (const member of this.GetItems()) {
      if (member instanceof PCB_TRACK) {
        const track = member;

        if (!primaryNet) {
          primaryItem = track;
          primaryNet = track.GetNet();
        } else if (!coupledNet && track.GetNet() !== primaryNet) {
          coupledItem = track;
          coupledNet = track.GetNet();
        }

        if (!netclass) netclass = track.GetEffectiveNetClass();

        if (!width) width = track.GetWidth();
        else if (width !== track.GetWidth()) mixedWidth = true;
      }
    }

    if (coupledNet) {
      aList.push(
        new MSG_PANEL_ITEM(
          'Nets',
          `${unescapeString(primaryNet!.GetNetname())}, ${unescapeString(coupledNet.GetNetname())}`,
        ),
      );
    } else if (primaryNet) {
      aList.push(new MSG_PANEL_ITEM('Net', unescapeString(primaryNet.GetNetname())));
    }

    if (netclass)
      aList.push(
        new MSG_PANEL_ITEM('Resolved Netclass', unescapeString(netclass.GetHumanReadableName())),
      );

    aList.push(new MSG_PANEL_ITEM('Layer', this.LayerMaskDescribe()));

    if (width && !mixedWidth)
      aList.push(new MSG_PANEL_ITEM('Width', aFrame.MessageTextFromValue(width)));

    // The routed length / delay rows (BOARD::GetTrackLength) and the target / constraint rows
    // (DRC_ENGINE::EvalRules)                              -- DRC_ENGINE pending (#636)
    void primaryItem;
    void coupledItem;
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    // std::swap( *this, *static_cast<PCB_TUNING_PATTERN*>( aImage ) )
    const image = aImage as PCB_TUNING_PATTERN;
    const tmp = PCB_TUNING_PATTERN.copyOf(this);
    this.assignTuningPattern(image);
    image.assignTuningPattern(tmp);
  }

  // recoverBaseline / baselineValid / initBaseLine / initBaseLines / removeToBaseline / resetToBaseline
  //                                                     -- PNS::ROUTER pending (#636 stage 3)

  protected getOutline(): SHAPE_LINE_CHAIN {
    if (this.m_baseLine) {
      let clampedMaxAmplitude = this.m_settings.maxAmplitude;
      let minAllowedAmplitude = 0;
      const baselineOffset =
        this.m_tuningMode === DIFF_PAIR
          ? Math.trunc((this.m_diffPairGap + this.m_trackWidth) / 2)
          : 0;

      if (this.m_settings.cornerStyle === MeanderStyle.MEANDER_STYLE_ROUND) {
        minAllowedAmplitude = baselineOffset + this.m_trackWidth;
      } else {
        const correction = Math.trunc(this.m_trackWidth * Math.tan(1 - Math.tan(DEG2RAD(22.5))));
        minAllowedAmplitude = baselineOffset + correction;
      }

      clampedMaxAmplitude = Math.max(clampedMaxAmplitude, minAllowedAmplitude);

      if (this.m_settings.singleSided) {
        const clBase = new SHAPE_LINE_CHAIN(this.m_baseLine);
        const left = new SHAPE_LINE_CHAIN();
        const right = new SHAPE_LINE_CHAIN();

        if (this.m_tuningMode !== DIFF_PAIR) {
          const amplitude = clampedMaxAmplitude + KiROUND(this.m_trackWidth / 2.0);

          const chain = new SHAPE_LINE_CHAIN();

          if (
            clBase.OffsetLine(
              amplitude,
              CornerStrategy.ROUND_ALL_CORNERS,
              ARC_LOW_DEF,
              left,
              right,
              true,
            )
          ) {
            chain.Append(this.m_settings.initialSide >= 0 ? right : left);
            chain.Append(clBase.Reverse());
            chain.SetClosed(true);

            return chain;
          }
        } else if (this.m_tuningMode === DIFF_PAIR && this.m_baseLineCoupled) {
          const amplitude =
            clampedMaxAmplitude + this.m_trackWidth + KiROUND(this.m_diffPairGap / 2.0);

          const clCoupled = new SHAPE_LINE_CHAIN(this.m_baseLineCoupled);
          const chain1 = new SHAPE_LINE_CHAIN();
          const chain2 = new SHAPE_LINE_CHAIN();

          if (
            clBase.OffsetLine(
              amplitude,
              CornerStrategy.ROUND_ALL_CORNERS,
              ARC_LOW_DEF,
              left,
              right,
              true,
            )
          ) {
            if (this.m_settings.initialSide >= 0) chain1.Append(right);
            else chain1.Append(left);

            if (
              clBase.OffsetLine(
                KiROUND(this.m_trackWidth / 2.0),
                CornerStrategy.ROUND_ALL_CORNERS,
                ARC_LOW_DEF,
                left,
                right,
                true,
              )
            ) {
              if (this.m_settings.initialSide >= 0) chain1.Append(left.Reverse());
              else chain1.Append(right.Reverse());
            }

            chain1.SetClosed(true);
          }

          if (
            clCoupled.OffsetLine(
              amplitude,
              CornerStrategy.ROUND_ALL_CORNERS,
              ARC_LOW_DEF,
              left,
              right,
              true,
            )
          ) {
            if (this.m_settings.initialSide >= 0) chain2.Append(right);
            else chain2.Append(left);

            if (
              clCoupled.OffsetLine(
                KiROUND(this.m_trackWidth / 2.0),
                CornerStrategy.ROUND_ALL_CORNERS,
                ARC_LOW_DEF,
                left,
                right,
                true,
              )
            ) {
              if (this.m_settings.initialSide >= 0) chain2.Append(left.Reverse());
              else chain2.Append(right.Reverse());
            }

            chain2.SetClosed(true);
          }

          const merged = new SHAPE_POLY_SET();
          merged.BooleanAdd(new SHAPE_POLY_SET(chain1), new SHAPE_POLY_SET(chain2));

          if (merged.OutlineCount() > 0) return merged.Outline(0);
        }
      }

      // Not single-sided / fallback
      const poly = new SHAPE_POLY_SET();

      let amplitude = 0;

      if (this.m_tuningMode === DIFF_PAIR)
        amplitude =
          clampedMaxAmplitude + Math.trunc(this.m_diffPairGap / 2) + KiROUND(this.m_trackWidth);
      else amplitude = clampedMaxAmplitude + KiROUND(this.m_trackWidth / 2.0);

      poly.OffsetLineChain(
        this.m_baseLine,
        amplitude,
        CornerStrategy.ROUND_ALL_CORNERS,
        ARC_LOW_DEF,
        false,
      );

      if (this.m_tuningMode === DIFF_PAIR && this.m_baseLineCoupled) {
        const polyCoupled = new SHAPE_POLY_SET();
        polyCoupled.OffsetLineChain(
          this.m_baseLineCoupled,
          amplitude,
          CornerStrategy.ROUND_ALL_CORNERS,
          ARC_LOW_DEF,
          false,
        );

        poly.ClearArcs();
        polyCoupled.ClearArcs();

        const merged = new SHAPE_POLY_SET();
        merged.BooleanAdd(poly, polyCoupled);

        if (merged.OutlineCount() > 0) return merged.Outline(0);
      }

      if (poly.OutlineCount() > 0) return poly.Outline(0);
    }

    return new SHAPE_LINE_CHAIN();
  }

  protected override baseMirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    super.baseMirror(aCentre, aFlipDirection);

    if (this.m_baseLine) {
      this.m_baseLine.Mirror(aCentre, aFlipDirection);
      this.m_origin = this.m_baseLine.CPoint(0);
      this.m_end = this.m_baseLine.CLastPoint();
    }

    if (this.m_baseLineCoupled) this.m_baseLineCoupled.Mirror(aCentre, aFlipDirection);

    if (this.m_settings.initialSide === MeanderSide.MEANDER_SIDE_RIGHT)
      this.m_settings.initialSide = MeanderSide.MEANDER_SIDE_LEFT;
    else this.m_settings.initialSide = MeanderSide.MEANDER_SIDE_RIGHT;
  }
}

/** `dynamic_cast<BOARD_CONNECTED_ITEM*>`. */
function isConnectedItem(aItem: BOARD_ITEM): aItem is BOARD_CONNECTED_ITEM {
  return (
    typeof (aItem as BOARD_CONNECTED_ITEM).GetNetCode === 'function' &&
    typeof (aItem as BOARD_CONNECTED_ITEM).SetNetCode === 'function'
  );
}

// static GENERATORS_MGR::REGISTER<PCB_TUNING_PATTERN> registerMe;
GENERATORS_MGR.Instance().Register(
  PCB_TUNING_PATTERN.GENERATOR_TYPE,
  PCB_TUNING_PATTERN.DISPLAY_NAME,
  () => new PCB_TUNING_PATTERN(),
);

// Also register under the 7.99 name
// static REGISTER_LEGACY_TUNING_PATTERN<PCB_TUNING_PATTERN> registerMeToo;
GENERATORS_MGR.Instance().Register(
  'meanders',
  PCB_TUNING_PATTERN.DISPLAY_NAME,
  () => new PCB_TUNING_PATTERN(),
);

void KICAD_T;

/**
 * `static struct PCB_TUNING_PATTERN_DESC` (pcbnew/generators/pcb_tuning_pattern.cpp).
 */
(() => {
  ENUM_MAP.Instance<LENGTH_TUNING_MODE>('LENGTH_TUNING_MODE')
    .Map(LENGTH_TUNING_MODE.SINGLE, 'Single track')
    .Map(LENGTH_TUNING_MODE.DIFF_PAIR, 'Differential pair')
    .Map(LENGTH_TUNING_MODE.DIFF_PAIR_SKEW, 'Diff pair skew');

  // ENUM_MAP<PNS::MEANDER_SIDE> is filled beside the enum, in pns_meander.ts:
  // this module and the router's are an import cycle, and the enum is not
  // yet initialised when this registration runs from the router's side.

  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_TUNING_PATTERN);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_TUNING_PATTERN, PCB_GENERATOR));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_TUNING_PATTERN, BOARD_ITEM));
  propMgr.InheritsAfter(PCB_TUNING_PATTERN, PCB_GENERATOR);
  propMgr.InheritsAfter(PCB_TUNING_PATTERN, BOARD_ITEM);

  const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');

  if (layerEnum.Choices().GetCount() === 0) {
    layerEnum.Undefined(PCB_LAYER_ID.UNDEFINED_LAYER);

    for (const layer of LSET.AllLayersMask().Seq()) layerEnum.Map(layer, LSET.Name(layer));
  }

  const layer = new PROPERTY_ENUM<PCB_TUNING_PATTERN, PCB_LAYER_ID>(
    PCB_TUNING_PATTERN,
    'Layer',
    'SetLayer',
    'GetLayer',
    layerEnum,
  );
  layer.SetChoices(layerEnum.Choices());
  propMgr.ReplaceProperty(BOARD_ITEM, 'Layer', layer);

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, number>(
      PCB_TUNING_PATTERN,
      'Width',
      'SetWidth',
      'GetWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
  );

  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_TUNING_PATTERN, number>(
      PCB_TUNING_PATTERN,
      'Net',
      'SetNetCode',
      'GetNetCode',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_NET,
    ),
  );

  const groupTechLayers = 'Technical Layers';

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, boolean>(
      PCB_TUNING_PATTERN,
      'Soldermask',
      'SetHasSolderMask',
      'HasSolderMask',
      TYPE_BOOL,
    ),
    groupTechLayers,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, number | undefined>(
      PCB_TUNING_PATTERN,
      'Soldermask Margin Override',
      'SetLocalSolderMaskMargin',
      'GetLocalSolderMaskMargin',
      TYPE_OPT_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    groupTechLayers,
  );

  const groupTab = 'Pattern Properties';

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, number>(
      PCB_TUNING_PATTERN,
      'End X',
      'SetEndX',
      'GetEndX',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
      COORD_TYPES_T.ABS_X_COORD,
    ),
    groupTab,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, number>(
      PCB_TUNING_PATTERN,
      'End Y',
      'SetEndY',
      'GetEndY',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
      COORD_TYPES_T.ABS_Y_COORD,
    ),
    groupTab,
  );

  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_TUNING_PATTERN, LENGTH_TUNING_MODE>(
      PCB_TUNING_PATTERN,
      'Tuning Mode',
      NO_SETTER,
      'GetTuningMode',
      ENUM_MAP.Instance<LENGTH_TUNING_MODE>('LENGTH_TUNING_MODE'),
    ),
    groupTab,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, number>(
      PCB_TUNING_PATTERN,
      'Min Amplitude',
      'SetMinAmplitude',
      'GetMinAmplitude',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
      COORD_TYPES_T.ABS_X_COORD,
    ),
    groupTab,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, number>(
      PCB_TUNING_PATTERN,
      'Max Amplitude',
      'SetMaxAmplitude',
      'GetMaxAmplitude',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
      COORD_TYPES_T.ABS_X_COORD,
    ),
    groupTab,
  );

  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_TUNING_PATTERN, MeanderSide>(
      PCB_TUNING_PATTERN,
      'Initial Side',
      'SetInitialSide',
      'GetInitialSide',
      ENUM_MAP.Instance<MeanderSide>('PNS::MEANDER_SIDE'),
    ),
    groupTab,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, number>(
      PCB_TUNING_PATTERN,
      'Min Spacing',
      'SetSpacing',
      'GetSpacing',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
      COORD_TYPES_T.ABS_X_COORD,
    ),
    groupTab,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, number>(
      PCB_TUNING_PATTERN,
      'Corner Radius %',
      'SetCornerRadiusPercentage',
      'GetCornerRadiusPercentage',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_DEFAULT,
      COORD_TYPES_T.NOT_A_COORD,
    ),
    groupTab,
  );

  const isSkew = (aItem: INSPECTABLE_ITEM): boolean => {
    if (aItem instanceof PCB_TUNING_PATTERN) return aItem.GetTuningMode() === DIFF_PAIR_SKEW;

    return false;
  };

  const isTimeDomain = (aItem: INSPECTABLE_ITEM): boolean => {
    if (aItem instanceof PCB_TUNING_PATTERN) return aItem.GetSettings().isTimeDomain;

    return false;
  };

  const isLengthIsSpaceDomain = (aItem: INSPECTABLE_ITEM): boolean =>
    !isSkew(aItem) && !isTimeDomain(aItem);

  const isLengthIsTimeDomain = (aItem: INSPECTABLE_ITEM): boolean =>
    !isSkew(aItem) && isTimeDomain(aItem);

  const isSkewIsSpaceDomain = (aItem: INSPECTABLE_ITEM): boolean =>
    isSkew(aItem) && !isTimeDomain(aItem);

  const isSkewIsTimeDomain = (aItem: INSPECTABLE_ITEM): boolean =>
    isSkew(aItem) && isTimeDomain(aItem);

  propMgr
    .AddProperty(
      new PROPERTY<PCB_TUNING_PATTERN, number | undefined>(
        PCB_TUNING_PATTERN,
        'Target Length',
        'SetTargetLength',
        'GetTargetLength',
        TYPE_OPT_INT,
        PROPERTY_DISPLAY.PT_SIZE,
        COORD_TYPES_T.ABS_X_COORD,
      ),
      groupTab,
    )
    .SetAvailableFunc(isLengthIsSpaceDomain);

  propMgr
    .AddProperty(
      new PROPERTY<PCB_TUNING_PATTERN, number | undefined>(
        PCB_TUNING_PATTERN,
        'Target Delay',
        'SetTargetDelay',
        'GetTargetDelay',
        TYPE_OPT_INT,
        PROPERTY_DISPLAY.PT_TIME,
        COORD_TYPES_T.NOT_A_COORD,
      ),
      groupTab,
    )
    .SetAvailableFunc(isLengthIsTimeDomain);

  propMgr
    .AddProperty(
      new PROPERTY<PCB_TUNING_PATTERN, number>(
        PCB_TUNING_PATTERN,
        'Target Skew',
        'SetTargetSkew',
        'GetTargetSkew',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
        COORD_TYPES_T.ABS_X_COORD,
      ),
      groupTab,
    )
    .SetAvailableFunc(isSkewIsSpaceDomain);

  propMgr
    .AddProperty(
      new PROPERTY<PCB_TUNING_PATTERN, number>(
        PCB_TUNING_PATTERN,
        'Target Skew Delay',
        'SetTargetSkewDelay',
        'GetTargetSkewDelay',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_TIME,
        COORD_TYPES_T.NOT_A_COORD,
      ),
      groupTab,
    )
    .SetAvailableFunc(isSkewIsTimeDomain);

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, boolean>(
      PCB_TUNING_PATTERN,
      'Override Custom Rules',
      'SetOverrideCustomRules',
      'GetOverrideCustomRules',
      TYPE_BOOL,
    ),
    groupTab,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, boolean>(
      PCB_TUNING_PATTERN,
      'Single-sided',
      'SetSingleSided',
      'IsSingleSided',
      TYPE_BOOL,
    ),
    groupTab,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TUNING_PATTERN, boolean>(
      PCB_TUNING_PATTERN,
      'Rounded',
      'SetRounded',
      'IsRounded',
      TYPE_BOOL,
    ),
    groupTab,
  );
})();
