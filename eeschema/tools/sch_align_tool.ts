// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Align to top / bottom / left / right / middle / centre. Counterpart:
 * `eeschema/tools/sch_align_tool.cpp` (SCH_ALIGN_TOOL).
 *
 * Each item moves on one axis until the chosen edge of its bounding box meets a
 * target value. What makes this more than "take the minimum" is how the target
 * is chosen (`selectTarget`), in this order:
 *
 *   1. an item under the cursor, so you can point at the one to align to;
 *   2. otherwise a locked item, since a locked item will not move and
 *      everything else has to come to it;
 *   3. otherwise the outermost item, which is the first after sorting.
 *
 * Locked items are never moved, only used as the target. And a connectable
 * item's delta is snapped so it lands on the grid (`adjustDeltaForGrid`):
 * aligning a symbol to a text box must not leave its pins between grid points,
 * where nothing will connect to them.
 */

import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { IS_MOVING } from '@ziroeda/common/eda_item_flags.js';
import { CONDITIONAL_MENU } from '@ziroeda/common/tool/conditional_menu.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { SCH_COLLECTOR } from '../sch_collectors.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { LibSymbol, Schematic, Vec2 } from '../types.js';
import { EE_GRID_HELPER } from './ee_grid_helper.js';
import { SCH_ACTIONS } from './sch_actions.js';
import { SCH_LINE_WIRE_BUS_TOOL } from './sch_line_wire_bus_tool.js';
import { SCH_SELECTION } from './sch_selection.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';
import { refId, type ItemRef } from './hittest.js';
import { symbolBodyBBox, labelBox, sheetPinBBox, type BBox } from './bbox.js';
import { directiveBox } from './directive_label.js';
import { imageSizeIU } from './image_size.js';
import { moveItems } from './move.js';
import { composeCommands, type EditCommand } from './command.js';
import { schSymbolLibraryName } from '../lib_symbol.js';

/** The six alignments, named as SCH_ACTIONS names them. */
export type AlignMode = 'top' | 'bottom' | 'left' | 'right' | 'centerX' | 'centerY';

export const ALIGN_LABELS: Record<AlignMode, string> = {
  top: 'Align to Top',
  bottom: 'Align to Bottom',
  left: 'Align to Left',
  right: 'Align to Right',
  centerX: 'Align to Middle',
  centerY: 'Align to Center',
};

/** One selected item: what to move, where it is, and whether it may move. */
export interface ItemBox {
  id: string;
  /** Which item array it came from, so a caller can treat kinds differently. */
  kind: ItemRef['kind'];
  box: BBox;
  /** The item's own anchor, which the grid snap is applied to. */
  anchor: Vec2;
  /** Locked items act as the target but are never moved. */
  locked: boolean;
  /** Connectable items snap to the grid; graphics and text do not. */
  connectable: boolean;
}

const boxOf = (a: Vec2, b: Vec2): BBox => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
});

/**
 * Every selected item with its bounding box, the same set `SCH_COLLECTOR::
 * MovableItems` collects. Fields and pins are skipped: upstream drops any item
 * whose parent is also selected, and ours are only ever selected alongside it.
 */
export function alignBoxes(
  doc: Schematic,
  ids: ReadonlySet<string> | null,
  libById: Map<string, LibSymbol>,
): ItemBox[] {
  const out: ItemBox[] = [];
  const add = (
    kind: ItemRef['kind'],
    id: string,
    box: BBox,
    anchor: Vec2,
    connectable: boolean,
    locked = false,
  ): void => {
    // A null id set means "every item", which is what the whole-sheet extent
    // wants; alignment always passes a real selection.
    if (ids === null || ids.has(id)) out.push({ kind, id, box, anchor, locked, connectable });
  };

  doc.symbols.forEach((s, i) =>
    add(
      'symbol',
      refId('symbol', s.uuid, i),
      symbolBodyBBox(s, libById.get(schSymbolLibraryName(s))),
      s.at,
      true,
      !!s.locked,
    ),
  );
  doc.lines.forEach((l, i) =>
    add('line', refId('line', l.uuid, i), boxOf(l.start, l.end), l.start, l.kind !== 'polyline'),
  );
  doc.junctions.forEach((j, i) =>
    add('junction', refId('junction', j.uuid, i), boxOf(j.at, j.at), j.at, true),
  );
  doc.noConnects.forEach((n, i) =>
    add('noconnect', refId('noconnect', n.uuid, i), boxOf(n.at, n.at), n.at, true),
  );
  doc.labels.forEach((l, i) => add('label', refId('label', l.uuid, i), labelBox(l), l.at, true));
  (doc.directiveLabels ?? []).forEach((d, i) =>
    add('directive', refId('directive', d.uuid, i), directiveBox(d), d.at, true),
  );
  doc.busEntries.forEach((b, i) =>
    add(
      'busentry',
      refId('busentry', b.uuid, i),
      boxOf(b.at, { x: b.at.x + b.size.x, y: b.at.y + b.size.y }),
      b.at,
      true,
    ),
  );
  doc.sheets.forEach((s, i) => {
    const box = boxOf(s.at, { x: s.at.x + s.size.w, y: s.at.y + s.size.h });
    // A sheet's pins hang off its border, so they are part of its extent.
    for (const p of s.pins) {
      const pb = sheetPinBBox(p);
      box.minX = Math.min(box.minX, pb.minX);
      box.minY = Math.min(box.minY, pb.minY);
      box.maxX = Math.max(box.maxX, pb.maxX);
      box.maxY = Math.max(box.maxY, pb.maxY);
    }
    add('sheet', refId('sheet', s.uuid, i), box, s.at, true);
  });
  doc.textBoxes.forEach((t, i) =>
    add('textbox', refId('textbox', t.uuid, i), boxOf(t.start, t.end), t.start, false),
  );
  // A table's extent is its cells': the table node itself carries only column
  // widths and row heights, so an empty table has no geometry to align to.
  doc.tables.forEach((t, i) => {
    if (!t.cells.length) return;
    const box: BBox = {
      minX: Math.min(...t.cells.map((c) => Math.min(c.start.x, c.end.x))),
      minY: Math.min(...t.cells.map((c) => Math.min(c.start.y, c.end.y))),
      maxX: Math.max(...t.cells.map((c) => Math.max(c.start.x, c.end.x))),
      maxY: Math.max(...t.cells.map((c) => Math.max(c.start.y, c.end.y))),
    };
    add('table', refId('table', t.uuid, i), box, { x: box.minX, y: box.minY }, false);
  });
  doc.images.forEach((im, i) => {
    const s = imageSizeIU(im);
    add(
      'image',
      refId('image', im.uuid, i),
      boxOf(
        { x: im.at.x - s.w / 2, y: im.at.y - s.h / 2 },
        { x: im.at.x + s.w / 2, y: im.at.y + s.h / 2 },
      ),
      im.at,
      false,
    );
  });
  doc.graphics.forEach((g, i) => {
    const id = refId('graphic', undefined, i);
    switch (g.kind) {
      case 'rectangle':
        add('graphic', id, boxOf(g.start, g.end), g.start, false);
        break;
      case 'circle':
        add(
          'graphic',
          id,
          boxOf(
            { x: g.center.x - g.radius, y: g.center.y - g.radius },
            { x: g.center.x + g.radius, y: g.center.y + g.radius },
          ),
          g.center,
          false,
        );
        break;
      case 'arc': {
        // The three stored points bound the arc closely enough to align by.
        const b = boxOf(g.start, g.end);
        b.minX = Math.min(b.minX, g.mid.x);
        b.minY = Math.min(b.minY, g.mid.y);
        b.maxX = Math.max(b.maxX, g.mid.x);
        b.maxY = Math.max(b.maxY, g.mid.y);
        add('graphic', id, b, g.start, false);
        break;
      }
      case 'polyline':
      case 'bezier': {
        const first = g.points[0];
        if (!first) break;
        const b = boxOf(first, first);
        for (const p of g.points) {
          b.minX = Math.min(b.minX, p.x);
          b.minY = Math.min(b.minY, p.y);
          b.maxX = Math.max(b.maxX, p.x);
          b.maxY = Math.max(b.maxY, p.y);
        }
        add('graphic', id, b, first, false);
        break;
      }
      case 'text':
        add('graphic', id, boxOf(g.at, g.at), g.at, false);
        break;
    }
  });
  return out;
}

/** The edge each mode aligns, and the axis it moves along. */
const EDGE: Record<AlignMode, { value: (b: BBox) => number; axis: 'x' | 'y' }> = {
  top: { value: (b) => b.minY, axis: 'y' },
  bottom: { value: (b) => b.maxY, axis: 'y' },
  left: { value: (b) => b.minX, axis: 'x' },
  right: { value: (b) => b.maxX, axis: 'x' },
  centerX: { value: (b) => (b.minX + b.maxX) / 2, axis: 'x' },
  centerY: { value: (b) => (b.minY + b.maxY) / 2, axis: 'y' },
};

/** Sort order per mode: the outermost item first, so it is the fallback target. */
const OUTERMOST: Record<AlignMode, (a: number, b: number) => number> = {
  top: (a, b) => a - b,
  bottom: (a, b) => b - a,
  left: (a, b) => a - b,
  right: (a, b) => b - a,
  centerX: (a, b) => a - b,
  centerY: (a, b) => a - b,
};

const contains = (b: BBox, p: Vec2): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/**
 * `selectTarget`: the item under the cursor wins; failing that a locked item,
 * since it will not move; failing that the outermost.
 */
function targetValue(items: ItemBox[], locked: ItemBox[], mode: AlignMode, cursor?: Vec2): number {
  const value = EDGE[mode].value;
  if (locked.length) {
    if (cursor) {
      const hit = locked.find((i) => contains(i.box, cursor));
      if (hit) return value(hit.box);
    }
    return value(locked[0]!.box);
  }
  if (cursor) {
    const hit = items.find((i) => contains(i.box, cursor));
    if (hit) return value(hit.box);
  }
  return value(items[0]!.box);
}

/**
 * Align the selection. `cursor` is where the action was invoked from, which
 * decides the target when it lands on one of the items; omit it and the
 * outermost item is used.
 */
export function alignItems(
  doc: Schematic,
  ids: ReadonlySet<string>,
  libById: Map<string, LibSymbol>,
  mode: AlignMode,
  gridSize: number,
  cursor?: Vec2,
): EditCommand | null {
  const all = alignBoxes(doc, ids, libById);
  const items = all.filter((i) => !i.locked);
  const locked = all.filter((i) => i.locked);
  if (items.length === 0) return null;

  const { value, axis } = EDGE[mode];
  const order = OUTERMOST[mode];
  items.sort((a, b) => order(value(a.box), value(b.box)));
  locked.sort((a, b) => order(value(a.box), value(b.box)));

  const target = targetValue(items, locked, mode, cursor);

  const moves: EditCommand[] = [];
  for (const item of items) {
    let d = target - value(item.box);
    if (d === 0) continue;
    if (item.connectable && gridSize > 0) {
      // adjustDeltaForGrid: snap where the item lands, not the distance it
      // travels, so a connectable item stays on grid however far it moved.
      const from = axis === 'x' ? item.anchor.x : item.anchor.y;
      d = Math.round((from + d) / gridSize) * gridSize - from;
      if (d === 0) continue;
    }
    moves.push(moveItems(new Set([item.id]), axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d }));
  }
  if (moves.length === 0) return null;
  return composeCommands(ALIGN_LABELS[mode], moves);
}

// -----------------------------------------------------------------------------------------------
// SCH_ALIGN_TOOL (sch_align_tool.{h,cpp}) on the live model
// -----------------------------------------------------------------------------------------------

type ITEM_BOX = [SCH_ITEM, BOX2I];

/** `SCH_ALIGN_TOOL`: align the selection's edges or centres to a target item. */
export class SCH_ALIGN_TOOL extends SCH_TOOL_BASE<SCH_EDIT_FRAME> {
  private m_alignMenu: CONDITIONAL_MENU | null = null;

  constructor() {
    super('eeschema.Align');
  }

  override Init(): boolean {
    super.Init();

    if (!this.m_alignMenu) {
      this.m_alignMenu = new CONDITIONAL_MENU(this);
      this.m_alignMenu.SetIcon(BITMAPS.align_items);
      this.m_alignMenu.SetUntranslatedTitle('Align');

      const canAlign = SELECTION_CONDITIONS.MoreThan(1);

      this.m_alignMenu.AddItem(SCH_ACTIONS.alignLeft, canAlign);
      this.m_alignMenu.AddItem(SCH_ACTIONS.alignCenterX, canAlign);
      this.m_alignMenu.AddItem(SCH_ACTIONS.alignRight, canAlign);

      this.m_alignMenu.AddSeparator(canAlign);
      this.m_alignMenu.AddItem(SCH_ACTIONS.alignTop, canAlign);
      this.m_alignMenu.AddItem(SCH_ACTIONS.alignCenterY, canAlign);
      this.m_alignMenu.AddItem(SCH_ACTIONS.alignBottom, canAlign);
    }

    const selToolMenu = this.m_selectionTool!.GetToolMenu().GetMenu();
    selToolMenu.AddMenu(this.m_alignMenu, SELECTION_CONDITIONS.MoreThan(1), 100);

    this.setTransitions();

    return true;
  }

  private selectTarget(
    aItems: ITEM_BOX[],
    aLocked: ITEM_BOX[],
    aGetValue: (aItem: ITEM_BOX) => number,
  ): number {
    const cursorPos = this.getViewControls()!.GetCursorPosition();

    if (aLocked.length > 0) {
      for (const item of aLocked) {
        if (item[1].Contains(cursorPos)) return aGetValue(item);
      }

      return aGetValue(aLocked[0]!);
    }

    for (const item of aItems) {
      if (item[1].Contains(cursorPos)) return aGetValue(item);
    }

    return aGetValue(aItems[0]!);
  }

  GetSelections(
    aItemsToAlign: ITEM_BOX[],
    aLockedItems: ITEM_BOX[],
    aCompare: (aLhs: ITEM_BOX, aRhs: ITEM_BOX) => boolean,
  ): number {
    const selection = this.m_selectionTool!.RequestSelection(SCH_COLLECTOR.MovableItems);

    for (const item of selection.GetItems()) {
      if (!item.IsSCH_ITEM()) continue;

      const schItem = item as SCH_ITEM;

      if (schItem.GetParent()?.IsSelected()) continue;

      const bbox = schItem.GetBoundingBox();

      if (schItem.IsLocked()) aLockedItems.push([schItem, bbox]);
      else aItemsToAlign.push([schItem, bbox]);
    }

    // std::sort: libstdc++'s, unstable, so equal keys keep KiCad's order
    stdSort(aItemsToAlign, aCompare);
    stdSort(aLockedItems, aCompare);

    return aItemsToAlign.length;
  }

  private moveItem(aItem: SCH_ITEM, aDelta: VECTOR2I, aCommit: SCH_COMMIT): void {
    if (aDelta.x === 0 && aDelta.y === 0) return;

    const delta = this.adjustDeltaForGrid(aItem, aDelta);

    if (delta.x === 0 && delta.y === 0) return;

    aCommit.Modify(aItem, this.m_frame!.GetScreen(), RECURSE_MODE.RECURSE);
    aItem.Move(delta);
    aItem.ClearFlags(IS_MOVING);
    this.updateItem(aItem, true);
  }

  private adjustDeltaForGrid(aItem: SCH_ITEM, aDelta: VECTOR2I): VECTOR2I {
    if (aDelta.x === 0 && aDelta.y === 0) return aDelta;

    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    const gridType = grid.GetItemGrid(aItem);

    if (gridType !== GRID_HELPER_GRIDS.GRID_CONNECTABLE) return aDelta;

    const pos = aItem.GetPosition();
    const desiredPos = { x: pos.x + aDelta.x, y: pos.y + aDelta.y };
    const snappedPos = grid.AlignGrid(desiredPos, gridType);

    return { x: snappedPos.x - pos.x, y: snappedPos.y - pos.y };
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.AlignTop), SCH_ACTIONS.alignTop.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignBottom), SCH_ACTIONS.alignBottom.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignLeft), SCH_ACTIONS.alignLeft.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignRight), SCH_ACTIONS.alignRight.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignCenterX), SCH_ACTIONS.alignCenterX.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignCenterY), SCH_ACTIONS.alignCenterY.MakeEvent());
  }

  /** The six Align* bodies (sch_align_tool.cpp:187-401) differ only in axis, edge and message. */
  private align(
    aCompare: (aLhs: ITEM_BOX, aRhs: ITEM_BOX) => boolean,
    aValue: (aItem: ITEM_BOX) => number,
    aVertical: boolean,
    aMessage: string,
  ): number {
    const itemsToAlign: ITEM_BOX[] = [];
    const lockedItems: ITEM_BOX[] = [];

    if (!this.GetSelections(itemsToAlign, lockedItems, aCompare)) return 0;

    const commit = new SCH_COMMIT(this.m_toolMgr!);

    const target = this.selectTarget(itemsToAlign, lockedItems, aValue);

    for (const item of itemsToAlign) {
      const difference = target - aValue(item);
      this.moveItem(item[0], aVertical ? { x: 0, y: difference } : { x: difference, y: 0 }, commit);
    }

    this.doAlignCleanup(commit, itemsToAlign);

    commit.Push(aMessage);
    return 0;
  }

  AlignTop(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetTop() < rhs[1].GetTop(),
      (item) => item[1].GetTop(),
      true,
      'Align to Top',
    );
  }

  AlignBottom(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetBottom() > rhs[1].GetBottom(),
      (item) => item[1].GetBottom(),
      true,
      'Align to Bottom',
    );
  }

  AlignLeft(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetLeft() < rhs[1].GetLeft(),
      (item) => item[1].GetLeft(),
      false,
      'Align to Left',
    );
  }

  AlignRight(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetRight() > rhs[1].GetRight(),
      (item) => item[1].GetRight(),
      false,
      'Align to Right',
    );
  }

  AlignCenterX(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].Centre().x < rhs[1].Centre().x,
      (item) => item[1].Centre().x,
      false,
      'Align to Middle',
    );
  }

  AlignCenterY(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].Centre().y < rhs[1].Centre().y,
      (item) => item[1].Centre().y,
      true,
      'Align to Center',
    );
  }

  private doAlignCleanup(aCommit: SCH_COMMIT, aItems: ITEM_BOX[]): void {
    const lwbTool = this.m_toolMgr!.GetTool(SCH_LINE_WIRE_BUS_TOOL)!;

    const alignedItems = new SCH_SELECTION();

    for (const item of aItems) alignedItems.Add(item[0]);

    lwbTool.TrimOverLappingWires(aCommit, alignedItems);
    lwbTool.AddJunctionsIfNeeded(aCommit, alignedItems);

    for (const item of this.m_frame!.GetScreen()!.Items()) item.ClearTempFlags();

    this.m_frame!.Schematic().CleanUp(aCommit);

    for (const item of this.m_frame!.GetScreen()!.Items()) item.ClearEditFlags();
  }
}
