// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Text & Graphics > Defaults. Counterparts:
 * `pcbnew/dialogs/panel_setup_text_and_graphics_base.cpp` (the layer-class grid,
 * "Default Properties for New Graphics and Text") and
 * `pcbnew/dialogs/panel_setup_dimensions_base.cpp` ("Default Properties for New
 * Dimension Objects"), which KiCad stacks on the same Defaults page.
 *
 * The grid rows are layer classes (Silk / Copper / Edge Cuts / Courtyards / Fab /
 * Other). Edge Cuts and Courtyards are graphics-only, so their Text Width/Height/
 * Thickness/Italic/Keep-Upright cells are blank and disabled, as upstream.
 *
 * The grid is upstream's: a WX_GRID over its string table with GRID_TRICKS,
 * `SetUnitsProvider` + `SetAutoEvalCols` on the four size columns, Italic and
 * Keep Upright read-only `wxGridCellBoolRenderer` cells that GRID_TRICKS
 * toggles, and `DISABLE_CELL` painting the dead cells wxSYS_COLOUR_FRAMEBK.
 *
 * Both headings carry a `wxStaticLine` under them
 * (`panel_setup_text_and_graphics_base.cpp:27`,
 * `panel_setup_dimensions_base.cpp:24`), which is `.ze-pref-group-title`; ours
 * drew bare 12.5px text with no rule at all. The dimension block is ONE
 * `wxGridBagSizer( 0, 5 )` six columns wide, not two side-by-side grids, which
 * is why upstream's "Text position:" lines up with "Units:" and its arrow-length
 * entry lines up with the Precision choice. No SetFont anywhere in either panel.
 */

import { CheckBox, TextCtrl } from '@ziroeda/common/wx/controls.js';
import { type JSX, useLayoutEffect, useRef, useState } from 'react';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { parseUnitValueDouble } from '@ziroeda/common/widgets/unit_binder.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxALIGN_CENTER,
  wxALIGN_LEFT,
  wxGridCellAttr,
  wxGridCellBoolRenderer,
  wxGridStringTable,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import type { BOARD } from '../board.js';
import { LAYER_CLASS } from '../board_design_settings.js';
import {
  DIM_PRECISION,
  DIM_TEXT_POSITION,
  DIM_UNITS_FORMAT,
  DIM_UNITS_MODE,
} from '../pcb_dimension.js';

export interface TextGfxRow {
  lineThickness: number;
  textWidth: number;
  textHeight: number;
  textThickness: number;
  italic: boolean;
  keepUpright: boolean;
}

/** PANEL_SETUP_DIMENSIONS's choices, as labels, beside the grid. */
export interface DimensionDefaults {
  units: string;
  format: string;
  precision: string;
  suppressTrailingZeroes: boolean;
  textPosition: string;
  keepTextAligned: boolean;
  arrowLengthMM: number;
  extLineOffsetMM: number;
}

export interface TextGfxDefaults {
  rows: TextGfxRow[];
  dimensions: DimensionDefaults;
}

/** The grid's rows, LAYER_CLASS order. */
const LAYER_CLASSES = [
  LAYER_CLASS.LAYER_CLASS_SILK,
  LAYER_CLASS.LAYER_CLASS_COPPER,
  LAYER_CLASS.LAYER_CLASS_EDGES,
  LAYER_CLASS.LAYER_CLASS_COURTYARD,
  LAYER_CLASS.LAYER_CLASS_FAB,
  LAYER_CLASS.LAYER_CLASS_OTHERS,
];

const selectionOf = (aList: readonly string[], aLabel: string, aFallback: number): number => {
  const i = aList.indexOf(aLabel);
  return i < 0 ? aFallback : i;
};

/**
 * PANEL_SETUP_TEXT_AND_GRAPHICS's transfers (panel_setup_text_and_graphics.cpp),
 * which run its PANEL_SETUP_DIMENSIONS' too.
 */
export const PANEL_SETUP_TEXT_AND_GRAPHICS = {
  TransferDataToWindow(aBoard: BOARD): TextGfxDefaults {
    const bds = aBoard.GetDesignSettings();
    const mm = (iu: number): number => pcbIUScale.iuToMM(iu);
    return {
      rows: LAYER_CLASSES.map((cls) => ({
        lineThickness: mm(bds.m_LineThickness[cls]!),
        textWidth: mm(bds.m_TextSize[cls]!.x),
        textHeight: mm(bds.m_TextSize[cls]!.y),
        textThickness: mm(bds.m_TextThickness[cls]!),
        italic: bds.m_TextItalic[cls]!,
        keepUpright: bds.m_TextUpright[cls]!,
      })),
      dimensions: {
        units: DIM_UNITS[bds.m_DimensionUnitsMode] ?? 'Automatic',
        format: DIM_FORMATS[bds.m_DimensionUnitsFormat] ?? '1234',
        precision: DIM_PRECISIONS[bds.m_DimensionPrecision] ?? '0.0000',
        suppressTrailingZeroes: bds.m_DimensionSuppressZeroes,
        textPosition: DIM_POSITION[bds.m_DimensionTextPosition] ?? 'Outside',
        keepTextAligned: bds.m_DimensionKeepTextAligned,
        arrowLengthMM: mm(bds.m_DimensionArrowLength),
        extLineOffsetMM: mm(bds.m_DimensionExtensionOffset),
      },
    };
  },

  TransferDataFromWindow(v: TextGfxDefaults, aBoard: BOARD): void {
    const bds = aBoard.GetDesignSettings();
    const iu = (mm: number): number => pcbIUScale.mmToIU(mm);
    v.rows.forEach((row, cls) => {
      bds.m_LineThickness[cls] = iu(row.lineThickness);
      if (cls === LAYER_CLASS.LAYER_CLASS_EDGES || cls === LAYER_CLASS.LAYER_CLASS_COURTYARD)
        return;
      bds.m_TextSize[cls] = { x: iu(row.textWidth), y: iu(row.textHeight) };
      bds.m_TextThickness[cls] = iu(row.textThickness);
      bds.m_TextItalic[cls] = row.italic;
      bds.m_TextUpright[cls] = row.keepUpright;
    });

    // PANEL_SETUP_DIMENSIONS::TransferDataFromWindow
    const d = v.dimensions;
    bds.m_DimensionUnitsMode = selectionOf(
      DIM_UNITS,
      d.units,
      DIM_UNITS_MODE.AUTOMATIC,
    ) as DIM_UNITS_MODE;
    bds.m_DimensionUnitsFormat = selectionOf(
      DIM_FORMATS,
      d.format,
      DIM_UNITS_FORMAT.NO_SUFFIX,
    ) as DIM_UNITS_FORMAT;
    bds.m_DimensionPrecision = selectionOf(
      DIM_PRECISIONS,
      d.precision,
      DIM_PRECISION.X_XXXX,
    ) as DIM_PRECISION;
    bds.m_DimensionSuppressZeroes = d.suppressTrailingZeroes;
    bds.m_DimensionTextPosition = selectionOf(
      DIM_POSITION,
      d.textPosition,
      DIM_TEXT_POSITION.OUTSIDE,
    ) as DIM_TEXT_POSITION;
    bds.m_DimensionKeepTextAligned = d.keepTextAligned;
    bds.m_DimensionArrowLength = iu(d.arrowLengthMM);
    bds.m_DimensionExtensionOffset = iu(d.extLineOffsetMM);
  },
};

// Row labels + whether the row carries text (Edge Cuts / Courtyards do not).
const ROWS: { label: string; text: boolean }[] = [
  { label: 'Silk Layers', text: true },
  { label: 'Copper Layers', text: true },
  { label: 'Edge Cuts', text: false },
  { label: 'Courtyards', text: false },
  { label: 'Fab Layers', text: true },
  { label: 'Other Layers', text: true },
];

// Dimension choice lists (panel_setup_dimensions_base.cpp).
const DIM_UNITS = ['Inches', 'Mils', 'Millimeters', 'Automatic'];
const DIM_FORMATS = ['1234', '1234 mm', '1234 (mm)'];
const DIM_PRECISIONS = ['0', '0.0', '0.00', '0.000', '0.0000', '0.00000'];
const DIM_POSITION = ['Outside', 'Inline'];

interface Props {
  value: TextGfxDefaults;
  onChange: (next: TextGfxDefaults) => void;
}

/** `COL_*` (`panel_setup_text_and_graphics.cpp:36-44`). */
const COL_LINE_THICKNESS = 0;
const COL_TEXT_WIDTH = 1;
const COL_TEXT_HEIGHT = 2;
const COL_TEXT_THICKNESS = 3;
const COL_TEXT_ITALIC = 4;
const COL_TEXT_UPRIGHT = 5;

/** `SetColLabelValue` (`_base.cpp:53-58`): no unit, the cells carry it. */
const COL_LABELS = [
  'Line Thickness',
  'Text Width',
  'Text Height',
  'Text Thickness',
  'Italic',
  'Keep Upright',
];

/** [data] `SetColSize` 140/140/140/140/80/120 (`panel_setup_text_and_graphics_base.cpp:46-51`). */
const COL_WIDTHS = [140, 140, 140, 140, 80, 120];

/** `wxSYS_COLOUR_FRAMEBK`, the same enumerator as BTNFACE: the grid's label colour. */
const DISABLED_COLOUR = 'var(--grid-label-bg)';

const toIU = (mm: number): number => Math.round(mm * pcbIUScale.IU_PER_MM);

export function PanelPcbTextGraphics({ value, onChange }: Props): JSX.Element {
  const num = (s: string): number => parseUnitValueDouble(s, 'mm');
  const setDim = <K extends keyof DimensionDefaults>(k: K, val: DimensionDefaults[K]): void =>
    onChange({ ...value, dimensions: { ...value.dimensions, [k]: val } });
  const d = value.dimensions;
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [{ grid, tricks }] = useState(() => {
    const g = new WX_GRID();
    g.SetTable(new wxGridStringTable(ROWS.length, COL_LABELS.length), true);
    COL_LABELS.forEach((label, c) => {
      g.SetColLabelValue(c, label);
    });
    ROWS.forEach((r, i) => {
      g.SetRowLabelValue(i, r.label);
    });
    g.SetRowLabelAlignment(wxALIGN_LEFT);
    // `SetUnitsProvider( m_Frame )`; this panel's frame reads millimetres.
    g.SetUnitsProvider(new UNITS_PROVIDER(pcbIUScale, 'mm'));
    g.SetAutoEvalCols([COL_LINE_THICKNESS, COL_TEXT_WIDTH, COL_TEXT_HEIGHT, COL_TEXT_THICKNESS]);
    return { grid: g, tricks: new GRID_TRICKS(g) };
  });

  const written = useRef<string | null>(null);
  const key = JSON.stringify(value.rows);

  // `TransferDataToWindow` (`:124-180`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the rows' content; the grid is stable
  useLayoutEffect(() => {
    if (key === written.current) return;

    grid.BeginBatch();

    value.rows.forEach((r, i) => {
      grid.SetUnitValue(i, COL_LINE_THICKNESS, toIU(r.lineThickness));

      if (!ROWS[i]?.text) {
        for (const col of [
          COL_TEXT_WIDTH,
          COL_TEXT_HEIGHT,
          COL_TEXT_THICKNESS,
          COL_TEXT_ITALIC,
          COL_TEXT_UPRIGHT,
        ]) {
          grid.SetReadOnly(i, col);
          grid.SetCellBackgroundColour(i, col, DISABLED_COLOUR);
        }
      } else {
        grid.SetUnitValue(i, COL_TEXT_WIDTH, toIU(r.textWidth));
        grid.SetUnitValue(i, COL_TEXT_HEIGHT, toIU(r.textHeight));
        grid.SetUnitValue(i, COL_TEXT_THICKNESS, toIU(r.textThickness));
        grid.SetCellValue(i, COL_TEXT_ITALIC, r.italic ? '1' : '');
        grid.SetCellValue(i, COL_TEXT_UPRIGHT, r.keepUpright ? '1' : '');

        for (const col of [COL_TEXT_ITALIC, COL_TEXT_UPRIGHT]) {
          const attr = new wxGridCellAttr();
          attr.SetRenderer(new wxGridCellBoolRenderer());
          attr.SetReadOnly(); // not really; we delegate interactivity to GRID_TRICKS
          attr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);
          grid.SetAttr(i, col, attr);
        }
      }
    });

    grid.EndBatch();
    written.current = key;
  }, [key]);

  /** `TransferDataFromWindow`'s reads (`:184-275`), after every change the grid draws. */
  const transfer = (): void => {
    const mm = (i: number, col: number): number => grid.GetUnitValue(i, col) / pcbIUScale.IU_PER_MM;
    const rows: TextGfxRow[] = valueRef.current.rows.map((r, i) =>
      ROWS[i]?.text
        ? {
            lineThickness: mm(i, COL_LINE_THICKNESS),
            textWidth: mm(i, COL_TEXT_WIDTH),
            textHeight: mm(i, COL_TEXT_HEIGHT),
            textThickness: mm(i, COL_TEXT_THICKNESS),
            // `wxGridCellBoolEditor::IsTrueValue`.
            italic: grid.GetCellValue(i, COL_TEXT_ITALIC) === '1',
            keepUpright: grid.GetCellValue(i, COL_TEXT_UPRIGHT) === '1',
          }
        : { ...r, lineThickness: mm(i, COL_LINE_THICKNESS) },
    );
    const next = JSON.stringify(rows);

    if (next === written.current) return;

    written.current = next;
    onChangeRef.current({ ...valueRef.current, rows });
  };

  return (
    <div className="ze-pref-page-natural">
      {/* PANEL_SETUP_TEXT_AND_GRAPHICS */}
      <div className="ze-pref-group-title">Default Properties for New Graphics and Text</div>
      <div className="ze-grid-pane ze-tg-grid-pane" style={{ maxHeight: '48vh' }}>
        <WxGridView
          grid={grid}
          tricks={tricks}
          rowLabels
          columns={COL_WIDTHS.map((width) => ({ width }))}
          onUpdate={transfer}
          ariaLabel="Default properties for new graphics and text"
        />
      </div>

      {/* PANEL_SETUP_DIMENSIONS — one `wxGridBagSizer( 0, 5 )`, six columns
          wide, whose right half starts at column 3. */}
      <div className="ze-pref-group-title ze-tg-dimtitle">
        Default Properties for New Dimension Objects
      </div>
      <div className="ze-tg-dimgrid">
        {/* Row 0 */}
        <span>Units:</span>
        <Combo
          value={d.units}
          ariaLabel="Dimension units"
          options={DIM_UNITS.map((u) => ({ value: u, label: u }))}
          onChange={(u) => setDim('units', u)}
        />
        {/* (0,2) is an empty spacer cell upstream. */}
        <span />
        <span className="ze-tg-dimright">Text position:</span>
        <Combo
          value={d.textPosition}
          ariaLabel="Dimension text position"
          options={DIM_POSITION.map((x) => ({ value: x, label: x }))}
          onChange={(x) => setDim('textPosition', x)}
        />
        <span />

        {/* Row 1 */}
        <span>Units format:</span>
        <Combo
          value={d.format}
          ariaLabel="Dimension units format"
          options={DIM_FORMATS.map((f) => ({ value: f, label: f }))}
          onChange={(f) => setDim('format', f)}
        />
        <span />
        <CheckBox
          label="Keep text aligned"
          checked={d.keepTextAligned}
          className="ze-pref-check ze-tg-dimright ze-tg-span2"
          onChange={(aChecked) => setDim('keepTextAligned', aChecked)}
        />
        <span />

        {/* Row 2 */}
        <span>Precision:</span>
        <Combo
          value={d.precision}
          ariaLabel="Dimension precision"
          options={DIM_PRECISIONS.map((x) => ({ value: x, label: x }))}
          onChange={(x) => setDim('precision', x)}
        />
        <span />
        <span className="ze-tg-dimright">Arrow length:</span>
        <TextCtrl
          value={String(d.arrowLengthMM)}
          onChange={(aValue) => setDim('arrowLengthMM', num(aValue))}
          className="ze-search"
        />
        <span className="unit">mm</span>

        {/* Row 3 */}
        <CheckBox
          label="Suppress trailing zeroes"
          checked={d.suppressTrailingZeroes}
          className="ze-pref-check ze-tg-span2"
          onChange={(aChecked) => setDim('suppressTrailingZeroes', aChecked)}
        />
        <span />
        <span className="ze-tg-dimright">Extension line offset:</span>
        <TextCtrl
          value={String(d.extLineOffsetMM)}
          onChange={(aValue) => setDim('extLineOffsetMM', num(aValue))}
          className="ze-search"
        />
        <span className="unit">mm</span>
      </div>
    </div>
  );
}
