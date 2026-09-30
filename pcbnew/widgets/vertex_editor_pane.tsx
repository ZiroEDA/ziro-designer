// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_VERTEX_EDITOR_PANE` (`pcbnew/widgets/vertex_editor_pane.cpp`, new in
 * KiCad 10): the docked "Vertex Editor" grid listing every vertex of the
 * selected polygon or zone outline, two columns (X coord, Y coord) in the
 * frame's units and origin, each cell editable and each edit one
 * `BOARD_COMMIT`.
 *
 * Two halves: {@link PCB_VERTEX_EDITOR_PANE}, the pane's state and every
 * method of the C++ class that is not drawing; and {@link PcbVertexEditorPane},
 * the `wxGrid` (`common/wx/grid_ui.tsx`'s `useStringGrid`) over its cells.
 *
 * Where the C++ reaches through `m_frame`, this asks {@link VertexEditorFrame}:
 * the units, the origin transforms, a fresh commit, and the canvas refresh.
 */

import { type JSX, useRef } from 'react';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import type { ORIGIN_TRANSFORMS } from '@ziroeda/common/origin_transforms.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { useStringGrid } from '@ziroeda/common/wx/grid_ui.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import type { SHAPE_POLY_SET, VERTEX_INDEX } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { ZONE } from '../zone.js';

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

/** `PCB_BASE_EDIT_FRAME`, as far as `vertex_editor_pane.cpp` reads it. */
export interface VertexEditorFrame {
  GetUnitsProvider(): Pick<UNITS_PROVIDER, 'ValueFromString' | 'MessageTextFromValue'>;
  GetOriginTransforms(): Pick<ORIGIN_TRANSFORMS, 'ToDisplay' | 'FromDisplay'>;
  /** `BOARD_COMMIT commit( m_frame )`. */
  NewCommit(): { Modify(aItem: BOARD_ITEM): unknown; Push(aMessage: string): void };
  /** `GetCanvas()->GetView()->Update( item ); GetCanvas()->Refresh()`. */
  RefreshItem(aItem: BOARD_ITEM | null): void;
  /** `OnVertexEditorPaneClosed( this )`, run by the destructor. */
  OnVertexEditorPaneClosed?(aPane: PCB_VERTEX_EDITOR_PANE): void;
}

/** `PCB_VERTEX_EDITOR_PANE`. */
export class PCB_VERTEX_EDITOR_PANE {
  private m_item: BOARD_ITEM | null = null;
  private m_zone: ZONE | null = null;
  private m_shape: PCB_SHAPE | null = null;
  /** `m_rows`: the vertex behind each grid row. */
  private m_rows: VERTEX_INDEX[] = [];
  /** `m_updatingGrid`. */
  private m_updatingGrid = false;
  /** Bumped by every change the grid should redraw for. */
  private m_revision = 0;
  private readonly m_listeners = new Set<() => void>();

  constructor(private readonly m_frame: VertexEditorFrame) {}

  /** `~PCB_VERTEX_EDITOR_PANE`. */
  Destroy(): void {
    this.m_frame.OnVertexEditorPaneClosed?.(this);
  }

  /** React subscription: called after every change to what the grid shows. */
  Subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  GetRevision(): number {
    return this.m_revision;
  }

  private changed(): void {
    this.m_revision++;
    for (const l of this.m_listeners) l();
  }

  /** `SetItem`. */
  SetItem(aItem: BOARD_ITEM | null): void {
    this.m_item = aItem;
    this.m_zone = aItem !== null && aItem.Type() === KICAD_T.PCB_ZONE_T ? (aItem as ZONE) : null;
    this.m_shape =
      aItem !== null && aItem.Type() === KICAD_T.PCB_SHAPE_T ? (aItem as PCB_SHAPE) : null;

    this.refreshGrid();

    if (this.m_rows.length > 0) this.updateHighlight(0);

    this.changed();
  }

  /** `ClearItem`. */
  ClearItem(): void {
    this.m_item = null;
    this.m_zone = null;
    this.m_shape = null;
    this.m_updatingGrid = true;
    this.m_rows = [];
    this.m_updatingGrid = false;
    this.changed();
  }

  /** `IsEditingItem`. */
  IsEditingItem(aItem: BOARD_ITEM): boolean {
    return this.m_item === aItem;
  }

  /** `OnSelectionChanged`: a polygon or a zone is edited, anything else clears. */
  OnSelectionChanged(aNewItem: BOARD_ITEM | null): void {
    if (aNewItem) {
      const isPolygon =
        aNewItem.Type() === KICAD_T.PCB_ZONE_T ||
        (aNewItem.Type() === KICAD_T.PCB_SHAPE_T &&
          (aNewItem as PCB_SHAPE).GetShape() === SHAPE_T.POLY);

      if (isPolygon) this.SetItem(aNewItem);
      else this.ClearItem();
    } else {
      this.ClearItem();
    }
  }

  private refreshGrid(): void {
    this.m_updatingGrid = true;
    this.m_rows = [];

    const poly = this.getPoly();

    if (poly) {
      for (const it = poly.CIterateWithHoles(); it.valid(); it.Advance()) {
        this.m_rows.push(it.GetIndex());
      }
    }

    this.m_updatingGrid = false;
  }

  /** The grid's cells: one `[X, Y]` pair per `m_rows` entry, `updateRow`'s two `SetCellValue`s. */
  GetCells(): string[][] {
    const poly = this.getPoly();

    if (!poly) return [];

    return this.m_rows.map((idx) => {
      const v = poly.CVertex(idx);

      return [
        this.formatCoord(v.x, COORD_TYPES_T.ABS_X_COORD),
        this.formatCoord(v.y, COORD_TYPES_T.ABS_Y_COORD),
      ];
    });
  }

  /** `updateHighlight`: the point editor draws the highlight, the pane refreshes the view. */
  private updateHighlight(_aRow: number): void {
    this.m_frame.RefreshItem(this.m_item);
  }

  private getPoly(): SHAPE_POLY_SET | null {
    if (this.m_zone) return this.m_zone.Outline();

    if (this.m_shape && this.m_shape.GetShape() === SHAPE_T.POLY)
      return this.m_shape.GetPolyShape();

    return null;
  }

  /**
   * `parseCellValue`. `ValueFromString()` returns 0 both for a literal "0" and
   * for unparseable input, so the leading numeric token must hold at least one
   * digit before the parse is trusted; otherwise a blank or non-numeric entry
   * would collapse the vertex onto the display origin instead of being rejected.
   */
  parseCellValue(aText: string, aCoordType: COORD_TYPES_T): number | null {
    let hasDigit = false;

    for (const ch of aText.trim()) {
      if (ch >= '0' && ch <= '9') {
        hasDigit = true;
        break;
      }

      if (ch !== '+' && ch !== '-' && ch !== '.' && ch !== ',') break;
    }

    if (!hasDigit) return null;

    const displayValue = Math.trunc(this.m_frame.GetUnitsProvider().ValueFromString(aText));
    const internal = this.m_frame.GetOriginTransforms().FromDisplay(displayValue, aCoordType);

    if (internal < INT_MIN || internal > INT_MAX) return null;

    return Math.trunc(internal);
  }

  /** `formatCoord`. */
  formatCoord(aValue: number, aCoordType: COORD_TYPES_T): string {
    const displayValue = this.m_frame.GetOriginTransforms().ToDisplay(aValue, aCoordType);

    return this.m_frame.GetUnitsProvider().MessageTextFromValue(displayValue);
  }

  /** `OnGridCellChange`: one commit per edit. */
  OnGridCellChange(aRow: number, aCol: number, aText: string): void {
    if (this.m_updatingGrid) return;

    if (aRow < 0 || aRow >= this.m_rows.length) {
      this.updateHighlight(-1);
      return;
    }

    const poly = this.getPoly();

    if (!poly || !this.m_item) return;

    const idx = this.m_rows[aRow]!;
    const vertex = { ...poly.CVertex(idx) };

    const coordType = aCol === 0 ? COORD_TYPES_T.ABS_X_COORD : COORD_TYPES_T.ABS_Y_COORD;
    const newValue = this.parseCellValue(aText, coordType);

    // A rejected or unchanged entry only restores the cell (`updateRow`).
    if (newValue === null || (aCol === 0 ? vertex.x : vertex.y) === newValue) {
      this.changed();
      return;
    }

    const commit = this.m_frame.NewCommit();
    commit.Modify(this.m_item);

    if (aCol === 0) vertex.x = newValue;
    else vertex.y = newValue;

    poly.SetVertex(idx, vertex);

    if (this.m_zone) {
      this.m_zone.UnFill();
      this.m_zone.SetNeedRefill(true);
      this.m_zone.HatchBorder();
    }

    commit.Push('Edit Vertex');

    this.m_frame.RefreshItem(this.m_item);
    this.updateHighlight(aRow);
    this.changed();
  }

  /** `onPolygonModified`. */
  onPolygonModified(): void {
    if (this.m_zone) {
      this.m_zone.UnFill();
      this.m_zone.SetNeedRefill(true);
      this.m_zone.HatchBorder();
    }

    this.m_frame.RefreshItem(this.m_item);
  }
}

// `SetColMinimalWidth( 0/1, FromDIP( 120 ) )`; `resizeColumns()` then splits the
// width equally, which a two-column table with equal `width` floors does.
const COL_MIN_WIDTH = 120;

interface Props {
  pane: PCB_VERTEX_EDITOR_PANE;
  /** The pane's `GetRevision()`, read by the caller's subscription (a re-render trigger). */
  revision: number;
}

// `revision` is a render trigger: the caller re-renders when the pane changes.
export function PcbVertexEditorPane({ pane }: Props): JSX.Element {
  const paneRef = useRef(pane);
  paneRef.current = pane;

  const cells = pane.GetCells();
  const rows = cells.map((c, i) => ({ i, c }));

  const { grid, tricks, onUpdate } = useStringGrid<{ i: number; c: string[] }>({
    labels: ['X coord', 'Y coord'],
    rows,
    toCells: (r) => r.c,
    fromCells: (c, i) => ({ i, c: [...c] }),
    onChange: (next) => {
      // `wxEVT_GRID_CELL_CHANGED`: the cell whose text no longer matches the pane's.
      const shown = paneRef.current.GetCells();

      next.forEach((r, i) => {
        r.c.forEach((text, col) => {
          if (shown[i]?.[col] !== text) paneRef.current.OnGridCellChange(i, col, text);
        });
      });
    },
    setup: (g) => g.EnableEditing(true),
  });

  return (
    <WxGridView
      grid={grid}
      tricks={tricks}
      colLabels
      ariaLabel="Vertex Editor"
      columns={[{ width: COL_MIN_WIDTH }, { width: COL_MIN_WIDTH }]}
      onUpdate={onUpdate}
    />
  );
}
