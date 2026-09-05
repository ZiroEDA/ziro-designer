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
 * **What reads it.** `FOOTPRINT_EDIT_FRAME::CreateNewFootprint` builds a new
 * footprint's Reference and Value fields and its extra text items from
 * `m_DefaultFPTextItems` — so this page is what a fresh footprint looks like.
 * `editors/footprint/new_footprint.ts` is that call.
 */
import { useState, type JSX } from 'react';
import { Combo } from '../../../ui/Combo.js';
import { StdBitmapButton } from '../../../ui/StdBitmapButton.js';
import { allLayerChoices } from '../fp_layer_choices.js';
import type { FpTextItem } from '../../../prefs/settings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/** `GetRowLabelValue` (`panel_fp_editor_field_defaults.cpp:75-83`). */
const FIELD_ROW_LABELS = ['Reference designator', 'Value'] as const;

export function PanelFpFootprintDefaults({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp } = ctx;
  const items = fpEdit.design_settings.default_footprint_text_items;
  const layers = allLayerChoices();
  /** `m_textItemsGrid->GetGridCursorRow()`, which the delete button reads. */
  const [sel, setSel] = useState<number | null>(null);

  const setItem = (i: number, patch: Partial<FpTextItem>): void =>
    upFp((s) => {
      const row = s.design_settings.default_footprint_text_items[i];
      if (row) Object.assign(row, patch);
    });

  /**
   * `OnAddTextItem` (`:307-327`): append a row and give it the layer of the row
   * ABOVE it, falling back to `F_SilkS` for the first — so a run of items on
   * the fabrication layer does not need the layer picked again each time.
   */
  const addItem = (): void =>
    upFp((s) => {
      const list = s.design_settings.default_footprint_text_items;
      const prev = list[list.length - 1];
      list.push({ text: '', visible: true, layer: prev ? prev.layer : 'F.SilkS' });
    });

  const deleteItem = (): void => {
    if (sel === null) return;
    upFp((s) => {
      s.design_settings.default_footprint_text_items.splice(sel + 2, 1);
    });
    setSel(null);
  };

  const layerCell = (i: number, label: string): JSX.Element => (
    <Combo
      value={items[i]?.layer ?? 'F.SilkS'}
      ariaLabel={label}
      options={layers}
      onChange={(v) => setItem(i, { layer: v })}
    />
  );

  return (
    <div className="ze-fp-defaults">
      {/* `defaultFieldPropertiesLabel`, a plain wxStaticText with no rule. */}
      <div className="ze-fp-defaults-title">Default Field Properties for New Footprints</div>
      <div className="ze-grid-pane">
        <table className="ze-grid ze-fp-fieldprops">
          <thead>
            <tr>
              {/* `SetRowLabelSize( 160 )` — the row-label column. */}
              <th />
              <th>Value</th>
              <th>Show</th>
              <th>Layer</th>
            </tr>
          </thead>
          <tbody>
            {FIELD_ROW_LABELS.map((label, i) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>
                  <input
                    type="text"
                    value={items[i]?.text ?? ''}
                    aria-label={`${label} value`}
                    onChange={(e) => setItem(i, { text: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </td>
                {/* `wxGridCellBoolRenderer`, centred (`:349-353`). */}
                <td className="ze-grid-bool">
                  <input
                    type="checkbox"
                    checked={items[i]?.visible ?? true}
                    aria-label={`${label} show`}
                    onChange={(e) => setItem(i, { visible: e.target.checked })}
                  />
                </td>
                <td>{layerCell(i, `${label} layer`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* `bSizerMargins->Add( 5, 25, … )` — the gap between the two grids. */}
      <div className="ze-fp-defaults-title ze-fp-defaults-title2">
        Default Text Items for New Footprints
      </div>
      <div className="ze-grid-pane ze-fp-textitems-grid">
        <table className="ze-grid ze-fp-textitems">
          <thead>
            <tr>
              <th>Text Items</th>
              <th>Layer</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(2).map((item, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the row index IS a
              // grid row's identity; two blank text items are equal values.
              <tr
                key={j}
                className={j === sel ? 'selected' : undefined}
                onFocusCapture={() => setSel(j)}
                onMouseDown={() => setSel(j)}
              >
                <td>
                  <input
                    type="text"
                    value={item.text}
                    aria-label="Text item"
                    onChange={(e) => setItem(j + 2, { text: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </td>
                <td>{layerCell(j + 2, 'Text item layer')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* `bButtonSize`: add, a fixed 20 px gap, delete — no up/down here,
          unlike the Field Name Templates panel. */}
      <div className="ze-grid-btns">
        <StdBitmapButton
          bitmap="small_plus"
          title="Add text item"
          tooltip={null}
          onClick={addItem}
        />
        {/* `bButtonSize->Add( 20, 0, 0, wxEXPAND, 5 )`. [px] wxFormBuilder's own 20. */}
        <span className="ze-fieldnames-gap" />
        <StdBitmapButton
          bitmap="small_trash"
          title="Delete text item"
          tooltip={null}
          disabled={sel === null}
          onClick={deleteItem}
        />
      </div>
    </div>
  );
}
