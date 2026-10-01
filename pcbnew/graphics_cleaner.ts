// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRAPHICS_CLEANER` (pcbnew/graphics_cleaner.cpp, graphics_cleaner.h), on the
 * live BOARD: Cleanup Graphics' four passes over a drawing list - redundant
 * (null and duplicated) shapes, board outlines joined end to end, four lines
 * that make a rectangle merged into one, and (footprint editor) pads rebuilt
 * from the shapes around them.
 *
 * ## What "equivalent" means, and what it ignores
 *
 * Two shapes are duplicates if their kind, layer and width match exactly and
 * their defining points coincide within the DRC epsilon. Fill, stroke type and
 * locked state are not compared, so a filled rectangle and an unfilled one
 * drawn over it are duplicates. The comparison is per defining point: a circle
 * compares its stored circumference point, not its radius, and an arc compares
 * centre, start and end but not the mid point, so a minor and a major arc over
 * the same chord count as duplicates. Polygons are never deduplicated (an
 * upstream TODO). All of it upstream's, mirrored rather than improved.
 */
import { IS_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { ARC_HIGH_DEF } from '@ziroeda/common/eda_units.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_COMMIT } from './board_commit.js';
import type { BOARD_ITEM } from './board_item.js';
import { CLEANUP_ITEM, CLEANUP_RC_CODE } from './cleanup_item.js';
import { ConnectBoardShapes } from './fix_board_shape.js';
import type { FOOTPRINT } from './footprint.js';
import { PCB_SHAPE } from './pcb_shape.js';
import type { PAD_TOOL } from './tools/pad_tool.js';

/** `equivalent( a, b, epsilon )`: each axis within epsilon, exclusive. */
function equivalent(a: VECTOR2I, b: VECTOR2I, epsilon: number): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

const asShape = (aItem: BOARD_ITEM): PCB_SHAPE | null =>
  aItem instanceof PCB_SHAPE ? aItem : null;

/** `SIDE_CANDIDATE`: an axis-aligned segment, its ends ordered low to high. */
class SIDE_CANDIDATE {
  start: VECTOR2I;
  end: VECTOR2I;

  constructor(readonly shape: PCB_SHAPE) {
    this.start = shape.GetStart();
    this.end = shape.GetEnd();

    if (this.start.x > this.end.x || this.start.y > this.end.y)
      [this.start, this.end] = [this.end, this.start];
  }
}

const ptKey = (p: VECTOR2I): string => `${p.x},${p.y}`;

export class GRAPHICS_CLEANER {
  private m_dryRun = true;
  private m_epsilon = 1;
  private m_maxError = ARC_HIGH_DEF;
  private m_outlinesTolerance = 0;
  private m_itemsList: CLEANUP_ITEM[] | null = null;

  constructor(
    private readonly m_drawings: readonly BOARD_ITEM[],
    private readonly m_parentFootprint: FOOTPRINT | null,
    private readonly m_commit: BOARD_COMMIT,
    private readonly m_toolMgr: TOOL_MANAGER | null,
  ) {}

  CleanupBoard(
    aDryRun: boolean,
    aItemsList: CLEANUP_ITEM[],
    aMergeRects: boolean,
    aDeleteRedundant: boolean,
    aMergePads: boolean,
    aFixBoardOutlines: boolean,
    aTolerance: number,
  ): void {
    this.m_dryRun = aDryRun;
    this.m_itemsList = aItemsList;
    this.m_outlinesTolerance = aTolerance;

    const bds = this.m_commit.GetBoard()!.GetDesignSettings();
    this.m_epsilon = bds.GetDRCEpsilon();
    this.m_maxError = bds.m_MaxError;

    // Clear the flag used to mark some shapes as deleted, in dry run:
    for (const drawing of this.m_drawings) drawing.ClearFlags(IS_DELETED);

    if (aDeleteRedundant) this.cleanupShapes();

    if (aFixBoardOutlines) this.fixBoardOutlines();

    if (aMergeRects) this.mergeRects();

    if (aMergePads) this.mergePads();

    // Clear the flag used to mark some shapes:
    for (const drawing of this.m_drawings) drawing.ClearFlags(IS_DELETED);
  }

  private isNullShape(aShape: PCB_SHAPE): boolean {
    switch (aShape.GetShape()) {
      case SHAPE_T.SEGMENT:
      case SHAPE_T.RECTANGLE:
      case SHAPE_T.ARC:
        return equivalent(aShape.GetStart(), aShape.GetEnd(), this.m_epsilon);

      case SHAPE_T.CIRCLE:
        return aShape.GetRadius() === 0;

      case SHAPE_T.POLY:
        return aShape.GetPointCount() === 0;

      case SHAPE_T.BEZIER:
        aShape.RebuildBezierToSegmentsPointsList(this.m_maxError);

        // If the Bezier points list contains 2 points, it is equivalent to a segment
        if (aShape.GetBezierPoints().length === 2)
          return equivalent(aShape.GetStart(), aShape.GetEnd(), this.m_epsilon);

        // If the Bezier points list contains 1 points, it is equivalent to a point
        return aShape.GetBezierPoints().length < 2;

      default:
        // UNIMPLEMENTED_FOR( aShape->SHAPE_T_asString() )
        return false;
    }
  }

  private areEquivalent(aShape1: PCB_SHAPE, aShape2: PCB_SHAPE): boolean {
    if (
      aShape1.GetShape() !== aShape2.GetShape() ||
      aShape1.GetLayer() !== aShape2.GetLayer() ||
      aShape1.GetWidth() !== aShape2.GetWidth()
    ) {
      return false;
    }

    const eps = this.m_epsilon;

    switch (aShape1.GetShape()) {
      case SHAPE_T.SEGMENT:
      case SHAPE_T.RECTANGLE:
      case SHAPE_T.CIRCLE:
        return (
          equivalent(aShape1.GetStart(), aShape2.GetStart(), eps) &&
          equivalent(aShape1.GetEnd(), aShape2.GetEnd(), eps)
        );

      case SHAPE_T.ARC:
        return (
          equivalent(aShape1.GetCenter(), aShape2.GetCenter(), eps) &&
          equivalent(aShape1.GetStart(), aShape2.GetStart(), eps) &&
          equivalent(aShape1.GetEnd(), aShape2.GetEnd(), eps)
        );

      case SHAPE_T.POLY:
        // TODO
        return false;

      case SHAPE_T.BEZIER:
        return (
          equivalent(aShape1.GetStart(), aShape2.GetStart(), eps) &&
          equivalent(aShape1.GetEnd(), aShape2.GetEnd(), eps) &&
          equivalent(aShape1.GetBezierC1(), aShape2.GetBezierC1(), eps) &&
          equivalent(aShape1.GetBezierC2(), aShape2.GetBezierC2(), eps)
        );

      default:
        // wxFAIL_MSG( "GRAPHICS_CLEANER::areEquivalent unimplemented for " ... )
        return false;
    }
  }

  private cleanupShapes(): void {
    // Remove duplicate shapes (2 superimposed identical shapes):
    for (let it = 0; it < this.m_drawings.length; it++) {
      const shape = asShape(this.m_drawings[it]!);

      if (!shape || shape.HasFlag(IS_DELETED)) continue;

      if (this.isNullShape(shape)) {
        const item = new CLEANUP_ITEM(CLEANUP_RC_CODE.CLEANUP_NULL_GRAPHIC);
        item.SetItems(shape);
        this.m_itemsList!.push(item);

        if (!this.m_dryRun) this.m_commit.Remove(shape);

        continue;
      }

      for (let it2 = it + 1; it2 < this.m_drawings.length; it2++) {
        const shape2 = asShape(this.m_drawings[it2]!);

        if (!shape2 || shape2.HasFlag(IS_DELETED)) continue;

        if (this.areEquivalent(shape, shape2)) {
          const item = new CLEANUP_ITEM(CLEANUP_RC_CODE.CLEANUP_DUPLICATE_GRAPHIC);
          item.SetItems(shape2);
          this.m_itemsList!.push(item);

          shape2.SetFlags(IS_DELETED);

          if (!this.m_dryRun) this.m_commit.Remove(shape2);
        }
      }
    }
  }

  private fixBoardOutlines(): void {
    if (this.m_dryRun) return;

    const shapeList: PCB_SHAPE[] = [];

    for (const item of this.m_drawings) {
      const shape = asShape(item);

      if (!shape || !shape.IsOnLayer(PCB_LAYER_ID.Edge_Cuts)) continue;

      shapeList.push(shape);

      if (!this.m_dryRun) this.m_commit.Modify(shape);
    }

    ConnectBoardShapes(shapeList, this.m_outlinesTolerance);
  }

  private mergeRects(): void {
    const sides: SIDE_CANDIDATE[] = [];
    const ptMap = new Map<string, SIDE_CANDIDATE[]>();
    const at = (p: VECTOR2I): SIDE_CANDIDATE[] => ptMap.get(ptKey(p)) ?? [];

    // First load all the candidates into the side vector and layer maps
    for (const item of this.m_drawings) {
      const shape = asShape(item);

      if (!shape || this.isNullShape(shape) || shape.GetShape() !== SHAPE_T.SEGMENT) continue;

      if (shape.GetStart().x === shape.GetEnd().x || shape.GetStart().y === shape.GetEnd().y) {
        const side = new SIDE_CANDIDATE(shape);
        sides.push(side);

        const key = ptKey(side.start);
        if (!ptMap.has(key)) ptMap.set(key, []);
        ptMap.get(key)!.push(side);
      }
    }

    // Now go through the sides and try and match lines into rectangles
    for (const side of sides) {
      if (side.shape.HasFlag(IS_DELETED)) continue;

      let left: SIDE_CANDIDATE | null = null;
      let top: SIDE_CANDIDATE | null = null;
      let right: SIDE_CANDIDATE | null = null;
      let bottom: SIDE_CANDIDATE | null = null;

      const viable = (aCandidate: SIDE_CANDIDATE): boolean =>
        aCandidate.shape.GetLayer() === side.shape.GetLayer() &&
        aCandidate.shape.GetWidth() === side.shape.GetWidth() &&
        !aCandidate.shape.HasFlag(IS_DELETED);

      if (side.start.x === side.end.x) {
        // We've found a possible left; see if we have a top
        left = side;

        for (const candidate of at(left.start)) {
          if (candidate !== left && viable(candidate)) {
            top = candidate;
            break;
          }
        }
      } else if (side.start.y === side.end.y) {
        // We've found a possible top; see if we have a left
        top = side;

        for (const candidate of at(top.start)) {
          if (candidate !== top && viable(candidate)) {
            left = candidate;
            break;
          }
        }
      }

      if (top && left) {
        // See if we can fill in the other two sides
        for (const candidate of at(top.end)) {
          if (candidate !== top && candidate !== left && viable(candidate)) {
            right = candidate;
            break;
          }
        }

        for (const candidate of at(left.end)) {
          if (candidate !== top && candidate !== left && viable(candidate)) {
            bottom = candidate;
            break;
          }
        }

        if (right && bottom && right.end.x === bottom.end.x && right.end.y === bottom.end.y) {
          left.shape.SetFlags(IS_DELETED);
          top.shape.SetFlags(IS_DELETED);
          right.shape.SetFlags(IS_DELETED);
          bottom.shape.SetFlags(IS_DELETED);

          const item = new CLEANUP_ITEM(CLEANUP_RC_CODE.CLEANUP_LINES_TO_RECT);
          item.SetItems(left.shape, top.shape, right.shape, bottom.shape);
          this.m_itemsList!.push(item);

          if (!this.m_dryRun) {
            const rect = new PCB_SHAPE(this.m_parentFootprint);

            rect.SetShape(SHAPE_T.RECTANGLE);
            rect.SetFilled(false);
            rect.SetStart(top.start);
            rect.SetEnd(bottom.end);
            rect.SetLayer(top.shape.GetLayer());
            rect.SetStroke(top.shape.GetStroke());

            this.m_commit.Add(rect);
            this.m_commit.Remove(left.shape);
            this.m_commit.Remove(top.shape);
            this.m_commit.Remove(right.shape);
            this.m_commit.Remove(bottom.shape);
          }
        }
      }
    }
  }

  private mergePads(): void {
    // wxCHECK_MSG( m_parentFootprint, ..., "mergePads() is FootprintEditor only" )
    if (!this.m_parentFootprint) return;

    const padTool = this.m_toolMgr?.FindTool('pcbnew.PadTool') as unknown as PAD_TOOL | null;
    const padToNetTieGroupMap = this.m_parentFootprint.MapPadNumbersToNetTieGroups();

    if (!padTool) return;

    for (const pad of this.m_parentFootprint.Pads()) {
      // Don't merge a pad that's in a net-tie pad group.  (We don't care which group.)
      if ((padToNetTieGroupMap.get(pad.GetNumber()) ?? -1) >= 0) continue;

      if (this.m_commit.GetStatus(this.m_parentFootprint) === 0)
        this.m_commit.Modify(this.m_parentFootprint);

      const shapes = padTool.RecombinePad(pad, this.m_dryRun);

      if (shapes.length > 0) {
        const item = new CLEANUP_ITEM(CLEANUP_RC_CODE.CLEANUP_MERGE_PAD);

        for (const shape of shapes) item.AddItem(shape);

        item.AddItem(pad);

        this.m_itemsList!.push(item);
      }
    }
  }
}
