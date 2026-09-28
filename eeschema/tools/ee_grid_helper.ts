// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EE_GRID_HELPER` - `eeschema/tools/ee_grid_helper.{h,cpp}`, a subclass of the
 * one `GRID_HELPER` in `common/tool/grid_helper.ts`, exactly as upstream
 * derives it. The anchor list, the flags, the grid and the snap manager are the
 * base's; this file adds eeschema's anchor collection (`computeAnchors`), its
 * own `nearestAnchor`, `BestSnapAnchor`, `BestDragOrigin` and the per-item
 * grid choice.
 *
 * ### Over the plain `Schematic`
 *
 * The schematic here is plain data, not `SCH_ITEM`s, so:
 *
 *  - the `VIEW` that `queryVisible` asks is {@link EE_GRID_HELPER.SetSchematic}:
 *    the sheet and its library, with each item's extent from `alignBoxes`
 *    (widened to its connection points, which a symbol's view box includes);
 *  - items are named by their ids (`refId`), so `aSkip` / a selection is a set
 *    of ids;
 *  - an anchor's `items` list stays empty; which item it came from - and so
 *    whether it is `IsConnectable()` for `nearestAnchor`'s grid filter - is
 *    kept beside it.
 *
 * ### Not ported
 *
 *  - `queryVisible`'s visibility and LOD tests (hidden layers, symbol-editor
 *    private items): every item on the sheet is visible here.
 *  - `m_viewAxis` / `m_viewSnapPoint` as view items: the base keeps their
 *    state for the canvas to draw.
 */

import {
  ANCHOR,
  ANCHOR_FLAGS,
  GRID_HELPER,
  GRID_HELPER_GRIDS,
} from '@ziroeda/common/tool/grid_helper.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { PT_NONE, TYPED_POINT2I } from '@ziroeda/kimath/src/geometry/point_types.js';
import { TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { localToWorld, symbolTransform } from '@ziroeda/kimath/src/transform.js';
import type { LibSymbol, SchSymbol, Schematic, Vec2 } from '../types.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import { refId, type ItemRef } from './hittest.js';
import type { BBox } from './bbox.js';
import { alignBoxes } from './sch_align_tool.js';

/** `SNAP_RANGE` (`eeschema/default_values.h:87`), in mils. */
export const SNAP_RANGE = 55;

/** `SCH_SYMBOL::GetConnectionPoints()`: the pin tips through the placement transform. */
function symbolPins(sym: SchSymbol, lib: LibSymbol | undefined): Vec2[] {
  if (!lib) return [];
  const t = symbolTransform(sym.angle, sym.mirror);
  const out: Vec2[] = [];
  for (const u of lib.units) {
    if (
      (u.unit !== 0 && u.unit !== sym.unit) ||
      (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
    )
      continue;
    for (const pin of u.pins) out.push(localToWorld(sym.at, t, pin.at));
  }
  return out;
}

/** One `SCH_ITEM` of the sheet, as `queryVisible` and `computeAnchors` see it. */
interface SchGridItem {
  id: string;
  kind: ItemRef['kind'];
  index: number;
  /** `ViewBBox()`. */
  box: BBox;
  /** `SCH_ITEM::IsConnectable()`. */
  connectable: boolean;
  /** `SCH_LINE_T` that `IsGraphicLine()`. */
  graphicLine: boolean;
  /** `SCH_TEXT_T` - a label of kind `text`. */
  text: boolean;
}

/** `ANCHOR`, and whether its first item `IsConnectable()` (see the file comment). */
class EE_ANCHOR extends ANCHOR {
  constructor(
    aPos: Vec2,
    aFlags: number,
    public connectable: boolean,
  ) {
    super(aPos, aFlags, 0, []);
  }
}

/** Per-item grid overrides, in IU - `GRID_SETTINGS::override_*` resolved to sizes. */
export interface EeGridOverrides {
  connected?: number;
  wires?: number;
  text?: number;
  graphics?: number;
}

const intersects = (a: BBox, b: BBox): boolean =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

export class EE_GRID_HELPER extends GRID_HELPER {
  private m_sch: Schematic | null = null;
  private m_libById: ReadonlyMap<string, LibSymbol> = new Map();
  private m_items: SchGridItem[] = [];
  private m_byId = new Map<string, SchGridItem>();
  private m_overrides: EeGridOverrides | null = null;

  /**
   * The sheet `queryVisible` asks - upstream's `VIEW`. Re-indexed only when
   * the document or the library map is a different object.
   */
  SetSchematic(aSch: Schematic, aLibById: ReadonlyMap<string, LibSymbol>): void {
    if (aSch === this.m_sch && aLibById === this.m_libById) return;

    this.m_sch = aSch;
    this.m_libById = aLibById;
    this.m_items = [];
    this.m_byId.clear();

    const boxes = new Map(
      alignBoxes(aSch, null, aLibById as Map<string, LibSymbol>).map((b) => [b.id, b.box]),
    );
    const add = (
      kind: ItemRef['kind'],
      id: string,
      index: number,
      connectable: boolean,
      extra: Partial<SchGridItem> = {},
    ): void => {
      const b = boxes.get(id);
      const item: SchGridItem = {
        id,
        kind,
        index,
        box: b ? { ...b } : { minX: 0, minY: 0, maxX: -1, maxY: -1 },
        connectable,
        graphicLine: false,
        text: false,
        ...extra,
      };
      // A symbol's view box includes its pins; widen every box to its own
      // connection points so none is missed by the query.
      for (const p of this.connectionPoints(item)) {
        if (item.box.maxX < item.box.minX)
          item.box = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
        item.box.minX = Math.min(item.box.minX, p.x);
        item.box.minY = Math.min(item.box.minY, p.y);
        item.box.maxX = Math.max(item.box.maxX, p.x);
        item.box.maxY = Math.max(item.box.maxY, p.y);
      }
      this.m_items.push(item);
      this.m_byId.set(id, item);
    };

    aSch.symbols.forEach((s, i) => add('symbol', refId('symbol', s.uuid, i), i, true));
    aSch.lines.forEach((l, i) =>
      add('line', refId('line', l.uuid, i), i, l.kind !== 'polyline', {
        graphicLine: l.kind === 'polyline',
      }),
    );
    aSch.junctions.forEach((j, i) => add('junction', refId('junction', j.uuid, i), i, true));
    aSch.noConnects.forEach((n, i) => add('noconnect', refId('noconnect', n.uuid, i), i, true));
    aSch.labels.forEach((l, i) =>
      add('label', refId('label', l.uuid, i), i, l.kind !== 'text', { text: l.kind === 'text' }),
    );
    (aSch.directiveLabels ?? []).forEach((d, i) =>
      add('directive', refId('directive', d.uuid, i), i, true),
    );
    aSch.busEntries.forEach((b, i) => add('busentry', refId('busentry', b.uuid, i), i, true));
    aSch.sheets.forEach((s, i) => add('sheet', refId('sheet', s.uuid, i), i, true));
    aSch.textBoxes.forEach((t, i) => add('textbox', refId('textbox', t.uuid, i), i, false));
    aSch.tables.forEach((t, i) => add('table', refId('table', t.uuid, i), i, false));
    aSch.images.forEach((im, i) => add('image', refId('image', im.uuid, i), i, false));
    aSch.graphics.forEach((_g, i) => add('graphic', refId('graphic', undefined, i), i, false));
  }

  /**
   * Resolved grid overrides (`GRID_SETTINGS::overrides_enabled` and the four
   * `override_*` indices), or null when overrides are off.
   */
  SetGridOverrides(aOverrides: EeGridOverrides | null): void {
    this.m_overrides = aOverrides;
  }

  /** `EE_GRID_HELPER::GetGridSize` (cpp:222-266). */
  override GetGridSize(aGrid: GRID_HELPER_GRIDS): Vec2 {
    const g = super.GetGridSize(aGrid);
    const o = this.m_overrides;

    if (!o) return g;

    let size: number | undefined;

    switch (aGrid) {
      case GRID_HELPER_GRIDS.GRID_CONNECTABLE:
        size = o.connected;
        break;
      case GRID_HELPER_GRIDS.GRID_WIRES:
        size = o.wires;
        break;
      case GRID_HELPER_GRIDS.GRID_TEXT:
        size = o.text;
        break;
      case GRID_HELPER_GRIDS.GRID_GRAPHICS:
        size = o.graphics;
        break;
      default:
        break;
    }

    return size ? { x: size, y: size } : g;
  }

  /** `EE_GRID_HELPER::GetItemGrid` (cpp:337-419), by item id. */
  GetItemGridById(aId: string | undefined): GRID_HELPER_GRIDS {
    const item = aId === undefined ? undefined : this.m_byId.get(aId);

    if (!item) return GRID_HELPER_GRIDS.GRID_CURRENT;

    switch (item.kind) {
      case 'symbol':
      case 'pin':
      case 'sheetpin':
      case 'sheet':
      case 'noconnect':
      case 'directive':
        return GRID_HELPER_GRIDS.GRID_CONNECTABLE;
      case 'label':
        return item.text ? GRID_HELPER_GRIDS.GRID_TEXT : GRID_HELPER_GRIDS.GRID_CONNECTABLE;
      case 'field':
        return GRID_HELPER_GRIDS.GRID_TEXT;
      case 'graphic':
      case 'textbox':
      case 'image':
        return GRID_HELPER_GRIDS.GRID_GRAPHICS;
      case 'junction':
      case 'busentry':
        return GRID_HELPER_GRIDS.GRID_WIRES;
      case 'line':
        return item.connectable ? GRID_HELPER_GRIDS.GRID_WIRES : GRID_HELPER_GRIDS.GRID_GRAPHICS;
      default:
        return GRID_HELPER_GRIDS.GRID_CURRENT;
    }
  }

  /**
   * `EE_GRID_HELPER::GetSelectionGrid` (cpp:320-334): the largest grid of all
   * the items, starting from the first.
   */
  GetSelectionGridOf(aIds: Iterable<string>): GRID_HELPER_GRIDS {
    const ids = [...aIds];
    let grid = this.GetItemGridById(ids[0]);
    const sq = (v: Vec2): number => v.x * v.x + v.y * v.y;

    for (const id of ids) {
      const itemGrid = this.GetItemGridById(id);

      if (sq(this.GetGridSize(itemGrid)) > sq(this.GetGridSize(grid))) grid = itemGrid;
    }

    return grid;
  }

  /** `SCH_ITEM::GetConnectionPoints()` for the kinds `computeAnchors` asks. */
  private connectionPoints(aItem: SchGridItem): Vec2[] {
    const sch = this.m_sch;

    if (!sch) return [];

    switch (aItem.kind) {
      case 'symbol': {
        const sym = sch.symbols[aItem.index]!;
        return symbolPins(sym, this.m_libById.get(schSymbolLibraryName(sym)));
      }
      case 'line': {
        const l = sch.lines[aItem.index]!;
        return [l.start, l.end];
      }
      case 'junction':
        return [sch.junctions[aItem.index]!.at];
      case 'noconnect':
        return [sch.noConnects[aItem.index]!.at];
      case 'label':
        return aItem.text ? [] : [sch.labels[aItem.index]!.at];
      case 'directive':
        return [sch.directiveLabels![aItem.index]!.at];
      case 'busentry': {
        const be = sch.busEntries[aItem.index]!;
        return [be.at, { x: be.at.x + be.size.x, y: be.at.y + be.size.y }];
      }
      case 'sheet':
        return sch.sheets[aItem.index]!.pins.map((p) => p.at);
      default:
        return [];
    }
  }

  private add(aPos: Vec2, aFlags: number, aItem: SchGridItem): void {
    // `GRID_HELPER::addAnchor`'s mask test, with the connectable flag kept.
    if ((aFlags & this.m_maskTypes) === aFlags)
      this.m_anchors.push(new EE_ANCHOR(aPos, aFlags, aItem.connectable));
  }

  /**
   * `EE_GRID_HELPER::computeAnchors` (cpp:436-548) for one item. `aFrom` is
   * accepted for upstream's signature and unused there too.
   */
  private computeItemAnchors(
    aItem: SchGridItem,
    aRefPos: Vec2,
    _aFrom = false,
    aIncludeText = false,
  ): void {
    const sch = this.m_sch;

    if (!sch) return;

    const conn = ANCHOR_FLAGS.SNAPPABLE | ANCHOR_FLAGS.CORNER;

    switch (aItem.kind) {
      case 'label':
        if (aItem.text) {
          // SCH_TEXT_T
          if (aIncludeText) this.add(sch.labels[aItem.index]!.at, ANCHOR_FLAGS.ORIGIN, aItem);
          break;
        }
        for (const p of this.connectionPoints(aItem)) this.add(p, conn, aItem);
        break;

      case 'table': {
        if (aIncludeText) {
          const b = aItem.box;
          this.add({ x: b.minX, y: b.minY }, conn, aItem);
          this.add({ x: b.maxX, y: b.maxY }, conn, aItem);
        }
        break;
      }

      case 'textbox': {
        if (aIncludeText) {
          const tb = sch.textBoxes[aItem.index]!;
          this.add(tb.start, conn, aItem);
          this.add(tb.end, conn, aItem);
        }
        break;
      }

      case 'symbol':
        this.add(sch.symbols[aItem.index]!.at, ANCHOR_FLAGS.ORIGIN, aItem);
        for (const p of this.connectionPoints(aItem)) this.add(p, conn, aItem);
        break;

      case 'sheet':
        this.add(sch.sheets[aItem.index]!.at, ANCHOR_FLAGS.ORIGIN, aItem);
        for (const p of this.connectionPoints(aItem)) this.add(p, conn, aItem);
        break;

      case 'line':
        // "Don't add anchors for graphic lines unless we're including text,
        // they may be on a non-connectable grid"
        if (aItem.graphicLine && !aIncludeText) break;
        for (const p of this.connectionPoints(aItem)) this.add(p, conn, aItem);
        break;

      case 'junction':
      case 'noconnect':
      case 'directive':
      case 'busentry':
        for (const p of this.connectionPoints(aItem)) this.add(p, conn, aItem);
        break;

      default:
        break;
    }

    // The point on a horizontal or vertical line level with the gridded cursor.
    if (aItem.kind === 'line' && (aIncludeText || !aItem.graphicLine)) {
      const line = sch.lines[aItem.index]!;
      const pt = this.Align(aRefPos);

      if (line.start.x === line.end.x) {
        const possible = { x: line.start.x, y: pt.y };

        if (TestSegmentHit(possible, line.start, line.end, 0))
          this.add(possible, ANCHOR_FLAGS.SNAPPABLE | ANCHOR_FLAGS.VERTICAL, aItem);
      } else if (line.start.y === line.end.y) {
        const possible = { x: pt.x, y: line.start.y };

        if (TestSegmentHit(possible, line.start, line.end, 0))
          this.add(possible, ANCHOR_FLAGS.SNAPPABLE | ANCHOR_FLAGS.HORIZONTAL, aItem);
      }
    }
  }

  /**
   * `computeAnchors`'s `SCH_PIN_T` arm (cpp:519-524), for pins handed in on
   * their own: `SNAPPABLE | ORIGIN` at each pin's position.
   */
  computePinAnchors(aPins: readonly Vec2[]): void {
    for (const p of aPins)
      this.m_anchors.push(new EE_ANCHOR(p, ANCHOR_FLAGS.SNAPPABLE | ANCHOR_FLAGS.ORIGIN, true));
  }

  /** The collected anchors - `m_anchors`, which upstream's own tests read as a friend. */
  GetAnchors(): readonly ANCHOR[] {
    return this.m_anchors;
  }

  /**
   * `EE_GRID_HELPER::queryVisible` (cpp:278-317): the items whose view box
   * meets `aArea`, less `aSkip`.
   */
  private queryVisible(aArea: BBox, aSkip: ReadonlySet<string>): SchGridItem[] {
    return this.m_items.filter((it) => !aSkip.has(it.id) && intersects(it.box, aArea));
  }

  /**
   * `EE_GRID_HELPER::nearestAnchor` (cpp:553-586): the nearest anchor carrying
   * every flag in `aFlags`, first found winning a tie. Under `GRID_CONNECTABLE`
   * an anchor of a non-connectable item is dropped, and under `GRID_GRAPHICS`
   * one of a connectable item.
   */
  nearestAnchor(aPos: Vec2, aFlags: number, aGrid: GRID_HELPER_GRIDS): ANCHOR | null {
    let minDist = Number.MAX_VALUE;
    let best: ANCHOR | null = null;

    for (const a of this.m_anchors) {
      if ((aFlags & a.flags) !== aFlags) continue;

      if (a instanceof EE_ANCHOR) {
        if (aGrid === GRID_HELPER_GRIDS.GRID_CONNECTABLE && !a.connectable) continue;
        if (aGrid === GRID_HELPER_GRIDS.GRID_GRAPHICS && a.connectable) continue;
      }

      const dist = a.Distance(aPos);

      if (dist < minDist) {
        minDist = dist;
        best = a;
      }
    }

    return best;
  }

  /**
   * `EE_GRID_HELPER::BestSnapAnchor` (cpp:131-219): the anchor under the
   * cursor when there is one in `SNAP_RANGE` - unless the grid node is in range
   * too, which wins - else the grid node.
   */
  BestSnapAnchor(
    aOrigin: Vec2,
    aGrid: GRID_HELPER_GRIDS,
    aSkip: ReadonlySet<string> = new Set(),
  ): Vec2 {
    const snapRange = schIUScale.milsToIU(SNAP_RANGE);

    let pt = { x: aOrigin.x, y: aOrigin.y };
    let snapDist = { x: snapRange, y: snapRange };
    let gridChecked = false;
    let snappedToAnchor = false;

    const bb: BBox = {
      minX: aOrigin.x - Math.trunc(snapRange / 2),
      minY: aOrigin.y - Math.trunc(snapRange / 2),
      maxX: aOrigin.x - Math.trunc(snapRange / 2) + snapRange,
      maxY: aOrigin.y - Math.trunc(snapRange / 2) + snapRange,
    };

    this.clearAnchors();
    this.m_snapItem = null;

    for (const item of this.queryVisible(bb, aSkip)) this.computeItemAnchors(item, aOrigin);

    const nearest = this.nearestAnchor(aOrigin, ANCHOR_FLAGS.SNAPPABLE, aGrid);
    const nearestGrid = this.Align(aOrigin, aGrid);

    this.showConstructionGeometry(this.m_enableSnap);

    const snapLineManager = this.getSnapManager().GetSnapLineManager();
    const gridSize = this.GetGridSize(aGrid);
    const guideSnap = this.m_enableSnapLine
      ? this.SnapToConstructionLines(aOrigin, nearestGrid, gridSize, snapRange)
      : null;

    const norm = (v: Vec2): number => Math.hypot(v.x, v.y);

    if (this.m_enableSnap && nearest && nearest.Distance(aOrigin) < norm(snapDist)) {
      if (
        this.canUseGrid() &&
        norm({ x: nearestGrid.x - aOrigin.x, y: nearestGrid.y - aOrigin.y }) < norm(snapDist)
      ) {
        pt = nearestGrid;
        snapDist = {
          x: Math.abs(nearestGrid.x - aOrigin.x),
          y: Math.abs(nearestGrid.y - aOrigin.y),
        };
        gridChecked = true;
      } else {
        pt = { ...nearest.pos };
        snapDist = {
          x: Math.abs(nearest.pos.x - aOrigin.x),
          y: Math.abs(nearest.pos.y - aOrigin.y),
        };
        snappedToAnchor = true;
        gridChecked = true;
      }
    }

    if (guideSnap && (guideSnap.x !== this.m_skipPoint.x || guideSnap.y !== this.m_skipPoint.y)) {
      snapLineManager.SetSnapLineEnd(guideSnap);
      this.setSnapPointVisible(false);
      this.m_snapItem = null;
      return guideSnap;
    }

    if (snappedToAnchor && nearest) {
      this.m_snapItem = nearest;
      this.updateSnapPoint(new TYPED_POINT2I(pt, PT_NONE));
      snapLineManager.SetSnapLineOrigin(pt);
      snapLineManager.SetSnapLineEnd(null);
      return pt;
    }

    this.m_snapItem = null;

    if (this.canUseGrid() && !gridChecked) pt = nearestGrid;

    snapLineManager.SetSnapLineEnd(null);
    this.setSnapPointVisible(false);

    return pt;
  }

  /**
   * `SCH_ITEM::IsMovableFromAnchorPoint` for an item of the indexed sheet: a
   * sheet, a bus entry and an image are not (their overrides answer false), and
   * a symbol only when every pin sits a whole 25 mil step from its anchor
   * (`SCH_SYMBOL::IsMovableFromAnchorPoint`, sch_symbol.cpp:218-236).
   */
  IsMovableFromAnchorPoint(aId: string): boolean {
    const item = this.m_byId.get(aId);

    if (!item) return true;

    switch (item.kind) {
      case 'sheet':
      case 'busentry':
      case 'image':
        return false;
      case 'symbol': {
        const sym = this.m_sch!.symbols[item.index]!;
        const minGridSize = schIUScale.milsToIU(25);

        for (const p of this.connectionPoints(item)) {
          if ((p.x - sym.at.x) % minGridSize !== 0) return false;
          if ((p.y - sym.at.y) % minGridSize !== 0) return false;
        }

        return true;
      }
      default:
        return true;
    }
  }

  /**
   * `EE_GRID_HELPER::BestDragOrigin` (cpp:84-128): the point on the selection
   * a move measures itself from. `aWorldScale` is the GAL's world scale
   * (screen pixels per IU), for `lineSnapMinCornerDistance`.
   */
  BestDragOrigin(
    aMousePos: Vec2,
    aGrid: GRID_HELPER_GRIDS,
    aItems: Iterable<string>,
    aWorldScale: number,
  ): Vec2 {
    this.clearAnchors();

    const items = [...aItems]
      .map((id) => this.m_byId.get(id))
      .filter((it): it is SchGridItem => !!it);

    // If we're working with any connectable objects, skip non-connectable
    // objects since they are often off-grid, e.g. text anchors
    let hasConnectables = false;

    for (const item of items) {
      const grid = this.GetItemGridById(item.id);

      if (grid === GRID_HELPER_GRIDS.GRID_CONNECTABLE || grid === GRID_HELPER_GRIDS.GRID_WIRES) {
        hasConnectables = true;
        break;
      }
    }

    for (const item of items) this.computeItemAnchors(item, aMousePos, true, !hasConnectables);

    const lineSnapMinCornerDistance = 50.0 / aWorldScale;

    const nearestOutline = this.nearestAnchor(aMousePos, ANCHOR_FLAGS.OUTLINE, aGrid);
    const nearestCorner = this.nearestAnchor(aMousePos, ANCHOR_FLAGS.CORNER, aGrid);
    const nearestOrigin = this.nearestAnchor(aMousePos, ANCHOR_FLAGS.ORIGIN, aGrid);
    let best: ANCHOR | null = null;
    let minDist = Number.MAX_VALUE;

    if (nearestOrigin) {
      minDist = nearestOrigin.Distance(aMousePos);
      best = nearestOrigin;
    }

    if (nearestCorner) {
      const dist = nearestCorner.Distance(aMousePos);

      if (dist < minDist) {
        minDist = dist;
        best = nearestCorner;
      }
    }

    if (nearestOutline) {
      const dist = nearestOutline.Distance(aMousePos);

      if (minDist > lineSnapMinCornerDistance && dist < minDist) best = nearestOutline;
    }

    return best ? { ...best.pos } : { ...aMousePos };
  }
}

/**
 * The nearest `SNAPPABLE` anchor closer than `aSnapRange`, else null - used for
 * the dangling-pin pick, which is a hit test over pins rather than a snap.
 */
export function nearestSnapAnchor(
  aHelper: EE_GRID_HELPER,
  aPos: Vec2,
  aSnapRange: number,
  aGrid: GRID_HELPER_GRIDS = GRID_HELPER_GRIDS.GRID_CONNECTABLE,
): Vec2 | null {
  const nearest = aHelper.nearestAnchor(aPos, ANCHOR_FLAGS.SNAPPABLE, aGrid);

  return nearest && nearest.Distance(aPos) < aSnapRange ? nearest.pos : null;
}
