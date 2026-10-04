// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board bridge: a `Board` seen as a `PNS::NODE`.
 * Counterparts: `pcbnew/router/pns_kicad_iface.h` and `pns_kicad_iface.cpp`
 * (`PNS_KICAD_IFACE_BASE`, `PNS_KICAD_IFACE`). One class here, `PNS_KICAD_IFACE`:
 * the base's board-facing half and the derived class's view-facing half are
 * not split, because nothing else instantiates the base.
 *
 * `PnsRouterIface` — declared in `pns_router.ts`, which is the specification
 * this file satisfies — is the only thing standing between the router engine
 * and a real design. Everything else in `router/` computes on items that
 * somebody handed it; this is where the items come from and where routed
 * geometry is meant to go back.
 *
 * ## This is not a line-for-line port, and cannot be
 *
 * Upstream is 3293 lines, and roughly a third of them are `KIGFX::VIEW`,
 * `ROUTER_PREVIEW_ITEM` and `BOARD_COMMIT` — a preview layer that draws the
 * head of the route, a hidden-item set that un-hides itself, and an undo
 * transaction. None of those exist here. What is ported is the **sync** half:
 * the mapping from board geometry to `PNS::ITEM`s, plus the accessors the
 * engine calls on every mouse move. The view methods are no-ops and say so at
 * the site; `addItem`/`updateItem`/`removeItem`/`commit` record what a caller
 * asked for without writing to the board, because writing needs the editor's
 * commit machinery and that is a separate change.
 *
 * ## What a `PADSTACK` would have added, and why nothing is missing
 *
 * `syncPad` and `syncVia` upstream are dominated by `PADSTACK::Mode()`: a pad
 * or via may be a different size on every layer, so `ForEachUniqueLayer` can
 * produce several `SOLID`s for one pad. `PcbPad` and `PcbVia` in this tree have
 * no per-layer padstack at all, so every pad and via is upstream's
 * `MODE::NORMAL` — one solid per pad, one diameter per via — and the other two
 * arms of each switch are unreachable rather than dropped.
 *
 * ## Where it disagrees with `pns_obstacles.ts`
 *
 * `boardObstacleHulls` is the older, narrower board→router mapping the shipped
 * Route tool uses. The two now disagree in two places that change routes:
 * net 0 (see {@link PNS_KICAD_IFACE.netHandle}) and non-round pad shapes (see
 * {@link solidShapeForPad}). Both are documented at the site. Nothing here
 * touches that file or the tool that calls it.
 */
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { BOARD_STACKUP } from '../board_stackup_manager/board_stackup.js';
import type { BOARD_DESIGN_SETTINGS } from '../board_design_settings.js';
import { arcShape } from '../drc/drc_engine_view.js';
import { DRC_ENGINE } from '../drc/drc_engine.js';
import {
  DRC_CONSTRAINT,
  DRC_CONSTRAINT_OPTIONS,
  DRC_CONSTRAINT_T,
  DRC_IMPLICIT_SOURCE,
} from '../drc/drc_rule.js';
import { PnsArc } from './pns_arc.js';
import { PnsHole } from './pns_hole.js';
import { PnsKind, LineMarker, type PnsBoardItem, type PnsLinkedItem } from './pns_item.js';
import { PnsLayerRange } from './pns_layerset.js';
import { PNS_UNDEFINED_LAYER } from './pns_drag_algo.js';
import { PnsSegment } from './pns_segment.js';
import { PnsSolid } from './pns_solid.js';
import { PnsVia, ViaStackMode as PNS_VIA_STACK_MODE } from './pns_via.js';
import type { Shape } from '@ziroeda/kimath/src/geometry/shape_collisions.js';
import { PnsConstraintType } from './pns_node.js';
import type { DpNetPair, PnsRuleResolver } from './pns_node.js';
import type { NetHandle } from './pns_item.js';
import type { PnsItem } from './pns_item.js';
import type { PnsItemSet } from './pns_itemset.js';
import type { PnsLine, PnsLineChain } from './pns_line.js';
import type { PnsNode } from './pns_node.js';
import type { PnsRouterIface, PnsRouterSizes } from './pns_router.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { Distance } from '@ziroeda/kimath/src/math/vector2.js';
import { itemHull } from './pns_utils.js';
import type { KeepoutResult, PnsConstraint } from './pns_node.js';
import type { Hull } from './pns_utils.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { VIEW_GROUP } from '@ziroeda/common/view/view_group.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { FLASHING, GAL_LAYER_ID, IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { RECURSE_MODE, type EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import { IN_EDIT, ROUTER_TRANSIENT } from '@ziroeda/common/eda_item_flags.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { MINOPTMAX } from '@ziroeda/core/minoptmax.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { SHAPE_TYPE, type SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import type { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import type { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import type { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import type { SHAPE_SIMPLE } from '@ziroeda/kimath/src/geometry/shape_simple.js';
import type { BOARD } from '../board.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { TOOL_BASE } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { BOARD_COMMIT, SKIP_ENTERED_GROUP } from '../board_commit.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';
import { NETINFO_LIST } from '../netinfo.js';
import type { NETINFO_ITEM } from '../netinfo_item.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB, PAD_PROP, PADSTACK, PADSTACK_MODE } from '../padstack.js';
import type { PCB_BARCODE } from '../pcb_barcode.js';
import type { PCB_DIMENSION_BASE } from '../pcb_dimension.js';
import type { PCB_FIELD } from '../pcb_field.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { PCB_TEXT } from '../pcb_text.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import { VIATYPE } from '../pcb_track_types.js';
import type { ZONE } from '../zone.js';
import {
  SHOW_WHILE_ROUTING,
  SHOW_WITH_VIA_ALWAYS,
  SHOW_WITH_VIA_WHILE_ROUTING,
  SHOW_WITH_VIA_WHILE_ROUTING_OR_DRAGGING,
} from '../pcbnew_settings.js';
import {
  PNS_SEMI_SOLID,
  ROUTER_PREVIEW_ITEM,
  type ROUTER_PREVIEW_IFACE,
} from './router_preview_item.js';

/** `ENTERED_GROUP_MAGIC_NUMBER`: the replacement-map key for brand-new items. */
const ENTERED_GROUP = Symbol('ENTERED_GROUP_MAGIC_NUMBER');

/** `dynamic_cast<PCB_GENERATOR*>( GetParentGroup() ) && !HasFlag( IN_EDIT )`. */
function isUneditedGenerator(aGroup: EDA_GROUP | null): boolean {
  const item = aGroup?.AsEdaItem() as EDA_ITEM | undefined;

  return item !== undefined && item.Type() === KICAD_T.PCB_GENERATOR_T && !item.HasFlag(IN_EDIT);
}

// ---------------------------------------------------------------------------
// Layer names <-> PNS layer indices

/**
 * `PNS_KICAD_IFACE_BASE::GetPNSLayerFromBoardLayer` (cpp:3056-3068).
 *
 * Upstream is arithmetic on `PCB_LAYER_ID`, where `F_Cu = 0`, `B_Cu = 2` and
 * `In<N>.Cu = (N + 1) * 2`:
 *
 * ```
 * aLayer < 0 -> -1;  F_Cu -> 0;  B_Cu -> count - 1;  else -> (aLayer / 2) - 1
 * ```
 *
 * `(In N).Cu / 2 - 1 == N`, so in this tree's layer *names* the mapping is
 * F.Cu → 0, In<N>.Cu → N, B.Cu → count-1. A name that is not a copper layer
 * has no `PCB_LAYER_ID` to abuse, so it answers −1; upstream would return
 * nonsense there (`F.SilkS` is `PCB_LAYER_ID` 5, giving 1, i.e. In1.Cu) and
 * gets away with it only because every caller guards with `IsKicadCopperLayer`
 * first.
 */
export function pnsLayerFromBoardLayer(aLayer: string, aCopperLayerCount: number): number {
  if (aLayer === 'F.Cu') return 0;
  if (aLayer === 'B.Cu') return aCopperLayerCount - 1;

  const inner = /^In(\d+)\.Cu$/.exec(aLayer);

  return inner ? Number(inner[1]) : -1;
}

/**
 * `PNS_KICAD_IFACE_BASE::GetBoardLayerFromPNSLayer` (cpp:3041-3053).
 *
 * `UNDEFINED_LAYER` becomes the empty string, which `isCopperLayerName` and
 * every consumer here reject — the same role the sentinel plays upstream.
 *
 * Note the order: layer 0 is answered `F.Cu` *before* the `count - 1` test, so
 * a one-layer board's only layer is the front and not the back. Upstream's.
 */
export function boardLayerFromPnsLayer(aLayer: number, aCopperLayerCount: number): string {
  if (aLayer < 0 || aLayer >= aCopperLayerCount) return '';
  if (aLayer === 0) return 'F.Cu';
  if (aLayer === aCopperLayerCount - 1) return 'B.Cu';

  return `In${aLayer}.Cu`;
}

// ---------------------------------------------------------------------------
// Geometry: a kimath SHAPE as the router's `Shape`

/**
 * The router's `Shape` for a kimath SHAPE: what `SOLID::SetShape( shape->Clone() )`
 * stores upstream. The engine's collision code works on its own tagged union,
 * so the live item's shape is translated once, here, at sync.
 *
 * Null for a shape the router cannot hold (a poly set, a compound, an empty
 * shape) — the caller reduces those first, as upstream does.
 */
export function pnsShapeOf(aShape: SHAPE): Shape | null {
  switch (aShape.Type()) {
    case SHAPE_TYPE.SH_CIRCLE: {
      const c = aShape as SHAPE_CIRCLE;
      return { kind: 'circle', c: { ...c.GetCenter() }, r: c.GetRadius() };
    }

    case SHAPE_TYPE.SH_SEGMENT: {
      const seg = aShape as SHAPE_SEGMENT;
      const s = seg.GetSeg();
      return { kind: 'stadium', a: { ...s.A }, b: { ...s.B }, r: seg.GetWidth() / 2 };
    }

    case SHAPE_TYPE.SH_RECT: {
      const rect = aShape as SHAPE_RECT;
      const p = rect.GetPosition();
      const sz = rect.GetSize();
      const r = rect.GetRadius();

      // A rounded rectangle is its inner rectangle swept by the corner radius.
      return {
        kind: 'poly',
        pts: [
          { x: p.x + r, y: p.y + r },
          { x: p.x + sz.x - r, y: p.y + r },
          { x: p.x + sz.x - r, y: p.y + sz.y - r },
          { x: p.x + r, y: p.y + sz.y - r },
        ],
        r,
      };
    }

    case SHAPE_TYPE.SH_SIMPLE: {
      const simple = aShape as SHAPE_SIMPLE;
      const pts: Vec2[] = [];

      for (let i = 0; i < simple.PointCount(); i++) pts.push({ ...simple.CPoint(i) });

      return { kind: 'poly', pts, r: 0 };
    }

    case SHAPE_TYPE.SH_LINE_CHAIN: {
      const chain = aShape as SHAPE_LINE_CHAIN;
      const pts: Vec2[] = [];

      for (let i = 0; i < chain.PointCount(); i++) pts.push({ ...chain.CPoint(i) });

      return { kind: 'poly', pts, r: chain.GetWidth() / 2 };
    }

    case SHAPE_TYPE.SH_ARC: {
      const arc = aShape as SHAPE_ARC;
      return arcShape(arc.GetP0(), arc.GetArcMid(), arc.GetP1(), arc.GetWidth());
    }

    default:
      return null;
  }
}

/** A closed outline as a `SHAPE_SIMPLE`-equivalent router polygon. */
function pnsPolyOf(aOutline: SHAPE_LINE_CHAIN): Shape {
  const pts: Vec2[] = [];

  for (let i = 0; i < aOutline.PointCount(); i++) pts.push({ ...aOutline.CPoint(i) });

  return { kind: 'poly', pts, r: 0 };
}

// ---------------------------------------------------------------------------
// The interface

/** What a host can tell the bridge that the BOARD itself does not carry. */
export interface PNS_KICAD_IFACE_DEPS {
  /**
   * `KIGFX::VIEW::IsLayerVisible`. Absent means everything is visible, which is
   * **not** upstream's no-view answer for `IsAnyLayerVisible` — see
   * {@link PNS_KICAD_IFACE.isAnyLayerVisible}.
   */
  isLayerVisible?: (aBoardLayer: string) => boolean;
  /** `KIGFX::VIEW::IsVisible( BOARD_ITEM* )`. Absent means visible. */
  isItemVisible?: (aItem: PnsItem) => boolean;
  /**
   * `BOARD_DESIGN_SETTINGS`, as `ImportSizes` reads it. Absent is upstream's
   * `if( !m_board )` early-out: {@link PNS_KICAD_IFACE.importSizes} returns false
   * and the caller's sizes are left alone.
   */
  designSettings?: PnsDesignSettings | null;
  /**
   * `PNS_KICAD_IFACE::SetView( KIGFX::VIEW* )`: with a view the interface owns a
   * `VIEW_GROUP` on `LAYER_SELECT_OVERLAY` and `DisplayItem` puts a
   * `ROUTER_PREVIEW_ITEM` in it. Without one the preview calls do nothing.
   */
  view?: VIEW | null;
  /** `PCBNEW_SETTINGS::m_Display.m_TrackClearance`, read on every `DisplayItem`. */
  trackClearanceMode?: () => number;
  /**
   * `SetHostTool( PCB_TOOL_BASE* )`: the commit host `m_commit` is made for
   * (`std::make_unique<BOARD_COMMIT>( m_tool )`), and the selection tool
   * `Commit()` asks for the entered group. Without one the interface still
   * syncs and previews, and `Commit()` changes nothing.
   */
  commitHost?: COMMIT_HOST | null;
  /** `PCB_SELECTION_TOOL::GetEnteredGroup()`, for new items (`Commit()`). */
  enteredGroup?: () => EDA_GROUP | null;
}

/** What `BOARD_COMMIT( m_tool )` is made for: a tool, a frame or a tool manager. */
export type COMMIT_HOST = TOOL_BASE | PCB_BASE_FRAME | TOOL_MANAGER;

/**
 * The `BOARD_DESIGN_SETTINGS` members `ImportSizes` reads, in IU.
 *
 * The four minimums, the two "inherit the width from the track I started on"
 * flags, and the whole size-selection block from
 * `board_design_settings_sizes.ts` — which is Board Setup > Pre-defined Sizes
 * plus the toolbar's choice.
 */
export interface PnsDesignSettings {
  /** `m_MinClearance`. */
  minClearance: number;
  /** `m_TrackMinWidth`. */
  trackMinWidth: number;
  /** `m_ViasMinSize`. */
  viasMinSize: number;
  /** `m_MinThroughDrill`. */
  minThroughDrill: number;
  /** `m_HoleToHoleMin`. */
  holeToHoleMin: number;
  /** `m_UseConnectedTrackWidth` — the "Use Existing Track Width" toggle. */
  useConnectedTrackWidth: boolean;
  /**
   * `m_TempOverrideTrackWidth`, set for one route when the user cycles the
   * width while `m_UseConnectedTrackWidth` is on
   * (`board_editor_control.cpp:1108-1112`).
   */
  tempOverrideTrackWidth: boolean;
  /** The real BOARD_DESIGN_SETTINGS: the indices, the overrides and the lists. */
  sizes: BOARD_DESIGN_SETTINGS;
  /**
   * `m_UseHeightForLengthCalcs` — Board Setup > Constraints' "Include stackup
   * height in track length calculations". False is upstream's own early return
   * from `StackupHeight`, not a stub.
   */
  useHeightForLengthCalcs?: boolean;
  /** `GetDesignSettings().GetStackupDescriptor()`, the live one. */
  stackup?: BOARD_STACKUP;
}

/**
 * `m_board->GetDesignSettings()` as `ImportSizes` reads it: every member a
 * getter over the live BOARD_DESIGN_SETTINGS, so a toolbar choice made after
 * the interface was built is the one the next route uses, as upstream's read of
 * the board at `ImportSizes` time is.
 */
export function PnsDesignSettingsFromBds(aBds: BOARD_DESIGN_SETTINGS): PnsDesignSettings {
  return {
    get minClearance() {
      return aBds.m_MinClearance;
    },
    get trackMinWidth() {
      return aBds.m_TrackMinWidth;
    },
    get viasMinSize() {
      return aBds.m_ViasMinSize;
    },
    get minThroughDrill() {
      return aBds.m_MinThroughDrill;
    },
    get holeToHoleMin() {
      return aBds.m_HoleToHoleMin;
    },
    get useConnectedTrackWidth() {
      return aBds.m_UseConnectedTrackWidth;
    },
    get tempOverrideTrackWidth() {
      return aBds.m_TempOverrideTrackWidth;
    },
    sizes: aBds,
    get useHeightForLengthCalcs() {
      return aBds.m_UseHeightForLengthCalcs;
    },
    get stackup() {
      return aBds.GetStackupDescriptor();
    },
  };
}

/**
 * `PNS_KICAD_IFACE_BASE` + `PNS_KICAD_IFACE`, on the live BOARD.
 *
 * `SyncWorld` builds the router's world from the board's items; `AddItem`,
 * `RemoveItem`, `UpdateItem` and `Commit` put the router's result back onto it
 * through a BOARD_COMMIT, as upstream's `m_commit`.
 */
export class PNS_KICAD_IFACE implements PnsRouterIface, ROUTER_PREVIEW_IFACE {
  private readonly m_board: BOARD;
  private readonly mDeps: PNS_KICAD_IFACE_DEPS;

  private mWorld: PnsNode | null = null;
  private mRuleResolver: PNS_PCBNEW_RULE_RESOLVER | null = null;

  /** `m_commit`: the board commit the router's edits go into. */
  private m_commit: BOARD_COMMIT | null;
  /** `m_fpOffsets`: pads the router moved (footprint drag), old and new positions. */
  private readonly m_fpOffsets = new Map<PAD, { p_old?: Vec2; p_new?: Vec2 }>();
  /** `m_itemGroups`: the group each removed item was in. */
  private readonly m_itemGroups = new Map<BOARD_ITEM, EDA_GROUP>();
  /** `m_replacementMap`: the new items made from each removed one, or for the entered group. */
  private readonly m_replacementMap = new Map<BOARD_ITEM | typeof ENTERED_GROUP, BOARD_ITEM[]>();

  constructor(aBoard: BOARD, aDeps: PNS_KICAD_IFACE_DEPS = {}) {
    this.m_board = aBoard;
    this.mDeps = aDeps;
    this.m_commit = aDeps.commitHost ? new BOARD_COMMIT(aDeps.commitHost as PCB_BASE_FRAME) : null;
    if (aDeps.view) this.SetView(aDeps.view);
  }

  /**
   * `m_startLayer` (pns_kicad_iface.h:140), the route's starting layer in PNS
   * layer coordinates; -1 until set, as the constructor leaves it (cpp:1585).
   */
  private m_startLayer = -1;
  /** `m_commitFlags` (cpp:1594), OR'd into each `Commit()`'s push. */
  private m_commitFlags = 0;

  /** `SetStartLayerFromPCBNew( PCB_LAYER_ID )` (cpp:3070). */
  SetStartLayerFromPCBNew(aLayer: PCB_LAYER_ID): void {
    this.m_startLayer = this.GetPNSLayerFromBoardLayer(aLayer);
  }

  /** `SetStartLayerFromPNS( int )` (pns_kicad_iface.h:107). */
  SetStartLayerFromPNS(aLayer: number): void {
    this.m_startLayer = aLayer;
  }

  /** `SetCommitFlags( int )` (pns_kicad_iface.h). */
  SetCommitFlags(aCommitFlags: number): void {
    this.m_commitFlags = aCommitFlags;
  }

  /** `m_view` and `m_previewItems`. */
  private mView: VIEW | null = null;
  private mPreviewItems: VIEW_GROUP | null = null;
  /** `m_hiddenItems`: what `HideItem` made invisible. */
  private readonly mHiddenItems = new Set<VIEW_ITEM>();

  /**
   * `PNS_KICAD_IFACE::SetView` (cpp:2968): the group the router's previews go
   * in, added to the view on `LAYER_SELECT_OVERLAY`.
   */
  SetView(aView: VIEW | null): void {
    this.Dispose();
    this.mView = aView;
    this.mPreviewItems = new VIEW_GROUP(aView);
    this.mPreviewItems.SetLayer(GAL_LAYER_ID.LAYER_SELECT_OVERLAY);

    if (aView) aView.Add(this.mPreviewItems);
  }

  /** `~PNS_KICAD_IFACE`: free the preview items and take the group off the view. */
  Dispose(): void {
    if (this.mView) {
      for (const item of this.mHiddenItems) this.mView.SetVisible(item, true);
      this.mHiddenItems.clear();
    }

    if (this.mPreviewItems) {
      this.mPreviewItems.FreeItems();
      this.mView?.Remove(this.mPreviewItems);
    }

    this.mPreviewItems = null;
    this.mView = null;
  }

  /** The group `DisplayItem` fills; null without a view. */
  GetPreviewItems(): VIEW_GROUP | null {
    return this.mPreviewItems;
  }

  /** `GetBoardLayerFromPNSLayer` (cpp:3040). */
  GetBoardLayerFromPNSLayer(aLayer: number): PCB_LAYER_ID {
    const count = this.m_board.GetCopperLayerCount();

    if (aLayer < 0) return PCB_LAYER_ID.UNDEFINED_LAYER;

    if (aLayer === 0) return PCB_LAYER_ID.F_Cu;

    if (aLayer === count - 1) return PCB_LAYER_ID.B_Cu;

    return ((aLayer + 1) * 2) as PCB_LAYER_ID;
  }

  /** `GetPNSLayerFromBoardLayer` (cpp:3055). */
  GetPNSLayerFromBoardLayer(aLayer: PCB_LAYER_ID): number {
    if (aLayer < 0) return -1;

    if (aLayer === PCB_LAYER_ID.F_Cu) return 0;

    if (aLayer === PCB_LAYER_ID.B_Cu) return this.m_board.GetCopperLayerCount() - 1;

    return aLayer / 2 - 1;
  }

  /** `SetLayersFromPCBNew( aStartLayer, aEndLayer )` (cpp:3076). */
  SetLayersFromPCBNew(aStartLayer: PCB_LAYER_ID, aEndLayer: PCB_LAYER_ID): PnsLayerRange {
    return new PnsLayerRange(
      this.GetPNSLayerFromBoardLayer(aStartLayer),
      this.GetPNSLayerFromBoardLayer(aEndLayer),
    );
  }

  /** `IsKicadCopperLayer` (cpp:2144). */
  IsKicadCopperLayer(aKicadLayer: PCB_LAYER_ID): boolean {
    return IsCopperLayer(aKicadLayer) && this.m_board.IsLayerEnabled(aKicadLayer);
  }

  GetNetCode(aNet: unknown): number {
    return this.getNetCode(aNet as NetHandle);
  }

  board(): BOARD {
    return this.m_board;
  }

  /** `BOARD::GetCopperLayerCount()`. */
  copperLayerCount(): number {
    return this.m_board.GetCopperLayerCount();
  }

  // ----- nets ----------------------------------------------------------------

  /** `PNS_KICAD_IFACE::GetNetCode` (cpp:2997). A null handle is −1. */
  getNetCode(aNet: NetHandle): number {
    return aNet ? (aNet as NETINFO_ITEM).GetNetCode() : -1;
  }

  /** `PNS_KICAD_IFACE::GetNetName` (cpp:3006). */
  getNetName(aNet: NetHandle): string {
    return aNet ? (aNet as NETINFO_ITEM).GetNetname() : '';
  }

  /** `UpdateNet` (cpp:3015): a trace; the ratsnest is the commit's business. */
  updateNet(_aNet: NetHandle): void {
    // Intentionally empty.
  }

  /** `GetOrphanedNetHandle` (cpp:3021). */
  getOrphanedNetHandle(): NetHandle {
    return NETINFO_LIST.OrphanedItem();
  }

  // ----- layers --------------------------------------------------------------

  /** The board layer, by name — the router engine's spelling of a layer. */
  getBoardLayerFromPnsLayer(aLayer: number): string {
    const layer = this.GetBoardLayerFromPNSLayer(aLayer);

    return layer === PCB_LAYER_ID.UNDEFINED_LAYER || aLayer >= this.m_board.GetCopperLayerCount()
      ? ''
      : LSET.Name(layer);
  }

  getPnsLayerFromBoardLayer(aLayer: string): number {
    return pnsLayerFromBoardLayer(aLayer, this.m_board.GetCopperLayerCount());
  }

  /** `IsPNSCopperLayer` (cpp:2137). */
  isPnsCopperLayer(aPnsLayer: number): boolean {
    return this.IsKicadCopperLayer(this.GetBoardLayerFromPNSLayer(aPnsLayer));
  }

  /**
   * `PNS_KICAD_IFACE::IsAnyLayerVisible` (cpp:2150).
   *
   * Upstream returns **false** when there is no `VIEW`. Reproducing that would
   * make `TOOL_BASE::pickSingleItem` reject every candidate in a headless
   * build, since its third rejection is exactly this call. The no-view answer
   * is therefore "visible", and a host that has a view injects the predicate.
   */
  isAnyLayerVisible(aLayer: PnsLayerRange): boolean {
    const visible = this.mDeps.isLayerVisible;

    if (!visible) return true;

    for (let i = aLayer.start(); i <= aLayer.end(); i++) {
      if (visible(this.getBoardLayerFromPnsLayer(i))) return true;
    }

    return false;
  }

  /**
   * `PNS_KICAD_IFACE::IsItemVisible` (cpp:2257): an item with no board parent
   * has not been committed yet and is always visible; the rest is the view's.
   */
  isItemVisible(aItem: PnsItem): boolean {
    if (!aItem.parent()) return true;

    return this.mDeps.isItemVisible?.(aItem) ?? true;
  }

  /** Both `IsFlashedOnLayer` overloads (cpp:2165-2254). */
  isFlashedOnLayer(aItem: PnsItem, aLayer: number | PnsLayerRange): boolean {
    const parent = aItem.parent() as unknown as BOARD_ITEM | null;

    if (typeof aLayer === 'number') {
      // Default is all layers
      if (aLayer < 0) return true;

      if (parent) {
        switch (parent.Type()) {
          case KICAD_T.PCB_VIA_T:
            return (parent as PCB_VIA).FlashLayer(this.GetBoardLayerFromPNSLayer(aLayer));

          case KICAD_T.PCB_PAD_T:
            return (parent as PAD).FlashLayer(this.GetBoardLayerFromPNSLayer(aLayer));

          default:
            break;
        }
      }

      if (aItem.ofKind(PnsKind.VIA_T)) return (aItem as PnsVia).connectsLayer(aLayer);

      return aItem.layers().overlaps(aLayer);
    }

    const test = aItem.layers().intersection(aLayer);

    if (parent) {
      switch (parent.Type()) {
        case KICAD_T.PCB_VIA_T: {
          const via = parent as PCB_VIA;

          for (let layer = test.start(); layer <= test.end(); ++layer) {
            if (via.FlashLayer(this.GetBoardLayerFromPNSLayer(layer))) return true;
          }

          return false;
        }

        case KICAD_T.PCB_PAD_T: {
          const pad = parent as PAD;

          for (let layer = test.start(); layer <= test.end(); ++layer) {
            if (pad.FlashLayer(this.GetBoardLayerFromPNSLayer(layer))) return true;
          }

          return false;
        }

        default:
          break;
      }
    }

    if (aItem.ofKind(PnsKind.VIA_T)) {
      const via = aItem as PnsVia;

      for (let layer = test.start(); layer <= test.end(); ++layer) {
        if (via.connectsLayer(layer)) return true;
      }

      return false;
    }

    return test.start() <= test.end();
  }

  // ----- the world -----------------------------------------------------------

  /** `PNS_KICAD_IFACE_BASE::GetWorld()` — the node the last sync filled. */
  getWorld(): PnsNode | null {
    return this.mWorld;
  }

  /** `GetRuleResolver()` (cpp:3027). Null before a sync. */
  getRuleResolver(): PnsRuleResolver | null {
    return this.mRuleResolver;
  }

  /** `PNS_KICAD_IFACE_BASE::SyncWorld` (cpp:2288-2449). */
  syncWorld(aWorld: PnsNode): void {
    let worstClearance = this.m_board.GetMaxClearanceValue();

    this.mWorld = aWorld;

    const syncBoardGraphic = (aItem: BOARD_ITEM): void => {
      switch (aItem.Type()) {
        case KICAD_T.PCB_SHAPE_T:
        case KICAD_T.PCB_TEXTBOX_T:
          this.syncGraphicalItem(aWorld, aItem as PCB_SHAPE);
          break;

        case KICAD_T.PCB_TEXT_T:
        case KICAD_T.PCB_TABLE_T:
          this.syncTextItem(aWorld, aItem, aItem.GetLayer());
          break;

        case KICAD_T.PCB_BARCODE_T:
          this.syncBarcode(aWorld, aItem as PCB_BARCODE);
          break;

        case KICAD_T.PCB_DIM_ALIGNED_T:
        case KICAD_T.PCB_DIM_CENTER_T:
        case KICAD_T.PCB_DIM_RADIAL_T:
        case KICAD_T.PCB_DIM_ORTHOGONAL_T:
        case KICAD_T.PCB_DIM_LEADER_T:
          this.syncDimension(aWorld, aItem as PCB_DIMENSION_BASE);
          break;

        default: // PCB_REFERENCE_IMAGE_T, PCB_TARGET_T: ignore
          break;
      }
    };

    for (const gitem of this.m_board.Drawings()) syncBoardGraphic(gitem);

    for (const zone of this.m_board.Zones()) this.syncZone(aWorld, zone);

    for (const footprint of this.m_board.Footprints()) {
      for (const pad of footprint.Pads()) {
        for (const solid of this.syncPad(pad)) aWorld.addSolid(solid);

        const clearanceOverride = pad.GetClearanceOverrides(null);

        if (clearanceOverride !== undefined)
          worstClearance = Math.max(worstClearance, clearanceOverride);

        if (pad.GetProperty() === PAD_PROP.CASTELLATED) {
          const hole = pnsShapeOf(pad.GetEffectiveHoleShape());

          if (hole) aWorld.addEdgeExclusion(hole);
        }
      }

      this.syncTextItem(aWorld, footprint.Reference(), footprint.Reference().GetLayer());
      this.syncTextItem(aWorld, footprint.Value(), footprint.Value().GetLayer());

      for (const zone of footprint.Zones()) this.syncZone(aWorld, zone);

      for (const field of footprint.GetFields()) this.syncTextItem(aWorld, field, field.GetLayer());

      for (const item of footprint.GraphicalItems()) syncBoardGraphic(item);
    }

    for (const t of this.m_board.Tracks()) {
      const type = t.Type();

      if (type === KICAD_T.PCB_TRACE_T) {
        const segment = this.syncTrack(t);

        if (segment) aWorld.addSegment(segment, true);
      } else if (type === KICAD_T.PCB_ARC_T) {
        const arc = this.syncArc(t as PCB_ARC);

        if (arc) aWorld.addArc(arc, true);
      } else if (type === KICAD_T.PCB_VIA_T) {
        const via = this.syncVia(t as PCB_VIA);

        if (via) aWorld.addVia(via);
      }
    }

    // NB: if this were ever to become a long-lived object we would need to dirty its
    // clearance cache here....
    this.mRuleResolver = new PNS_PCBNEW_RULE_RESOLVER(this.m_board, this);

    aWorld.setRuleResolver(this.mRuleResolver);
    aWorld.setMaxClearance(worstClearance + this.mRuleResolver.clearanceEpsilon());
  }

  /**
   * `PNS_KICAD_IFACE_BASE::syncPad` (cpp:1615-1743): a SOLID per unique padstack
   * layer, for a copper pad or one with a hole.
   */
  syncPad(aPad: PAD): PnsSolid[] {
    const solids: PnsSolid[] = [];
    const copperCount = aPad.BoardCopperLayerCount();
    let layers = new PnsLayerRange(0, copperCount - 1);
    const lmsk = aPad.GetLayerSet().CuStack();

    // ignore non-copper pads except for those with holes
    if (lmsk.length === 0 && aPad.GetDrillSize().x === 0) return solids;

    switch (aPad.GetAttribute()) {
      case PAD_ATTRIB.PTH:
      case PAD_ATTRIB.NPTH:
        break;

      case PAD_ATTRIB.CONN:
      case PAD_ATTRIB.SMD: {
        let isCopper = false;

        if (lmsk.length > 0 && aPad.GetAttribute() !== PAD_ATTRIB.NPTH) {
          layers = this.SetLayersFromPCBNew(lmsk[0]!, lmsk[0]!);
          isCopper = true;
        }

        if (!isCopper) return solids;

        break;
      }

      default:
        return solids;
    }

    const mode = aPad.Padstack().Mode();

    const makeSolidFromPadLayer = (aLayer: PCB_LAYER_ID): void => {
      // For FRONT_INNER_BACK mode, skip creating a SOLID for inner layers when there are
      // no inner layers (2-layer board). Otherwise PNS_LAYER_RANGE(1, 0) would be swapped
      // to (0, 1) and indexed on both F_Cu and B_Cu, causing incorrect collision checks.
      if (
        mode === PADSTACK_MODE.FRONT_INNER_BACK &&
        aLayer !== PCB_LAYER_ID.F_Cu &&
        aLayer !== PCB_LAYER_ID.B_Cu &&
        copperCount <= 2
      )
        return;

      const solid = new PnsSolid();

      if (aPad.GetAttribute() === PAD_ATTRIB.NPTH) solid.setRoutable(false);

      if (mode === PADSTACK_MODE.CUSTOM) {
        solid.setLayer(this.GetPNSLayerFromBoardLayer(aLayer));
      } else if (mode === PADSTACK_MODE.FRONT_INNER_BACK) {
        if (aLayer === PCB_LAYER_ID.F_Cu || aLayer === PCB_LAYER_ID.B_Cu)
          solid.setLayer(this.GetPNSLayerFromBoardLayer(aLayer));
        else solid.setLayers(new PnsLayerRange(1, copperCount - 2));
      } else {
        solid.setLayers(layers);
      }

      solid.setNet(aPad.GetNet());
      solid.setParent(aPad as unknown as PnsBoardItem);
      solid.setPadToDie(aPad.GetPadToDieLength());
      solid.setPadToDieDelay(aPad.GetPadToDieDelay());
      solid.setOrientation(aPad.GetOrientation());

      if (aPad.IsFreePad()) solid.setIsFreePad();

      const c = aPad.ShapePos(aLayer);
      const offset = RotatePoint(aPad.GetOffset(aLayer), aPad.GetOrientation());

      solid.setPos({ x: c.x - offset.x, y: c.y - offset.y });
      solid.setOffset({ x: offset.x, y: offset.y });

      if (aPad.GetDrillSize().x > 0) {
        const hole = pnsShapeOf(aPad.GetEffectiveHoleShape());

        if (hole) {
          solid.setHole(new PnsHole(hole));
          solid.hole()?.setLayers(new PnsLayerRange(0, copperCount - 1));
        }
      }

      // We generate a single SOLID for a pad, so we have to treat it as ALWAYS_FLASHED and
      // then perform layer-specific flashing tests internally.
      const shape = aPad.GetEffectiveShape(aLayer, FLASHING.ALWAYS_FLASHED);
      let solidShape: Shape | null = null;

      if (shape.HasIndexableSubshapes() && shape.GetIndexableSubshapeCount() === 1) {
        const subshapes: SHAPE[] = [];
        shape.GetIndexableSubshapes(subshapes);

        solidShape = pnsShapeOf(subshapes[0]!);
      } else {
        // For anything that's not a single shape we use a polygon. Multiple shapes have a
        // tendency to confuse the hull generator. https://gitlab.com/kicad/code/kicad/-/issues/15553
        const poly = aPad.GetEffectivePolygon(aLayer, ERROR_LOC.ERROR_OUTSIDE);

        if (poly.OutlineCount()) solidShape = pnsPolyOf(poly.Outline(0));
      }

      if (!solidShape) return;

      solid.setShape(solidShape);
      solids.push(solid);
    };

    aPad.Padstack().ForEachUniqueLayer(makeSolidFromPadLayer);

    return solids;
  }

  /** `PNS_KICAD_IFACE_BASE::syncTrack` (cpp:1745). */
  syncTrack(aTrack: PCB_TRACK): PnsSegment | null {
    const start = aTrack.GetStart();
    const end = aTrack.GetEnd();
    const segment = new PnsSegment(
      { seg: { a: { ...start }, b: { ...end } }, width: aTrack.GetWidth() },
      aTrack.GetNet(),
    );

    segment.setWidth(aTrack.GetWidth());
    segment.setLayer(this.GetPNSLayerFromBoardLayer(aTrack.GetLayer()));
    segment.setParent(aTrack as unknown as PnsBoardItem);

    if (aTrack.IsLocked()) segment.mark(LineMarker.MK_LOCKED);

    if (isUneditedGenerator(aTrack.GetParentGroup())) segment.mark(LineMarker.MK_LOCKED);

    return segment;
  }

  /** `PNS_KICAD_IFACE_BASE::syncArc` (cpp:1766). */
  syncArc(aArc: PCB_ARC): PnsArc | null {
    const arc = new PnsArc(
      {
        p0: { ...aArc.GetStart() },
        arcMid: { ...aArc.GetMid() },
        p1: { ...aArc.GetEnd() },
        width: aArc.GetWidth(),
      },
      aArc.GetNet(),
    );

    arc.setLayer(this.GetPNSLayerFromBoardLayer(aArc.GetLayer()));
    arc.setParent(aArc as unknown as PnsBoardItem);

    if (aArc.IsLocked()) arc.mark(LineMarker.MK_LOCKED);

    if (isUneditedGenerator(aArc.GetParentGroup())) arc.mark(LineMarker.MK_LOCKED);

    return arc;
  }

  /** `PNS_KICAD_IFACE_BASE::syncVia` (cpp:1788-1888). */
  syncVia(aVia: PCB_VIA): PnsVia | null {
    const via = new PnsVia(
      { ...aVia.GetPosition() },
      this.SetLayersFromPCBNew(aVia.TopLayer(), aVia.BottomLayer()),
      0,
      aVia.GetDrillValue(),
      aVia.GetNet(),
      aVia.GetViaType(),
    );
    via.setUnconnectedLayerMode(aVia.Padstack().UnconnectedLayerMode());

    const syncDiameter = (aLayer: PCB_LAYER_ID): void => {
      via.setDiameter(this.GetPNSLayerFromBoardLayer(aLayer), aVia.GetWidth(aLayer));
    };

    switch (aVia.Padstack().Mode()) {
      case PADSTACK_MODE.NORMAL:
        via.setDiameter(0, aVia.GetWidth(PADSTACK.ALL_LAYERS));
        break;

      case PADSTACK_MODE.FRONT_INNER_BACK:
        if (aVia.GetViaType() === VIATYPE.BLIND || aVia.GetViaType() === VIATYPE.BURIED) {
          via.setDiameter(0, aVia.GetWidth(PADSTACK.INNER_LAYERS));
        } else {
          via.setStackMode(PNS_VIA_STACK_MODE.FRONT_INNER_BACK);
          aVia.Padstack().ForEachUniqueLayer(syncDiameter);
        }

        break;

      case PADSTACK_MODE.CUSTOM:
        via.setStackMode(PNS_VIA_STACK_MODE.CUSTOM);
        aVia.Padstack().ForEachUniqueLayer(syncDiameter);
    }

    via.setParent(aVia as unknown as PnsBoardItem);

    if (aVia.IsLocked()) via.mark(LineMarker.MK_LOCKED);

    if (isUneditedGenerator(aVia.GetParentGroup())) via.mark(LineMarker.MK_LOCKED);

    via.setIsFree(aVia.GetIsFree());
    via.setHole(
      PnsHole.makeCircularHole(
        { ...aVia.GetPosition() },
        Math.trunc(aVia.GetDrillValue() / 2),
        this.SetLayersFromPCBNew(aVia.TopLayer(), aVia.BottomLayer()),
      ),
    );

    const primaryStart = aVia.GetPrimaryDrillStartLayer();
    const primaryEnd = aVia.GetPrimaryDrillEndLayer();

    if (
      primaryStart !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      primaryEnd !== PCB_LAYER_ID.UNDEFINED_LAYER
    )
      via.setHoleLayers(this.SetLayersFromPCBNew(primaryStart, primaryEnd));
    else via.setHoleLayers(this.SetLayersFromPCBNew(aVia.TopLayer(), aVia.BottomLayer()));

    via.setSecondaryDrill(aVia.GetSecondaryDrillSize() ?? null);

    let secondaryLayers: PnsLayerRange | null = null;

    if (
      aVia.GetSecondaryDrillStartLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      aVia.GetSecondaryDrillEndLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER
    ) {
      secondaryLayers = this.SetLayersFromPCBNew(
        aVia.GetSecondaryDrillStartLayer(),
        aVia.GetSecondaryDrillEndLayer(),
      );
    }

    via.setSecondaryHoleLayers(secondaryLayers);

    return via;
  }

  /**
   * `PNS_KICAD_IFACE_BASE::syncZone` (cpp:1890-1951): a keepout rule area, as
   * one non-routable SOLID per triangle of its outline on each copper layer.
   */
  syncZone(aWorld: PnsNode, aZone: ZONE): boolean {
    if (!aZone.GetIsRuleArea() || !aZone.HasKeepoutParametersSet()) return false;

    const layers = aZone.GetLayerSet();
    const poly = aZone.Outline();

    poly.CacheTriangulation(false);

    // Upstream shows "%s is malformed." in a KIDIALOG here; the zone is skipped either way.
    if (!poly.IsTriangulationUpToDate()) return false;

    for (const layer of this.m_board.GetEnabledLayers().CuStack()) {
      if (!layers.Contains(layer)) continue;

      for (let polyId = 0; polyId < poly.TriangulatedPolyCount(); polyId++) {
        const tri = poly.TriangulatedPolygon(polyId);

        for (let i = 0; i < tri.GetTriangleCount(); i++) {
          const a = { x: 0, y: 0 };
          const b = { x: 0, y: 0 };
          const c = { x: 0, y: 0 };
          tri.GetTriangle(i, a, b, c);

          const solid = new PnsSolid();

          solid.setLayer(this.GetPNSLayerFromBoardLayer(layer));
          solid.setNet(null);
          solid.setParent(aZone as unknown as PnsBoardItem);
          solid.setShape({ kind: 'poly', pts: [a, b, c], r: 0 });
          solid.setIsCompoundShapePrimitive();
          solid.setRoutable(false);

          aWorld.addSolid(solid);
        }
      }
    }

    return true;
  }

  /** `PNS_KICAD_IFACE_BASE::syncTextItem` (cpp:1954): text on copper, as one outline. */
  syncTextItem(aWorld: PnsNode, aItem: BOARD_ITEM, aLayer: PCB_LAYER_ID): boolean {
    if (!this.IsKicadCopperLayer(aLayer)) return false;

    if (aItem.Type() === KICAD_T.PCB_FIELD_T && !(aItem as PCB_FIELD).IsVisible()) return false;

    const cornerBuffer = new SHAPE_POLY_SET();

    aItem.TransformShapeToPolygon(
      cornerBuffer,
      aItem.GetLayer(),
      0,
      aItem.GetMaxError(),
      ERROR_LOC.ERROR_OUTSIDE,
    );

    cornerBuffer.Simplify();

    if (!cornerBuffer.OutlineCount()) return false;

    const solid = new PnsSolid();

    solid.setLayer(this.GetPNSLayerFromBoardLayer(aLayer));
    solid.setNet(null);
    solid.setParent(aItem as unknown as PnsBoardItem);
    solid.setShape(pnsPolyOf(cornerBuffer.Outline(0)));
    solid.setRoutable(false);

    aWorld.addSolid(solid);

    return true;
  }

  /** `PNS_KICAD_IFACE_BASE::syncDimension` (cpp:1989). */
  syncDimension(aWorld: PnsNode, aDimension: PCB_DIMENSION_BASE): boolean {
    if (!this.IsKicadCopperLayer(aDimension.GetLayer())) return false;

    const addPolysToWorld = (aPolys: SHAPE_POLY_SET): void => {
      for (let ii = 0; ii < aPolys.OutlineCount(); ++ii) {
        const solid = new PnsSolid();

        solid.setLayer(this.GetPNSLayerFromBoardLayer(aDimension.GetLayer()));
        solid.setNet(null);
        solid.setParent(aDimension as unknown as PnsBoardItem);
        solid.setShape(pnsPolyOf(aPolys.Outline(ii)));
        solid.setRoutable(false);

        aWorld.addSolid(solid);
      }
    };

    const cornerBuffer = new SHAPE_POLY_SET();

    aDimension.TransformShapeToPolygon(
      cornerBuffer,
      aDimension.GetLayer(),
      0,
      aDimension.GetMaxError(),
      ERROR_LOC.ERROR_OUTSIDE,
    );

    cornerBuffer.Simplify();

    if (cornerBuffer.OutlineCount()) addPolysToWorld(cornerBuffer);

    // Footprints can have hidden dimensions
    if (aDimension.IsVisible() && aDimension.GetText() !== '') {
      const textBuffer = new SHAPE_POLY_SET();

      PCB_TEXT.prototype.TransformShapeToPolygon.call(
        aDimension,
        textBuffer,
        aDimension.GetLayer(),
        0,
        aDimension.GetMaxError(),
        ERROR_LOC.ERROR_OUTSIDE,
      );

      textBuffer.Simplify();

      if (textBuffer.OutlineCount()) addPolysToWorld(textBuffer);
    }

    return cornerBuffer.OutlineCount() > 0 || aDimension.GetText() !== '';
  }

  /** `PNS_KICAD_IFACE_BASE::syncGraphicalItem` (cpp:2043). */
  syncGraphicalItem(aWorld: PnsNode, aItem: PCB_SHAPE): boolean {
    const layer = aItem.GetLayer();
    const isEdgeLayer = layer === PCB_LAYER_ID.Edge_Cuts || layer === PCB_LAYER_ID.Margin;

    if (!isEdgeLayer && !this.IsKicadCopperLayer(layer)) return false;

    const shapes = aItem.MakeEffectiveShapes();

    for (const shape of shapes) {
      const solid = new PnsSolid();

      if (isEdgeLayer) {
        solid.setLayers(new PnsLayerRange(0, this.m_board.GetCopperLayerCount() - 1));
        solid.setRoutable(false);
      } else {
        solid.setLayer(this.GetPNSLayerFromBoardLayer(layer));
        solid.setRoutable(aItem.Type() !== KICAD_T.PCB_TABLECELL_T);
      }

      if (layer === PCB_LAYER_ID.Edge_Cuts) {
        switch (shape.Type()) {
          case SHAPE_TYPE.SH_SEGMENT:
            (shape as SHAPE_SEGMENT).SetWidth(0);
            break;
          case SHAPE_TYPE.SH_ARC:
            (shape as SHAPE_ARC).SetWidth(0);
            break;
          case SHAPE_TYPE.SH_LINE_CHAIN:
            (shape as SHAPE_LINE_CHAIN).SetWidth(0);
            break;
          default: // remaining shapes don't have width
            break;
        }
      }

      const pnsShape = pnsShapeOf(shape);

      if (!pnsShape) continue;

      solid.setAnchorPoints(aItem.GetConnectionPoints());
      solid.setNet(aItem.GetNet());
      solid.setParent(aItem as unknown as PnsBoardItem);
      solid.setShape(pnsShape);

      if (shapes.length > 1) solid.setIsCompoundShapePrimitive();

      aWorld.addSolid(solid);
    }

    return true;
  }

  /** `PNS_KICAD_IFACE_BASE::syncBarcode` (cpp:2095). */
  syncBarcode(aWorld: PnsNode, aBarcode: PCB_BARCODE): boolean {
    if (!this.IsKicadCopperLayer(aBarcode.GetLayer())) return false;

    const cornerBuffer = new SHAPE_POLY_SET();

    aBarcode.GetBoundingHull(
      cornerBuffer,
      aBarcode.GetLayer(),
      0,
      aBarcode.GetMaxError(),
      ERROR_LOC.ERROR_OUTSIDE,
    );

    if (!cornerBuffer.OutlineCount()) return false;

    for (let ii = 0; ii < cornerBuffer.OutlineCount(); ++ii) {
      const solid = new PnsSolid();

      solid.setLayer(this.GetPNSLayerFromBoardLayer(aBarcode.GetLayer()));
      solid.setNet(null);
      solid.setParent(aBarcode as unknown as PnsBoardItem);
      solid.setShape(pnsPolyOf(cornerBuffer.Outline(ii)));
      solid.setRoutable(false);

      aWorld.addSolid(solid);
    }

    return true;
  }

  // ----- routability ---------------------------------------------------------

  /**
   * The `switch( parent->Type() )` at `pns_router.cpp:257-295`: why routing may
   * not start on an item, or null when it may.
   */
  startPointUnroutableReason(aItem: PnsItem): string | null {
    const parent = aItem.parent() as unknown as BOARD_ITEM | null;

    if (!parent) return null;

    switch (parent.Type()) {
      case KICAD_T.PCB_PAD_T:
        if ((parent as PAD).GetAttribute() === PAD_ATTRIB.NPTH)
          return 'Cannot start routing from a non-plated hole.';
        break;

      case KICAD_T.PCB_ZONE_T: {
        const zone = parent as ZONE;

        if (!zone.HasKeepoutParametersSet()) break;

        if (zone.GetZoneName() !== '') return `Rule area '${zone.GetZoneName()}' disallows tracks.`;

        return 'Rule area disallows tracks.';
      }

      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T:
      case KICAD_T.PCB_TEXTBOX_T:
        return 'Cannot start routing from a text item.';

      default:
        break;
    }

    return null;
  }

  // ----- sizes and the stackup -----------------------------------------------

  /**
   * `PNS_KICAD_IFACE_BASE::StackupHeight` (cpp:1330-1339).
   *
   *     if( !m_board || !bds.m_UseHeightForLengthCalcs )
   *         return 0;
   *     return stackup.GetLayerDistance( board layer a, board layer b );
   *
   * Both early returns are upstream's, so a board whose Constraints page leaves
   * "Include stackup height in track length calculations" unticked really does
   * answer 0 — that is the setting doing its job, not the port giving up.
   *
   * The stackup is the live `BOARD_STACKUP`, passed in with the design
   * settings the window hands it.
   */
  stackupHeight(aFirstLayer: number, aSecondLayer: number): number {
    const ds = this.mDeps.designSettings;

    // `if( !m_board || !m_board->GetDesignSettings().m_UseHeightForLengthCalcs )`
    if (!ds?.useHeightForLengthCalcs || !ds.stackup) return 0;

    return ds.stackup.GetLayerDistance(
      this.GetBoardLayerFromPNSLayer(aFirstLayer),
      this.GetBoardLayerFromPNSLayer(aSecondLayer),
    );
  }

  /**
   * `PNS_KICAD_IFACE_BASE::ImportSizes` (`pns_kicad_iface.cpp:1098-1301`), the
   * one call that turns Board Setup into the numbers the router places copper
   * with. `ROUTER_TOOL` makes it before `StartRouting` and again on a size
   * change; `ROUTER` never does.
   *
   * The shape of it is the same three times over — track width, via, diff pair
   * — and it is worth stating once:
   *
   *  1. seed from the board's own MINIMUM (`m_TrackMinWidth`, `m_ViasMinSize`,
   *     `m_MinThroughDrill`, `m_MinClearance`);
   *  2. if the user is on "use netclass" for that dimension AND there is a
   *     start item to evaluate against, ask the rule engine and take
   *     `std::max( minimum, constraint.Opt() )`;
   *  3. otherwise take `GetCurrent…()`, which is the toolbar's preset, the
   *     custom value, or the netclass default — and STILL clamp it up to the
   *     board minimum for the track width, but NOT for the via, where upstream
   *     assigns `GetCurrentViaSize()` outright.
   *
   * That last asymmetry is upstream's and is kept.
   *
   * Absent by design: `SetClearance`, `SetClearanceSource` and the four
   * `Set…Source` strings. `SIZES_SETTINGS` carries them and `ROUTER_TOOL`'s
   * status bar reads them; {@link PnsRouterSizes} is the reduced shape `ROUTER`
   * itself reads, and a field nothing reads is a field nothing can pin. They
   * belong with the tool that displays them.
   *
   * Returns false with no design settings, which is upstream's `if( !m_board )`
   * early-out: the caller's sizes are left as they were.
   */
  /**
   * `PNS_KICAD_IFACE_BASE::inheritTrackWidth` (pns_kicad_iface.cpp:982-1096):
   * the width of the track a route starts on — the start item's own, or for a
   * via or pad the connected track whose far end is nearest the cursor, else
   * the narrowest connected one on the start layer, else on any layer. Null
   * is upstream's `return false`.
   */
  private inheritTrackWidth(aItem: PnsItem, aStartPosition: Vec2): number | null {
    let p: Vec2;

    // assert( aItem->Owner() != nullptr )

    const tryGetTrackWidth = (aPnsItem: PnsItem): number => {
      switch (aPnsItem.kind()) {
        case PnsKind.SEGMENT_T:
        case PnsKind.ARC_T:
          return (aPnsItem as PnsLinkedItem).width();
        default:
          return -1;
      }
    };

    const itemTrackWidth = tryGetTrackWidth(aItem);

    if (itemTrackWidth > 0) return itemTrackWidth;

    switch (aItem.kind()) {
      case PnsKind.VIA_T:
        p = (aItem as PnsVia).pos();
        break;
      case PnsKind.SOLID_T:
        p = (aItem as PnsSolid).pos();
        break;
      default:
        return null;
    }

    const jt = (aItem.owner() as PnsNode).findJointForItem(p, aItem);

    // assert( jt != nullptr )
    if (!jt) return null;

    const linkedSegs = jt
      .links()
      .clone()
      .excludeItem(aItem)
      .filterKinds(PnsKind.SEGMENT_T | PnsKind.ARC_T);

    if (linkedSegs.empty()) return null;

    const sq = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

    // When a start position is provided, find the connected track whose far end is closest to
    // the cursor. Since all tracks share the pad/via endpoint, the far-end direction is a proxy
    // for which exit stub the user is pointing at.
    if (aStartPosition.x !== 0 || aStartPosition.y !== 0) {
      let closestItem: PnsItem | null = null;
      let minDist = Number.MAX_VALUE;

      for (const item of linkedSegs.items()) {
        if (item.layer() !== this.m_startLayer) continue;

        const anchor0 = item.anchor(0);
        const anchor1 = item.anchor(1);

        // The "other end" is the anchor farther from the pad/via center
        const otherEnd = sq(anchor0, p) > sq(anchor1, p) ? anchor0 : anchor1;

        const dist = sq(otherEnd, aStartPosition);

        if (dist < minDist) {
          minDist = dist;
          closestItem = item;
        }
      }

      if (closestItem) {
        const w = tryGetTrackWidth(closestItem);

        if (w > 0) return w;
      }
    }

    // Fallback to minimum width when no start position provided or no valid exit stub found
    let min_current_layer = Number.MAX_SAFE_INTEGER;
    let min_all_layers = Number.MAX_SAFE_INTEGER;

    for (const item of linkedSegs.items()) {
      const w = tryGetTrackWidth(item);

      if (w > 0) {
        min_all_layers = Math.min(w, min_all_layers);

        if (item.layer() === this.m_startLayer) min_current_layer = Math.min(w, min_current_layer);
      }
    }

    if (min_all_layers === Number.MAX_SAFE_INTEGER) return null;

    if (min_current_layer < Number.MAX_SAFE_INTEGER) return min_current_layer;

    return min_all_layers;
  }

  /** Whether {@link PNS_KICAD_IFACE.importSizes} has a BOARD_DESIGN_SETTINGS to read. */
  get importSizesEnabled(): boolean {
    return this.mDeps.designSettings != null;
  }

  importSizes(
    aSizes: PnsRouterSizes,
    aStartItem: PnsItem | null,
    _aNet: NetHandle,
    aStartPosition: Vec2,
  ): boolean {
    const ds = this.mDeps.designSettings;

    if (!ds) return false;

    const resolver = this.mRuleResolver;

    aSizes.minClearance = ds.minClearance;
    aSizes.clearance = ds.minClearance;
    aSizes.clearanceSource = 'board minimum clearance';

    // `startAnchor`: which end of a segment the pointer is nearer, so the dummy
    // track below sits where the user actually started.
    let startAnchor = 0;
    // `VECTOR2I startPosInt( aStartPosition.x, aStartPosition.y )` (cpp:1112):
    // the int constructor, so the doubles truncate.
    const startPosInt: Vec2 = { x: Math.trunc(aStartPosition.x), y: Math.trunc(aStartPosition.y) };

    if (aStartItem && aStartItem.kind() === PnsKind.SEGMENT_T) {
      const d0 = Distance(startPosInt, aStartItem.anchor(0));
      const d1 = Distance(startPosInt, aStartItem.anchor(1));

      if (d1 < d0) startAnchor = 1;
    }

    // `if( aStartItem && m_startLayer < 0 ) m_startLayer = aStartItem->Layer();`
    // (cpp:1104). Every read below is behind an `aStartItem` test, so the -1 of
    // an unset layer never reaches the rule engine.
    if (aStartItem && this.m_startLayer < 0) this.m_startLayer = aStartItem.layer();

    const startLayer = this.m_startLayer;

    /** `PNS::SEGMENT dummyTrack` on the start anchor, for the rule engine. */
    const dummyTrack = (aNet: NetHandle, aAnchor = startAnchor): PnsSegment => {
      const p = aStartItem ? aStartItem.anchor(aAnchor) : { x: 0, y: 0 };
      const seg = new PnsSegment({ a: p, b: p }, aNet);
      seg.setLayer(startLayer);
      return seg;
    };

    const optOf = (
      aType: PnsConstraintType,
      aA: PnsItem,
      aB: PnsItem | null,
      aLayer: number,
    ): number | null => {
      const c = resolver?.queryConstraint(aType, aA, aB, aLayer) ?? null;
      return c?.value.opt ?? null;
    };

    // ----- track width -----------------------------------------------------
    let trackWidth = ds.trackMinWidth;
    let found = false;

    aSizes.widthSource = 'board minimum track width';

    // `if( bds.m_UseConnectedTrackWidth && !bds.m_TempOverrideTrackWidth && aStartItem )`
    if (ds.useConnectedTrackWidth && !ds.tempOverrideTrackWidth && aStartItem) {
      const inherited = this.inheritTrackWidth(aStartItem, startPosInt);

      if (inherited !== null) {
        trackWidth = inherited;
        found = true;
        aSizes.widthSource = 'existing track';
      }
    }

    if (!found && ds.sizes.UseNetClassTrack() && aStartItem) {
      const c = resolver?.queryConstraint(
        PnsConstraintType.CT_WIDTH,
        dummyTrack(aStartItem.net()),
        null,
        startLayer,
      );

      if (c?.value.opt !== undefined) {
        trackWidth = Math.max(trackWidth, c.value.opt);
        found = true;

        // `if( trackWidth == constraint.m_Value.Opt() )` — the rule only gets
        // the credit when it actually won the max.
        if (trackWidth === c.value.opt) aSizes.widthSource = c.ruleName;
      }
    }

    if (!found) {
      const current = ds.sizes.GetCurrentTrackWidth();
      trackWidth = Math.max(trackWidth, current);

      if (ds.sizes.UseNetClassTrack()) aSizes.widthSource = "netclass 'Default'";
      else if (trackWidth === current) aSizes.widthSource = 'user choice';
    }

    aSizes.trackWidth = trackWidth;
    aSizes.boardMinTrackWidth = ds.trackMinWidth;
    aSizes.trackWidthIsExplicit = !ds.useConnectedTrackWidth || ds.tempOverrideTrackWidth;

    // ----- via -------------------------------------------------------------
    let viaDiameter = ds.viasMinSize;
    let viaDrill = ds.minThroughDrill;

    const dummyVia = (): PnsVia => {
      const via = new PnsVia();
      if (aStartItem) via.setNet(aStartItem.net());
      return via;
    };
    const coupledVia = (): PnsVia => {
      const via = new PnsVia();
      if (aStartItem) via.setNet(resolver?.dpCoupledNet(aStartItem.net()) ?? null);
      return via;
    };

    if (ds.sizes.UseNetClassVia() && aStartItem) {
      const dia = optOf(PnsConstraintType.CT_VIA_DIAMETER, dummyVia(), null, startLayer);
      if (dia !== null) viaDiameter = Math.max(viaDiameter, dia);

      const hole = optOf(PnsConstraintType.CT_VIA_HOLE, dummyVia(), null, startLayer);
      if (hole !== null) viaDrill = Math.max(viaDrill, hole);
    } else {
      // Not `std::max` — upstream assigns, so a preset SMALLER than the board
      // minimum reaches the router and DRC is what complains about it.
      viaDiameter = ds.sizes.GetCurrentViaSize();
      viaDrill = ds.sizes.GetCurrentViaDrill();
    }

    aSizes.viaDiameter = viaDiameter;
    aSizes.viaDrill = viaDrill;

    // ----- differential pair ------------------------------------------------
    let diffPairWidth = ds.trackMinWidth;
    let diffPairGap = ds.minClearance;
    let diffPairViaGap = ds.minClearance;

    aSizes.diffPairWidthSource = 'board minimum track width';
    aSizes.diffPairGapSource = 'board minimum clearance';

    found = false;

    // The width inherits from the starting track under the SAME flag as above,
    // but WITHOUT the `m_TempOverrideTrackWidth` half of the test.
    if (ds.useConnectedTrackWidth && aStartItem) {
      const inherited = this.inheritTrackWidth(aStartItem, startPosInt);

      if (inherited !== null) {
        diffPairWidth = inherited;
        found = true;
      }
    }

    if (ds.sizes.UseNetClassDiffPair() && aStartItem) {
      const net = aStartItem.net();
      const coupled = resolver?.dpCoupledNet(net) ?? null;
      const a = dummyTrack(net, 0);
      const b = dummyTrack(coupled, 0);

      if (!found) {
        const c = resolver?.queryConstraint(PnsConstraintType.CT_WIDTH, a, b, startLayer);

        if (c?.value.opt !== undefined) {
          diffPairWidth = Math.max(diffPairWidth, c.value.opt);
          if (diffPairWidth === c.value.opt) aSizes.diffPairWidthSource = c.ruleName;
        }
      }

      const gap = resolver?.queryConstraint(PnsConstraintType.CT_DIFF_PAIR_GAP, a, b, startLayer);

      if (gap?.value.opt !== undefined) {
        diffPairGap = Math.max(diffPairGap, gap.value.opt);
        diffPairViaGap = Math.max(diffPairViaGap, gap.value.opt);
        if (diffPairGap === gap.value.opt) aSizes.diffPairGapSource = gap.ruleName;
      }
    } else {
      diffPairWidth = ds.sizes.GetCurrentDiffPairWidth();
      diffPairGap = ds.sizes.GetCurrentDiffPairGap();
      diffPairViaGap = ds.sizes.GetCurrentDiffPairViaGap();

      aSizes.diffPairWidthSource = 'user choice';
      aSizes.diffPairGapSource = 'user choice';
    }

    aSizes.diffPairWidth = diffPairWidth;
    aSizes.diffPairGap = diffPairGap;
    aSizes.diffPairViaGap = diffPairViaGap;
    aSizes.diffPairViaGapSameAsTraceGap = false;

    // ----- hole to hole -----------------------------------------------------
    // `SetHoleToHole` then `SetDiffPairHoleToHole( max( holeToHoleMin, … ) )`.
    // The second query is the same type against the COUPLED via, so a rule
    // written for the pair can widen it past the single-via answer.
    let holeToHole = ds.holeToHoleMin;
    const single = resolver?.queryConstraint(
      PnsConstraintType.CT_HOLE_TO_HOLE,
      dummyVia(),
      dummyVia(),
      PNS_UNDEFINED_LAYER,
    );

    if (single?.value.min !== undefined) holeToHole = single.value.min;

    aSizes.holeToHole = holeToHole;

    const pairHoleToHole = holeToHole;
    const coupled = resolver?.queryConstraint(
      PnsConstraintType.CT_HOLE_TO_HOLE,
      dummyVia(),
      coupledVia(),
      PNS_UNDEFINED_LAYER,
    );

    aSizes.diffPairHoleToHole = Math.max(coupled?.value.min ?? pairHoleToHole, pairHoleToHole);

    return true;
  }

  // ----- length and delay ----------------------------------------------------

  /**
   * `CalculateRoutedPathLength` (cpp:3171-3193), reduced to geometry.
   *
   * Upstream hands the items to `LENGTH_DELAY_CALCULATION` with
   * `InferViaInPad` on and the pad-to-die lengths of the two end pads folded
   * in. That class is not ported. What is portable — and what dominates the
   * answer — is the sum of the segment and arc lengths plus the two pad-to-die
   * stubs, so that is what this returns. It does **not** include via stackup
   * height (see {@link stackupHeight}) or the in-pad path optimisations.
   */
  calculateRoutedPathLength(
    aLine: PnsItemSet,
    aStartPad: PnsSolid | null,
    aEndPad: PnsSolid | null,
    _aNetClass: string | null,
  ): number {
    let length = 0;

    for (const item of aLine.citems()) {
      if (item.kind() === PnsKind.SEGMENT_T) {
        const seg = (item as PnsSegment).seg();
        length += Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
      } else if (item.kind() === PnsKind.ARC_T) {
        const a = (item as PnsArc).cArc();
        const g = arcShape(a.p0, a.arcMid, a.p1, a.width);

        length +=
          g.kind === 'arc'
            ? Math.abs(g.sweep) * g.rad
            : Math.hypot(a.p1.x - a.p0.x, a.p1.y - a.p0.y);
      }
    }

    length += aStartPad?.getPadToDie() ?? 0;
    length += aEndPad?.getPadToDie() ?? 0;

    return length;
  }

  /**
   * `CalculateRoutedPathDelay` — **not implemented**, returns 0.
   *
   * Propagation delay needs `LENGTH_DELAY_CALCULATION`'s per-layer velocity
   * table, which needs the `BOARD_STACKUP` dielectric constants this tree does
   * not model. Every caller is a length tuner, which is out of scope for the
   * board bridge; a wrong number here would be worse than none.
   */
  calculateRoutedPathDelay(
    _aLine: PnsItemSet,
    _aStartPad: PnsSolid | null,
    _aEndPad: PnsSolid | null,
    _aNetClass: string | null,
  ): number {
    return 0;
  }

  /** `CalculateLengthForDelay` — not implemented; see {@link calculateRoutedPathDelay}. */
  calculateLengthForDelay(
    _aDelay: number,
    _aWidth: number,
    _aIsDiffPair: boolean,
    _aDiffPairGap: number,
    _aLayer: number,
    _aNetClass: string | null,
  ): number {
    return 0;
  }

  /** `CalculateDelayForShapeLineChain` — not implemented; see above. */
  calculateDelayForShapeLineChain(
    _aShape: PnsLineChain,
    _aWidth: number,
    _aIsDiffPair: boolean,
    _aDiffPairGap: number,
    _aLayer: number,
    _aNetClass: string | null,
  ): number {
    return 0;
  }

  /**
   * `GetSignalAggregate` (cpp:3070-3105) — **not implemented**, returns null.
   *
   * Upstream walks `NETINFO_ITEM::GetNetChain()`, the "signal" a net belongs to
   * across series components. `Board.nets` is a code→name map with no chain, so
   * there is nothing to walk. Null is upstream's `return false`.
   */
  getSignalAggregate(
    _aFirst: NetHandle,
    _aSecond: NetHandle,
  ): { length: number; delay: number } | null {
    return null;
  }

  /** `GetNetBoardLength` — not implemented; needs the same length calculator. */
  getNetBoardLength(_aNet: NetHandle): number {
    return 0;
  }

  // ----- the board mutations ---------------------------------------------------

  /** `PNS_KICAD_IFACE::RemoveItem` (cpp:2620). */
  removeItem(aItem: PnsItem): void {
    const parent = aItem.parent() as unknown as BOARD_ITEM | null;

    if (aItem.ofKind(PnsKind.SOLID_T) && parent?.Type() === KICAD_T.PCB_PAD_T) {
      const pad = parent as PAD;
      const pos = (aItem as PnsSolid).pos();

      this.fpOffset(pad).p_old = { ...pos };
      return;
    }

    if (parent && this.m_commit) {
      const group = parent.GetParentGroup();

      if (group) this.m_itemGroups.set(parent, group);

      this.m_commit.Remove(parent);
    }
  }

  /** `PNS_KICAD_IFACE::UpdateItem` (cpp:2747): `modifyBoardItem`. */
  updateItem(aItem: PnsItem): void {
    this.modifyBoardItem(aItem);
  }

  /** `PNS_KICAD_IFACE::modifyBoardItem` (cpp:2648). */
  private modifyBoardItem(aItem: PnsItem): void {
    const boardItem = aItem.parent() as unknown as BOARD_ITEM | null;
    const commit = this.m_commit;

    if (!commit || !boardItem) return;

    switch (aItem.kind()) {
      case PnsKind.ARC_T: {
        const arc = aItem as PnsArc;
        const arcBoard = boardItem as PCB_ARC;
        const a = arc.cArc();

        commit.Modify(arcBoard);

        arcBoard.SetStart({ ...a.p0 });
        arcBoard.SetEnd({ ...a.p1 });
        arcBoard.SetMid({ ...a.arcMid });
        arcBoard.SetWidth(arc.width());
        break;
      }

      case PnsKind.SEGMENT_T: {
        const seg = aItem as PnsSegment;
        const track = boardItem as PCB_TRACK;
        const s = seg.seg();

        commit.Modify(track);

        track.SetStart({ x: s.a.x, y: s.a.y });
        track.SetEnd({ x: s.b.x, y: s.b.y });
        track.SetWidth(seg.width());
        break;
      }

      case PnsKind.VIA_T: {
        const viaBoard = boardItem as PCB_VIA;

        commit.Modify(viaBoard);
        this.writeVia(viaBoard, aItem as PnsVia, (aItem as PnsVia).net() as NETINFO_ITEM | null);
        break;
      }

      case PnsKind.SOLID_T: {
        if (boardItem.Type() === KICAD_T.PCB_PAD_T) {
          const pad = boardItem as PAD;
          const pos = (aItem as PnsSolid).pos();

          // Don't add to commit; we'll add the parent footprints when processing the m_fpOffsets
          const offset = this.fpOffset(pad);
          offset.p_old = { ...pad.GetPosition() };
          offset.p_new = { ...pos };
        }

        break;
      }

      default:
        commit.Modify(boardItem);
        break;
    }
  }

  /** The via fields `modifyBoardItem` and `createBoardItem` both write from a PNS::VIA. */
  private writeVia(aViaBoard: PCB_VIA, aVia: PnsVia, aNet: NETINFO_ITEM | null): void {
    aViaBoard.SetPosition({ x: aVia.pos().x, y: aVia.pos().y });
    aViaBoard.SetWidth(PADSTACK.ALL_LAYERS, aVia.diameter(0));
    aViaBoard.SetDrill(aVia.drill());
    aViaBoard.SetNet(aNet);
    aViaBoard.SetViaType(aVia.viaType()); // MUST be before SetLayerPair()
    aViaBoard.Padstack().SetUnconnectedLayerMode(aVia.unconnectedLayerMode());
    aViaBoard.SetIsFree(aVia.isFree());
    aViaBoard.SetLayerPair(
      this.GetBoardLayerFromPNSLayer(aVia.layers().start()),
      this.GetBoardLayerFromPNSLayer(aVia.layers().end()),
    );

    const holeLayers = aVia.holeLayers();

    if (holeLayers.start() >= 0 && holeLayers.end() >= 0) {
      aViaBoard.SetPrimaryDrillStartLayer(this.GetBoardLayerFromPNSLayer(holeLayers.start()));
      aViaBoard.SetPrimaryDrillEndLayer(this.GetBoardLayerFromPNSLayer(holeLayers.end()));
    }

    aViaBoard.SetSecondaryDrillSize(aVia.secondaryDrill() ?? undefined);

    const secondaryLayers = aVia.secondaryHoleLayers();

    if (secondaryLayers) {
      aViaBoard.SetSecondaryDrillStartLayer(
        this.GetBoardLayerFromPNSLayer(secondaryLayers.start()),
      );
      aViaBoard.SetSecondaryDrillEndLayer(this.GetBoardLayerFromPNSLayer(secondaryLayers.end()));
    } else {
      aViaBoard.SetSecondaryDrillStartLayer(PCB_LAYER_ID.UNDEFINED_LAYER);
      aViaBoard.SetSecondaryDrillEndLayer(PCB_LAYER_ID.UNDEFINED_LAYER);
    }
  }

  /** `PNS_KICAD_IFACE::createBoardItem` (cpp:2758). */
  private createBoardItem(aItem: PnsItem): BOARD_CONNECTED_ITEM | null {
    let newBoardItem: BOARD_CONNECTED_ITEM | null = null;
    let net = aItem.net() as NETINFO_ITEM | null;

    if (!net) net = NETINFO_LIST.OrphanedItem();

    const source = aItem.getSourceItem() as unknown as BOARD_ITEM | null;

    switch (aItem.kind()) {
      case PnsKind.ARC_T: {
        const arc = aItem as PnsArc;
        const a = arc.cArc();
        const newArc = new PCB_ARC(this.m_board);
        newArc.SetStart({ ...a.p0 });
        newArc.SetMid({ ...a.arcMid });
        newArc.SetEnd({ ...a.p1 });
        newArc.SetWidth(arc.width());
        newArc.SetLayer(this.GetBoardLayerFromPNSLayer(arc.layers().start()));
        newArc.SetNet(net);

        if (source?.IsType([KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T])) {
          const sourceTrack = source as PCB_TRACK;
          newArc.SetHasSolderMask(sourceTrack.HasSolderMask());
          newArc.SetLocalSolderMaskMargin(sourceTrack.GetLocalSolderMaskMargin());
        }

        newBoardItem = newArc;
        break;
      }

      case PnsKind.SEGMENT_T: {
        const seg = aItem as PnsSegment;
        const track = new PCB_TRACK(this.m_board);
        const s = seg.seg();
        track.SetStart({ x: s.a.x, y: s.a.y });
        track.SetEnd({ x: s.b.x, y: s.b.y });
        track.SetWidth(seg.width());
        track.SetLayer(this.GetBoardLayerFromPNSLayer(seg.layers().start()));
        track.SetNet(net);

        if (source?.IsType([KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T])) {
          const sourceTrack = source as PCB_TRACK;
          track.SetHasSolderMask(sourceTrack.HasSolderMask());
          track.SetLocalSolderMaskMargin(sourceTrack.GetLocalSolderMaskMargin());
        }

        newBoardItem = track;
        break;
      }

      case PnsKind.VIA_T: {
        const viaBoard = new PCB_VIA(this.m_board);
        this.writeVia(viaBoard, aItem as PnsVia, net);

        if (source?.Type() === KICAD_T.PCB_VIA_T) {
          const sourceVia = source as PCB_VIA;
          viaBoard.SetFrontTentingMode(sourceVia.GetFrontTentingMode());
          viaBoard.SetBackTentingMode(sourceVia.GetBackTentingMode());
        }

        newBoardItem = viaBoard;
        break;
      }

      case PnsKind.SOLID_T: {
        const pad = aItem.parent() as unknown as PAD;
        const pos = (aItem as PnsSolid).pos();

        this.fpOffset(pad).p_new = { ...pos };
        return null;
      }

      default:
        return null;
    }

    if (net.GetNetCode() <= 0) {
      const newNetInfo = newBoardItem.GetNet();

      if (newNetInfo) {
        newNetInfo.SetParent(this.m_board);
        newNetInfo.SetNetClass(this.m_board.GetDesignSettings().m_NetSettings.GetDefaultNetclass());
      }
    }

    if (aItem.isLocked()) newBoardItem.SetLocked(true);

    if (source) {
      if (this.m_itemGroups.has(source)) this.replacements(source).push(newBoardItem);
    } else {
      // This is a new item, which goes in the entered group (if any)
      this.replacements(ENTERED_GROUP).push(newBoardItem);
    }

    return newBoardItem;
  }

  /** `PNS_KICAD_IFACE::AddItem` (cpp:2898). */
  addItem(aItem: PnsItem): void {
    const boardItem = this.createBoardItem(aItem);

    if (boardItem) {
      aItem.setParent(boardItem as unknown as PnsBoardItem);
      boardItem.ClearFlags();

      this.m_commit?.Add(boardItem);
    }
  }

  /** `PNS_KICAD_IFACE::Commit` (cpp:2912). */
  commit(): void {
    const commit = this.m_commit;

    this.eraseView();

    if (!commit) {
      this.m_fpOffsets.clear();
      this.m_itemGroups.clear();
      this.m_replacementMap.clear();
      return;
    }

    const processedFootprints = new Set<FOOTPRINT>();

    for (const [pad, fpOffset] of this.m_fpOffsets) {
      const footprint = pad.GetParentFootprint();

      if (!footprint || !fpOffset.p_new || !fpOffset.p_old) continue;

      const offset = {
        x: fpOffset.p_new.x - fpOffset.p_old.x,
        y: fpOffset.p_new.y - fpOffset.p_old.y,
      };
      const pOrig = footprint.GetPosition();
      const pNew = { x: pOrig.x + offset.x, y: pOrig.y + offset.y };

      if (processedFootprints.has(footprint)) continue;

      processedFootprints.add(footprint);
      commit.Modify(footprint);
      footprint.SetPosition(pNew);
    }

    this.m_fpOffsets.clear();

    for (const [src, items] of this.m_replacementMap) {
      let group: EDA_GROUP | null = null;

      if (src === ENTERED_GROUP) group = this.mDeps.enteredGroup?.() ?? null;
      else group = this.m_itemGroups.get(src) ?? null;

      if (group) {
        commit.Modify(group.AsEdaItem(), null, RECURSE_MODE.NO_RECURSE);

        for (const bi of items) group.AddItem(bi);
      }
    }

    this.m_itemGroups.clear();
    this.m_replacementMap.clear();

    if (!commit.Empty()) this.m_pushedCommits++;

    commit.Push('Routing', this.m_commitFlags | SKIP_ENTERED_GROUP);
    this.m_commit = new BOARD_COMMIT(this.mDeps.commitHost as PCB_BASE_FRAME);
  }

  /** How many non-empty commits this interface has pushed. */
  pushedCommits(): number {
    return this.m_pushedCommits;
  }

  private m_pushedCommits = 0;

  private fpOffset(aPad: PAD): { p_old?: Vec2; p_new?: Vec2 } {
    let offset = this.m_fpOffsets.get(aPad);

    if (!offset) {
      offset = {};
      this.m_fpOffsets.set(aPad, offset);
    }

    return offset;
  }

  private replacements(aKey: BOARD_ITEM | typeof ENTERED_GROUP): BOARD_ITEM[] {
    let list = this.m_replacementMap.get(aKey);

    if (!list) {
      list = [];
      this.m_replacementMap.set(aKey, list);
    }

    return list;
  }

  // ----- the view, which does not exist here ---------------------------------

  /**
   * `PNS_KICAD_IFACE::DisplayItem` (cpp:2475): a `ROUTER_PREVIEW_ITEM` in the
   * preview group, clearance shown as `m_TrackClearance` says.
   */
  displayItem(aItem: PnsItem, aClearance: number, aEdit = false, aFlags = 0): void {
    const view = this.mView;
    const group = this.mPreviewItems;

    if (!view || !group) return;

    if (aItem.isVirtual()) return;

    // A rule area is a semi-solid: sketched, not filled, until it collides.
    if ((aItem.parent() as { ruleArea?: unknown } | null)?.ruleArea !== undefined)
      aFlags |= PNS_SEMI_SOLID;

    const pitem = new ROUTER_PREVIEW_ITEM(aItem, this, view, aFlags);

    // Note: SEGMENT_T is used for placed tracks; LINE_T is used for the routing head
    const kind = aItem.kind();
    const tracks = kind === PnsKind.SEGMENT_T || kind === PnsKind.ARC_T || kind === PnsKind.LINE_T;
    const tracksOrVias = tracks || kind === PnsKind.VIA_T;

    if (aClearance >= 0) {
      pitem.SetClearance(aClearance);

      switch (this.mDeps.trackClearanceMode?.() ?? SHOW_WITH_VIA_ALWAYS) {
        case SHOW_WITH_VIA_ALWAYS:
        case SHOW_WITH_VIA_WHILE_ROUTING_OR_DRAGGING:
          pitem.ShowClearance(tracksOrVias);
          break;

        case SHOW_WITH_VIA_WHILE_ROUTING:
          pitem.ShowClearance(tracksOrVias && !aEdit);
          break;

        case SHOW_WHILE_ROUTING:
          pitem.ShowClearance(tracks && !aEdit);
          break;

        default:
          pitem.ShowClearance(false);
          break;
      }
    }

    group.Add(pitem);
    view.Update(group);
  }

  /** `DisplayPathLine` — pure view. Not ported. */
  displayPathLine(_aLine: PnsLineChain, _aImportance: number): void {
    // Intentionally empty: pure view.
  }

  /** `DisplayRatline` — pure view. Not ported. */
  displayRatline(_aRatline: PnsLineChain, _aNet: NetHandle): void {
    // Intentionally empty: pure view.
  }

  /**
   * `HideItem` (cpp:2589): the board item behind `aItem` is hidden in the view
   * while the shove shows its replacement; `EraseView` shows it again.
   */
  hideItem(aItem: PnsItem): void {
    const view = this.mView;

    if (!view) return;

    const parent = (aItem.parent() as { k?: VIEW_ITEM } | null)?.k;

    if (parent && view.HasItem(parent)) {
      if (view.IsVisible(parent)) this.mHiddenItems.add(parent);

      view.SetVisible(parent, false);
    }
  }

  /** `EraseView` (cpp:2451). */
  eraseView(): void {
    const view = this.mView;

    if (view) {
      for (const item of this.mHiddenItems) view.SetVisible(item, true);
      this.mHiddenItems.clear();

      if (this.mPreviewItems) {
        this.mPreviewItems.FreeItems();
        view.Update(this.mPreviewItems);
      }
    }
  }
}

// ============================================================================
// Folded in from pns_rule_resolver.ts (the KiCad file that holds this code is this one; see STRUCTURE.md).
// ============================================================================
/**
 * The router's design-rule oracle, over this repo's DRC rules engine.
 * Counterpart: `PNS_PCBNEW_RULE_RESOLVER` (`pcbnew/router/pns_kicad_iface.cpp`,
 * `:92-330` for the cache keys, `:349-535` for the board predicates, `:537-790`
 * for `QueryConstraint`, `:792-981` for the caches and `Clearance`).
 *
 * `NODE::GetClearance` is three lines and delegates everything to this. So this
 * is where a routed track's actual clearance comes from, and where the router
 * stops being a geometry library and starts being a DRC client.
 *
 * ## It is a client of `drc_rules_engine.ts`, not a second rules engine
 *
 * Every number below arrives through `evalDrcRules`, the same call DRC itself
 * makes, so a clearance the router honours and a clearance DRC flags cannot
 * disagree. That is the whole reason for wiring it this way rather than
 * re-deriving clearances from netclasses: a router that keeps a *different*
 * clearance from the checker produces boards that pass routing and fail DRC,
 * which is the worst of both.
 *
 * ## Three caches, and why they are not one
 *
 * - **The clearance cache** is keyed on the two items' *identities*. It is for
 *   real board items, which live as long as the routing session.
 * - **The temporary clearance cache** is keyed on the two items'
 *   *properties* — board item, net, layer span, kind, free-pad flag — because
 *   the router manufactures throwaway items constantly and they would otherwise
 *   miss the cache every time. Upstream's comment: *"Items with the same
 *   properties get the same clearance from the rules, so they share one cache
 *   entry."* This is the mechanism that makes the scratch-segment reuse in
 *   `NODE::NearestObstacle` cheap as well as deduplicating.
 * - **The hull cache** is keyed on `(item, clearance, walkaroundThickness,
 *   layer)` and holds geometry, not numbers.
 *
 * They are cleared on different schedules — `ClearTemporaryCaches` drops only
 * the middle one, `ClearCacheForItems` only touches the first and third — and
 * merging any two of them changes when a stale answer can be returned.
 *
 * ## Where upstream sorts pointers, this sorts ordinals
 *
 * `CLEARANCE_CACHE_KEY` stores `(min(A,B), max(A,B))` *by address*, purely so
 * that `Clearance(a, b)` and `Clearance(b, a)` hit the same entry. Addresses do
 * not exist here, so each item is given a stable ordinal on first sight and the
 * ordinals are sorted instead. The property that matters — symmetry — is
 * preserved exactly; the property that does not — which of two unrelated pairs
 * hashes first — was never meaningful.
 */

/**
 * `PCBNEW_LAYER_ID_START` and `PCB_LAYER_ID_COUNT - 1` (`include/layer_ids.h:167,170`).
 *
 * Note what upstream does with these: it intersects a **PNS** layer range with
 * a range built from **board** layer ids. The two numbering schemes are not the
 * same thing — `ROUTER_IFACE` exists to convert between them — so this is a
 * namespace confusion in the source. Its only real effect is to clamp away the
 * `-1`s, which is what the comment beside it (*"Normalize layer range (no -1
 * magic numbers)"*) says it is for, so it is ported literally rather than
 * corrected into a copper-layer count this port would have to invent.
 */
const LAYER_ID_START = 0;
const LAYER_ID_END = 127;

/** `CONSTRAINT_TYPE` -> `DRC_CONSTRAINT_T` (`QueryConstraint`'s switch). */
const HOST_TYPE: Partial<Record<PnsConstraintType, DRC_CONSTRAINT_T>> = {
  [PnsConstraintType.CT_CLEARANCE]: DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT,
  [PnsConstraintType.CT_WIDTH]: DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT,
  [PnsConstraintType.CT_DIFF_PAIR_GAP]: DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT,
  [PnsConstraintType.CT_LENGTH]: DRC_CONSTRAINT_T.LENGTH_CONSTRAINT,
  [PnsConstraintType.CT_DIFF_PAIR_SKEW]: DRC_CONSTRAINT_T.SKEW_CONSTRAINT,
  [PnsConstraintType.CT_MAX_UNCOUPLED]: DRC_CONSTRAINT_T.MAX_UNCOUPLED_CONSTRAINT,
  [PnsConstraintType.CT_VIA_DIAMETER]: DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT,
  [PnsConstraintType.CT_VIA_HOLE]: DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT,
  [PnsConstraintType.CT_HOLE_CLEARANCE]: DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT,
  [PnsConstraintType.CT_EDGE_CLEARANCE]: DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT,
  [PnsConstraintType.CT_HOLE_TO_HOLE]: DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT,
  [PnsConstraintType.CT_PHYSICAL_CLEARANCE]: DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
  [PnsConstraintType.CT_PHYSICAL_HOLE_CLEARANCE]:
    DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
};

/** The BOARD_ITEM behind a router item (`ITEM::BoardItem()`). */
const boardItemOf = (aItem: PnsItem | null): BOARD_ITEM | null =>
  (aItem?.boardItem() as unknown as BOARD_ITEM | null) ?? null;

/** `ITEM::Parent()`. */
const parentOf = (aItem: PnsItem | null): BOARD_ITEM | null =>
  (aItem?.parent() as unknown as BOARD_ITEM | null) ?? null;

/** `isCopper`: `!parent || parent->IsOnCopperLayer()`. */
function isCopper(aItem: PnsItem | null): boolean {
  if (!aItem) return false;

  const parent = parentOf(aItem);

  return !parent || parent.IsOnCopperLayer();
}

/** `isEdge`: a PCB_SHAPE on Edge.Cuts or Margin. */
function isEdge(aItem: PnsItem | null): boolean {
  if (!aItem) return false;

  const parent = boardItemOf(aItem);

  return (
    parent instanceof PCB_SHAPE &&
    (parent.IsOnLayer(PCB_LAYER_ID.Edge_Cuts) || parent.IsOnLayer(PCB_LAYER_ID.Margin))
  );
}

/** A MINOPTMAX as the engine's plain value. */
function minOptMaxOf(aValue: MINOPTMAX): PnsConstraint['value'] {
  const out: PnsConstraint['value'] = {};

  if (aValue.HasMin()) out.min = aValue.Min();
  if (aValue.HasOpt()) out.opt = aValue.Opt();
  if (aValue.HasMax()) out.max = aValue.Max();

  return out;
}

/** One entry of the long-lived clearance cache, kept whole so it can be swept. */
interface ClearanceEntry {
  a: PnsItem;
  b: PnsItem | null;
  value: number;
}

interface HullEntry {
  item: PnsItem;
  hull: Hull;
}

/** `isHole`: `aItem->OfKind( HOLE_T )`, with upstream's null guard. */
const isHole = (aItem: PnsItem | null): boolean => {
  if (aItem === null) return false;

  return aItem.ofKind(PnsKind.HOLE_T);
};

/**
 * `PNS_PCBNEW_RULE_RESOLVER`.
 *
 * Construct one per routing session and hand it to
 * {@link PnsNode.setRuleResolver}. It holds caches keyed on live items, so it
 * must not outlive the node tree it was built for — that is what
 * {@link PNS_PCBNEW_RULE_RESOLVER.clearCaches} is for.
 */
export class PNS_PCBNEW_RULE_RESOLVER implements PnsRuleResolver {
  private readonly m_routerIface: PNS_KICAD_IFACE;
  private readonly m_board: BOARD | null;
  private readonly m_dummyTracks: [PCB_TRACK, PCB_TRACK];
  private readonly m_dummyArcs: [PCB_ARC, PCB_ARC];
  private readonly m_dummyVias: [PCB_VIA, PCB_VIA];
  private readonly m_clearanceEpsilon: number;

  /** Stable stand-in for `(uintptr_t) pointer`, handed out on first sight. */
  private readonly mOrdinals = new WeakMap<object, number>();
  private mNextOrdinal = 0;

  private mClearanceCache = new Map<string, ClearanceEntry>();
  private mTempClearanceCache = new Map<string, number>();
  private mHullCache = new Map<string, HullEntry>();

  /** `std::optional<bool> m_hasUserPhysicalConstraint`. */
  private mHasUserPhysicalConstraint: boolean | undefined;

  constructor(aBoard: BOARD | null, aRouterIface: PNS_KICAD_IFACE) {
    this.m_routerIface = aRouterIface;
    this.m_board = aBoard;
    this.m_dummyTracks = [new PCB_TRACK(aBoard), new PCB_TRACK(aBoard)];
    this.m_dummyArcs = [new PCB_ARC(aBoard), new PCB_ARC(aBoard)];
    this.m_dummyVias = [new PCB_VIA(aBoard), new PCB_VIA(aBoard)];

    for (const track of this.m_dummyTracks) track.SetFlags(ROUTER_TRANSIENT);
    for (const arc of this.m_dummyArcs) arc.SetFlags(ROUTER_TRANSIENT);
    for (const via of this.m_dummyVias) via.SetFlags(ROUTER_TRANSIENT);

    this.m_clearanceEpsilon = aBoard ? aBoard.GetDesignSettings().GetDRCEpsilon() : 0;
  }

  private drcEngine(): DRC_ENGINE | null {
    return this.m_board?.GetDesignSettings().m_DRCEngine ?? null;
  }

  // ----- identity ------------------------------------------------------------------

  /** The ordinal standing in for an object's address. Primitives key on themselves. */
  private token(aValue: unknown): string {
    if (aValue === null || aValue === undefined) return 'n';

    if (typeof aValue !== 'object' && typeof aValue !== 'function') {
      return `p${typeof aValue}:${String(aValue)}`;
    }

    const obj = aValue as object;
    let ord = this.mOrdinals.get(obj);

    if (ord === undefined) {
      ord = this.mNextOrdinal++;
      this.mOrdinals.set(obj, ord);
    }

    return `o${ord}`;
  }

  private ordinalOf(aItem: PnsItem | null): number {
    if (!aItem) return -1;

    let ord = this.mOrdinals.get(aItem);

    if (ord === undefined) {
      ord = this.mNextOrdinal++;
      this.mOrdinals.set(aItem, ord);
    }

    return ord;
  }

  /** `CLEARANCE_CACHE_KEY( aA, aB, aFlag )`, symmetric in its first two arguments. */
  private clearanceKey(aA: PnsItem, aB: PnsItem | null, aFlag: boolean): string {
    const oa = this.ordinalOf(aA);
    const ob = this.ordinalOf(aB);
    const lo = oa < ob ? oa : ob;
    const hi = oa < ob ? ob : oa;

    return `${lo}/${hi}/${aFlag ? 1 : 0}`;
  }

  /**
   * `TEMP_CLEARANCE_CACHE_KEY::SIDE` — the six properties upstream decided are
   * enough to determine a clearance, in the order its `operator<` compares them.
   */
  private tempSide(aItem: PnsItem | null): string[] {
    if (!aItem) return ['n', 'n', '-1', '-1', '0', '0'];

    return [
      this.token(aItem.boardItem()),
      this.token(aItem.net()),
      String(aItem.layers().start()),
      String(aItem.layers().end()),
      String(aItem.kind()),
      aItem.isFreePad() ? '1' : '0',
    ];
  }

  private tempClearanceKey(aA: PnsItem, aB: PnsItem | null, aFlag: boolean): string {
    const sa = this.tempSide(aA);
    const sb = this.tempSide(aB);

    // `if( sb < sa ) swap` — a field-by-field lexicographic compare, so the key
    // is symmetric in (A, B) exactly as the pointer sort makes the other one.
    let swap = false;

    for (let i = 0; i < sa.length; i++) {
      if (sa[i] === sb[i]) continue;

      swap = (sb[i] as string) < (sa[i] as string);
      break;
    }

    const [first, second] = swap ? [sb, sa] : [sa, sb];

    return `${first.join('|')}#${second.join('|')}#${aFlag ? 1 : 0}`;
  }

  // ----- the board predicates ---------------------------------------------------------

  hasUserDefinedPhysicalConstraint(): boolean {
    if (this.mHasUserPhysicalConstraint === undefined) {
      const drc = this.drcEngine();
      this.mHasUserPhysicalConstraint = drc ? drc.HasUserDefinedPhysicalConstraint() : false;
    }

    return this.mHasUserPhysicalConstraint;
  }

  /** `DpCoupledNet( aNet )`: `m_board->DpCoupledNet( NETINFO_ITEM* )`. */
  dpCoupledNet(aNet: NetHandle): NetHandle {
    if (!this.m_board || !aNet) return null;

    return this.m_board.DpCoupledNet(aNet as NETINFO_ITEM);
  }

  /** `DpNetPolarity( aNet )` (cpp:1359): `m_board->MatchDpSuffix( name, dummy )`. */
  dpNetPolarity(aNet: NetHandle): number {
    return DRC_ENGINE.MatchDpSuffix(this.netName(aNet)).polarity;
  }

  /** `DpNetPair( aItem, aNetP, aNetN )` (cpp:1372), null where upstream returns false. */
  dpNetPair(aItem: PnsItem): DpNetPair | null {
    if (!aItem || !aItem.net() || !this.m_board) return null;

    const netNameP = this.netName(aItem.net());
    const r = DRC_ENGINE.MatchDpSuffix(netNameP);

    if (r.polarity === 0) return null;

    let nameP: string;
    let nameN: string;

    if (r.polarity === 1) {
      nameP = netNameP;
      nameN = r.complementNet;
    } else {
      nameP = r.complementNet;
      nameN = netNameP;
    }

    const netInfoP = this.m_board.FindNet(nameP);
    const netInfoN = this.m_board.FindNet(nameN);

    if (!netInfoP || !netInfoN) return null;

    return { netP: netInfoP, netN: netInfoN };
  }

  /** `NetCode( aNet )`: `NETINFO_ITEM::GetNetCode`, -1 for a null handle. */
  netCode(aNet: NetHandle): number {
    return aNet ? (aNet as NETINFO_ITEM).GetNetCode() : -1;
  }

  /** `NetName( aNet )`. */
  netName(aNet: NetHandle): string {
    return aNet ? (aNet as NETINFO_ITEM).GetNetname() : '';
  }

  /** `IsInNetTie` (cpp:347). */
  isInNetTie(aA: PnsItem): boolean {
    const item = boardItemOf(aA);
    const fp = item ? item.GetParentFootprint() : null;

    return fp !== null && fp.IsNetTie();
  }

  /** `IsNetTieExclusion` (cpp:355). */
  isNetTieExclusion(aItem: PnsItem, aCollisionPos: Vec2, aCollidingItem: PnsItem): boolean {
    if (!aItem || !aCollidingItem) return false;

    const drcEngine = this.drcEngine();
    const item = boardItemOf(aItem);
    const collidingItem = boardItemOf(aCollidingItem);

    const collidingFp = collidingItem ? collidingItem.GetParentFootprint() : null;
    const itemFp = item ? item.GetParentFootprint() : null;

    // Two items colliding from the same net tie footprint are not checked
    if (collidingFp && itemFp && collidingFp === itemFp && itemFp.IsNetTie()) return true;

    if (drcEngine && collidingItem) {
      return drcEngine.IsNetTieExclusion(
        this.netCode(aItem.net()),
        this.m_routerIface.GetBoardLayerFromPNSLayer(aItem.layer()),
        aCollisionPos,
        collidingItem,
      );
    }

    return false;
  }

  /**
   * `IsDrilledHole` (cpp:462): a hole whose own parent, or failing that its
   * pad/via's, has a drilled hole.
   */
  isDrilledHole(aItem: PnsItem): boolean {
    if (!isHole(aItem)) return false;

    let parent = parentOf(aItem);

    if (!parent && aItem.parentPadVia()) parent = parentOf(aItem.parentPadVia());

    return parent !== null && parent.HasDrilledHole();
  }

  /** `IsNonPlatedSlot` (cpp:476): an NPTH pad whose two drill sizes differ. */
  isNonPlatedSlot(aItem: PnsItem): boolean {
    if (!isHole(aItem)) return false;

    let parent = parentOf(aItem);

    if (!parent && aItem.parentPadVia()) parent = parentOf(aItem.parentPadVia());

    if (parent && parent.Type() === KICAD_T.PCB_PAD_T) {
      const pad = parent as PAD;

      return pad.GetAttribute() === PAD_ATTRIB.NPTH && pad.GetDrillSizeX() !== pad.GetDrillSizeY();
    }

    // Via holes are (currently) always round, and always plated
    return false;
  }

  /**
   * `IsKeepout( aObstacle, aItem, aEnforce )` (cpp:386): a rule area with keepout
   * parameters is a keepout, and `enforce` says whether its rules exclude aItem.
   */
  isKeepout(aObstacle: PnsItem, aItem: PnsItem): KeepoutResult {
    const checkKeepout = (aKeepout: ZONE, aOther: BOARD_ITEM | null): boolean => {
      if (!aOther) return false;

      if (aKeepout.GetDoNotAllowTracks() && aOther.IsType([KICAD_T.PCB_ARC_T, KICAD_T.PCB_TRACE_T]))
        return true;

      if (aKeepout.GetDoNotAllowVias() && aOther.Type() === KICAD_T.PCB_VIA_T) return true;

      if (aKeepout.GetDoNotAllowPads() && aOther.Type() === KICAD_T.PCB_PAD_T) return true;

      // Incomplete test, but better than nothing:
      if (aKeepout.GetDoNotAllowFootprints() && aOther.Type() === KICAD_T.PCB_PAD_T) {
        return (
          !aKeepout.GetParentFootprint() ||
          aKeepout.GetParentFootprint() !== aOther.GetParentFootprint()
        );
      }

      return false;
    };

    const parent = parentOf(aObstacle);

    if (parent && parent.Type() === KICAD_T.PCB_ZONE_T) {
      const zone = parent as ZONE;

      if (zone.GetIsRuleArea() && zone.HasKeepoutParametersSet()) {
        return {
          keepout: true,
          enforce: checkKeepout(
            zone,
            this.getBoardItem(
              aItem,
              this.m_routerIface.GetBoardLayerFromPNSLayer(aObstacle.layer()),
            ),
          ),
        };
      }
    }

    return { keepout: false, enforce: false };
  }

  clearanceEpsilon(): number {
    return this.m_clearanceEpsilon;
  }

  /**
   * `getBoardItem( aItem, aBoardLayer, aIdx )` (cpp:503): the item's own board
   * item, or one of the two ROUTER_TRANSIENT dummies set up as it.
   */
  private getBoardItem(aItem: PnsItem, aBoardLayer: PCB_LAYER_ID, aIdx = 0): BOARD_ITEM | null {
    const parent = boardItemOf(aItem);

    if (parent) return parent;

    return this.getDummyItem(aItem, aBoardLayer, aIdx);
  }

  private getDummyItem(aItem: PnsItem, aBoardLayer: PCB_LAYER_ID, aIdx: number): BOARD_ITEM | null {
    const net = aItem.net() as NETINFO_ITEM | null;

    switch (aItem.kind()) {
      case PnsKind.ARC_T: {
        const arc = this.m_dummyArcs[aIdx]!;
        arc.SetLayer(aBoardLayer);
        arc.SetNet(net);
        arc.SetStart(aItem.anchor(0));
        arc.SetEnd(aItem.anchor(1));
        return arc;
      }

      case PnsKind.VIA_T:
      case PnsKind.HOLE_T: {
        const via = this.m_dummyVias[aIdx]!;
        via.SetLayer(aBoardLayer);
        via.SetNet(net);
        via.SetStart(aItem.anchor(0));
        return via;
      }

      case PnsKind.SEGMENT_T:
      case PnsKind.LINE_T: {
        const track = this.m_dummyTracks[aIdx]!;
        track.SetLayer(aBoardLayer);
        track.SetNet(net);
        track.SetStart(aItem.anchor(0));
        track.SetEnd(aItem.anchor(1));
        return track;
      }

      default:
        return null;
    }
  }

  // ----- constraints ------------------------------------------------------------------

  /** `QueryConstraint` (cpp:535-787). */
  queryConstraint(
    aType: PnsConstraintType,
    aItemA: PnsItem | null,
    aItemB: PnsItem | null,
    aPNSLayer: number,
  ): PnsConstraint | null {
    const drcEngine = this.drcEngine();

    if (!drcEngine) return null;

    const hostType = HOST_TYPE[aType];

    // should not happen
    if (hostType === undefined) return null;

    let parentA = aItemA ? boardItemOf(aItemA) : null;
    let parentB = aItemB ? boardItemOf(aItemB) : null;
    const boardLayer = this.m_routerIface.GetBoardLayerFromPNSLayer(aPNSLayer);
    let hostConstraint = new DRC_CONSTRAINT();

    // For clearance-type constraints, pick the smaller (more permissive) value.
    // Returns true if we found a zero/negative clearance (can't get more permissive).
    const pickSmallerConstraint = (aCandidate: DRC_CONSTRAINT): boolean => {
      if (aCandidate.IsNull()) return false;

      if (hostConstraint.IsNull()) {
        hostConstraint = aCandidate;
      } else if (
        aCandidate.GetValue().HasMin() &&
        hostConstraint.GetValue().HasMin() &&
        aCandidate.GetValue().Min() < hostConstraint.GetValue().Min()
      ) {
        hostConstraint = aCandidate;
      }

      return hostConstraint.GetValue().HasMin() && hostConstraint.GetValue().Min() <= 0;
    };

    // Check for multi-segment LINEs without BoardItems. These need segment-by-segment
    // evaluation because custom DRC rules may have geometry-dependent conditions (like
    // intersectsCourtyard) that require evaluating actual segment positions.
    const isMultiSegmentLine = (aItem: PnsItem | null, aParent: BOARD_ITEM | null): boolean => {
      if (!aItem || aParent || aItem.kind() !== PnsKind.LINE_T) return false;

      return (aItem as PnsLine).cLine().segmentCount() > 1;
    };

    let lineANeedsSegmentEval = false;
    let lineBNeedsSegmentEval = false;

    if (drcEngine.HasGeometryDependentRules()) {
      lineANeedsSegmentEval = isMultiSegmentLine(aItemA, parentA);
      lineBNeedsSegmentEval = isMultiSegmentLine(aItemB, parentB);
    }

    const evalRules = (a: BOARD_ITEM | null, b: BOARD_ITEM | null): DRC_CONSTRAINT =>
      drcEngine.EvalRules(hostType, a, b, boardLayer);

    // Evaluate segments of a multi-segment LINE against a single opposing item.
    const evaluateLineSegments = (
      aLineItem: PnsItem,
      aOpposingItem: BOARD_ITEM | null,
      aLineIsFirst: boolean,
      aIdx: number,
    ): void => {
      const line = aLineItem as PnsLine;
      const chain = line.cLine();
      const dummyTrack = this.m_dummyTracks[aIdx]!;

      dummyTrack.SetLayer(boardLayer);
      dummyTrack.SetNet(aLineItem.net() as NETINFO_ITEM | null);
      dummyTrack.SetWidth(line.width());

      for (let i = 0; i < chain.segmentCount(); i++) {
        dummyTrack.SetStart(chain.cPoint(i));
        dummyTrack.SetEnd(chain.cPoint(i + 1));

        const segConstraint = aLineIsFirst
          ? evalRules(dummyTrack, aOpposingItem)
          : evalRules(aOpposingItem, dummyTrack);

        if (pickSmallerConstraint(segConstraint)) break;
      }
    };

    const chainBBox = (aChain: PnsLineChain): BOX2I => {
      const box = new BOX2I();
      const pts: Vec2[] = [];

      for (let i = 0; i < aChain.pointCount(); i++) pts.push(aChain.cPoint(i));

      box.Compute(pts);
      return box;
    };

    // Check if two multi-segment lines have overlapping bboxes (worth doing segment evaluation)
    const linesBBoxOverlap = (): boolean => {
      if (!lineANeedsSegmentEval || !lineBNeedsSegmentEval) return true;

      const lineA = aItemA as PnsLine;
      const lineB = aItemB as PnsLine;
      const proximityThreshold = Math.max(lineA.width(), lineB.width()) * 2;

      const bboxA = chainBBox(lineA.cLine());
      bboxA.Inflate(proximityThreshold);

      return bboxA.Intersects(chainBBox(lineB.cLine()));
    };

    // Handle multi-segment lines with segment-by-segment evaluation.
    if ((lineANeedsSegmentEval || lineBNeedsSegmentEval) && linesBBoxOverlap()) {
      // Get dummy items for non-multi-segment items that need them
      if (aItemA && !parentA && !lineANeedsSegmentEval)
        parentA = this.getDummyItem(aItemA, boardLayer, 0);

      if (aItemB && !parentB && !lineBNeedsSegmentEval)
        parentB = this.getDummyItem(aItemB, boardLayer, 1);

      if (lineANeedsSegmentEval && lineBNeedsSegmentEval) {
        // Both items are multi-segment lines. Evaluate segment pairs, skipping pairs that are
        // far apart since geometry-dependent rules won't trigger for them.
        const lineA = aItemA as PnsLine;
        const lineB = aItemB as PnsLine;
        const chainA = lineA.cLine();
        const chainB = lineB.cLine();
        const proximityThreshold = Math.max(lineA.width(), lineB.width()) * 2;

        const dummyA = this.m_dummyTracks[0];
        dummyA.SetLayer(boardLayer);
        dummyA.SetNet(aItemA!.net() as NETINFO_ITEM | null);
        dummyA.SetWidth(lineA.width());

        const dummyB = this.m_dummyTracks[1];
        dummyB.SetLayer(boardLayer);
        dummyB.SetNet(aItemB!.net() as NETINFO_ITEM | null);
        dummyB.SetWidth(lineB.width());

        let done = false;

        for (let i = 0; i < chainA.segmentCount() && !done; i++) {
          const ptA1 = chainA.cPoint(i);
          const ptA2 = chainA.cPoint(i + 1);

          const bboxA = new BOX2I(ptA1);
          bboxA.SetEnd(ptA2);
          bboxA.Normalize();
          bboxA.Inflate(proximityThreshold);

          dummyA.SetStart(ptA1);
          dummyA.SetEnd(ptA2);

          for (let j = 0; j < chainB.segmentCount(); j++) {
            const ptB1 = chainB.cPoint(j);
            const ptB2 = chainB.cPoint(j + 1);

            const bboxB = new BOX2I(ptB1);
            bboxB.SetEnd(ptB2);
            bboxB.Normalize();

            if (!bboxA.Intersects(bboxB)) continue;

            dummyB.SetStart(ptB1);
            dummyB.SetEnd(ptB2);

            if (pickSmallerConstraint(evalRules(dummyA, dummyB))) {
              done = true;
              break;
            }
          }
        }
      } else if (lineANeedsSegmentEval) {
        evaluateLineSegments(aItemA!, parentB, true, 0);
      } else {
        evaluateLineSegments(aItemB!, parentA, false, 1);
      }
    } else {
      // Standard path: no multi-segment lines (or lines too far apart), use anchor-based dummies
      if (aItemA && !parentA) parentA = this.getDummyItem(aItemA, boardLayer, 0);

      if (aItemB && !parentB) parentB = this.getDummyItem(aItemB, boardLayer, 1);

      if (parentA) hostConstraint = evalRules(parentA, parentB);
    }

    if (hostConstraint.IsNull()) return null;

    const rule = hostConstraint.GetParentRule();

    if (
      hostConstraint.GetSeverity() === RPT_SEVERITY_IGNORE &&
      (!rule?.IsImplicit() || rule.GetImplicitSource() !== DRC_IMPLICIT_SOURCE.TUNING_PROFILE)
    ) {
      return {
        type: aType,
        value: { min: -1 },
        allowed: false,
        ruleName: hostConstraint.GetName(),
        fromName: '',
        toName: '',
        isTimeDomain: false,
      };
    }

    return {
      type: aType,
      value: minOptMaxOf(hostConstraint.GetValue()),
      allowed: false,
      ruleName: hostConstraint.GetName(),
      fromName: '',
      toName: '',
      isTimeDomain: hostConstraint.GetOption(DRC_CONSTRAINT_OPTIONS.TIME_DOMAIN),
    };
  }

  // ----- clearance --------------------------------------------------------------------

  /**
   * `PNS_PCBNEW_RULE_RESOLVER::Clearance`.
   *
   * ### The shape of the answer
   *
   * `rv` starts at 0 and only ever climbs: every constraint that resolves is
   * folded in with `if( min > rv ) rv = min`, so a query that returns *nothing*
   * leaves the running value alone rather than zeroing it. The loop runs over
   * every layer in the overlap and keeps the worst case across all of them —
   * not a per-layer answer.
   *
   * ### Which constraints are asked, in which order
   *
   * The net-aware block is skipped entirely for same-net and free-pad pairs.
   * Inside it, hole-to-hole and hole clearance are an `if/else if` — two
   * drilled holes ask for hole-to-hole and *not* hole clearance — but there is
   * deliberately **no** `else` before the copper clearance test, because a
   * plated hole must collect both. The physical clearances that follow are
   * outside the block: they are net-blind and apply to same-net pairs too.
   *
   * ### The two escapes at the end
   *
   * `(sameNet || freePad) && rv == 0` becomes **-1**, which is
   * `collideSimple`'s "no clearance at all, do not even test". A positive `rv`
   * survives, which is how a `physical_clearance` rule reaches across a net.
   * Then the epsilon is subtracted, floored at zero, and **only from a strictly
   * positive value** — so a -1 stays -1 rather than becoming -1 minus epsilon.
   */
  clearance(aA: PnsItem, aB: PnsItem | null, aUseClearanceEpsilon = true): number {
    const bothOwned = !!aA && !!aB && !!aA.owner() && !!aB.owner();

    if (bothOwned) {
      const hit = this.mClearanceCache.get(this.clearanceKey(aA, aB, aUseClearanceEpsilon));

      if (hit) return hit.value;
    } else if (aA && aB) {
      const hit = this.mTempClearanceCache.get(this.tempClearanceKey(aA, aB, aUseClearanceEpsilon));

      if (hit !== undefined) return hit;
    }

    let rv = 0;
    let layers: PnsLayerRange;

    if (!aB) layers = aA.layers();
    else if (isEdge(aA)) layers = aB.layers();
    else if (isEdge(aB)) layers = aA.layers();
    else layers = aA.layers().intersection(aB.layers());

    // Normalize layer range (no -1 magic numbers).
    layers = layers.intersection(new PnsLayerRange(LAYER_ID_START, LAYER_ID_END));

    const sameNet = !!aA && !!aB && !!aA.net() && aA.net() === aB.net();
    const freePad = !!aA && !!aB && (aA.isFreePad() || aB.isFreePad());

    const fold = (type: PnsConstraintType, layer: number): void => {
      const c = this.queryConstraint(type, aA, aB, layer);

      if (!c) return;

      const min = c.value.min ?? 0;

      if (min > rv) rv = min;
    };

    for (let layer = layers.start(); layer <= layers.end(); ++layer) {
      if (!sameNet && !freePad) {
        if (this.isDrilledHole(aA) && aB !== null && this.isDrilledHole(aB)) {
          fold(PnsConstraintType.CT_HOLE_TO_HOLE, layer);
        } else if (isHole(aA) || isHole(aB)) {
          fold(PnsConstraintType.CT_HOLE_CLEARANCE, layer);
        }

        // No 'else'; plated holes get both HOLE_CLEARANCE and CLEARANCE.
        if (isCopper(aA) && (!aB || isCopper(aB))) {
          fold(PnsConstraintType.CT_CLEARANCE, layer);
        }

        if (isEdge(aA) || isEdge(aB)) {
          fold(PnsConstraintType.CT_EDGE_CLEARANCE, layer);
        }
      }

      // Physical clearances are net-blind: a physical_clearance rule applies
      // regardless.
      if (isHole(aA) || isHole(aB)) {
        fold(PnsConstraintType.CT_PHYSICAL_HOLE_CLEARANCE, layer);
      }

      fold(PnsConstraintType.CT_PHYSICAL_CLEARANCE, layer);
    }

    // Same-net pairs short-circuit clearance unless a physical_clearance rule
    // gave a positive value.
    if ((sameNet || freePad) && rv === 0) rv = -1;

    if (aUseClearanceEpsilon && rv > 0) rv = Math.max(0, rv - this.clearanceEpsilon());

    if (bothOwned) {
      this.mClearanceCache.set(this.clearanceKey(aA, aB, aUseClearanceEpsilon), {
        a: aA,
        b: aB,
        value: rv,
      });
    } else if (aA && aB) {
      this.mTempClearanceCache.set(this.tempClearanceKey(aA, aB, aUseClearanceEpsilon), rv);
    }

    return rv;
  }

  /** `isCopper`: an item with **no parent counts as copper**. */
  // ----- the hull cache ----------------------------------------------------------------

  /**
   * `HullCache`. Upstream returns a **reference into the map**, and the
   * base-class fallback in `pns_node.h:176-182` is worse — it returns a
   * reference to a function-local `static`, so two live references alias each
   * other. Neither is reproducible; a value is returned instead. Nothing
   * observable is lost, because the only caller (`NODE::NearestObstacle`)
   * copies into its own `hullData[i]` on the next line.
   *
   * The cached hull is *not* deep-copied on the way out. Callers must not
   * mutate it — `NearestObstacle` only reads, and `makeHull` builds a fresh
   * chain when it simplifies.
   */
  hullCache(
    aItem: PnsItem,
    aClearance: number,
    aWalkaroundThickness: number,
    aLayer: number,
  ): Hull {
    const key = `${this.ordinalOf(aItem)}/${aClearance}/${aWalkaroundThickness}/${aLayer}`;
    const hit = this.mHullCache.get(key);

    if (hit) return hit.hull;

    const hull = itemHull(aItem, aClearance, aWalkaroundThickness, aLayer);

    this.mHullCache.set(key, { item: aItem, hull });

    return hull;
  }

  // ----- cache lifetimes ----------------------------------------------------------------

  /**
   * Drop everything that mentions any of these items.
   *
   * Note the two asymmetries. The clearance sweep tests **both** sides of each
   * key, the hull sweep only its single item. And the **temporary** clearance
   * cache is not touched at all — it is keyed on properties rather than
   * identities, so a dead item does not make an entry wrong.
   *
   * The empty-list early return is upstream's and is not just a fast path: it
   * is what makes `NODE::releaseGarbage` cheap on the overwhelmingly common
   * commit that orphaned nothing.
   */
  clearCacheForItems(aItems: PnsItem[]): void {
    if (aItems.length === 0) return;

    const dirty = new Set(aItems);

    for (const [key, entry] of this.mClearanceCache) {
      if (dirty.has(entry.a) || (entry.b !== null && dirty.has(entry.b))) {
        this.mClearanceCache.delete(key);
      }
    }

    for (const [key, entry] of this.mHullCache) {
      if (dirty.has(entry.item)) this.mHullCache.delete(key);
    }
  }

  /** Everything, including the memoised physical-constraint answer. */
  clearCaches(): void {
    this.mClearanceCache = new Map();
    this.mTempClearanceCache = new Map();
    this.mHullCache = new Map();
    this.mHasUserPhysicalConstraint = undefined;
  }

  /** **Only** the property-keyed cache — the one holding answers about items
   * the router made up and has now thrown away. */
  clearTemporaryCaches(): void {
    this.mTempClearanceCache = new Map();
  }
}
