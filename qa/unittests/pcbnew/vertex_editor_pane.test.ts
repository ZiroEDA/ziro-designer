// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_VERTEX_EDITOR_PANE` (`pcbnew/widgets/vertex_editor_pane.cpp`) and the
 * `PCB_SEARCH_PANE` board-listener half (`pcb_search_pane.cpp`).
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import {
  PCB_VERTEX_EDITOR_PANE,
  type VertexEditorFrame,
} from '@ziroeda/pcbnew/widgets/vertex_editor_pane.js';
import { PCB_SEARCH_PANE } from '@ziroeda/pcbnew/widgets/pcb_search_pane.js';

const MM = 1_000_000;

function rig() {
  const log: string[] = [];
  const frame: VertexEditorFrame = {
    GetUnitsProvider: () => ({
      ValueFromString: (t: string) => Number.parseFloat(t) * MM,
      MessageTextFromValue: (v: number) => `${v / MM} mm`,
    }),
    // A display origin at (1 mm, 0): X is shifted, Y is not.
    GetOriginTransforms: () => ({
      ToDisplay: (v: number, t: number) => (t === 1 ? v - MM : v),
      FromDisplay: (v: number, t: number) => (t === 1 ? v + MM : v),
    }),
    NewCommit: () => ({
      Modify: () => log.push('modify'),
      Push: (m: string) => log.push(`push:${m}`),
    }),
    RefreshItem: () => log.push('refresh'),
  } as unknown as VertexEditorFrame;

  const b = new BOARD();
  const shape = new PCB_SHAPE(b, SHAPE_T.POLY);
  shape.SetPolyPoints([
    { x: 0, y: 0 },
    { x: 2 * MM, y: 0 },
    { x: 2 * MM, y: 3 * MM },
    { x: 0, y: 3 * MM },
  ]);
  return { pane: new PCB_VERTEX_EDITOR_PANE(frame), shape, log };
}

describe('PCB_VERTEX_EDITOR_PANE', () => {
  it('lists every vertex in display coordinates (origin applied to X only)', () => {
    const { pane, shape } = rig();
    pane.SetItem(shape);
    expect(pane.GetCells()).toEqual([
      ['-1 mm', '0 mm'],
      ['1 mm', '0 mm'],
      ['1 mm', '3 mm'],
      ['-1 mm', '3 mm'],
    ]);
  });

  it('an edit is one commit, converts back through the origin, and moves the vertex', () => {
    const { pane, shape, log } = rig();
    pane.SetItem(shape);
    log.length = 0;
    pane.OnGridCellChange(1, 0, '4');
    expect(log[0]).toBe('modify');
    expect(log).toContain('push:Edit Vertex');
    expect(shape.GetPolyShape().CVertex(1).x).toBe(5 * MM);
    expect(pane.GetCells()[1]).toEqual(['4 mm', '0 mm']);
  });

  it('rejects text with no digit instead of moving the vertex to the origin', () => {
    const { pane, shape, log } = rig();
    pane.SetItem(shape);
    log.length = 0;
    pane.OnGridCellChange(1, 1, 'abc');
    pane.OnGridCellChange(1, 1, '');
    pane.OnGridCellChange(1, 1, '-');
    expect(log.filter((l) => l.startsWith('push'))).toEqual([]);
    expect(shape.GetPolyShape().CVertex(1).y).toBe(0);
  });

  it('an unchanged value pushes nothing; a value outside int range is rejected', () => {
    const { pane, shape, log } = rig();
    pane.SetItem(shape);
    log.length = 0;
    pane.OnGridCellChange(2, 1, '3');
    pane.OnGridCellChange(2, 1, '99999');
    expect(log.filter((l) => l.startsWith('push'))).toEqual([]);
  });

  it('OnSelectionChanged: a polygon edits, anything else clears', () => {
    const { pane, shape } = rig();
    pane.OnSelectionChanged(shape);
    expect(pane.IsEditingItem(shape)).toBe(true);
    expect(pane.GetCells()).toHaveLength(4);
    pane.OnSelectionChanged(new PCB_TEXT(new BOARD()));
    expect(pane.IsEditingItem(shape)).toBe(false);
    expect(pane.GetCells()).toEqual([]);
    pane.OnSelectionChanged(shape);
    pane.OnSelectionChanged(null);
    expect(pane.GetCells()).toEqual([]);
  });

  it('a rectangle is not a polygon and is cleared', () => {
    const { pane } = rig();
    const b = new BOARD();
    pane.OnSelectionChanged(new PCB_SHAPE(b, SHAPE_T.RECTANGLE));
    expect(pane.GetCells()).toEqual([]);
  });
});

describe('PCB_SEARCH_PANE listener', () => {
  const mk = (shown: boolean) => {
    const calls: string[] = [];
    const b = new BOARD();
    const l = new PCB_SEARCH_PANE(
      { GetBoard: () => b },
      {
        IsShownOnScreen: () => shown,
        RefreshSearch: () => calls.push('refresh'),
        ClearAllResults: () => calls.push('clear'),
      },
    );
    return { b, l, calls };
  };

  it('a shown pane refreshes on every item event; a hidden one does not', () => {
    const on = mk(true);
    const item = new PCB_TEXT(on.b);
    on.l.OnBoardItemAdded(on.b, item);
    on.l.OnBoardItemsRemoved(on.b, [item]);
    on.l.OnBoardRatsnestChanged(on.b);
    expect(on.calls).toEqual(['refresh', 'refresh', 'refresh']);
    const off = mk(false);
    off.l.OnBoardItemAdded(off.b, item);
    expect(off.calls).toEqual([]);
  });

  it('net-setting and highlight events do nothing; units clear then refresh', () => {
    const { b, l, calls } = mk(true);
    l.OnBoardNetSettingsChanged(b);
    l.OnBoardHighlightNetChanged(b);
    expect(calls).toEqual([]);
    l.onUnitsChanged();
    expect(calls).toEqual(['clear', 'refresh']);
  });

  it('registers on the board and Detach unregisters', () => {
    const { b, l } = mk(true);
    const item = new PCB_TEXT(b);
    let n = 0;
    (l as unknown as { m_host: { RefreshSearch(): void } }).m_host.RefreshSearch = () => n++;
    b.InvokeListeners((x) => x.OnBoardItemAdded(b, item));
    expect(n).toBe(1);
    l.Detach();
    b.InvokeListeners((x) => x.OnBoardItemAdded(b, item));
    expect(n).toBe(1);
  });
});
