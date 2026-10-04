// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/tools/sch_drag_net_collision.{h,cpp}`: SCH_DRAG_NET_COLLISION_MONITOR on the live
 * model, which tracks the nets of the items a drag moves and marks, on an overlay, the junctions
 * where the drag would merge two nets and the connections it would break. (The record model's
 * version is tools/drag_net_collision.ts until S7.)
 *
 * `std::unordered_map<const SCH_ITEM*, …>` is a Map; the one place the C++ compares two item
 * pointers (recordOriginalConnections' canonical pair order) uses ptrOrdinal.
 */
import { COLOR4D_UNSPECIFIED, type Color4d, withAlpha } from '@ziroeda/common/gal/color4d.js';
import { IS_PASTED } from '@ziroeda/common/eda_item_flags.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { VIEW_OVERLAY } from '@ziroeda/common/view/view_overlay.js';
import { ptrOrdinal } from '@ziroeda/core/kicad_algo.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SCH_JUNCTION } from '../sch_junction.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { SCH_SELECTION } from './sch_selection.js';

/** `PREVIEW_NET_ASSIGNMENT`: the net a previewed item would carry. */
export interface PREVIEW_NET_ASSIGNMENT {
  item: SCH_ITEM | null;
  netCode: number | null;
}

interface COLLISION_MARKER {
  position: VECTOR2I;
  radius: number;
}

interface DISCONNECTION_MARKER {
  pointA: VECTOR2I;
  pointB: VECTOR2I;
  radius: number;
}

interface ORIGINAL_CONNECTION {
  itemA: SCH_ITEM;
  indexA: number;
  itemB: SCH_ITEM;
  indexB: number;
}

const samePoint = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

const sameColor = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Helper responsible for tracking the original net assignments of items involved in a drag
 * operation and providing visual feedback when the drag would create an unintended net merge.
 */
export class SCH_DRAG_NET_COLLISION_MONITOR {
  private m_frame: SCH_EDIT_FRAME;
  private m_view: VIEW;
  private m_overlay: VIEW_OVERLAY | null = null;
  private m_itemNetCodes = new Map<SCH_ITEM, number | null>();
  private m_sheetPath: SCH_SHEET_PATH | null = null;
  private m_originalConnections: ORIGINAL_CONNECTION[] = [];
  private m_hasCollision = false;

  constructor(aFrame: SCH_EDIT_FRAME, aView: VIEW) {
    this.m_frame = aFrame;
    this.m_view = aView;
  }

  /** `~SCH_DRAG_NET_COLLISION_MONITOR`. */
  Destroy(): void {
    this.Reset();
  }

  Initialize(aSelection: SCH_SELECTION): void {
    this.m_itemNetCodes.clear();
    this.m_originalConnections = [];
    this.m_sheetPath = this.m_frame.GetCurrentSheet().Clone();
    this.m_hasCollision = false;

    const items = this.m_frame.GetScreen()!.Items();

    for (const item of items) this.recordItemNet(item);

    for (const edaItem of aSelection.GetItems()) this.recordItemNet(edaItem as SCH_ITEM);

    this.recordOriginalConnections(aSelection);
  }

  Update(
    aJunctions: readonly SCH_JUNCTION[],
    aSelection: SCH_SELECTION,
    aPreviewAssignments: readonly PREVIEW_NET_ASSIGNMENT[] = [],
  ): boolean {
    const previewNetCodes = new Map<SCH_ITEM, number | null>();

    for (const assignment of aPreviewAssignments) {
      if (!assignment.item) continue;

      previewNetCodes.set(assignment.item, assignment.netCode);
    }

    const markers: COLLISION_MARKER[] = [];

    for (const junction of aJunctions) {
      const marker = this.analyzeJunction(junction, aSelection, previewNetCodes);

      if (marker) markers.push(marker);
    }

    const disconnections = this.collectDisconnectedMarkers(aSelection);

    if (markers.length === 0 && disconnections.length === 0) {
      this.clearOverlay();
      this.m_hasCollision = false;
      return false;
    }

    this.ensureOverlay();
    const overlay = this.m_overlay!;
    overlay.Clear();

    let baseColor: Color4d = { r: 1.0, g: 0.0, b: 0.0, a: 0.8 };

    const colorSettings = this.m_frame.GetColorSettings();

    if (colorSettings) {
      const themeColor = colorSettings.GetColor(SCH_LAYER_ID.LAYER_DRAG_NET_COLLISION);

      if (!sameColor(themeColor, COLOR4D_UNSPECIFIED)) baseColor = themeColor;
    }

    let baseAlpha = baseColor.a;

    if (baseAlpha <= 0.0) baseAlpha = 1.0;

    const fillAlpha = clamp(baseAlpha * 0.35, 0.05, 1.0);
    const strokeAlpha = clamp(baseAlpha, 0.05, 1.0);

    overlay.SetIsFill(true);
    overlay.SetFillColor(withAlpha(baseColor, fillAlpha));
    overlay.SetIsStroke(true);
    overlay.SetStrokeColor(withAlpha(baseColor, strokeAlpha));

    let lineWidthPixels = 4;

    const cfg = this.m_frame.eeconfig();

    if (cfg) lineWidthPixels = Math.max(cfg.selection.drag_net_collision_width, 1);

    let lineWidth = this.m_view.ToWorld(lineWidthPixels) as number;

    if (lineWidth <= 0.0) lineWidth = 1.0;

    overlay.SetLineWidth(lineWidth);

    for (const marker of markers) overlay.Circle(marker.position, marker.radius);

    for (const marker of disconnections) {
      overlay.Circle(marker.pointA, marker.radius);
      overlay.Circle(marker.pointB, marker.radius);
      overlay.Line(marker.pointA, marker.pointB);
    }

    this.m_view.Update(overlay);
    this.m_hasCollision = true;
    return true;
  }

  Reset(): void {
    this.clearOverlay();
    this.m_itemNetCodes.clear();
    this.m_originalConnections = [];
    this.m_hasCollision = false;
  }

  AdjustCursor(aBaseCursor: KICURSOR): KICURSOR {
    if (this.m_hasCollision) return KICURSOR.WARNING;

    return aBaseCursor;
  }

  GetNetCode(aItem: SCH_ITEM | null): number | null {
    if (!aItem) return null;

    if (this.m_itemNetCodes.has(aItem)) return this.m_itemNetCodes.get(aItem)!;

    const connection = aItem.Connection(this.m_sheetPath);

    if (connection) {
      if (connection.IsNet() && !connection.IsUnconnected()) {
        const netCode = connection.NetCode();

        if (netCode > 0) return netCode;
      }
    }

    return null;
  }

  private analyzeJunction(
    aJunction: SCH_JUNCTION | null,
    aSelection: SCH_SELECTION,
    aPreviewNetCodes: Map<SCH_ITEM, number | null>,
  ): COLLISION_MARKER | null {
    if (!aJunction) return null;

    const position = aJunction.GetPosition();
    const items = this.m_frame.GetScreen()!.Items();

    const allNetCodes = new Set<number>();
    const movedNetCodes = new Set<number>();
    const originalNetCodes = new Set<number>();
    const movedOriginalNetCodes = new Set<number>();
    const stationaryOriginalNetCodes = new Set<number>();

    const accumulateNet = (item: SCH_ITEM | null): void => {
      if (!item) return;

      if (!item.IsConnectable()) return;

      if (
        !item.IsConnected(position) &&
        !(item.IsType([KICAD_T.SCH_LINE_T]) && item.HitTest(position))
      )
        return;

      const hasPreview = aPreviewNetCodes.has(item);
      const hasOriginal = this.m_itemNetCodes.has(item);
      let netCodeOpt: number | null = null;
      let originalNetOpt: number | null = null;

      if (hasOriginal) originalNetOpt = this.m_itemNetCodes.get(item)!;

      if (hasPreview) netCodeOpt = aPreviewNetCodes.get(item)!;
      else if (hasOriginal) netCodeOpt = this.m_itemNetCodes.get(item)!;

      const isSelectionItem = item.IsSelected() || aSelection.Contains(item);
      const isMoved = hasPreview || isSelectionItem;

      if (netCodeOpt === null) {
        if (originalNetOpt !== null) {
          originalNetCodes.add(originalNetOpt);

          if (isSelectionItem) movedOriginalNetCodes.add(originalNetOpt);
          else stationaryOriginalNetCodes.add(originalNetOpt);
        }

        return;
      }

      const netCode = netCodeOpt;
      allNetCodes.add(netCode);

      if (isMoved) movedNetCodes.add(netCode);

      if (originalNetOpt !== null) {
        originalNetCodes.add(originalNetOpt);

        if (isSelectionItem) movedOriginalNetCodes.add(originalNetOpt);
        else stationaryOriginalNetCodes.add(originalNetOpt);
      }
    };

    for (const candidate of items.Overlapping(position)) accumulateNet(candidate);

    for (const selected of aSelection.GetItems()) accumulateNet(selected as SCH_ITEM);

    const previewCollision = movedNetCodes.size > 0 && allNetCodes.size >= 2;

    let originalCollision = false;

    if (movedOriginalNetCodes.size > 0 && stationaryOriginalNetCodes.size > 0) {
      for (const movedNet of movedOriginalNetCodes) {
        for (const stationaryNet of stationaryOriginalNetCodes) {
          if (movedNet !== stationaryNet) {
            originalCollision = true;
            break;
          }
        }

        if (originalCollision) break;
      }
    }

    if (!previewCollision && !originalCollision) return null;

    const base = aJunction.GetEffectiveDiameter();

    return { position, radius: Math.max(base * 1.5, 800.0) };
  }

  private recordItemNet(aItem: SCH_ITEM | null): void {
    if (!aItem) return;

    if (!aItem.IsConnectable()) return;

    if (this.m_itemNetCodes.has(aItem)) return;

    const connection = aItem.Connection(this.m_sheetPath);

    if (connection) {
      if (connection.IsNet() && !connection.IsUnconnected()) {
        const netCode = connection.NetCode();

        if (netCode > 0) this.m_itemNetCodes.set(aItem, netCode);
        else this.m_itemNetCodes.set(aItem, null);
      } else {
        this.m_itemNetCodes.set(aItem, null);
      }
    } else {
      this.m_itemNetCodes.set(aItem, null);
    }
  }

  private recordOriginalConnections(aSelection: SCH_SELECTION): void {
    // Don't record original connections for new or pasted items (duplicates, pastes)
    // as they weren't previously connected to anything
    let hasNewOrPastedItems = false;

    for (const edaItem of aSelection.GetItems()) {
      if (edaItem.IsNew() || edaItem.GetFlags() & IS_PASTED) {
        hasNewOrPastedItems = true;
        break;
      }
    }

    if (hasNewOrPastedItems) return;

    const items = this.m_frame.GetScreen()!.Items();

    for (const edaItem of aSelection.GetItems()) {
      const item = edaItem as SCH_ITEM;

      if (!item || !item.IsConnectable()) continue;

      const points = item.GetConnectionPoints();

      for (let index = 0; index < points.length; ++index) {
        const point = points[index]!;

        for (const candidate of items.Overlapping(point)) {
          if (candidate === item || !candidate.IsConnectable()) continue;

          if (!candidate.CanConnect(item)) continue;

          if (
            !candidate.IsConnected(point) &&
            !(candidate.IsType([KICAD_T.SCH_LINE_T]) && candidate.HitTest(point))
          ) {
            continue;
          }

          const candidatePoints = candidate.GetConnectionPoints();
          let candidateIndex = -1;

          for (let candidatePos = 0; candidatePos < candidatePoints.length; ++candidatePos) {
            if (samePoint(candidatePoints[candidatePos]!, point)) {
              candidateIndex = candidatePos;
              break;
            }
          }

          if (candidateIndex === -1) continue;

          let firstItem: SCH_ITEM = item;
          let firstIndex = index;
          let secondItem: SCH_ITEM = candidate;
          let secondIndex = candidateIndex;

          // `secondItem < firstItem`: a pointer comparison, the canonical order of the pair.
          if (
            ptrOrdinal(secondItem) < ptrOrdinal(firstItem) ||
            (secondItem === firstItem && secondIndex < firstIndex)
          ) {
            [firstItem, secondItem] = [secondItem, firstItem];
            [firstIndex, secondIndex] = [secondIndex, firstIndex];
          }

          if (firstItem === secondItem) continue;

          const firstSelected = firstItem.IsSelected() || aSelection.Contains(firstItem);
          const secondSelected = secondItem.IsSelected() || aSelection.Contains(secondItem);

          if (!firstSelected && !secondSelected) continue;

          const existing = this.m_originalConnections.some(
            (c) =>
              c.itemA === firstItem &&
              c.indexA === firstIndex &&
              c.itemB === secondItem &&
              c.indexB === secondIndex,
          );

          if (existing) continue;

          this.m_originalConnections.push({
            itemA: firstItem,
            indexA: firstIndex,
            itemB: secondItem,
            indexB: secondIndex,
          });
        }
      }
    }
  }

  private collectDisconnectedMarkers(aSelection: SCH_SELECTION): DISCONNECTION_MARKER[] {
    const markers: DISCONNECTION_MARKER[] = [];

    for (const connection of this.m_originalConnections) {
      const itemA = connection.itemA;
      const itemB = connection.itemB;

      if (!itemA || !itemB) continue;

      if (!itemA.IsConnectable() || !itemB.IsConnectable()) continue;

      const pointsA = itemA.GetConnectionPoints();
      const pointsB = itemB.GetConnectionPoints();

      if (connection.indexA >= pointsA.length || connection.indexB >= pointsB.length) continue;

      const pointA = pointsA[connection.indexA]!;
      const pointB = pointsB[connection.indexB]!;

      // Check if the connection is still valid. Points match exactly.
      let stillConnected = samePoint(pointA, pointB);

      // For lines, connection is valid if the point is anywhere on the line
      if (!stillConnected && itemB.IsType([KICAD_T.SCH_LINE_T]) && itemB.HitTest(pointA, 0))
        stillConnected = true;

      if (!stillConnected && itemA.IsType([KICAD_T.SCH_LINE_T]) && itemA.HitTest(pointB, 0))
        stillConnected = true;

      if (stillConnected) continue;

      const relevant =
        itemA.IsSelected() ||
        aSelection.Contains(itemA) ||
        itemB.IsSelected() ||
        aSelection.Contains(itemB);

      if (!relevant) continue;

      const radius = Math.max(800.0, itemA.GetPenWidth(), itemB.GetPenWidth());

      markers.push({ pointA, pointB, radius });
    }

    return markers;
  }

  private ensureOverlay(): void {
    if (!this.m_overlay) this.m_overlay = this.m_view.MakeOverlay();
  }

  private clearOverlay(): void {
    if (this.m_overlay) {
      this.m_overlay.Clear();
      this.m_view.Update(this.m_overlay);
    }
  }
}
