// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Net Classes panel. Counterpart:
 * `common/dialogs/panel_setup_netclasses_base.cpp` (PANEL_SETUP_NETCLASSES), the
 * shared net-class editor. Top: a wide "Netclasses" grid (Name + physical/visual
 * columns) with add / move-up / move-down / remove. Bottom: a "Netclass
 * Assignments" grid mapping a net-name pattern to a net class. The Default class
 * is always present and cannot be removed or reordered.
 *
 * Both grids are WX_GRIDs with GRID_TRICKS, rows selected whole. As upstream
 * the netclasses are listed by priority with Default LAST (`loadNetclasses`),
 * a new class goes in at the top, the columns shown are the editor's
 * (`ShowHideColumns`), the colours are swatch cells, and renaming a class
 * renames it in the assignments (`OnNetclassGridCellChanging`). The
 * assignments sort on a click on their column label. Not ported: the
 * matching-nets pane and the per-column tooltips.
 */

import { type JSX, useEffect, useLayoutEffect } from 'react';
import { DisplayErrorMessage } from '../confirm.js';
import { StdBitmapButton } from '../widgets/std_bitmap_button.js';
import type { WX_GRID } from '../widgets/wx_grid.js';
import {
  wxEVT_GRID_CELL_CHANGING,
  wxEVT_GRID_LABEL_LEFT_CLICK,
  wxGridCellAttr,
  wxGridCellChoiceEditor,
  type wxGridEvent,
  wxGridSelectionModes,
} from '../wx/grid.js';
import { useStringGrid, WxGridView } from '../wx/grid_ui.js';
import {
  LINE_STYLES,
  blankNetClass as blankClass,
  type NetClass,
  type NetClassAssignment,
  type NetClassesData,
} from '../project/net_settings.js';

// The data model lives beside the class it describes in common/;
// re-exported here so the panel stays the import site for its slice.
export {
  LINE_STYLES,
  defaultNetClasses,
  type NetClass,
  type NetClassAssignment,
  type NetClassesData,
} from '../project/net_settings.js';
import { ColorSwatch } from '../widgets/color_swatch.js';
import { parseColor4d, toCssColor } from '../gal/color4d.js';
import { pcbIUScale, schIUScale } from '../eda_units.js';
import { COLOR4D_UNSPECIFIED, type Color4d } from '../gal/color4d.js';
import { NETCLASS } from '../netclass.js';
import type { NET_SETTINGS } from '../project/net_settings.js';

/** The CSS colour the grid edits; `COLOR4D::UNSPECIFIED` is the blank. */
function colorToCss(c: Color4d): string {
  return c.a === 0
    ? ''
    : toCssColor(c).replace(/^rgb\((\d+),(\d+),(\d+)\)$/, (_m, r, g, b) => {
        const hex = (x: string): string => Number(x).toString(16).padStart(2, '0');
        return `#${hex(r)}${hex(g)}${hex(b)}`;
      });
}

function cssToColor(css: string): Color4d {
  return css === '' ? COLOR4D_UNSPECIFIED : parseColor4d(css);
}

const numStr = (v: number | undefined): string => (v === undefined ? '' : String(v));

/**
 * PANEL_SETUP_NETCLASSES's transfers (common/dialogs/panel_setup_netclasses.cpp)
 * over the project's NET_SETTINGS: Default first, then by priority. PCB
 * dimensions are mm; the schematic wire and bus widths are mils.
 */
export const PANEL_SETUP_NETCLASSES = {
  TransferDataToWindow(aSettings: NET_SETTINGS): NetClassesData {
    const mm = (iu: number): number => pcbIUScale.iuToMM(iu);
    const toRow = (nc: NETCLASS): NetClass => ({
      name: nc.GetName(),
      clearance: nc.HasClearance() ? numStr(mm(nc.GetClearance())) : '',
      trackWidth: nc.HasTrackWidth() ? numStr(mm(nc.GetTrackWidth())) : '',
      viaSize: nc.HasViaDiameter() ? numStr(mm(nc.GetViaDiameter())) : '',
      viaHole: nc.HasViaDrill() ? numStr(mm(nc.GetViaDrill())) : '',
      uviaSize: nc.HasuViaDiameter() ? numStr(mm(nc.GetuViaDiameter())) : '',
      uviaHole: nc.HasuViaDrill() ? numStr(mm(nc.GetuViaDrill())) : '',
      dpWidth: nc.HasDiffPairWidth() ? numStr(mm(nc.GetDiffPairWidth())) : '',
      dpGap: nc.HasDiffPairGap() ? numStr(mm(nc.GetDiffPairGap())) : '',
      dpViaGap: nc.HasDiffPairViaGap() ? numStr(mm(nc.GetDiffPairViaGap())) : '',
      tuningProfile: nc.GetTuningProfile(),
      pcbColor: colorToCss(nc.GetPcbColor(true)),
      wireThickness: nc.HasWireWidth() ? numStr(schIUScale.iuToMils(nc.GetWireWidth())) : '',
      busThickness: nc.HasBusWidth() ? numStr(schIUScale.iuToMils(nc.GetBusWidth())) : '',
      color: colorToCss(nc.GetSchematicColor(true)),
      lineStyle: nc.HasLineStyle() ? (LINE_STYLES[nc.GetLineStyle()] ?? 'Solid') : 'Solid',
    });

    const rest = [...aSettings.GetNetclasses().values()].sort(
      (a, b) => a.GetPriority() - b.GetPriority(),
    );
    const netColors: Record<string, string> = {};
    for (const [net, color] of aSettings.GetNetColorAssignments())
      netColors[net] = colorToCss(color);

    return {
      classes: [toRow(aSettings.GetDefaultNetclass()), ...rest.map(toRow)],
      assignments: aSettings
        .GetNetclassPatternAssignments()
        .map(([matcher, netClass]) => ({ pattern: matcher.GetPattern(), netClass })),
      netColors,
    };
  },

  TransferDataFromWindow(data: NetClassesData, aSettings: NET_SETTINGS): void {
    const parseMM = (s: string): number | undefined => {
      const t = s.trim();
      if (t === '') return undefined;
      const f = Number.parseFloat(t);
      return Number.isFinite(f) ? pcbIUScale.mmToIU(f) : undefined;
    };
    const parseMils = (s: string): number | undefined => {
      const t = s.trim();
      if (t === '') return undefined;
      const f = Number.parseFloat(t);
      return Number.isFinite(f) ? schIUScale.milsToIU(f) : undefined;
    };

    const fill = (nc: NETCLASS, row: NetClass): void => {
      nc.SetClearance(parseMM(row.clearance));
      nc.SetTrackWidth(parseMM(row.trackWidth));
      nc.SetViaDiameter(parseMM(row.viaSize));
      nc.SetViaDrill(parseMM(row.viaHole));
      nc.SetuViaDiameter(parseMM(row.uviaSize));
      nc.SetuViaDrill(parseMM(row.uviaHole));
      nc.SetDiffPairWidth(parseMM(row.dpWidth));
      nc.SetDiffPairGap(parseMM(row.dpGap));
      nc.SetDiffPairViaGap(parseMM(row.dpViaGap));
      nc.SetTuningProfile(row.tuningProfile);
      nc.SetPcbColor(cssToColor(row.pcbColor));
      nc.SetWireWidth(parseMils(row.wireThickness));
      nc.SetBusWidth(parseMils(row.busThickness));
      nc.SetSchematicColor(cssToColor(row.color));
      nc.SetLineStyle(Math.max(0, LINE_STYLES.indexOf(row.lineStyle)));
    };

    const [dfltRow, ...rows] = data.classes;
    if (dfltRow) {
      const dflt = aSettings.GetDefaultNetclass();
      fill(dflt, dfltRow);
      aSettings.SetDefaultNetclass(dflt);
    }

    const classes = new Map<string, NETCLASS>();
    rows.forEach((row, i) => {
      const nc = new NETCLASS(row.name, false);
      nc.SetPriority(i);
      fill(nc, row);
      classes.set(row.name, nc);
    });
    aSettings.SetNetclasses(classes);

    aSettings.ClearNetclassPatternAssignments();
    for (const a of data.assignments) {
      if (a.pattern !== '' || a.netClass !== '')
        aSettings.SetNetclassPatternAssignment(a.pattern, a.netClass);
    }

    aSettings.GetNetColorAssignments().clear();
    for (const [net, css] of Object.entries(data.netColors)) {
      if (css !== '') aSettings.GetNetColorAssignments().set(net, parseColor4d(css));
    }

    aSettings.ClearAllCaches();
  },
};

interface Props {
  value: NetClassesData;
  onChange: (next: NetClassesData) => void;
  /** `aIsEEschema`: which half of the columns the grid shows. */
  isEEschema?: boolean;
  /**
   * `UpdateDelayProfileNames( aNames )` (panel_setup_netclasses.cpp:1002):
   * the Board Setup dialog hands over its Tuning Profiles page's names and the
   * Tuning Profile column becomes a `wxGridCellChoiceEditor` over a blank
   * entry plus them. Absent (the schematic dialog), the column stays text.
   */
  delayProfileNames?: readonly string[];
}

/** The netclass grid's columns, in `GRID_*` order (`panel_setup_netclasses.cpp:52-73`). */
const GRID_COLS: { label: string; key: keyof NetClass }[] = [
  { label: 'Name', key: 'name' },
  { label: 'Clearance', key: 'clearance' },
  { label: 'Track Width', key: 'trackWidth' },
  { label: 'Via Size', key: 'viaSize' },
  { label: 'Via Hole', key: 'viaHole' },
  { label: 'uVia Size', key: 'uviaSize' },
  { label: 'uVia Hole', key: 'uviaHole' },
  { label: 'DP Width', key: 'dpWidth' },
  { label: 'DP Gap', key: 'dpGap' },
  { label: 'Tuning Profile', key: 'tuningProfile' },
  { label: 'PCB Color', key: 'pcbColor' },
  { label: 'Wire Thickness', key: 'wireThickness' },
  { label: 'Bus Thickness', key: 'busThickness' },
  { label: 'Color', key: 'color' },
  { label: 'Line Style', key: 'lineStyle' },
];

const GRID_NAME = 0;
const GRID_DELAY_PROFILE = 9;
const GRID_PCB_COLOR = 10;
const GRID_SCHEMATIC_COLOR = 13;
const GRID_LINESTYLE = 14;

/** `NETCLASS::Default`. */
const DEFAULT_NETCLASS = 'Default';

export function PanelSetupNetclasses({
  value,
  onChange,
  isEEschema = false,
  delayProfileNames,
}: Props): JSX.Element {
  // `loadNetclasses`: by priority, then Default in the last row.
  const gridClasses = [...value.classes.slice(1), ...value.classes.slice(0, 1)];
  const dpViaGapOf = (aName: string): string =>
    value.classes.find((c) => c.name === aName)?.dpViaGap ?? '';

  const nc = useStringGrid<NetClass>({
    labels: GRID_COLS.map((c) => c.label),
    mode: wxGridSelectionModes.wxGridSelectRows,
    rows: gridClasses,
    toCells: (c) => GRID_COLS.map((col) => c[col.key]),
    fromCells: (cells) => {
      const c = blankClass(cells[GRID_NAME]!);
      GRID_COLS.forEach((col, i) => {
        c[col.key] = cells[i]!;
      });
      c.dpViaGap = dpViaGapOf(c.name);
      return c;
    },
    onChange: (rows) => onChange({ ...value, classes: [...rows.slice(-1), ...rows.slice(0, -1)] }),
    setup: (g) => {
      // The Default row: its name, colours and line style are fixed.
      const last = g.GetNumberRows() - 1;

      if (last >= 0)
        for (const col of [GRID_NAME, GRID_PCB_COLOR, GRID_SCHEMATIC_COLOR, GRID_LINESTYLE])
          g.SetReadOnly(last, col);
    },
    onAddRow: (g) => onAddNetclass(g),
  });

  const asg = useStringGrid<NetClassAssignment>({
    labels: ['Pattern', 'Net Class'],
    mode: wxGridSelectionModes.wxGridSelectRows,
    rows: value.assignments,
    toCells: (a) => [a.pattern, a.netClass],
    fromCells: (c) => ({ pattern: c[0]!, netClass: c[1]! }),
    onChange: (assignments) => onChange({ ...value, assignments }),
    onAddRow: (g) => onAddAssignment(g),
  });

  // `ShowHideColumns` and the attributes the constructor sets (`:136-170`).
  const profilesKey = JSON.stringify(delayProfileNames ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: profilesKey is delayProfileNames' content; the grid is stable
  useLayoutEffect(() => {
    const g = nc.grid;
    g.ShowHideColumns(isEEschema ? '0 11 12 13 14' : '0 1 2 3 4 5 6 7 8 9 10');

    const style = new wxGridCellAttr();
    style.SetEditor(new wxGridCellChoiceEditor(LINE_STYLES));
    g.SetColAttr(GRID_LINESTYLE, style);

    if (delayProfileNames) {
      const attr = new wxGridCellAttr();
      attr.SetEditor(new wxGridCellChoiceEditor(['', ...delayProfileNames]));
      g.SetColAttr(GRID_DELAY_PROFILE, attr);
    }
  }, [nc.grid, isEEschema, profilesKey]);

  // `rebuildNetclassDropdowns`: the assignments' Net Class column offers the names.
  const namesKey = JSON.stringify(value.classes.map((c) => c.name));
  // biome-ignore lint/correctness/useExhaustiveDependencies: namesKey is the names' content; the grid is stable
  useLayoutEffect(() => {
    const attr = new wxGridCellAttr();
    attr.SetEditor(
      new wxGridCellChoiceEditor(gridClasses.map((c) => c.name).filter((n) => n !== '')),
    );
    asg.grid.SetColAttr(1, attr);
  }, [namesKey]);

  // `OnNetclassGridCellChanging`: a name is validated, and a rename follows
  // into the assignments.
  useEffect(() => {
    const g = nc.grid;
    const onChanging = (e: wxGridEvent): void => {
      e.Skip();

      if (e.GetCol() !== GRID_NAME) return;

      const row = e.GetRow();
      const tmp = e.GetString().trim();
      let error: string | null = null;

      if (tmp === '') error = 'Netclass must have a name.';

      for (let ii = 0; ii < g.GetNumberRows() && error === null; ii++)
        if (ii !== row && g.GetCellValue(ii, GRID_NAME).toLowerCase() === tmp.toLowerCase())
          error = 'Netclass name already in use.';

      if (error !== null) {
        e.Veto();
        const msg = error;
        queueMicrotask(() => DisplayErrorMessage(msg));
        return;
      }

      const oldName = g.GetCellValue(row, GRID_NAME);

      if (oldName !== '')
        for (let r = 0; r < asg.grid.GetNumberRows(); ++r)
          if (asg.grid.GetCellValue(r, 1) === oldName) asg.grid.SetCellValue(r, 1, e.GetString());
    };
    g.Connect(wxEVT_GRID_CELL_CHANGING, onChanging);
    return () => g.Disconnect(wxEVT_GRID_CELL_CHANGING, onChanging);
  }, [nc.grid, asg.grid]);

  // `OnNetclassAssignmentSort`, on a click on an assignment column label.
  useEffect(() => {
    const g = asg.grid;
    let sortCol = 0;
    let sortAsc = false;
    const onSort = (e: wxGridEvent): void => {
      e.Skip();

      if (!g.CommitPendingChanges()) return;

      const col = e.GetCol();

      if (col < 0 || col >= g.GetNumberCols()) return;

      if (col !== sortCol) {
        sortCol = col;
        sortAsc = true;
      } else {
        sortAsc = !sortAsc;
      }

      const rows = Array.from({ length: g.GetNumberRows() }, (_, r) => [
        g.GetCellValue(r, 0),
        g.GetCellValue(r, 1),
      ]);
      rows.sort((a, b) => {
        const s1 = a[sortCol]!;
        const s2 = b[sortCol]!;
        const lt = s1 < s2 ? -1 : s1 > s2 ? 1 : 0;
        return sortAsc ? lt : -lt;
      });
      g.BeginBatch();
      rows.forEach(([pattern, netclass], r) => {
        g.SetCellValue(r, 0, pattern!);
        g.SetCellValue(r, 1, netclass!);
      });
      g.EndBatch();
    };
    g.Connect(wxEVT_GRID_LABEL_LEFT_CLICK, onSort);
    return () => g.Disconnect(wxEVT_GRID_LABEL_LEFT_CLICK, onSort);
  }, [asg.grid]);

  /** `OnAddNetclassClick`: a row at the top, colours unspecified, style not defined. */
  function onAddNetclass(g: WX_GRID): void {
    g.OnAddRow(() => {
      g.InsertRows(0);
      const blank = blankClass('');
      g.SetCellValue(0, GRID_PCB_COLOR, blank.pcbColor);
      g.SetCellValue(0, GRID_SCHEMATIC_COLOR, blank.color);
      g.SetCellValue(0, GRID_LINESTYLE, blank.lineStyle);
      return [0, GRID_NAME];
    });
  }

  /** `OnRemoveNetclassClick`: never the Default row; its members go back to Default. */
  const onRemoveNetclass = (): void => {
    const g = nc.grid;
    g.OnDeleteRows(
      (row) => {
        if (row === g.GetNumberRows() - 1) {
          DisplayErrorMessage('The default net class is required.');
          return false;
        }

        return true;
      },
      (row) => {
        const classname = g.GetCellValue(row, GRID_NAME);

        for (let a = 0; a < asg.grid.GetNumberRows(); ++a)
          if (asg.grid.GetCellValue(a, 1) === classname)
            asg.grid.SetCellValue(a, 1, DEFAULT_NETCLASS);

        g.DeleteRows(row, 1);
      },
    );
  };

  /** `OnAddAssignmentClick`: a new pattern for the Default class. */
  function onAddAssignment(g: WX_GRID): void {
    g.OnAddRow(() => {
      const row = g.GetNumberRows();
      g.AppendRows(1);
      g.SetCellValue(row, 1, value.classes[0]?.name ?? DEFAULT_NETCLASS);
      return [row, 0];
    });
  }

  const colorCell = (row: number, col: number, css: string): JSX.Element => (
    // GRID_CELL_COLOR_RENDERER / GRID_CELL_COLOR_SELECTOR: the swatch, and
    // the colour picker when the cell is edited.
    <span className="ze-grid-text">
      <ColorSwatch
        size="small"
        label={GRID_COLS[col]!.label}
        disabled={nc.grid.IsReadOnly(row, col)}
        color={parseColor4d(css || '#000000')}
        onChange={(picked) => nc.grid.SetCellValue(row, col, toCssColor(picked, ', '))}
      />
    </span>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Netclasses grid */}
      <div className="ze-pref-group-title">Netclasses</div>
      <div className="ze-grid-pane" style={{ flex: '1 1 55%', minHeight: 80 }}>
        <WxGridView
          grid={nc.grid}
          tricks={nc.tricks}
          onUpdate={nc.onUpdate}
          ariaLabel="Netclasses"
          renderCell={(row, col, css) =>
            col === GRID_PCB_COLOR || col === GRID_SCHEMATIC_COLOR ? colorCell(row, col, css) : null
          }
        />
      </div>

      <div className="ze-grid-btns">
        <StdBitmapButton
          bitmap="small_plus"
          title="Add netclass"
          tooltip={null}
          onClick={() => onAddNetclass(nc.grid)}
        />
        <StdBitmapButton
          bitmap="small_up"
          title="Move up"
          tooltip={null}
          onClick={() =>
            nc.grid.OnMoveRowUp(
              // Can't move the Default netclass
              (row) => row !== nc.grid.GetNumberRows() - 1,
              (row) => nc.grid.SwapRows(row, row - 1),
            )
          }
        />
        <StdBitmapButton
          bitmap="small_down"
          title="Move down"
          tooltip={null}
          onClick={() =>
            nc.grid.OnMoveRowDown(
              // Can't move the Default netclass
              (row) => row + 1 !== nc.grid.GetNumberRows() - 1,
              (row) => nc.grid.SwapRows(row, row + 1),
            )
          }
        />
        <span className="ze-gridbtn-gap" />
        <StdBitmapButton
          bitmap="small_trash"
          title="Remove netclass"
          tooltip={null}
          onClick={onRemoveNetclass}
        />
        <span style={{ flex: 1 }} />
        {/* `m_colorDefaultHelpText`; pcbnew relabels it (`:176-181`). */}
        <span>
          {isEEschema
            ? 'Set color to transparent to use KiCad default color.'
            : 'Set color to transparent to use layer default color.'}
        </span>
        {/* `m_importColorsButton`, hidden in eeschema. Stubbed: it copies net
            colours from the schematic's netclass definitions. */}
        {!isEEschema && (
          <button type="button" className="ze-btn ze-nc-importcolors" title="Not implemented yet">
            Import colors from schematic
          </button>
        )}
      </div>

      {/* Assignments grid */}
      <div className="ze-pref-group-title">Netclass Assignments</div>
      <div className="ze-grid-pane" style={{ flex: '1 1 45%', minHeight: 60 }}>
        <WxGridView
          grid={asg.grid}
          tricks={asg.tricks}
          columns={[{ width: 270 }, { width: 160 }]}
          flexCol={0}
          onUpdate={asg.onUpdate}
          ariaLabel="Netclass assignments"
        />
      </div>
      <div className="ze-grid-btns">
        <StdBitmapButton
          bitmap="small_plus"
          title="Add assignment"
          tooltip={null}
          onClick={() => onAddAssignment(asg.grid)}
        />
        <span style={{ width: 15 }} />
        <StdBitmapButton
          bitmap="small_trash"
          title="Remove assignment"
          tooltip={null}
          onClick={() => asg.grid.OnDeleteRows((row) => asg.grid.DeleteRows(row, 1))}
        />
      </div>
    </div>
  );
}
