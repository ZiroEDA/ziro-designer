// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRID_HELPER` - `include/tool/grid_helper.h` + `common/tool/grid_helper.cpp`:
 * the base every editor's grid-snapping helper builds on (`EE_GRID_HELPER`,
 * `PCB_GRID_HELPER`). It answers three questions a tool asks on every mouse
 * move: what is the grid (`GetGrid`), where does *this* point round to on it
 * (`Align` / `AlignGrid`), and - while a gesture is in flight - is the point
 * the gesture started from still reachable even though it is off-grid
 * (`SetAuxAxes`, the "auxiliary axis" `Align` reads).
 *
 * ### What this port keeps, and what it reduces
 *
 * `GetGrid`, `GetOrigin`, `GetVisibleGrid`, `Align`, `AlignGrid`,
 * `computeNearest`, `canUseGrid`, `GetSelectionGrid`, `GetGridSize`,
 * `addAnchor` / `clearAnchors` / the `ANCHOR` type, the skip point, the mask
 * flags, and `SnapToConstructionLines` are all ported line for line against
 * `common/tool/grid_helper.cpp`.
 *
 * Three pieces are reduced, because nothing in `GRID_HELPER` itself needs the
 * full machinery behind them, and no subclass in this tree calls this base
 * yet - `eeschema/tools/snap.ts`, `pcbnew/tools/pcb_grid_helper.ts` and
 * `pcbnew/router/pns_tool_base.ts` are separate, ad-hoc ports that predate
 * this file and reduce the same C++ their own way. Rewiring them onto this
 * base is a bigger job than this port (they are functional/data-oriented,
 * this is the real stateful class) and is left as a follow-up, not attempted
 * here:
 *
 *  - `m_viewAxis` / `m_viewSnapPoint` are `ORIGIN_VIEWITEM` / `SNAP_INDICATOR`
 *    **instances** upstream, and it is the *subclass* constructor
 *    (`EE_GRID_HELPER`, `PCB_GRID_HELPER`) that calls `view->Add` on them -
 *    this base class never does. So here they stay plain state
 *    ({@link AxisViewState}, {@link SnapIndicatorViewState}, read through
 *    {@link GRID_HELPER.GetAxisState} / {@link GRID_HELPER.GetSnapIndicatorState}),
 *    for a subclass or renderer to feed into `drawOriginViewItem` /
 *    `drawSnapIndicator` (`preview_items/snap_indicator.ts`).
 *  - `m_snapManager` (`SNAP_MANAGER`, `include/tool/construction_manager.h`)
 *    is reduced to the one piece `GRID_HELPER`'s own methods read: the
 *    snap-line direction list and its derived "active direction"
 *    ({@link SnapLineManagerLite}, a lean transcription of `SNAP_LINE_MANAGER`).
 *    The construction-geometry and snap-guide-colour halves are UI state for
 *    a preview overlay this base class never draws.
 *  - `m_anchorDebug` / `enableAndGetAnchorDebug` (`ANCHOR_DEBUG`, gated by an
 *    advanced-config flag that defaults off) is not ported; the getter always
 *    answers `null`, which is upstream's own default-config behaviour.
 *
 * `wxLogTrace( traceSnap, ... )` calls are dropped throughout - debug tracing,
 * no behaviour.
 */

import { PT_NONE, type TYPED_POINT2I } from '@ziroeda/kimath/src/geometry/point_types.js';
import { INT_MIN, KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  type VECTOR2I,
  type Vec2,
  equal as vecEqual,
  toVECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import type { EDA_ITEM } from '../eda_item.js';
import type { SELECTION } from './selection.js';
import type { TOOL_MANAGER } from './tool_manager.js';

/** `GRID_HELPER_GRIDS` (`grid_helper.h:43-53`). */
export enum GRID_HELPER_GRIDS {
  // When the item doesn't match an override, use the current user grid
  GRID_CURRENT = 0,
  GRID_CONNECTABLE,
  GRID_WIRES,
  GRID_VIAS,
  GRID_TEXT,
  GRID_GRAPHICS,
}

/** `GRID_HELPER::ANCHOR_FLAGS` (`grid_helper.h:154-168`). */
export enum ANCHOR_FLAGS {
  CORNER = 1,
  OUTLINE = 2,
  SNAPPABLE = 4,
  ORIGIN = 8,
  VERTICAL = 16,
  HORIZONTAL = 32,
  /**
   * This anchor comes from 'constructed' geometry (e.g. an intersection with
   * something else), and not from some intrinsic point of an item (e.g. an
   * endpoint).
   */
  CONSTRUCTED = 64,
  ALL = CORNER | OUTLINE | SNAPPABLE | ORIGIN | VERTICAL | HORIZONTAL | CONSTRUCTED,
}

/** `GRID_HELPER::ANCHOR` (`grid_helper.h:172-205`). */
export class ANCHOR {
  constructor(
    public pos: VECTOR2I,
    public flags: number,
    public pointTypes: number,
    public items: EDA_ITEM[],
  ) {}

  /** `ANCHOR::Distance`: the plain Euclidean distance to `aP`. */
  Distance(aP: VECTOR2I): number {
    return Math.hypot(aP.x - this.pos.x, aP.y - this.pos.y);
  }

  /** `ANCHOR::InvolvesItem`. */
  InvolvesItem(aItem: EDA_ITEM): boolean {
    return this.items.includes(aItem);
  }
}

/** `GRID_HELPER::computeNearest` (`grid_helper.cpp:445-450`). */
export function computeNearest(aPoint: VECTOR2I, aGrid: VECTOR2I, aOffset: VECTOR2I): VECTOR2I {
  return {
    x: KiROUND((aPoint.x - aOffset.x) / aGrid.x) * aGrid.x + aOffset.x,
    y: KiROUND((aPoint.y - aOffset.y) / aGrid.y) * aGrid.y + aOffset.y,
  };
}

/** `normalizeDirection` (`construction_manager.cpp:406-427`): a direction's canonical form. */
function normalizeDirection(aDir: VECTOR2I): VECTOR2I {
  if (aDir.x === 0 && aDir.y === 0) return { x: 0, y: 0 };

  let dx = aDir.x;
  let dy = aDir.y;

  let a = Math.abs(dx);
  let b = Math.abs(dy);
  while (b) {
    [a, b] = [b, a % b];
  }
  const gcd = a;

  if (gcd > 0) {
    dx = dx / gcd;
    dy = dy / gcd;
  }

  if (dx < 0 || (dx === 0 && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }

  return { x: dx, y: dy };
}

/** `findDirectionIndex` (`construction_manager.cpp:432-447`). */
function findDirectionIndex(aDirections: readonly VECTOR2I[], aDelta: VECTOR2I): number | null {
  const normalized = normalizeDirection(aDelta);

  if (normalized.x === 0 && normalized.y === 0) return null;

  const index = aDirections.findIndex((d) => d.x === normalized.x && d.y === normalized.y);

  return index === -1 ? null : index;
}

/**
 * `SNAP_LINE_MANAGER` (`include/tool/construction_manager.h:71-150`), reduced
 * to the pure data `GRID_HELPER`'s own methods touch: the direction list, the
 * snap-line origin/end, and the derived "active direction". The rendering
 * half (`CONSTRUCTION_VIEW_HANDLER`, `notifyGuideChange` ->
 * `SNAP_MANAGER::UpdateSnapGuides`, `SetSnappedAnchor`,
 * `GetNearestSnapLinePoint`) is not ported: nothing in `GRID_HELPER` itself
 * calls it.
 */
class SnapLineManagerLite {
  private m_directions: VECTOR2I[] = [];
  private m_snapLineOrigin: VECTOR2I | null = null;
  private m_snapLineEnd: VECTOR2I | null = null;
  private m_activeDirection: number | null = null;

  constructor() {
    // `SNAP_LINE_MANAGER::SNAP_LINE_MANAGER` (`construction_manager.cpp:398-403`).
    this.SetDirections([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
  }

  GetDirections(): readonly VECTOR2I[] {
    return this.m_directions;
  }

  GetSnapLineOrigin(): VECTOR2I | null {
    return this.m_snapLineOrigin;
  }

  GetActiveDirection(): number | null {
    return this.m_activeDirection;
  }

  /** `SNAP_LINE_MANAGER::SetDirections` (`construction_manager.cpp:450-489`). */
  SetDirections(aDirections: readonly VECTOR2I[]): void {
    const unique: VECTOR2I[] = [];

    for (const direction of aDirections) {
      const normalized = normalizeDirection(direction);

      if (normalized.x === 0 && normalized.y === 0) continue;

      if (!unique.some((u) => u.x === normalized.x && u.y === normalized.y))
        unique.push(normalized);
    }

    const changed =
      unique.length !== this.m_directions.length ||
      unique.some((d, i) => {
        const existing = this.m_directions[i];
        return !existing || d.x !== existing.x || d.y !== existing.y;
      });

    if (!changed) return;

    this.m_directions = unique;
    this.m_activeDirection = null;

    if (this.m_snapLineOrigin && this.m_snapLineEnd) {
      const delta = {
        x: this.m_snapLineEnd.x - this.m_snapLineOrigin.x,
        y: this.m_snapLineEnd.y - this.m_snapLineOrigin.y,
      };

      if (findDirectionIndex(this.m_directions, delta) === null) this.m_snapLineEnd = null;
    }

    if (this.m_directions.length === 0) {
      this.ClearSnapLine();
    }
  }

  /** `SNAP_LINE_MANAGER::SetSnapLineOrigin` (`construction_manager.cpp:491-504`). */
  SetSnapLineOrigin(aOrigin: VECTOR2I): void {
    if (this.m_snapLineOrigin && vecEqual(this.m_snapLineOrigin, aOrigin) && !this.m_snapLineEnd)
      return;

    this.m_snapLineOrigin = aOrigin;
    this.m_snapLineEnd = null;
    this.m_activeDirection = null;
  }

  /** `SNAP_LINE_MANAGER::SetSnapLineEnd` (`construction_manager.cpp:507-525`). */
  SetSnapLineEnd(aSnapEnd: VECTOR2I | null): void {
    if (!this.m_snapLineOrigin) return;

    const same =
      (aSnapEnd === null && this.m_snapLineEnd === null) ||
      (aSnapEnd !== null && this.m_snapLineEnd !== null && vecEqual(aSnapEnd, this.m_snapLineEnd));

    if (same) return;

    this.m_snapLineEnd = aSnapEnd;

    if (aSnapEnd) {
      this.m_activeDirection = findDirectionIndex(this.m_directions, {
        x: aSnapEnd.x - this.m_snapLineOrigin.x,
        y: aSnapEnd.y - this.m_snapLineOrigin.y,
      });
    } else {
      this.m_activeDirection = null;
    }
  }

  /** `SNAP_LINE_MANAGER::ClearSnapLine` (`construction_manager.cpp:528-535`). */
  ClearSnapLine(): void {
    this.m_snapLineOrigin = null;
    this.m_snapLineEnd = null;
    this.m_activeDirection = null;
  }
}

/** The `m_viewAxis` state a subclass or renderer reads; see the file comment. */
export interface AxisViewState {
  position: VECTOR2I;
  visible: boolean;
}

/** The `m_viewSnapPoint` state a subclass or renderer reads; see the file comment. */
export interface SnapIndicatorViewState {
  position: VECTOR2I;
  snapTypes: number;
  visible: boolean;
}

/** `computeNearest`'s guard-free component KiROUND, for `AlignGrid`'s double overload. */
const kiRoundVec = (v: Vec2): VECTOR2I => ({ x: KiROUND(v.x), y: KiROUND(v.y) });

const sqNorm = (v: Vec2): number => v.x * v.x + v.y * v.y;

export class GRID_HELPER {
  protected m_anchors: ANCHOR[] = [];

  protected m_toolMgr: TOOL_MANAGER | null;
  protected m_auxAxis: VECTOR2I | null = null;

  /** Mask of allowed snap types. */
  protected m_maskTypes: number = ANCHOR_FLAGS.ALL;

  protected m_enableSnap = true;
  protected m_enableGrid = true;
  protected m_enableSnapLine = true;

  /** The currently snapped anchor, if any - written by a subclass directly, as upstream does. */
  protected m_snapItem: ANCHOR | null = null;

  /** When drawing a line, we avoid snapping to the source point. */
  protected m_skipPoint: VECTOR2I = { x: 0, y: 0 };

  // Manual grid parameters used when no TOOL_MANAGER is provided
  protected m_manualGrid: Vec2 = { x: 1, y: 1 };
  protected m_manualVisibleGrid: Vec2 = { x: 1, y: 1 };
  protected m_manualOrigin: VECTOR2I = { x: 0, y: 0 };
  protected m_manualGridSnapping = true;

  private m_viewAxis: AxisViewState = { position: { x: 0, y: 0 }, visible: false };
  private m_viewSnapPoint: SnapIndicatorViewState = {
    position: { x: 0, y: 0 },
    snapTypes: PT_NONE,
    visible: false,
  };

  private m_snapLineManager = new SnapLineManagerLite();

  /**
   * `GRID_HELPER()` / `GRID_HELPER( TOOL_MANAGER*, int )` (`grid_helper.cpp:42-94`).
   * `aConstructionLayer` is unused upstream too (`wxUnusedVar`); it exists
   * only so a caller can keep passing it.
   */
  constructor(aToolMgr: TOOL_MANAGER | null = null, _aConstructionLayer?: number) {
    this.m_toolMgr = aToolMgr;

    if (!aToolMgr) return;

    const gal = aToolMgr.GetView()?.GetGAL();

    if (!gal) return;

    // Initialise manual values from view for compatibility
    this.m_manualGrid = gal.GetGridSize();
    this.m_manualVisibleGrid = gal.GetVisibleGridSize();
    this.m_manualOrigin = toVECTOR2I(gal.GetGridOrigin());
    this.m_manualGridSnapping = gal.GetGridSnapping();
  }

  /**
   * Reset all internal state. Used to remove any dangling pointers to items
   * that have been deleted.
   *
   * `m_constructionGeomPreview.ClearSnapLine()` (the *rendered* construction
   * geometry's own clear, a different type) is not ported - see the file
   * comment; the snap line's own state still clears.
   */
  FullReset(): void {
    this.m_snapLineManager.ClearSnapLine();
    this.m_anchors = [];
  }

  // Manual setters used when no TOOL_MANAGER/View is available (e.g. in tests)
  SetGridSize(aGrid: Vec2): void {
    this.m_manualGrid = aGrid;
  }

  SetVisibleGridSize(aGrid: Vec2): void {
    this.m_manualVisibleGrid = aGrid;
  }

  SetOrigin(aOrigin: VECTOR2I): void {
    this.m_manualOrigin = aOrigin;
  }

  SetGridSnapping(aEnable: boolean): void {
    this.m_manualGridSnapping = aEnable;
  }

  /** `GRID_HELPER::SetAuxAxes` (`grid_helper.cpp:410-425`). */
  SetAuxAxes(aEnable: boolean, aOrigin: VECTOR2I = { x: 0, y: 0 }): void {
    if (aEnable) {
      this.m_auxAxis = aOrigin;
      this.m_viewAxis = {
        position: aOrigin,
        visible: this.m_toolMgr ? true : this.m_viewAxis.visible,
      };
    } else {
      this.m_auxAxis = null;
      if (this.m_toolMgr) this.m_viewAxis = { ...this.m_viewAxis, visible: false };
    }
  }

  /** `Align( aPoint, aGrid )` (inline, `grid_helper.h:86-89`). */
  Align(aPoint: VECTOR2I, aGrid: GRID_HELPER_GRIDS): VECTOR2I;
  /** `GRID_HELPER::Align( const VECTOR2I& )` (`grid_helper.cpp:453-456`). */
  Align(aPoint: VECTOR2I): VECTOR2I;
  /** `GRID_HELPER::Align( const VECTOR2I&, const VECTOR2D&, const VECTOR2D& )` (`grid_helper.cpp:459-477`). */
  Align(aPoint: VECTOR2I, aGrid: Vec2, aOffset: Vec2): VECTOR2I;
  Align(aPoint: VECTOR2I, aGrid?: GRID_HELPER_GRIDS | Vec2, aOffset?: Vec2): VECTOR2I {
    if (aGrid === undefined) return this.Align(aPoint, this.GetGrid(), this.GetOrigin());

    if (typeof aGrid === 'number')
      return this.Align(aPoint, this.GetGridSize(aGrid), this.GetOrigin());

    if (!this.canUseGrid()) return { ...aPoint };

    const nearest = this.AlignGrid(aPoint, aGrid, aOffset as Vec2);

    if (!this.m_auxAxis) return nearest;

    const aux = this.m_auxAxis;

    if (Math.abs(aux.x - aPoint.x) < Math.abs(nearest.x - aPoint.x)) nearest.x = aux.x;
    if (Math.abs(aux.y - aPoint.y) < Math.abs(nearest.y - aPoint.y)) nearest.y = aux.y;

    return nearest;
  }

  /** `AlignGrid( aPoint, aGrid )` (inline, `grid_helper.h:91-94`). */
  AlignGrid(aPoint: VECTOR2I, aGrid: GRID_HELPER_GRIDS): VECTOR2I;
  /** `GRID_HELPER::AlignGrid( const VECTOR2I& )` (`grid_helper.cpp:428-431`). */
  AlignGrid(aPoint: VECTOR2I): VECTOR2I;
  /**
   * `GRID_HELPER::AlignGrid( const VECTOR2I&, const VECTOR2D&, const VECTOR2D& )`
   * (`grid_helper.cpp:434-442`). Rounds the grid size and offset rather than
   * relying on the implicit double -> int truncation in `computeNearest`:
   * a grid size that isn't exact in IEEE 754 (0.254 mm = 10 mil) would
   * otherwise truncate to the wrong integer.
   */
  AlignGrid(aPoint: VECTOR2I, aGrid: Vec2, aOffset: Vec2): VECTOR2I;
  AlignGrid(aPoint: VECTOR2I, aGrid?: GRID_HELPER_GRIDS | Vec2, aOffset?: Vec2): VECTOR2I {
    if (aGrid === undefined) return computeNearest(aPoint, this.GetGrid(), this.GetOrigin());

    if (typeof aGrid === 'number')
      return this.AlignGrid(aPoint, this.GetGridSize(aGrid), this.GetOrigin());

    return computeNearest(aPoint, kiRoundVec(aGrid), kiRoundVec(aOffset as Vec2));
  }

  /** `GRID_HELPER::GetSelectionGrid` (`grid_helper.cpp:387-401`): the coarsest grid over a selection. */
  GetSelectionGrid(aSelection: SELECTION): GRID_HELPER_GRIDS {
    let grid = this.GetItemGrid(aSelection.Front());

    for (const item of aSelection) {
      const itemGrid = this.GetItemGrid(item);

      if (sqNorm(this.GetGridSize(itemGrid)) > sqNorm(this.GetGridSize(grid))) grid = itemGrid;
    }

    return grid;
  }

  /** `GRID_HELPER::GetItemGrid`: the base always answers the current grid. */
  GetItemGrid(_aItem: EDA_ITEM | null): GRID_HELPER_GRIDS {
    return GRID_HELPER_GRIDS.GRID_CURRENT;
  }

  /** `GRID_HELPER::GetGridSize` (`grid_helper.cpp:404-407`): the base ignores the selector. */
  GetGridSize(_aGrid: GRID_HELPER_GRIDS): Vec2 {
    const gal = this.m_toolMgr?.GetView()?.GetGAL();

    return gal ? gal.GetGridSize() : this.m_manualGrid;
  }

  SetSkipPoint(aPoint: VECTOR2I): void {
    this.m_skipPoint = aPoint;
  }

  /** Clear the skip point by setting it to an unreachable position, thereby preventing matching. */
  ClearSkipPoint(): void {
    this.m_skipPoint = { x: INT_MIN, y: INT_MIN };
  }

  SetSnap(aSnap: boolean): void {
    this.m_enableSnap = aSnap;
  }

  GetSnap(): boolean {
    return this.m_enableSnap;
  }

  SetUseGrid(aSnapToGrid: boolean): void {
    this.m_enableGrid = aSnapToGrid;
  }

  GetUseGrid(): boolean {
    return this.m_enableGrid;
  }

  SetSnapLine(aSnap: boolean): void {
    this.m_enableSnapLine = aSnap;
  }

  SetSnapLineDirections(aDirections: readonly VECTOR2I[]): void {
    this.m_snapLineManager.SetDirections(aDirections);
  }

  SetSnapLineOrigin(aOrigin: VECTOR2I): void {
    this.m_snapLineManager.SetSnapLineOrigin(aOrigin);
  }

  SetSnapLineEnd(aEnd: VECTOR2I | null): void {
    this.m_snapLineManager.SetSnapLineEnd(aEnd);
  }

  ClearSnapLine(): void {
    this.m_snapLineManager.ClearSnapLine();
  }

  /**
   * `GRID_HELPER::SnapToConstructionLines` (`grid_helper.cpp:158-344`): the
   * best point along one of the active snap-line directions, gridded where
   * the grid is on. `wxLogTrace` calls are dropped; nothing else is
   * behaviour.
   */
  SnapToConstructionLines(
    aPoint: VECTOR2I,
    aNearestGrid: VECTOR2I,
    aGrid: Vec2,
    aSnapRange: number,
  ): VECTOR2I | null {
    const origin = this.m_snapLineManager.GetSnapLineOrigin();
    const directions = this.m_snapLineManager.GetDirections();

    if (!origin || directions.length === 0) return null;

    const activeDirection = this.m_snapLineManager.GetActiveDirection();

    const originVec: Vec2 = { x: origin.x, y: origin.y };
    const cursorVec: Vec2 = { x: aPoint.x, y: aPoint.y };
    const delta: Vec2 = { x: cursorVec.x - originVec.x, y: cursorVec.y - originVec.y };

    let bestPoint: VECTOR2I | null = null;
    let bestPerp = Number.MAX_VALUE;
    let bestDistance = Number.MAX_VALUE;

    for (let ii = 0; ii < directions.length; ii++) {
      const dir = directions[ii];
      if (!dir) continue;
      const dirLength = Math.hypot(dir.x, dir.y);

      if (dirLength === 0) continue;

      const dirUnit: Vec2 = { x: dir.x / dirLength, y: dir.y / dirLength };

      const distanceAlong = delta.x * dirUnit.x + delta.y * dirUnit.y;
      const projection: Vec2 = {
        x: originVec.x + dirUnit.x * distanceAlong,
        y: originVec.y + dirUnit.y * distanceAlong,
      };
      const offset: Vec2 = {
        x: delta.x - dirUnit.x * distanceAlong,
        y: delta.y - dirUnit.y * distanceAlong,
      };
      const perpDistance = Math.hypot(offset.x, offset.y);

      let snapThreshold = aSnapRange;

      if (activeDirection !== null && activeDirection === ii) snapThreshold *= 1.5;

      if (perpDistance > snapThreshold) continue;

      let candidate: Vec2 = { ...projection };

      if (this.canUseGrid()) {
        if (dir.x === 0 && dir.y !== 0) {
          // Vertical construction line: snap to grid intersection
          candidate = { x: origin.x, y: aNearestGrid.y };
        } else if (dir.y === 0 && dir.x !== 0) {
          // Horizontal construction line: snap to grid intersection
          candidate = { x: aNearestGrid.x, y: origin.y };
        } else {
          // Diagonal construction line: find nearest grid intersection along the line.
          // Check 9 points in a 3x3 grid around the projection, and pick the closest
          // one that lies on the construction line.
          const gridOrigin: Vec2 = this.GetOrigin();
          const relProjection: Vec2 = {
            x: projection.x - gridOrigin.x,
            y: projection.y - gridOrigin.y,
          };

          const gridPoints: Vec2[] = [];

          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const gridX = KiROUND(relProjection.x / aGrid.x) * aGrid.x + dx * aGrid.x;
              const gridY = KiROUND(relProjection.y / aGrid.y) * aGrid.y + dy * aGrid.y;
              gridPoints.push({ x: gridX + gridOrigin.x, y: gridY + gridOrigin.y });
            }
          }

          // Find the grid point closest to the construction line
          let bestGridDist = Number.MAX_VALUE;
          let bestGridPt = projection;

          for (const gridPt of gridPoints) {
            const gridDelta: Vec2 = { x: gridPt.x - originVec.x, y: gridPt.y - originVec.y };
            const gridDistAlong = gridDelta.x * dirUnit.x + gridDelta.y * dirUnit.y;
            const gridProjection: Vec2 = {
              x: originVec.x + dirUnit.x * gridDistAlong,
              y: originVec.y + dirUnit.y * gridDistAlong,
            };
            const gridPerpDist = Math.hypot(
              gridPt.x - gridProjection.x,
              gridPt.y - gridProjection.y,
            );

            // Also consider distance from cursor
            const distFromCursor = Math.hypot(gridPt.x - cursorVec.x, gridPt.y - cursorVec.y);

            // Prefer grid points that are close to the line and close to cursor
            const score = gridPerpDist + distFromCursor * 0.1;

            if (score < bestGridDist) {
              bestGridDist = score;
              bestGridPt = gridPt;
            }
          }

          candidate = bestGridPt;
        }
      }

      const candidateInt: VECTOR2I = { x: KiROUND(candidate.x), y: KiROUND(candidate.y) };

      if (vecEqual(candidateInt, this.m_skipPoint)) continue;

      const candidateDistance = Math.hypot(candidateInt.x - aPoint.x, candidateInt.y - aPoint.y);

      if (
        perpDistance < bestPerp ||
        (Math.abs(perpDistance - bestPerp) < 1e-9 && candidateDistance < bestDistance)
      ) {
        bestPerp = perpDistance;
        bestDistance = candidateDistance;
        bestPoint = candidateInt;
      }
    }

    return bestPoint;
  }

  SetMask(aMask: number): void {
    this.m_maskTypes = aMask;
  }

  SetMaskFlag(aFlag: number): void {
    this.m_maskTypes |= aFlag;
  }

  ClearMaskFlag(aFlag: number): void {
    this.m_maskTypes = this.m_maskTypes & ~aFlag;
  }

  GetSnappedPoint(): VECTOR2I | null {
    return this.m_snapItem ? this.m_snapItem.pos : null;
  }

  /** `GRID_HELPER::GetGrid` (`grid_helper.cpp:362-366`). */
  GetGrid(): VECTOR2I {
    const gal = this.m_toolMgr?.GetView()?.GetGAL();
    const size = gal ? gal.GetGridSize() : this.m_manualGrid;

    return { x: KiROUND(size.x), y: KiROUND(size.y) };
  }

  /** `GRID_HELPER::GetVisibleGrid` (`grid_helper.cpp:369-372`). */
  GetVisibleGrid(): Vec2 {
    const gal = this.m_toolMgr?.GetView()?.GetGAL();

    return gal ? gal.GetVisibleGridSize() : this.m_manualVisibleGrid;
  }

  /**
   * `GRID_HELPER::GetOrigin` (`grid_helper.cpp:375-384`). Truncates rather
   * than rounds - `VECTOR2I( const VECTOR2D& )`'s casting constructor, not
   * `KiROUND`.
   */
  GetOrigin(): VECTOR2I {
    const gal = this.m_toolMgr?.GetView()?.GetGAL();

    if (gal) return toVECTOR2I(gal.GetGridOrigin());

    return this.m_manualOrigin;
  }

  /** `GRID_HELPER::canUseGrid` (`grid_helper.cpp:480-484`). */
  protected canUseGrid(): boolean {
    const gal = this.m_toolMgr?.GetView()?.GetGAL();

    return this.m_enableGrid && (gal ? gal.GetGridSnapping() : this.m_manualGridSnapping);
  }

  protected addAnchor(
    aPos: VECTOR2I,
    aFlags: number,
    aItems: EDA_ITEM | EDA_ITEM[],
    aPointTypes: number = PT_NONE,
  ): void {
    const items = Array.isArray(aItems) ? aItems : [aItems];

    if ((aFlags & this.m_maskTypes) === aFlags)
      this.m_anchors.push(new ANCHOR(aPos, aFlags, aPointTypes, items));
  }

  protected clearAnchors(): void {
    this.m_anchors = [];
  }

  /**
   * `GRID_HELPER::showConstructionGeometry`: a no-op here - the construction
   * geometry preview it toggles is not ported (see the file comment).
   */
  protected showConstructionGeometry(_aShow: boolean): void {}

  /**
   * `GRID_HELPER::enableAndGetAnchorDebug`: always `null` - the anchor debug
   * overlay is gated behind an advanced-config flag that defaults off, and
   * that overlay is not ported (see the file comment).
   */
  protected enableAndGetAnchorDebug(): null {
    return null;
  }

  /** `GRID_HELPER::updateSnapPoint` (`grid_helper.cpp:347-359`). */
  protected updateSnapPoint(aPoint: TYPED_POINT2I): void {
    if (!this.m_toolMgr) return;

    this.m_viewSnapPoint = {
      position: { ...aPoint.m_point },
      snapTypes: aPoint.m_types,
      visible: true,
    };
  }

  /** The `m_viewAxis` state; see the file comment. */
  GetAxisState(): AxisViewState {
    return { ...this.m_viewAxis };
  }

  /** The `m_viewSnapPoint` state; see the file comment. */
  GetSnapIndicatorState(): SnapIndicatorViewState {
    return { ...this.m_viewSnapPoint };
  }
}
