// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FP_EDIT_PAD_TABLE` (`pcbnew/dialogs/dialog_fp_edit_pad_table.cpp` +
 * `.h`): the footprint editor's Pad Table, one row per pad of the footprint,
 * edited in place.
 *
 * The class owns its WX_GRID exactly as the C++ owns `m_grid`: it fills the
 * cells, makes the Type and Shape columns combo boxes, binds the numeric
 * columns to a UNITS_PROVIDER, and connects the grid's cell-changed and
 * cell-selected events to its own handlers, which edit the LIVE pads as the
 * user types (so the canvas follows). Cancel puts every pad back from the
 * snapshot taken before; OK restores first and then edits through one
 * BOARD_COMMIT, so the undo entry holds the original state. The window is
 * `dialog_fp_edit_pad_table_ui.tsx`.
 *
 * The C++ keeps its snapshots in a `std::map<PAD*, PAD_SNAPSHOT, COMPARE>`
 * ordered by pad number, then x, then y. The order the rows take is that map's
 * order at the time of the snapshot, kept here as an array. The map's key
 * order is not re-established when a pad's number changes under it, and a
 * `contains( pad )` on a map whose keys have moved is unspecified; a pad is
 * looked up by identity here, which is what the map is for.
 */
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import { type EdaUnits, pcbIUScale } from '@ziroeda/common/eda_units.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { PIN_NUMBERS } from '@ziroeda/common/pin_numbers.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { GRID_CELL_COMBOBOX } from '@ziroeda/common/widgets/grid_combobox.js';
import {
  GRID_CELL_MARK_AS_NULLABLE,
  GRID_CELL_TEXT_EDITOR,
} from '@ziroeda/common/widgets/grid_text_helpers.js';
import { INDETERMINATE_STATE } from '@ziroeda/common/widgets/ui_common.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import {
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_SELECT_CELL,
  type wxGridEvent,
  wxGridCellAttr,
  wxGridStringTable,
} from '@ziroeda/common/wx/grid.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { FOOTPRINT } from '../footprint.js';
import { PAD } from '../pad.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK } from '../padstack.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';

/** `DIALOG_FP_EDIT_PAD_TABLE::COLS`: column indices (after adding the Type column). */
export enum COLS {
  COL_NUMBER = 0,
  COL_TYPE,
  COL_SHAPE,
  COL_POS_X,
  COL_POS_Y,
  COL_SIZE_X,
  COL_SIZE_Y,
  COL_DRILL_X,
  COL_DRILL_Y,
  COL_P2D_LENGTH,
  COL_P2D_DELAY,
}

export const {
  COL_NUMBER,
  COL_TYPE,
  COL_SHAPE,
  COL_POS_X,
  COL_POS_Y,
  COL_SIZE_X,
  COL_SIZE_Y,
  COL_DRILL_X,
  COL_DRILL_Y,
  COL_P2D_LENGTH,
  COL_P2D_DELAY,
} = COLS;

/** `DIALOG_FP_EDIT_PAD_TABLE_BASE`'s title: the base file states none. */
export const DIALOG_FP_EDIT_PAD_TABLE_TITLE = 'Pad Table';

/** `m_grid->SetColLabelValue( n, ... )`. */
export const PAD_TABLE_COLUMN_LABELS: readonly string[] = [
  'Number',
  'Type',
  'Shape',
  'X Position',
  'Y Position',
  'Size X',
  'Size Y',
  'Drill X',
  'Drill Y',
  'Pad->Die Length',
  'Pad->Die Delay',
];

/** `m_grid->SetColSize( n, ... )`, the base file's widths. */
export const PAD_TABLE_COLUMN_WIDTHS: readonly number[] = [
  60, 110, 140, 84, 84, 84, 84, 84, 84, 110, 110,
];

/** The names the Type column offers, in the order the constructor pushes them. */
export const PAD_TYPE_NAMES: readonly string[] = [
  'Through-hole', // PTH
  'SMD', // SMD
  'Connector', // CONN SMD? (use CONN?)
  'NPTH', // NPTH
  'Aperture', // inferred copper-less
];

/** Helper to map shape string to PAD_SHAPE. */
export function ShapeFromString(aShape: string): PAD_SHAPE {
  if (aShape === 'Oval') return PAD_SHAPE.OVAL;
  if (aShape === 'Rectangle') return PAD_SHAPE.RECTANGLE;
  if (aShape === 'Trapezoid') return PAD_SHAPE.TRAPEZOID;
  if (aShape === 'Rounded rectangle') return PAD_SHAPE.ROUNDRECT;
  if (aShape === 'Chamfered rectangle') return PAD_SHAPE.CHAMFERED_RECT;
  if (aShape === 'Custom shape') return PAD_SHAPE.CUSTOM;

  return PAD_SHAPE.CIRCLE;
}

/** `DIALOG_FP_EDIT_PAD_TABLE::PAD_SNAPSHOT`. */
class PAD_SNAPSHOT {
  number = '';
  shape: PAD_SHAPE = PAD_SHAPE.CHAMFERED_RECT;
  padstack: PADSTACK;
  position: VECTOR2I = { x: 0, y: 0 };
  size: VECTOR2I = { x: 0, y: 0 };
  attribute: PAD_ATTRIB = PAD_ATTRIB.PTH;
  padToDieLength = 0;
  padToDieDelay = 0;

  constructor(aPad: PAD) {
    this.padstack = new PADSTACK(aPad);
  }
}

/** `PAD_SNAPSHOT_COMPARE::operator()`: a before b. */
function padSnapshotLess(a: PAD, b: PAD): boolean {
  const cmpVal = strNumCmp(a.GetNumber(), b.GetNumber());

  // First sort by alphanumeric ordering
  if (cmpVal < 0) return true;

  if (cmpVal > 0) return false;

  // Sort by x and then y
  if (a.GetCenter().x < b.GetCenter().x) return true;

  if (a.GetCenter().x > b.GetCenter().x) return false;

  if (a.GetCenter().y < b.GetCenter().y) return true;

  if (a.GetCenter().y > b.GetCenter().y) return false;

  // For degenerate pads the map falls back on the pointer, which is a stable order: insertion
  return false;
}

export class DIALOG_FP_EDIT_PAD_TABLE {
  readonly m_grid: WX_GRID;
  readonly m_tricks: GRID_TRICKS;

  private readonly m_frame: PCB_BASE_FRAME;
  private readonly m_footprint: FOOTPRINT | null;
  private readonly m_unitsProvider: UNITS_PROVIDER;

  /** `m_originalPads`: original pad data for cancel rollback, in the map's order. */
  private m_originalPads: { pad: PAD; snapshot: PAD_SNAPSHOT }[] = [];
  private m_cancelled = false; // set if user hit cancel
  private m_summaryDirty = true;

  // Proportional resize support
  private m_colProportions: number[] = []; // relative widths captured after init
  private m_minColWidths: number[] = []; // initial (minimum) widths
  /** The widths `m_grid->SetColSize` last gave the columns. */
  private m_colSizes: number[] = [...PAD_TABLE_COLUMN_WIDTHS];

  // the summary labels
  m_pin_numbers_summary = '0';
  m_pin_numbers_summaryToolTip = '';
  m_pin_count = '0';
  m_duplicate_pins = '0';
  m_duplicate_pinsToolTip = '';

  private m_version = 0;
  private readonly m_listeners = new Set<() => void>();
  /** `DIALOG_SHIM::m_units`. */
  private readonly m_units: EdaUnits;

  constructor(aParent: PCB_BASE_FRAME, aFootprint: FOOTPRINT | null) {
    this.m_frame = aParent;
    this.m_footprint = aFootprint;
    this.m_units = aParent.GetUserUnits();
    this.m_unitsProvider = new UNITS_PROVIDER(pcbIUScale, this.m_units);

    this.CaptureOriginalPadState();

    // The base class created a single placeholder row; resize the grid to fit the pads.
    this.m_grid = new WX_GRID();
    this.m_grid.SetTable(
      new wxGridStringTable(this.m_originalPads.length, PAD_TABLE_COLUMN_LABELS.length),
      true,
    );
    PAD_TABLE_COLUMN_LABELS.forEach((label, c) => this.m_grid.SetColLabelValue(c, label));
    this.m_grid.EnableEditing(true);

    let attr: wxGridCellAttr;

    // Type column editor (attribute)
    attr = new wxGridCellAttr();
    attr.SetEditor(new GRID_CELL_COMBOBOX(PAD_TYPE_NAMES));
    this.m_grid.SetColAttr(COL_TYPE, attr);

    attr = new wxGridCellAttr();
    attr.SetEditor(new GRID_CELL_COMBOBOX(DIALOG_FP_EDIT_PAD_TABLE.shapeNames()));
    this.m_grid.SetColAttr(COL_SHAPE, attr);

    for (const col of [COL_POS_X, COL_POS_Y, COL_SIZE_X, COL_SIZE_Y, COL_DRILL_X, COL_DRILL_Y]) {
      attr = new wxGridCellAttr();
      attr.SetEditor(new GRID_CELL_TEXT_EDITOR());
      this.m_grid.SetColAttr(col, attr);
    }

    // Pad->Die Length
    this.m_grid.SetAutoEvalColUnits(
      COL_P2D_LENGTH,
      this.m_unitsProvider.GetUnitsFromType('distance'),
    );

    // Pad->Die Delay
    this.m_grid.SetAutoEvalColUnits(COL_P2D_DELAY, this.m_unitsProvider.GetUnitsFromType('time'));

    for (const col of [COL_POS_X, COL_POS_Y, COL_SIZE_X, COL_SIZE_Y, COL_DRILL_X, COL_DRILL_Y])
      this.m_grid.SetUnitsProvider(this.m_unitsProvider, col);

    this.m_grid.SetAutoEvalCols([
      COL_POS_X,
      COL_POS_Y,
      COL_SIZE_X,
      COL_SIZE_Y,
      COL_DRILL_X,
      COL_DRILL_Y,
      COL_P2D_LENGTH,
      COL_P2D_DELAY,
    ]);

    // add Cut, Copy, and Paste to wxGrid
    this.m_tricks = new GRID_TRICKS(this.m_grid);

    // the base file connects these (wxEVT_GRID_CELL_CHANGED, wxEVT_GRID_SELECT_CELL)
    this.m_grid.Connect(wxEVT_GRID_CELL_CHANGED, (e: wxGridEvent) => this.OnCellChanged(e));
    this.m_grid.Connect(wxEVT_GRID_SELECT_CELL, (e: wxGridEvent) => this.OnSelectCell(e));
  }

  /** The seven names the Shape column offers: `PAD::ShowPadShape` of each shape, in order. */
  static shapeNames(): string[] {
    return [
      PAD_SHAPE.CIRCLE,
      PAD_SHAPE.OVAL,
      PAD_SHAPE.RECTANGLE,
      PAD_SHAPE.TRAPEZOID,
      PAD_SHAPE.ROUNDRECT,
      PAD_SHAPE.CHAMFERED_RECT,
      PAD_SHAPE.CUSTOM,
    ].map((s) => PAD.ShowPadShape(s));
  }

  /** `DIALOG_SHIM::GetUserUnits()`. */
  GetUserUnits(): EdaUnits {
    return this.m_units;
  }

  /** The window's subscription: called after every change of the dialog's state. */
  Subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  GetVersion(): number {
    return this.m_version;
  }

  private notify(): void {
    this.m_version++;
    for (const l of [...this.m_listeners]) l();
  }

  /** The column widths the grid is to draw. */
  GetColumnWidths(): readonly number[] {
    return this.m_colSizes;
  }

  TransferDataToWindow(): boolean {
    if (!this.m_footprint) return false;

    let row = 0;

    for (const { pad } of this.m_originalPads) {
      if (row >= this.m_grid.GetNumberRows()) continue;

      this.m_grid.SetCellValue(row, COL_NUMBER, pad.GetNumber());

      // Pad attribute to string
      let attrStr: string;

      switch (pad.GetAttribute()) {
        case PAD_ATTRIB.PTH:
          attrStr = 'Through-hole';
          break;
        case PAD_ATTRIB.SMD:
          attrStr = 'SMD';
          break;
        case PAD_ATTRIB.CONN:
          attrStr = 'Connector';
          break;
        case PAD_ATTRIB.NPTH:
          attrStr = 'NPTH';
          break;
        default:
          attrStr = 'Through-hole';
          break;
      }

      let size_x = pad.GetSize(PADSTACK.ALL_LAYERS).x;
      let size_y = pad.GetSize(PADSTACK.ALL_LAYERS).y;
      let padShape = pad.ShowPadShape(PADSTACK.ALL_LAYERS);

      pad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
        if (pad.GetSize(aLayer).x !== size_x) size_x = -1;

        if (pad.GetSize(aLayer).y !== size_y) size_y = -1;

        if (pad.ShowPadShape(aLayer) !== padShape) padShape = INDETERMINATE_STATE;
      });

      if (pad.IsAperturePad()) attrStr = 'Aperture';

      this.m_grid.SetCellValue(row, COL_TYPE, attrStr);
      this.m_grid.SetCellValue(row, COL_SHAPE, padShape);
      this.m_grid.SetCellValue(
        row,
        COL_POS_X,
        this.m_unitsProvider.StringFromValue(pad.GetPosition().x, true),
      );
      this.m_grid.SetCellValue(
        row,
        COL_POS_Y,
        this.m_unitsProvider.StringFromValue(pad.GetPosition().y, true),
      );
      this.m_grid.SetCellValue(
        row,
        COL_SIZE_X,
        size_x >= 0 ? this.m_unitsProvider.StringFromValue(size_x, true) : INDETERMINATE_STATE,
      );
      this.m_grid.SetCellValue(
        row,
        COL_SIZE_Y,
        size_y >= 0 ? this.m_unitsProvider.StringFromValue(size_y, true) : INDETERMINATE_STATE,
      );

      // Drill values (only meaningful for PTH or NPTH). Leave empty otherwise.
      if (pad.GetAttribute() === PAD_ATTRIB.PTH || pad.GetAttribute() === PAD_ATTRIB.NPTH) {
        const drill = pad.GetDrillSize();

        if (drill.x > 0)
          this.m_grid.SetCellValue(
            row,
            COL_DRILL_X,
            this.m_unitsProvider.StringFromValue(drill.x, true),
          );

        if (drill.y > 0)
          this.m_grid.SetCellValue(
            row,
            COL_DRILL_Y,
            this.m_unitsProvider.StringFromValue(drill.y, true),
          );
      } else {
        // For non-PTH pads, drill columns are not applicable.
        this.m_grid.SetReadOnly(row, COL_DRILL_X, true);
        this.m_grid.SetReadOnly(row, COL_DRILL_Y, true);
      }

      // Pad to die metrics
      if (pad.GetPadToDieLength())
        this.m_grid.SetUnitValue(row, COL_P2D_LENGTH, pad.GetPadToDieLength());

      if (pad.GetPadToDieDelay())
        this.m_grid.SetUnitValue(row, COL_P2D_DELAY, pad.GetPadToDieDelay());

      this.setRowNullableEditors(row);

      row++;
    }

    // `AutoSizeColumns()` and the Shape column's width from the longest shape name are the
    // window's: it measures the text it draws, and hands the sizes back through
    // `SetColumnSizes`.

    // If pads exist, select the first row to show initial highlight
    if (this.m_grid.GetNumberRows() > 0) {
      this.m_grid.SetGridCursor(0, 0);

      // Construct event with required parameters (id, type, obj, row, col,...)
      this.OnSelectCell({
        GetRow: () => 0,
        GetCol: () => 0,
      } as unknown as wxGridEvent);
    }

    this.notify();
    return true;
  }

  /**
   * The window measured the grid: `AutoSizeColumns()`, then the Shape column
   * "wide enough for the longest translated shape text plus the dropdown arrow",
   * then `InitColumnProportions()`.
   */
  SetColumnSizes(aSizes: readonly number[]): void {
    this.m_colSizes = [...aSizes];
    this.InitColumnProportions();
    this.notify();
  }

  private setRowNullableEditors(aRowId: number): void {
    // Set nullable editors
    const setCellEditor = (aCol: number): void => {
      this.m_grid.SetCellEditor(aRowId, aCol, new GRID_CELL_MARK_AS_NULLABLE(true));
    };

    setCellEditor(COL_P2D_LENGTH);
    setCellEditor(COL_P2D_DELAY);
  }

  CaptureOriginalPadState(): void {
    this.m_originalPads = [];

    if (!this.m_footprint) return;

    for (const pad of this.m_footprint.Pads()) {
      // try_emplace: a pad already there is left alone
      if (this.m_originalPads.some((e) => e.pad === pad)) continue;

      const snap = new PAD_SNAPSHOT(pad);
      snap.number = pad.GetNumber();
      snap.position = { ...pad.GetPosition() };
      snap.padstack.assign(pad.Padstack());
      snap.attribute = pad.GetAttribute();
      snap.padToDieLength = pad.GetPadToDieLength();
      snap.padToDieDelay = pad.GetPadToDieDelay();

      // std::map insertion: before the first element the new key is less than
      let at = this.m_originalPads.length;

      for (let i = 0; i < this.m_originalPads.length; i++) {
        if (padSnapshotLess(pad, this.m_originalPads[i]!.pad)) {
          at = i;
          break;
        }
      }

      this.m_originalPads.splice(at, 0, { pad, snapshot: snap });
    }
  }

  RestoreOriginalPadState(): void {
    if (!this.m_footprint) return;

    const canvas = this.m_frame.GetCanvas();

    for (const pad of this.m_footprint.Pads()) {
      const entry = this.m_originalPads.find((e) => e.pad === pad);

      if (!entry) continue;

      const snap = entry.snapshot;
      pad.SetNumber(snap.number);
      pad.SetPosition(snap.position);
      pad.SetPadstack(snap.padstack);
      pad.SetAttribute(snap.attribute);
      pad.SetPadToDieLength(snap.padToDieLength);
      pad.SetPadToDieDelay(snap.padToDieDelay);
      pad.ClearBrightened();

      if (canvas) canvas.GetView().Update(pad, VIEW_UPDATE_FLAGS.REPAINT);
    }

    if (canvas) {
      canvas.GetView().MarkTargetDirty(RENDER_TARGET.TARGET_OVERLAY);
      canvas.ForceRefresh();
    }

    this.m_summaryDirty = true;
  }

  TransferDataFromWindow(): boolean {
    if (!this.m_grid.CommitPendingChanges()) return false;

    if (!this.m_footprint) return true;

    this.RestoreOriginalPadState();
    const commit = new BOARD_COMMIT(this.m_frame);

    let row = 0;

    for (const { pad } of this.m_originalPads) {
      commit.Modify(pad);
      pad.SetNumber(this.m_grid.GetCellValue(row, COL_NUMBER));

      const typeStr = this.m_grid.GetCellValue(row, COL_TYPE);

      if (typeStr === 'Through-hole') pad.SetAttribute(PAD_ATTRIB.PTH);
      else if (typeStr === 'SMD') pad.SetAttribute(PAD_ATTRIB.SMD);
      else if (typeStr === 'Connector') pad.SetAttribute(PAD_ATTRIB.CONN);
      else if (typeStr === 'NPTH') pad.SetAttribute(PAD_ATTRIB.NPTH);
      // Aperture derived by copper-less layers; do not overwrite attribute here.

      const shape = this.m_grid.GetCellValue(row, COL_SHAPE);

      if (shape !== INDETERMINATE_STATE) {
        const newShape = ShapeFromString(shape);

        pad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
          pad.SetShape(aLayer, newShape);
        });
      }

      const pos = {
        x: this.m_grid.GetUnitValue(row, COL_POS_X),
        y: this.m_grid.GetUnitValue(row, COL_POS_Y),
      };
      pad.SetPosition(pos);

      const size_x_value = this.m_grid.GetCellValue(row, COL_SIZE_X);

      if (size_x_value !== INDETERMINATE_STATE) {
        const size_x = this.m_grid.GetUnitValue(row, COL_SIZE_X);

        pad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
          const size = { x: size_x, y: pad.GetSize(aLayer).y };
          pad.SetSize(aLayer, size);
        });
      }

      const size_y_value = this.m_grid.GetCellValue(row, COL_SIZE_Y);

      if (size_y_value !== INDETERMINATE_STATE) {
        const size_y = this.m_grid.GetUnitValue(row, COL_SIZE_Y);

        pad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
          const size = { x: pad.GetSize(aLayer).x, y: size_y };
          pad.SetSize(aLayer, size);
        });
      }

      // Drill sizes (only if attribute allows)
      if (pad.GetAttribute() === PAD_ATTRIB.PTH || pad.GetAttribute() === PAD_ATTRIB.NPTH) {
        let drill_x = this.m_grid.GetUnitValue(row, COL_DRILL_X);
        let drill_y = this.m_grid.GetUnitValue(row, COL_DRILL_Y);

        if (drill_x > 0 || drill_y > 0) {
          if (drill_x <= 0) drill_x = drill_y;

          if (drill_y <= 0) drill_y = drill_x;

          pad.SetDrillSize({ x: drill_x, y: drill_y });
        }
      }

      // Pad->Die
      const delayStr = this.m_grid.GetCellValue(row, COL_P2D_DELAY);
      const lenStr = this.m_grid.GetCellValue(row, COL_P2D_LENGTH);

      if (lenStr !== '') pad.SetPadToDieLength(this.m_grid.GetUnitValue(row, COL_P2D_LENGTH));
      else pad.SetPadToDieLength(0);

      if (delayStr !== '') pad.SetPadToDieDelay(this.m_grid.GetUnitValue(row, COL_P2D_DELAY));
      else pad.SetPadToDieDelay(0);

      row++;
    }

    commit.Push('Edit Pads');
    this.m_frame.GetCanvas()?.Refresh();

    return true;
  }

  InitColumnProportions(): void {
    this.m_colProportions = [];
    this.m_minColWidths = [];

    // Only consider the actual data columns (all of them since row labels are hidden)
    const cols = this.m_grid.GetNumberCols();
    let total = 0;
    const widths: number[] = [];

    for (let c = 0; c < cols; ++c) {
      const w = this.m_colSizes[c] ?? 0;
      widths.push(w);
      total += w;
    }

    if (total <= 0) return;

    for (const w of widths) {
      this.m_colProportions.push(w / total);
      this.m_minColWidths.push(w);
    }
  }

  /** `OnSize`: `aClientWidth` is `m_grid->GetClientSize().x`. */
  OnSize(aClientWidth: number): void {
    if (this.m_colProportions.length === 0) return;

    // Compute available total width for columns and resize keeping proportions.
    const cols = this.m_grid.GetNumberCols();
    let available = 0;

    for (let c = 0; c < cols; ++c) available += this.m_colSizes[c] ?? 0;

    // Use client size of grid minus scrollbar estimate to better distribute.
    if (aClientWidth > 0) available = aClientWidth; // prefer actual client width

    let used = 0;
    const sizes = [...this.m_colSizes];

    for (let c = 0; c < cols; ++c) {
      let target = Math.round(this.m_colProportions[c]! * available);
      target = Math.max(target, this.m_minColWidths[c]!);

      // Defer last column to absorb rounding diff.
      if (c === cols - 1) target = Math.max(available - used, this.m_minColWidths[c]!);

      sizes[c] = target;
      used += target;
    }

    this.m_colSizes = sizes;
    this.notify();
  }

  /** `OnCharHook`: a key typed into the Number editor makes the summary stale. */
  OnCharHook(): void {
    if (this.m_grid.IsCellEditControlShown() && this.m_grid.GetGridCursorCol() === COL_NUMBER)
      this.m_summaryDirty = true;
  }

  OnCellChanged(aEvent: wxGridEvent): void {
    const row = aEvent.GetRow();
    const col = aEvent.GetCol();

    if (!this.m_footprint) return;

    const target = this.getPadForRow(row);

    if (!target) return;

    let needCanvasRefresh = false;

    switch (col) {
      case COL_NUMBER:
        target.SetNumber(this.m_grid.GetCellValue(row, col));
        needCanvasRefresh = true;
        this.m_summaryDirty = true;
        break;

      case COL_TYPE: {
        const typeStr = this.m_grid.GetCellValue(row, col);
        let newAttr = target.GetAttribute();

        if (typeStr === 'Through-hole') newAttr = PAD_ATTRIB.PTH;
        else if (typeStr === 'SMD') newAttr = PAD_ATTRIB.SMD;
        else if (typeStr === 'Connector') newAttr = PAD_ATTRIB.CONN;
        else if (typeStr === 'NPTH') newAttr = PAD_ATTRIB.NPTH;

        if (newAttr !== target.GetAttribute()) {
          target.SetAttribute(newAttr);

          // Toggle drill columns read-only state dynamically.
          const drillsEditable = newAttr === PAD_ATTRIB.PTH || newAttr === PAD_ATTRIB.NPTH;
          this.m_grid.SetReadOnly(row, COL_DRILL_X, !drillsEditable);
          this.m_grid.SetReadOnly(row, COL_DRILL_Y, !drillsEditable);
          needCanvasRefresh = true;
        }

        break;
      }

      case COL_SHAPE:
        target.SetShape(PADSTACK.ALL_LAYERS, ShapeFromString(this.m_grid.GetCellValue(row, col)));
        needCanvasRefresh = true;
        break;

      case COL_POS_X:
      case COL_POS_Y: {
        const pos = { ...target.GetPosition() };

        if (col === COL_POS_X) pos.x = this.m_grid.GetUnitValue(row, col);
        else pos.y = this.m_grid.GetUnitValue(row, col);

        target.SetPosition(pos);
        needCanvasRefresh = true;
        break;
      }

      case COL_SIZE_X:
      case COL_SIZE_Y: {
        const size = { ...target.GetSize(PADSTACK.ALL_LAYERS) };

        if (col === COL_SIZE_X) size.x = this.m_grid.GetUnitValue(row, col);
        else size.y = this.m_grid.GetUnitValue(row, col);

        target.SetSize(PADSTACK.ALL_LAYERS, size);
        needCanvasRefresh = true;
        break;
      }

      case COL_DRILL_X:
      case COL_DRILL_Y: {
        if (target.GetAttribute() === PAD_ATTRIB.PTH || target.GetAttribute() === PAD_ATTRIB.NPTH) {
          let dx = this.m_grid.GetUnitValue(row, COL_DRILL_X);
          let dy = this.m_grid.GetUnitValue(row, COL_DRILL_Y);

          if (dx > 0 || dy > 0) {
            if (dx <= 0) dx = dy;

            if (dy <= 0) dy = dx;

            target.SetDrillSize({ x: dx, y: dy });
            needCanvasRefresh = true;
          }
        }

        break;
      }

      case COL_P2D_LENGTH:
        if (this.m_grid.GetCellValue(row, col) !== '')
          target.SetPadToDieLength(this.m_grid.GetUnitValue(row, col));

        break;

      case COL_P2D_DELAY:
        if (this.m_grid.GetCellValue(row, col) !== '')
          target.SetPadToDieDelay(this.m_grid.GetUnitValue(row, col));

        break;

      default:
        break;
    }

    // Request redraw (simple approach)
    target.SetDirty();

    if (needCanvasRefresh) this.m_frame.GetCanvas()?.ForceRefresh();

    this.notify();
  }

  OnSelectCell(aEvent: wxGridEvent): void {
    const row = aEvent.GetRow();

    if (!this.m_footprint) return;

    const canvas = this.m_frame.GetCanvas();

    // Clear existing pad selections
    for (const pad of this.m_footprint.Pads()) {
      if (pad.IsBrightened()) {
        pad.ClearBrightened();

        if (canvas) canvas.GetView().Update(pad, VIEW_UPDATE_FLAGS.REPAINT);
      }
    }

    const pad = this.getPadForRow(row);

    if (!pad) return;

    pad.SetBrightened();

    if (canvas) {
      canvas.GetView().Update(pad, VIEW_UPDATE_FLAGS.REPAINT);
      canvas.ForceRefresh();
    }
  }

  OnUpdateUI(): void {
    if (this.m_summaryDirty) {
      if (this.m_grid.IsCellEditControlShown() && this.m_grid.GetGridCursorCol() === COL_NUMBER) {
        const row = this.m_grid.GetGridCursorRow();
        const col = this.m_grid.GetGridCursorCol();

        const target = this.getPadForRow(row);

        if (!target) return;

        const editor = this.m_grid.GetCellEditor(row, col);

        if (editor) target.SetNumber(editor.m_value);
      }

      this.updateSummary();
      this.m_summaryDirty = false;
    }
  }

  OnCancel(): void {
    this.m_cancelled = true;
  }

  /**
   * `~DIALOG_FP_EDIT_PAD_TABLE`: a cancelled dialog puts every pad back as it
   * was; the grid's GRID_TRICKS handler goes with it.
   */
  Destroy(): void {
    if (this.m_cancelled) this.RestoreOriginalPadState();
  }

  private updateSummary(): void {
    const pinNumbers = new PIN_NUMBERS();

    for (const pad of this.m_footprint!.Pads()) {
      if (pad.GetNumber().length) pinNumbers.insert(pad.GetNumber());
    }

    const summary = pinNumbers.GetSummary();
    const duplicates = pinNumbers.GetDuplicates();

    this.m_pin_numbers_summary = summary;
    this.m_pin_numbers_summaryToolTip = summary;
    this.m_pin_count = String(this.m_footprint!.Pads().length);
    this.m_duplicate_pins = duplicates;
    this.m_duplicate_pinsToolTip = duplicates;

    this.notify();
  }

  private getPadForRow(aRowId: number): PAD | null {
    if (aRowId < 0 || aRowId >= this.m_originalPads.length) return null;

    return this.m_originalPads[aRowId]!.pad;
  }

  /** For the tests: the pad each row stands for. */
  GetPadForRow(aRowId: number): PAD | null {
    return this.getPadForRow(aRowId);
  }

  IsCancelled(): boolean {
    return this.m_cancelled;
  }
}
