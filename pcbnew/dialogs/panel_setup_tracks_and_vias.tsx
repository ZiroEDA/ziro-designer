// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Pre-defined Sizes. Counterpart:
 * `pcbnew/dialogs/panel_setup_tracks_and_vias.cpp` over its `_base.cpp`
 * (`PANEL_SETUP_TRACKS_AND_VIAS`): the Tracks, Vias and Differential Pairs
 * grids, their sort/normalise transfer and `Validate()`. Was inside
 * `dialog_board_setup.tsx` until it was split out to the file KiCad keeps it in.
 */
import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxGridSelectionModes, wxGridStringTable } from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import { pcbIUScale, pcbMmToIU } from '@ziroeda/common/eda_units.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { PCB_VIA, VIA_PARAMETER_ERROR_FIELD } from '../pcb_track.js';
import type { DiffPairSize, ViaSize } from '../board_settings.js';

/** `document.getElementById` handle for one grid cell, so PAGED_DIALOG can
 *  focus the cell `Validate()` refused — `SetError( …, grid, row, col )`. */
export function sizeCellId(grid: string, row: number, col: string): string {
  return `ze-size-${grid.replace(/\s+/g, '-').toLowerCase()}-${row}-${col}`;
}

/**
 * `std::sort` over the row struct, which is `operator<` and not the first
 * column: `VIA_DIMENSION` compares diameter then drill, `DIFF_PAIR_DIMENSION`
 * width then gap then via gap (`board_design_settings.h:144`, `:187`).
 */
export function sortSizeRows<T>(rows: readonly T[], keys: readonly (keyof T)[]): T[] {
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const d = (a[k] as number) - (b[k] as number);
      if (d !== 0) return d;
    }
    return 0;
  });
}

/**
 * `PANEL_SETUP_TRACKS_AND_VIAS::TransferDataFromWindow` (`:290-345`): a row
 * whose FIRST column is empty is dropped, and what survives is sorted.
 *
 * Both halves are unconditional. The Sort button is a convenience; OK sorts
 * whether or not it was pressed, which is why a board file's lists are always
 * in increasing order.
 */
export function normalizeSizeRows<T>(rows: readonly T[], keys: readonly (keyof T)[]): T[] {
  const first = keys[0]!;
  return sortSizeRows(
    rows.filter((r) => (r[first] as number) > 0),
    keys,
  );
}

/**
 * `PANEL_SETUP_TRACKS_AND_VIAS::Validate()` (`:376-433`), which is the page's
 * own refusal and runs before anything is stored.
 *
 * The via half is `PCB_VIA::ValidateViaParameters` (`pcb_track.cpp:1769-1817`)
 * with every layer argument `std::nullopt`, so five of its checks apply. A
 * value of zero is this page's empty cell, which is upstream's "has no value"
 * — so "no hole size defined" is a diameter with a zero drill beside it, not a
 * separate rule.
 *
 * Returns the message and the cell to focus, or null.
 */
export function validateSizes(v: {
  viaSizesMM: readonly ViaSize[];
  diffPairsMM: readonly DiffPairSize[];
}): { message: string; row: number; grid: string; col: string } | null {
  for (const [row, via] of v.viaSizesMM.entries()) {
    // `PCB_VIA::ValidateViaParameters`, shared with the Custom Track/Via Size
    // dialog so the two refuse the same values in the same words. A zero is
    // this page's empty cell, which is upstream's empty `std::optional`.
    const bad = PCB_VIA.ValidateViaParameters(
      via.diameter > 0 ? pcbMmToIU(via.diameter) : undefined,
      via.drill > 0 ? pcbMmToIU(via.drill) : undefined,
    );

    if (bad) {
      const col = bad.m_Field === VIA_PARAMETER_ERROR_FIELD.DIAMETER ? 'diameter' : 'drill';
      return { message: bad.m_Message, row, grid: 'Vias', col };
    }
  }

  // "No differential pair gap defined." — a width with no gap. A via gap is
  // optional and is not checked.
  for (const [row, dp] of v.diffPairsMM.entries()) {
    if (dp.width > 0 && !(dp.gap > 0))
      return {
        message: 'No differential pair gap defined.',
        row,
        grid: 'Differential Pairs',
        col: 'gap',
      };
  }

  return null;
}

/** The columns of each Pre-defined Sizes grid, by the grid's title. */
export const SIZE_GRID_KEYS: Record<string, string[]> = {
  Tracks: ['width'],
  Vias: ['diameter', 'drill'],
  'Differential Pairs': ['width', 'gap', 'viaGap'],
};

/**
 * One pre-defined-size grid (Tracks / Vias / Differential Pairs), and the
 * three of them are the whole of `PANEL_SETUP_TRACKS_AND_VIAS`.
 *
 * A WX_GRID with GRID_TRICKS, rows selected whole, `SetUnitsProvider( m_Frame )`
 * and every column auto-eval (`panel_setup_tracks_and_vias.cpp:88-100`): a
 * cell holds TEXT, "0.5 mm", and a zero is an EMPTY cell, because
 * `AppendViaSize` / `AppendDiffPairs` only call `SetUnitValue` for a value
 * `> 0` (`:446-472`) — that empty cell is what `<= 0 means use Netclass`
 * looks like to the user.
 */
function SizeGrid<T extends object>({
  title,
  cols,
  rows,
  setRows,
  units,
  gridRef,
}: {
  title: string;
  cols: { label: string; key: keyof T }[];
  rows: readonly T[];
  setRows: (next: T[]) => void;
  units: StatusUnits;
  gridRef: (g: WX_GRID) => void;
}): JSX.Element {
  const [{ grid, tricks, provider }] = useState(() => {
    const g = new WX_GRID();
    g.SetTable(new wxGridStringTable(0, cols.length), true, wxGridSelectionModes.wxGridSelectRows);
    cols.forEach((c, i) => {
      g.SetColLabelValue(i, c.label);
    });
    const p = new UNITS_PROVIDER(pcbIUScale, units);
    g.SetUnitsProvider(p);
    g.SetAutoEvalCols(cols.map((_, i) => i));
    return { grid: g, tricks: new GRID_TRICKS(g), provider: p };
  });
  gridRef(grid);

  const written = useRef<string | null>(null);
  const key = JSON.stringify([units, rows]);

  /** `AppendTrackWidth` / `AppendViaSize` / `AppendDiffPairs`: a zero stays empty. */
  const appendRow = (aRow: T): void => {
    const row = grid.GetNumberRows();
    grid.AppendRows(1);
    cols.forEach((c, i) => {
      const mm = aRow[c.key] as number;

      if (mm > 0) grid.SetUnitValue(row, i, pcbIUScale.mmToIU(mm));
    });
  };

  // TransferDataToWindow.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the rows and units; the grid is stable
  useLayoutEffect(() => {
    if (key === written.current) return;

    provider.SetUserUnits(units);
    grid.BeginBatch();
    grid.ClearRows();

    for (const r of rows) appendRow(r);

    grid.EndBatch();
    written.current = key;
  }, [key]);

  /** The rows as the grid holds them; an empty cell is 0. */
  const read = (): T[] =>
    Array.from({ length: grid.GetNumberRows() }, (_, row) => {
      const r = {} as T;
      cols.forEach((c, i) => {
        const text = grid.GetCellValue(row, i);
        (r as Record<keyof T, number>)[c.key] =
          text.trim() === '' ? 0 : pcbIUScale.iuToMM(grid.GetUnitValue(row, i));
      });
      return r;
    });

  const transfer = (): void => {
    const next = read();
    const nextKey = JSON.stringify([units, next]);

    if (nextKey === written.current) return;

    written.current = nextKey;
    setRows(next);
  };

  /** `OnSort…Click`: the rows with a first value, sorted as `operator<` does. */
  const onSort = (): void => {
    if (grid.GetNumberRows() < 2) return;

    grid.ClearSelection();
    const sorted = sortSizeRows(
      read().filter((r) => (r[cols[0]!.key] as number) > 0 || cols.length > 1),
      cols.map((c) => c.key),
    );
    grid.BeginBatch();
    grid.ClearRows();

    for (const r of sorted) appendRow(r);

    grid.EndBatch();
  };

  return (
    <div className="ze-sizes-col">
      {/* [data] `bSizerTracks->Add( stTracksLabel, 0, wxALL, 5 )`. */}
      <div className="ze-sizes-title">{title}</div>
      <div className="ze-grid-pane ze-sizes-pane">
        <WxGridView
          grid={grid}
          tricks={tricks}
          // [data] `SetColSize( n, 120 )` (`panel_setup_tracks_and_vias_base.cpp:38`, `:92-93`, `:151-153`).
          columns={cols.map(() => ({ width: 120 }))}
          onUpdate={transfer}
          ariaLabel={title}
        />
      </div>
      <div className="ze-grid-btns">
        {/* `OnAddRow` appends a row of ZEROS and puts the cursor in its first
            column. It does not invent a size. */}
        <button
          type="button"
          className="ze-gridbtn ze-gridbtn-add"
          title="Add"
          onClick={() =>
            grid.OnAddRow(() => {
              appendRow({} as T);
              return [grid.GetNumberRows() - 1, 0];
            })
          }
        >
          <Icon name="plus" />
        </button>
        {/* `std::sort` over the whole struct — `VIA_DIMENSION::operator<`
            compares diameter then drill, `DIFF_PAIR_DIMENSION::operator<`
            width then gap then via gap (`board_design_settings.h:144`, `:187`). */}
        <button
          type="button"
          className="ze-gridbtn ze-gridbtn-sort"
          title="Sort ascending"
          onClick={onSort}
        >
          <Icon name="arrowDown" />
        </button>
        {/* `WX_GRID::OnDeleteRows` deletes the SELECTED rows. */}
        <button
          type="button"
          className="ze-gridbtn ze-gridbtn-remove"
          title="Remove"
          onClick={() => grid.OnDeleteRows((row) => grid.DeleteRows(row, 1))}
        >
          <Icon name="delete" />
        </button>
      </div>
    </div>
  );
}

export function PanelSetupTracksAndVias({
  trackWidthsMM,
  viaSizesMM,
  diffPairsMM,
  units,
  onChange,
  gridRefs,
}: {
  trackWidthsMM: readonly number[];
  viaSizesMM: readonly ViaSize[];
  diffPairsMM: readonly DiffPairSize[];
  units: StatusUnits;
  onChange: (patch: {
    trackWidthsMM?: number[];
    viaSizesMM?: ViaSize[];
    diffPairsMM?: DiffPairSize[];
  }) => void;
  /** The three grids by title, for `SetError( …, grid, row, col )`. */
  gridRefs: Record<string, WX_GRID | undefined>;
}): JSX.Element {
  return (
    // `bMainSizer`, horizontal: three columns at proportion 1
    // (`panel_setup_tracks_and_vias_base.cpp:71`, `:130`, `:198`), so they
    // split the page in thirds whatever their grids need.
    <div className="ze-sizes-cols">
      {/* [data] the column labels, which carry no unit: `SetColLabelValue( 0,
          _("Width") )` and friends (`_base.cpp:41`, `:96-97`, `:165-167`).
          These read "Width (mm)" — the unit is in the CELL, not the header. */}
      <SizeGrid<{ width: number }>
        title="Tracks"
        cols={[{ label: 'Width', key: 'width' }]}
        rows={trackWidthsMM.map((width) => ({ width }))}
        setRows={(rows) => onChange({ trackWidthsMM: rows.map((r) => r.width) })}
        units={units}
        gridRef={(g) => (gridRefs.Tracks = g)}
      />
      <SizeGrid<ViaSize>
        title="Vias"
        cols={[
          { label: 'Diameter', key: 'diameter' },
          { label: 'Hole', key: 'drill' },
        ]}
        rows={viaSizesMM}
        setRows={(rows) => onChange({ viaSizesMM: rows })}
        units={units}
        gridRef={(g) => (gridRefs.Vias = g)}
      />
      <SizeGrid<DiffPairSize>
        title="Differential Pairs"
        cols={[
          { label: 'Width', key: 'width' },
          { label: 'Gap', key: 'gap' },
          { label: 'Via Gap', key: 'viaGap' },
        ]}
        rows={diffPairsMM}
        setRows={(rows) => onChange({ diffPairsMM: rows })}
        units={units}
        gridRef={(g) => (gridRefs['Differential Pairs'] = g)}
      />
    </div>
  );
}
