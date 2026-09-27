// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Footprint Editor > Footprint Defaults —
 * `PANEL_FP_EDITOR_FIELD_DEFAULTS`
 * (`pcbnew/dialogs/panel_fp_editor_field_defaults.cpp` and its `_base.cpp`),
 * constructed by pcbnew's KIFACE for `PANEL_FP_DEFAULT_FIELDS`
 * (`pcbnew/pcbnew.cpp:345-359`).
 *
 * Two grids over ONE list. `design_settings.default_footprint_text_items` is a
 * single array, and the panel splits it by POSITION
 * (`panel_fp_editor_field_defaults.cpp:216-247`):
 *
 *     rows 0..1  -> "Default Field Properties for New Footprints"
 *                   3 columns: Value, Show, Layer
 *                   row labels "Reference designator" and "Value"
 *     rows 2..n  -> "Default Text Items for New Footprints"
 *                   2 columns: Text Items, Layer, with + / trash
 *
 * That is why the upper grid is exactly two rows and has no add button, and why
 * the lower grid has no Show column: `TransferDataFromWindow` writes every row
 * past the first two back with `visible` hard-coded true
 * (`:296-303`). Both facts are the list's shape, not a decision here.
 *
 * The sizer tree (`panel_fp_editor_field_defaults_base.cpp:14-110`):
 *
 *     bSizerMargins (V)
 *       "Default Field Properties for New Footprints"   wxTOP|wxRIGHT|wxLEFT 8
 *       (0, 4) spacer
 *       m_fieldPropsGrid   cols 240 / 60 / 150, row labels 160 wide
 *       (5, 25) spacer
 *       "Default Text Items for New Footprints"         wxTOP|wxLEFT 8
 *       (0, 4) spacer
 *       m_textItemsGrid    cols 460 / 150, min height 140
 *       bButtonSize: m_bpAdd, a 20 px gap, m_bpDelete
 *
 * The grids are upstream's: `TEXT_ITEMS_GRID_TABLE` on two WX_GRIDs with
 * GRID_TRICKS, rows selected whole; Show is a read-only `wxGridCellBoolRenderer`
 * column (GRID_TRICKS toggles it on a click), and Layer is
 * `GRID_CELL_LAYER_RENDERER` / `GRID_CELL_LAYER_SELECTOR`.
 *
 * **What reads it.** `FOOTPRINT_EDIT_FRAME::CreateNewFootprint` builds a new
 * footprint's Reference and Value fields and its extra text items from
 * `m_DefaultFPTextItems` — so this page is what a fresh footprint looks like.
 * `editors/footprint/new_footprint.ts` is that call.
 */
import { type JSX, useLayoutEffect, useRef, useState } from 'react';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxGRID_VALUE_BOOL,
  wxGRID_VALUE_NUMBER,
  wxGRID_VALUE_STRING,
  wxGridCellAttr,
  wxGridCellBoolRenderer,
  wxGridSelectionModes,
  wxGridTableRequest,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  GRID_CELL_LAYER_RENDERER,
  GRID_CELL_LAYER_SELECTOR,
} from '@ziroeda/pcbnew/grid_layer_box_helpers.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/pcbnew/layer_ids.js';
import { allLayerChoices, choiceOf } from '../fp_layer_choices.js';
import type { FpTextItem } from '../../../prefs/settings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

interface TEXT_ITEM_INFO {
  m_Text: string;
  m_Visible: boolean;
  m_Layer: number;
}

/** `TEXT_ITEMS_GRID_TABLE` (`panel_fp_editor_field_defaults.cpp:40-164`). */
class TEXT_ITEMS_GRID_TABLE extends WX_GRID_TABLE_BASE {
  m_items: TEXT_ITEM_INFO[] = [];

  constructor(private readonly m_forFieldProps: boolean) {
    super();
  }

  GetNumberRows(): number {
    return this.m_items.length;
  }
  GetNumberCols(): number {
    return this.m_forFieldProps ? 3 : 2;
  }
  override GetColLabelValue(aCol: number): string {
    const labels = this.m_forFieldProps ? ['Value', 'Show', 'Layer'] : ['Text Items', 'Layer'];
    return labels[aCol] ?? '';
  }
  override GetRowLabelValue(aRow: number): string {
    return aRow === 0 ? 'Reference designator' : aRow === 1 ? 'Value' : '';
  }
  override CanGetValueAs(_aRow: number, aCol: number, aTypeName: string): boolean {
    const types = this.m_forFieldProps
      ? [wxGRID_VALUE_STRING, wxGRID_VALUE_BOOL, wxGRID_VALUE_NUMBER]
      : [wxGRID_VALUE_STRING, wxGRID_VALUE_NUMBER];
    return types[aCol] === aTypeName;
  }
  override CanSetValueAs(aRow: number, aCol: number, aTypeName: string): boolean {
    return this.CanGetValueAs(aRow, aCol, aTypeName);
  }
  GetValue(aRow: number, _aCol: number): string {
    return this.m_items[aRow]?.m_Text ?? '';
  }
  SetValue(aRow: number, aCol: number, aValue: string): void {
    if (aCol === 0 && this.m_items[aRow]) this.m_items[aRow]!.m_Text = aValue;
  }
  override GetValueAsBool(aRow: number, _aCol: number): boolean {
    return this.m_items[aRow]?.m_Visible ?? false;
  }
  override SetValueAsBool(aRow: number, aCol: number, aValue: boolean): void {
    if (aCol === 1 && this.m_items[aRow]) this.m_items[aRow]!.m_Visible = aValue;
  }
  override GetValueAsLong(aRow: number, _aCol: number): number {
    return this.m_items[aRow]?.m_Layer ?? -1;
  }
  override SetValueAsLong(aRow: number, aCol: number, aValue: number): void {
    if (aCol === this.GetNumberCols() - 1 && this.m_items[aRow])
      this.m_items[aRow]!.m_Layer = aValue;
  }

  override AppendRows(aNumRows = 1): boolean {
    for (let i = 0; i < aNumRows; ++i)
      this.m_items.push({ m_Text: '', m_Visible: true, m_Layer: PCB_LAYER_ID.F_SilkS });

    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, aNumRows);
    return true;
  }

  override DeleteRows(aPos = 0, aNumRows = 1): boolean {
    if (aPos < this.m_items.length && aPos + aNumRows <= this.m_items.length) {
      this.m_items.splice(aPos, aNumRows);
      this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aPos, aNumRows);
      return true;
    }

    return false;
  }
}

/** The layer column's attribute: `GRID_CELL_LAYER_RENDERER( nullptr )` + `GRID_CELL_LAYER_SELECTOR( nullptr, {} )`. */
function layerAttr(): wxGridCellAttr {
  const attr = new wxGridCellAttr();
  attr.SetRenderer(new GRID_CELL_LAYER_RENDERER(choiceOf));
  attr.SetEditor(
    new GRID_CELL_LAYER_SELECTOR(() =>
      allLayerChoices().map((c) => ({
        layer: LSET_NameToLayer(c.value),
        label: c.label,
        swatch: c.swatch,
      })),
    ),
  );
  return attr;
}

function makeGrid(aForFieldProps: boolean): {
  grid: WX_GRID;
  table: TEXT_ITEMS_GRID_TABLE;
  tricks: GRID_TRICKS;
} {
  const grid = new WX_GRID();
  const table = new TEXT_ITEMS_GRID_TABLE(aForFieldProps);
  grid.SetTable(table, true, wxGridSelectionModes.wxGridSelectRows);
  const tricks = new GRID_TRICKS(grid);

  if (aForFieldProps) {
    const attr = new wxGridCellAttr();
    attr.SetRenderer(new wxGridCellBoolRenderer());
    attr.SetReadOnly();
    grid.SetColAttr(1, attr);
    grid.SetColAttr(2, layerAttr());
  } else {
    grid.SetColAttr(1, layerAttr());
  }

  return { grid, table, tricks };
}

export function PanelFpFootprintDefaults({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp } = ctx;
  const upFpRef = useRef(upFp);
  upFpRef.current = upFp;

  const [props] = useState(() => makeGrid(true));
  const [texts] = useState(() => makeGrid(false));

  const items = fpEdit.design_settings.default_footprint_text_items;
  const written = useRef<string | null>(null);
  const key = JSON.stringify(items);

  // `loadFPSettings` (`:207-247`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the list's content; the grids are stable
  useLayoutEffect(() => {
    if (key === written.current) return;

    props.grid.BeginBatch();
    props.table.DeleteRows(0, props.table.GetNumberRows());
    props.table.AppendRows(2);

    for (let i = 0; i < Math.min(2, items.length); ++i) {
      const item = items[i]!;
      props.table.SetValue(i, 0, item.text);
      props.table.SetValueAsBool(i, 1, item.visible);
      props.table.SetValueAsLong(i, 2, LSET_NameToLayer(item.layer));
    }

    props.grid.EndBatch();

    texts.grid.BeginBatch();
    texts.table.DeleteRows(0, texts.table.GetNumberRows());

    if (items.length > 2) texts.table.AppendRows(items.length - 2);

    for (let i = 2; i < items.length; ++i) {
      texts.table.SetValue(i - 2, 0, items[i]!.text);
      texts.table.SetValueAsLong(i - 2, 1, LSET_NameToLayer(items[i]!.layer));
    }

    texts.grid.EndBatch();
    written.current = key;
  }, [key]);

  /** `TransferDataFromWindow` (`:280-305`): every row past the first two is visible. */
  const transfer = (): void => {
    const list: FpTextItem[] = [];

    for (const i of [0, 1])
      list.push({
        text: props.table.GetValue(i, 0),
        visible: props.table.GetValueAsBool(i, 1),
        layer: LSET_Name(props.table.GetValueAsLong(i, 2)),
      });

    for (let i = 0; i < texts.table.GetNumberRows(); ++i)
      list.push({
        text: texts.table.GetValue(i, 0),
        visible: true,
        layer: LSET_Name(texts.table.GetValueAsLong(i, 1)),
      });

    const next = JSON.stringify(list);

    if (next === written.current) return;

    written.current = next;
    upFpRef.current((s) => {
      s.design_settings.default_footprint_text_items = list;
    });
  };

  /** `OnAddTextItem` (`:307-327`): the new row takes the layer of the row above. */
  const onAddTextItem = (): void => {
    texts.grid.OnAddRow(() => {
      const newRow = texts.grid.GetNumberRows();
      texts.table.AppendRows(1);

      let defaultBoardLayer: number = PCB_LAYER_ID.F_SilkS;

      if (newRow > 0) defaultBoardLayer = texts.table.GetValueAsLong(newRow - 1, 1);

      texts.table.SetValueAsLong(newRow, 1, defaultBoardLayer);
      return [newRow, 0];
    });
  };

  return (
    <div className="ze-fp-defaults">
      {/* `defaultFieldPropertiesLabel`, a plain wxStaticText with no rule. */}
      <div className="ze-fp-defaults-title">Default Field Properties for New Footprints</div>
      <div className="ze-grid-pane">
        <WxGridView
          grid={props.grid}
          tricks={props.tricks}
          rowLabels
          columns={[{ width: 240 }, { width: 60, center: true }, { width: 150 }]}
          className="ze-fp-fieldprops"
          onUpdate={transfer}
          ariaLabel="Default field properties"
        />
      </div>

      {/* `bSizerMargins->Add( 5, 25, … )` — the gap between the two grids. */}
      <div className="ze-fp-defaults-title ze-fp-defaults-title2">
        Default Text Items for New Footprints
      </div>
      <div className="ze-grid-pane ze-fp-textitems-grid">
        <WxGridView
          grid={texts.grid}
          tricks={texts.tricks}
          columns={[{ width: 460 }, { width: 150 }]}
          className="ze-fp-textitems"
          onUpdate={transfer}
          ariaLabel="Default text items"
        />
      </div>
      {/* `bButtonSize`: add, a fixed 20 px gap, delete — no up/down here,
          unlike the Field Name Templates panel. */}
      <div className="ze-grid-btns">
        <StdBitmapButton
          bitmap="small_plus"
          title="Add text item"
          tooltip={null}
          onClick={onAddTextItem}
        />
        {/* `bButtonSize->Add( 20, 0, 0, wxEXPAND, 5 )`. [px] wxFormBuilder's own 20. */}
        <span className="ze-fieldnames-gap" />
        <StdBitmapButton
          bitmap="small_trash"
          title="Delete text item"
          tooltip={null}
          onClick={() => texts.grid.OnDeleteRows((row) => texts.table.DeleteRows(row, 1))}
        />
      </div>
    </div>
  );
}
