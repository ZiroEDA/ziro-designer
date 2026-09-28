// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/tool/construction_manager.h` + `common/tool/construction_manager.cpp`:
 * `CONSTRUCTION_MANAGER`, `SNAP_LINE_MANAGER`, `SNAP_MANAGER` and
 * `CONSTRUCTION_VIEW_HANDLER` - the state behind the "construction geometry"
 * preview (line extensions, arc centres) and the snap line, glued to the
 * rendered {@link CONSTRUCTION_GEOM} through the view-handler callback.
 *
 * `common/tool/grid_helper.ts` held a reduced stand-in for this file
 * (`SnapLineManagerLite`) until this port landed; it now holds the real
 * `SNAP_MANAGER`, exactly as `GRID_HELPER::m_snapManager` does upstream.
 *
 * ### What changes for a single-threaded port
 *
 * `ACTIVATION_HELPER<T>`'s `std::mutex` is dropped - there is one JS thread,
 * so the lock/unlock pairs around state mutation are simply sequential code;
 * `wxTimer` becomes `setTimeout`/`clearTimeout`. The proposal "tag"
 * (`std::size_t`, from `hash_combine`) becomes a plain string built from each
 * item's *identity* rather than a hash of its pointer value - see
 * {@link itemIdentity} - which is strictly more correct (no collisions) for
 * the same purpose: telling two batches of the same shape apart.
 *
 * `wxLogTrace( traceSnap, ... )` calls are dropped throughout - debug
 * tracing, no behaviour.
 */

import type { EDA_ITEM } from '../eda_item.js';
import { ADVANCED_CFG } from '../advanced_config.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type {
  CONSTRUCTION_GEOM,
  CONSTRUCTION_GEOM_DRAWABLE,
  CONSTRUCTION_GEOM_SNAP_GUIDE,
} from '../preview_items/construction_geom.js';

/**
 * Interface wrapper for the construction geometry preview with a callback to
 * signal the view owner that the view needs to be updated.
 * `CONSTRUCTION_VIEW_HANDLER` (`construction_manager.h:45-61`).
 */
export abstract class CONSTRUCTION_VIEW_HANDLER {
  // An (external) construction helper view item, that this manager adds/removes
  // construction objects to/from.
  private m_constructionGeomPreview: CONSTRUCTION_GEOM;

  constructor(aHelper: CONSTRUCTION_GEOM) {
    this.m_constructionGeomPreview = aHelper;
  }

  abstract updateView(): void;

  GetViewItem(): CONSTRUCTION_GEOM {
    return this.m_constructionGeomPreview;
  }
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

const vecEqual = (a: VECTOR2I | null, b: VECTOR2I | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);

/**
 * A class that manages the geometry of a "snap line".
 *
 * This is a line that has a start point (the "snap origin") and an end point
 * (the "snap end"). The end can only be set if the origin is set; setting a
 * new origin unsets the end. `SNAP_LINE_MANAGER` (`construction_manager.h:71-150`).
 */
export class SNAP_LINE_MANAGER {
  // If a snap point is "active", extra construction geometry is added to the helper
  // extending from the snap point to the cursor.
  private m_snapLineOrigin: VECTOR2I | null = null;
  private m_snapLineEnd: VECTOR2I | null = null;

  private m_directions: VECTOR2I[] = [];
  private m_activeDirection: number | null = null;

  // The view handler to update when the snap line changes
  private m_viewHandler: CONSTRUCTION_VIEW_HANDLER;
  private m_snapManager: SNAP_MANAGER;

  /** `SNAP_LINE_MANAGER::SNAP_LINE_MANAGER` (`construction_manager.cpp:398-403`). */
  constructor(aViewHandler: CONSTRUCTION_VIEW_HANDLER) {
    this.m_viewHandler = aViewHandler;

    // `static_cast<SNAP_MANAGER*>( &aViewHandler )` + `wxASSERT( m_snapManager )`:
    // upstream only ever constructs this from `SNAP_MANAGER`'s own
    // constructor, passing itself.
    if (!(aViewHandler instanceof SNAP_MANAGER)) {
      throw new Error('SNAP_LINE_MANAGER requires a SNAP_MANAGER view handler');
    }

    this.m_snapManager = aViewHandler;

    this.SetDirections([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
  }

  /**
   * The snap point is a special point that is located at the last point the
   * cursor snapped to.
   *
   * If it is set, the construction manager may add extra construction
   * geometry to the helper extending from the snap point origin to the
   * cursor, which is the 'snap line'.
   */
  SetSnapLineOrigin(aOrigin: VECTOR2I): void {
    if (this.m_snapLineOrigin && vecEqual(this.m_snapLineOrigin, aOrigin) && !this.m_snapLineEnd) {
      this.notifyGuideChange();
      return;
    }

    this.m_snapLineOrigin = aOrigin;
    this.m_snapLineEnd = null;
    this.m_activeDirection = null;
    this.m_viewHandler.GetViewItem().ClearSnapLine();
    this.notifyGuideChange();
  }

  /**
   * Set the end point of the snap line.
   *
   * Passing `null` will unset the end point, but keep the origin.
   */
  SetSnapLineEnd(aSnapEnd: VECTOR2I | null): void {
    if (this.m_snapLineOrigin && !vecEqual(aSnapEnd, this.m_snapLineEnd)) {
      this.m_snapLineEnd = aSnapEnd;

      if (this.m_snapLineEnd) {
        this.m_activeDirection = findDirectionIndex(this.m_directions, {
          x: this.m_snapLineEnd.x - this.m_snapLineOrigin.x,
          y: this.m_snapLineEnd.y - this.m_snapLineOrigin.y,
        });
      } else {
        this.m_activeDirection = null;
      }

      if (this.m_snapLineEnd) {
        this.m_viewHandler
          .GetViewItem()
          .SetSnapLine(new SEG(this.m_snapLineOrigin, this.m_snapLineEnd));
      } else {
        this.m_viewHandler.GetViewItem().ClearSnapLine();
      }

      this.notifyGuideChange();
    }
  }

  /**
   * Clear the snap line origin and end points.
   */
  ClearSnapLine(): void {
    this.m_snapLineOrigin = null;
    this.m_snapLineEnd = null;
    this.m_activeDirection = null;
    this.m_viewHandler.GetViewItem().ClearSnapLine();
    this.notifyGuideChange();
  }

  GetSnapLineOrigin(): VECTOR2I | null {
    return this.m_snapLineOrigin;
  }

  HasCompleteSnapLine(): boolean {
    return this.m_snapLineOrigin !== null && this.m_snapLineEnd !== null;
  }

  /**
   * Inform this manager that an anchor snap has been made.
   *
   * This will also update the start or end of the snap line as appropriate.
   */
  SetSnappedAnchor(aAnchorPos: VECTOR2I): void {
    if (this.m_snapLineOrigin !== null) {
      if (
        findDirectionIndex(this.m_directions, {
          x: aAnchorPos.x - this.m_snapLineOrigin.x,
          y: aAnchorPos.y - this.m_snapLineOrigin.y,
        }) !== null
      ) {
        this.SetSnapLineEnd(aAnchorPos);
      } else {
        // Snapped to something that is not the snap line origin, so
        // this anchor is now the new snap line origin
        this.SetSnapLineOrigin(aAnchorPos);
      }
    } else {
      // If there's no snap line, start one
      this.SetSnapLineOrigin(aAnchorPos);
    }
  }

  /**
   * If the snap line is active, return the best snap point that is closest
   * to the cursor.
   *
   * If there's no active snap line, return `null`.
   *
   * If there's a snap very near, use that; otherwise, use the grid point.
   * With this point, snap to it on an H/V axis.
   *
   * Then, if there's a grid point near, snap to it on an H/V axis.
   *
   * `SNAP_LINE_MANAGER::GetNearestSnapLinePoint` (`construction_manager.cpp:561-716`).
   */
  GetNearestSnapLinePoint(
    aCursor: VECTOR2I,
    aNearestGrid: VECTOR2I,
    aDistToNearest: number | null,
    aSnapRange: number,
    aGridSize: Vec2 = { x: 0, y: 0 },
    aGridOrigin: VECTOR2I = { x: 0, y: 0 },
  ): VECTOR2I | null {
    if (!this.m_snapLineOrigin || this.m_directions.length === 0) return null;

    const gridBetterThanNearest = aDistToNearest === null || aDistToNearest > aSnapRange;
    const gridActive = aGridSize.x > 0 && aGridSize.y > 0;

    if (!gridBetterThanNearest) return null;

    const escapeRange = 2 * aSnapRange;
    const longRangeEscapeAngle = new EDA_ANGLE(4);

    const origin: Vec2 = { x: this.m_snapLineOrigin.x, y: this.m_snapLineOrigin.y };
    const cursor: Vec2 = { x: aCursor.x, y: aCursor.y };
    const delta: Vec2 = { x: cursor.x - origin.x, y: cursor.y - origin.y };

    let bestPerpDistance = Number.MAX_VALUE;
    let bestSnapPoint: VECTOR2I | null = null;

    for (const direction of this.m_directions) {
      const dirLength = Math.hypot(direction.x, direction.y);

      if (dirLength === 0.0) continue;

      const dirUnit: Vec2 = { x: direction.x / dirLength, y: direction.y / dirLength };

      const distanceAlong = delta.x * dirUnit.x + delta.y * dirUnit.y;
      const projection: Vec2 = {
        x: origin.x + dirUnit.x * distanceAlong,
        y: origin.y + dirUnit.y * distanceAlong,
      };
      const offset: Vec2 = {
        x: delta.x - dirUnit.x * distanceAlong,
        y: delta.y - dirUnit.y * distanceAlong,
      };
      const perpDistance = Math.hypot(offset.x, offset.y);

      if (perpDistance > aSnapRange) continue;

      let escaped = false;

      if (perpDistance >= escapeRange) {
        const deltaAngle = EDA_ANGLE.fromVector(delta);
        const directionAngle = EDA_ANGLE.fromVector(direction);
        const angleDiff = deltaAngle.sub(directionAngle).Normalize180().AsDegrees();

        if (Math.abs(angleDiff) > longRangeEscapeAngle.AsDegrees()) escaped = true;
      }

      if (escaped) continue;

      // Now snap the projection to the grid if the grid is active
      let snapPoint: Vec2 = { ...projection };

      if (gridActive) {
        if (direction.x === 0 && direction.y !== 0) {
          // Vertical line: keep origin X, snap Y to grid
          snapPoint = { x: origin.x, y: aNearestGrid.y };
        } else if (direction.y === 0 && direction.x !== 0) {
          // Horizontal line: snap X to grid, keep origin Y
          snapPoint = { x: aNearestGrid.x, y: origin.y };
        } else {
          // Diagonal line: find nearest grid intersection along the line
          const gridOriginD: Vec2 = { x: aGridOrigin.x, y: aGridOrigin.y };
          const relProjection: Vec2 = {
            x: projection.x - gridOriginD.x,
            y: projection.y - gridOriginD.y,
          };

          // Find nearby grid points (check 3x3 grid around projection)
          let bestGridScore = Number.MAX_VALUE;
          let bestGridPoint = projection;

          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const gridX =
                Math.round(relProjection.x / aGridSize.x) * aGridSize.x + dx * aGridSize.x;
              const gridY =
                Math.round(relProjection.y / aGridSize.y) * aGridSize.y + dy * aGridSize.y;
              const gridPt: Vec2 = { x: gridX + gridOriginD.x, y: gridY + gridOriginD.y };

              // Calculate perpendicular distance from grid point to construction line
              const gridDelta: Vec2 = { x: gridPt.x - origin.x, y: gridPt.y - origin.y };
              const gridDistAlong = gridDelta.x * dirUnit.x + gridDelta.y * dirUnit.y;
              const gridProjection: Vec2 = {
                x: origin.x + dirUnit.x * gridDistAlong,
                y: origin.y + dirUnit.y * gridDistAlong,
              };
              const gridPerpDist = Math.hypot(
                gridPt.x - gridProjection.x,
                gridPt.y - gridProjection.y,
              );

              // Also consider distance from cursor
              const distFromCursor = Math.hypot(gridPt.x - cursor.x, gridPt.y - cursor.y);

              // Prefer grid points that are close to the line and close to cursor
              const score = gridPerpDist + distFromCursor * 0.1;

              if (score < bestGridScore) {
                bestGridScore = score;
                bestGridPoint = gridPt;
              }
            }
          }

          snapPoint = bestGridPoint;
        }
      }

      if (perpDistance < bestPerpDistance) {
        bestPerpDistance = perpDistance;
        bestSnapPoint = { x: KiROUND(snapPoint.x), y: KiROUND(snapPoint.y) };
      }
    }

    return bestSnapPoint;
  }

  /** `SNAP_LINE_MANAGER::SetDirections` (`construction_manager.cpp:450-489`). */
  SetDirections(aDirections: readonly VECTOR2I[]): void {
    const uniqueDirections: VECTOR2I[] = [];

    for (const direction of aDirections) {
      const normalized = normalizeDirection(direction);

      if (normalized.x === 0 && normalized.y === 0) continue;

      if (!uniqueDirections.some((d) => d.x === normalized.x && d.y === normalized.y))
        uniqueDirections.push(normalized);
    }

    const unchanged =
      uniqueDirections.length === this.m_directions.length &&
      uniqueDirections.every((d, i) => {
        const existing = this.m_directions[i];
        return existing !== undefined && d.x === existing.x && d.y === existing.y;
      });

    if (unchanged) return;

    this.m_directions = uniqueDirections;
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
      return;
    }

    this.notifyGuideChange();
  }

  GetDirections(): readonly VECTOR2I[] {
    return this.m_directions;
  }

  GetActiveDirection(): number | null {
    return this.m_activeDirection;
  }

  /** `SNAP_LINE_MANAGER::notifyGuideChange` (`construction_manager.cpp:800-804`). */
  private notifyGuideChange(): void {
    this.m_snapManager.UpdateSnapGuides();
  }
}

/**
 * Items to be used for the construction of "virtual" anchors, for example,
 * when snapping to a point involving an _extension_ of an existing line or
 * arc. `CONSTRUCTION_MANAGER::CONSTRUCTION_ITEM` (`construction_manager.h:163-183`).
 */
export enum CONSTRUCTION_MANAGER_SOURCE {
  FROM_ITEMS,
  FROM_SNAP_LINE,
}

export interface CONSTRUCTION_ITEM_DRAWABLE_ENTRY {
  Drawable: CONSTRUCTION_GEOM_DRAWABLE;
  LineWidth: number;
}

export interface CONSTRUCTION_ITEM {
  Source: CONSTRUCTION_MANAGER_SOURCE;
  /** One item can have multiple construction items (e.g. an arc can have a circle and centre point). */
  Item: EDA_ITEM | null;
  Constructions: CONSTRUCTION_ITEM_DRAWABLE_ENTRY[];
}

/**
 * A single batch of construction items. One batch contains all the items
 * (and associated construction geometry) that should be shown for one point
 * of interest. More than one batch may be shown on the screen at the same
 * time.
 */
export type CONSTRUCTION_ITEM_BATCH = CONSTRUCTION_ITEM[];

interface PENDING_BATCH {
  Batch: CONSTRUCTION_ITEM_BATCH;
  IsPersistent: boolean;
}

/**
 * A helper class to manage the activation of a "proposal" after a timeout.
 *
 * When a proposal is made, a timer starts. If no new proposal is made and the
 * proposal is not canceled before the timer expires, the proposal is
 * "accepted" via a callback.
 *
 * Proposals are "tagged" - this is used to avoid reproposing the same thing
 * multiple times. `ACTIVATION_HELPER<T>` (`construction_manager.cpp:44-160`).
 */
class ACTIVATION_HELPER<T> {
  private m_timeoutMs: number;
  private m_callback: (aProposal: T) => void;

  private m_pendingProposalTag: string | null = null;
  private m_lastAcceptedProposalTag: string | null = null;
  private m_lastProposal: T | undefined;

  private m_timer: ReturnType<typeof setTimeout> | null = null;

  constructor(aTimeoutMs: number, aCallback: (aProposal: T) => void) {
    this.m_timeoutMs = aTimeoutMs;
    this.m_callback = aCallback;
  }

  /** `~ACTIVATION_HELPER`: stop the timer and drop any pending proposal. */
  Dispose(): void {
    if (this.m_timer !== null) clearTimeout(this.m_timer);

    this.m_timer = null;
    this.m_pendingProposalTag = null;
  }

  ProposeActivation(aProposal: T, aProposalTag: string, aAcceptImmediately: boolean): void {
    if (
      this.m_lastAcceptedProposalTag !== null &&
      aProposalTag === this.m_lastAcceptedProposalTag
    ) {
      // This proposal was accepted last time
      // (could be made optional if we want to allow re-accepting the same proposal)
      return;
    }

    if (this.m_pendingProposalTag !== null && aProposalTag === this.m_pendingProposalTag) {
      // This proposal is already pending
      return;
    }

    this.m_pendingProposalTag = aProposalTag;
    this.m_lastProposal = aProposal;

    if (aAcceptImmediately) {
      // Synchronously accept the proposal
      this.acceptPendingProposal();
    } else {
      if (this.m_timer !== null) clearTimeout(this.m_timer);

      this.m_timer = setTimeout(() => this.acceptPendingProposal(), this.m_timeoutMs);
    }
  }

  CancelProposal(): void {
    this.m_pendingProposalTag = null;

    if (this.m_timer !== null) {
      clearTimeout(this.m_timer);
      this.m_timer = null;
    }
  }

  private acceptPendingProposal(): void {
    if (this.m_pendingProposalTag !== null) {
      this.m_lastAcceptedProposalTag = this.m_pendingProposalTag;
      this.m_pendingProposalTag = null;

      const proposalToAccept = this.m_lastProposal as T;
      this.m_lastProposal = undefined;

      this.m_callback(proposalToAccept);
    }
  }
}

/** Sequential identity for an `EDA_ITEM`, standing in for its C++ pointer value in a hash. */
let s_nextItemIdentity = 1;
const s_itemIdentities = new WeakMap<EDA_ITEM, number>();

function itemIdentity(aItem: EDA_ITEM | null): number {
  if (!aItem) return 0;

  let id = s_itemIdentities.get(aItem);

  if (id === undefined) {
    id = s_nextItemIdentity++;
    s_itemIdentities.set(aItem, id);
  }

  return id;
}

/**
 * `HashConstructionBatchSources` (`construction_manager.cpp:180-192`): a
 * string key from the batch's `(Source, Item identity)` pairs and the
 * persistence flag, standing in for `hash_combine` over the pointer values.
 */
function hashConstructionBatchSources(
  aBatch: CONSTRUCTION_ITEM_BATCH,
  aIsPersistent: boolean,
): string {
  const parts: string[] = [aIsPersistent ? '1' : '0'];

  for (const item of aBatch) parts.push(`${item.Source}:${itemIdentity(item.Item)}`);

  return parts.join('|');
}

/**
 * A class that manages "construction" objects and geometry.
 *
 * These are things like line extensions, arc centers, etc.
 * `CONSTRUCTION_MANAGER` (`construction_manager.h:158-240`,
 * `construction_manager.cpp:163-360`).
 */
export class CONSTRUCTION_MANAGER {
  private m_viewHandler: CONSTRUCTION_VIEW_HANDLER;

  /// Within one "operation", there is one set of construction items that are
  /// "persistent", and are always shown. Usually the original item and any
  /// extensions.
  private m_persistentConstructionBatch: CONSTRUCTION_ITEM_BATCH | null = null;

  /// Temporary construction items are added and removed as needed.
  private m_temporaryConstructionBatches: CONSTRUCTION_ITEM_BATCH[] = [];

  /// Set of all items for which construction geometry has been added.
  private m_involvedItems = new Set<EDA_ITEM | null>();

  private m_activationHelper: ACTIVATION_HELPER<PENDING_BATCH>;

  constructor(aHelper: CONSTRUCTION_VIEW_HANDLER) {
    this.m_viewHandler = aHelper;

    const acceptanceTimeoutMs = ADVANCED_CFG.GetCfg().m_ExtensionSnapTimeoutMs;

    this.m_activationHelper = new ACTIVATION_HELPER<PENDING_BATCH>(
      acceptanceTimeoutMs,
      (aAccepted) => this.acceptConstructionItems(aAccepted),
    );
  }

  /**
   * Add a batch of construction items to the helper.
   *
   * @param aBatch The batch of construction items to add.
   * @param aIsPersistent If true, the batch is considered "persistent" and
   *                       will always be shown (and it will replace any
   *                       previous persistent batch). If false, the batch is
   *                       temporary and may be pushed out by other batches.
   */
  ProposeConstructionItems(aBatch: CONSTRUCTION_ITEM_BATCH, aIsPersistent: boolean): void {
    if (aBatch.length === 0) {
      // There's no point in proposing an empty batch
      // It would just clear existing construction items for nothing new
      return;
    }

    const acceptImmediately = aIsPersistent
      ? true
      : this.m_temporaryConstructionBatches.length < this.getMaxTemporaryBatches();

    const pendingBatch: PENDING_BATCH = { Batch: aBatch, IsPersistent: aIsPersistent };
    const hash = hashConstructionBatchSources(pendingBatch.Batch, aIsPersistent);

    // Immediate or not, propose the batch via the activation helper as this handles duplicates
    this.m_activationHelper.ProposeActivation(pendingBatch, hash, acceptImmediately);
  }

  /**
   * Cancel outstanding proposals for new geometry.
   */
  CancelProposal(): void {
    this.m_activationHelper.CancelProposal();
  }

  /**
   * How many batches of temporary construction items can be active at once.
   *
   * This is to prevent too much clutter.
   */
  private getMaxTemporaryBatches(): number {
    // We only keep up to one previous temporary batch and the current one
    // we could make this a setting if we want to keep more, but it gets cluttered
    return 2;
  }

  private acceptConstructionItems(aAcceptedBatch: PENDING_BATCH): void {
    const getInvolved = (aBatchToAdd: CONSTRUCTION_ITEM_BATCH): void => {
      for (const item of aBatchToAdd) {
        // Only show the item if it's not already involved
        // (avoid double-drawing the same item)
        if (!this.m_involvedItems.has(item.Item)) this.m_involvedItems.add(item.Item);
      }
    };

    if (aAcceptedBatch.IsPersistent) {
      // We only keep one previous persistent batch for the moment
      this.m_persistentConstructionBatch = aAcceptedBatch.Batch;
    } else {
      let anyNewItems = false;

      for (const item of aAcceptedBatch.Batch) {
        if (!this.m_involvedItems.has(item.Item)) {
          anyNewItems = true;
          break;
        }
      }

      // If there are no new items involved, don't bother adding the batch
      if (!anyNewItems) return;

      while (this.m_temporaryConstructionBatches.length >= this.getMaxTemporaryBatches())
        this.m_temporaryConstructionBatches.shift();

      this.m_temporaryConstructionBatches.push(aAcceptedBatch.Batch);
    }

    this.m_involvedItems.clear();

    // Copies for consistency with the persistent/temporary batches at this instant
    const persistentBatches: CONSTRUCTION_ITEM_BATCH[] = [];
    const temporaryBatches: CONSTRUCTION_ITEM_BATCH[] = [];

    if (this.m_persistentConstructionBatch) {
      getInvolved(this.m_persistentConstructionBatch);
      persistentBatches.push(this.m_persistentConstructionBatch);
    }

    for (const batch of this.m_temporaryConstructionBatches) {
      getInvolved(batch);
      temporaryBatches.push(batch);
    }

    const geom = this.m_viewHandler.GetViewItem();
    geom.ClearDrawables();

    const addDrawables = (aBatches: CONSTRUCTION_ITEM_BATCH[], aIsPersistent: boolean): void => {
      for (const batch of aBatches) {
        for (const item of batch) {
          for (const drawable of item.Constructions) {
            geom.AddDrawable(drawable.Drawable, aIsPersistent, drawable.LineWidth);
          }
        }
      }
    };

    addDrawables(persistentBatches, true);
    addDrawables(temporaryBatches, false);

    this.m_viewHandler.updateView();
  }

  /**
   * Check if all 'real' (non-null = constructed) the items in the batch are
   * in the list of items currently 'involved' in an active construction.
   */
  InvolvesAllGivenRealItems(aItems: readonly (EDA_ITEM | null)[]): boolean {
    for (const item of aItems) {
      // Null items (i.e. construction items) are always considered involved
      if (item && !this.m_involvedItems.has(item)) return false;
    }

    return true;
  }

  /**
   * Get the list of additional geometry items that should be considered.
   */
  GetConstructionItems(aToExtend: CONSTRUCTION_ITEM_BATCH[]): void {
    if (this.m_persistentConstructionBatch) aToExtend.push(this.m_persistentConstructionBatch);

    for (const batch of this.m_temporaryConstructionBatches) aToExtend.push(batch);
  }

  HasActiveConstruction(): boolean {
    return (
      this.m_persistentConstructionBatch !== null || this.m_temporaryConstructionBatches.length > 0
    );
  }

  /**
   * Clear all construction items.
   */
  Clear(): void {
    this.m_persistentConstructionBatch = null;
    this.m_temporaryConstructionBatches = [];
    this.m_involvedItems.clear();
    this.CancelProposal();
  }
}

/**
 * A `SNAP_MANAGER` glues together the snap line manager and construction
 * manager, along with some other state. It provides information for
 * generating snap anchors based on this state, as well as keeping the state
 * of visible construction geometry involved in that process.
 *
 * Probably only used by `GRID_HELPER`s, but it's neater to keep it separate,
 * as there's quite a bit of state to manage.
 *
 * This is also where you may wish to add other 'virtual' snapping state,
 * such as 'equal-space' snapping, etc. `SNAP_MANAGER` (`construction_manager.h:250-297`).
 */
export class SNAP_MANAGER extends CONSTRUCTION_VIEW_HANDLER {
  private m_updateCallback: ((aShowAnything: boolean) => void) | null = null;

  // `!`: assigned in the constructor below, but only once `new
  // SNAP_LINE_MANAGER( this )` *returns* - unlike upstream, where the
  // sub-object's memory (and so `GetSnapLineManager()`'s reference to it)
  // already exists the moment its own constructor starts running. See
  // {@link UpdateSnapGuides}'s guard for the one place that matters.
  private m_snapLineManager!: SNAP_LINE_MANAGER;
  private m_constructionManager!: CONSTRUCTION_MANAGER;

  private m_referenceOnlyPoints: VECTOR2I[] = [];
  private m_snapGuideColor = '#ffffff';
  private m_snapGuideHighlightColor = '#ffffff';

  constructor(aHelper: CONSTRUCTION_GEOM) {
    super(aHelper);

    this.m_snapLineManager = new SNAP_LINE_MANAGER(this);
    this.m_constructionManager = new CONSTRUCTION_MANAGER(this);
  }

  /**
   * Set the callback to call when the construction geometry changes and a
   * view may need updating.
   */
  SetUpdateCallback(aCallback: (aShowAnything: boolean) => void): void {
    this.m_updateCallback = aCallback;
  }

  GetSnapLineManager(): SNAP_LINE_MANAGER {
    return this.m_snapLineManager;
  }

  GetConstructionManager(): CONSTRUCTION_MANAGER {
    return this.m_constructionManager;
  }

  /**
   * Set the reference-only points - these are points that are not snapped
   * to, but can still be used for connection to the snap line.
   */
  SetReferenceOnlyPoints(aPoints: VECTOR2I[]): void {
    this.m_referenceOnlyPoints = aPoints;
  }

  GetReferenceOnlyPoints(): readonly VECTOR2I[] {
    return this.m_referenceOnlyPoints;
  }

  /**
   * Get a list of all the active construction geometry, computed from the
   * combined state of the snap line and construction manager.
   *
   * This can be combined with other external geometry to compute snap
   * anchors. `SNAP_MANAGER::GetConstructionItems` (`construction_manager.cpp:770-793`).
   */
  GetConstructionItems(): CONSTRUCTION_ITEM_BATCH[] {
    const batches: CONSTRUCTION_ITEM_BATCH[] = [];

    this.m_constructionManager.GetConstructionItems(batches);

    const snapLineOrigin = this.m_snapLineManager.GetSnapLineOrigin();

    if (snapLineOrigin) {
      const batch: CONSTRUCTION_ITEM_BATCH = [];

      const snapPointItem: CONSTRUCTION_ITEM = {
        Source: CONSTRUCTION_MANAGER_SOURCE.FROM_SNAP_LINE,
        Item: null,
        Constructions: [],
      };
      batch.push(snapPointItem);

      const directions = this.m_snapLineManager.GetDirections();
      const activeDirection = this.m_snapLineManager.GetActiveDirection();

      for (let ii = 0; ii < directions.length; ii++) {
        const direction = directions[ii];

        if (!direction) continue;

        const scaledDirection = { x: direction.x * 100000, y: direction.y * 100000 };

        snapPointItem.Constructions.push({
          Drawable: new SEG(snapLineOrigin, {
            x: snapLineOrigin.x + scaledDirection.x,
            y: snapLineOrigin.y + scaledDirection.y,
          }),
          LineWidth: activeDirection !== null && activeDirection === ii ? 2 : 1,
        });
      }

      if (snapPointItem.Constructions.length > 0) batches.push(batch);
    }

    return batches;
  }

  SetSnapGuideColors(aBase: string, aHighlight: string): void {
    this.m_snapGuideColor = aBase;
    this.m_snapGuideHighlightColor = aHighlight;
    this.UpdateSnapGuides();
  }

  /**
   * `SNAP_MANAGER::UpdateSnapGuides` (`construction_manager.cpp:730-767`).
   *
   * `SNAP_LINE_MANAGER`'s own constructor (via its default `SetDirections`
   * call) reaches this before `this.m_snapLineManager` above is assigned -
   * see its comment. At that point the snap line has no origin yet either,
   * so a fully-wired call would produce the same empty `guides` upstream's
   * own reentrant call does (`m_updateCallback` is also unset that early, so
   * `updateView()` below is a no-op regardless); skip explicitly instead of
   * faulting on the unassigned field.
   */
  UpdateSnapGuides(): void {
    const guides: CONSTRUCTION_GEOM_SNAP_GUIDE[] = [];

    const origin = this.m_snapLineManager?.GetSnapLineOrigin();
    const directions = this.m_snapLineManager?.GetDirections() ?? [];

    if (origin && directions.length > 0) {
      const activeDirection = this.m_snapLineManager.GetActiveDirection();
      const guideLength = 500000;

      for (let ii = 0; ii < directions.length; ii++) {
        const direction = directions[ii];

        if (!direction || (direction.x === 0 && direction.y === 0)) continue;

        const scaled = { x: direction.x * guideLength, y: direction.y * guideLength };

        const isActive = activeDirection !== null && activeDirection === ii;

        guides.push({
          Segment: new SEG(
            { x: origin.x - scaled.x, y: origin.y - scaled.y },
            { x: origin.x + scaled.x, y: origin.y + scaled.y },
          ),
          LineWidth: isActive ? 5 : 1,
          Color: isActive ? this.m_snapGuideHighlightColor : this.m_snapGuideColor,
        });
      }
    }

    this.GetViewItem().SetSnapGuides(guides);
    this.updateView();
  }

  Clear(): void {
    this.m_snapLineManager.ClearSnapLine();
    this.m_constructionManager.Clear();
    this.UpdateSnapGuides();
  }

  /** `SNAP_MANAGER::updateView` (`construction_manager.cpp:719-727`). */
  override updateView(): void {
    if (this.m_updateCallback) {
      const showAnything =
        this.m_constructionManager.HasActiveConstruction() ||
        this.m_snapLineManager.HasCompleteSnapLine() ||
        (this.m_snapLineManager.GetSnapLineOrigin() !== null &&
          this.m_snapLineManager.GetDirections().length > 0);

      this.m_updateCallback(showAnything);
    }
  }
}
