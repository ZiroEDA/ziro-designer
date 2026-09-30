// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Footprint Editor > User Layer Names —
 * `PANEL_FP_USER_LAYER_NAMES` (`pcbnew/dialogs/panel_fp_user_layer_names.cpp`
 * and its `_base.cpp`), constructed by pcbnew's KIFACE for
 * `PANEL_FP_USER_LAYER_NAMES` (`pcbnew/pcbnew.cpp:378-379`).
 *
 * Two controls, and they answer two different questions the manual keeps apart
 * (`pcbnew.txt`, "You can globally configure the number of user layers in
 * footprints, as well as their names"):
 *
 *   - **User layers:** a `wxChoice` of 0..9
 *     (`panel_fp_user_layer_names_base.cpp:29-32`) writing
 *     `SetUserDefinedLayerCount` — how many `User.n` layers a footprint gets;
 *   - **User Layer Names:** a grid of Layer -> Name pairs writing
 *     `m_UserLayerNames`, a map keyed by the CANONICAL name (`LSET::Name`) —
 *     what each of them is called.
 *
 * The sizer tree (`_base.cpp:14-108`):
 *
 *     bSizerMargins (V)
 *       bSizerUserLayerCount (H)      wxTOP|wxRIGHT|wxLEFT|wxEXPAND 8
 *         "User layers:" + m_choiceUserLayers + a growing spacer
 *       (0, 10) spacer
 *       "User Layer Names"            wxTOP|wxLEFT|wxEXPAND 8
 *       (0, 4) spacer
 *       m_layerNamesGrid   cols 200 / 220, min height 140
 *       bButtonSize: m_bpAdd, a 20 px gap, m_bpDelete
 *
 * **Three rules the panel enforces, all ported:**
 *
 *  1. The Layer cell offers only user layers. `forbiddenLayers` is
 *     `AllCuMask() | AllTechMask()` plus Edge_Cuts and Margin (`:157-161`), so
 *     what is left is the four auxiliary `User.*` layers and the numbered ones
 *     — see `fp_layer_choices.ts`.
 *  2. **A layer may appear once.** `onLayerChange` walks the other rows and, on
 *     a collision, silently moves the edited row to `getNextAvailableLayer()`
 *     rather than refusing the edit (`:267-283`, `:299-313`).
 *  3. **A name may appear once.** The same handler raises
 *     `PAGED_DIALOG::SetError( "Layer name %s already in use." )` on a
 *     duplicate NAME (`:285-296`) — a message, not a silent fix, because a name
 *     is the user's word and the layer is not.
 *
 * A row with an empty name is dropped on the way out (`:250-253`), so an added
 * row that is never filled in simply does not persist.
 *
 * The grid is upstream's: `LAYER_NAMES_GRID_TABLE` on a WX_GRID with
 * GRID_TRICKS, `GRID_CELL_LAYER_RENDERER` / `GRID_CELL_LAYER_SELECTOR` on
 * column 0, rows selected whole.
 *
 * **What reads it.** `editors/footprint/footprintBoard.ts`'
 * `FOOTPRINT_LAYERS` — the layer set the canvas, the layer selector and the
 * Appearance panel all read — takes its `User.n` rows from the count, and each
 * row's shown name from this map. That is `BOARD::GetLayerName` over
 * `m_UserLayerNames`, which is where upstream's names surface too.
 */
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import { Sel } from '@ziroeda/common/wx/controls.js';
import {
  wxEVT_GRID_CELL_CHANGED,
  wxGRID_VALUE_NUMBER,
  wxGRID_VALUE_STRING,
  wxGridCellAttr,
  type wxGridEvent,
  wxGridSelectionModes,
  wxGridTableRequest,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  GRID_CELL_LAYER_RENDERER,
  GRID_CELL_LAYER_SELECTOR,
  choiceOf,
  userLayerChoices,
} from '../grid_layer_box_helpers.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';

/** `m_choiceUserLayersChoices` — "0" … "9" (`_base.cpp:29-30`). */
const USER_LAYER_COUNTS: [number, string][] = Array.from({ length: 10 }, (_, i) => [i, String(i)]);

/** `IsUserLayer`: User_1 .. User_45, the numbered user layers. */
const IsUserLayer = (aLayer: number): boolean =>
  aLayer >= PCB_LAYER_ID.User_1 &&
  aLayer <= PCB_LAYER_ID.User_45 &&
  (aLayer - PCB_LAYER_ID.User_1) % 2 === 0;

/** `LAYER_NAMES_GRID_TABLE` (`panel_fp_user_layer_names.cpp:40-140`). */
class LAYER_NAMES_GRID_TABLE extends WX_GRID_TABLE_BASE {
  m_items: { text: string; layer: number }[] = [];

  GetNumberRows(): number {
    return this.m_items.length;
  }
  GetNumberCols(): number {
    return 2;
  }
  override GetColLabelValue(aCol: number): string {
    return aCol === 0 ? 'Layer' : aCol === 1 ? 'Name' : '';
  }
  override CanGetValueAs(_aRow: number, aCol: number, aTypeName: string): boolean {
    return aCol === 0 ? aTypeName === wxGRID_VALUE_NUMBER : aTypeName === wxGRID_VALUE_STRING;
  }
  override CanSetValueAs(aRow: number, aCol: number, aTypeName: string): boolean {
    return this.CanGetValueAs(aRow, aCol, aTypeName);
  }
  /** Both columns answer the name text, as upstream's does. */
  GetValue(aRow: number, _aCol: number): string {
    return this.m_items[aRow]?.text ?? '';
  }
  SetValue(aRow: number, aCol: number, aValue: string): void {
    if (aCol === 1 && this.m_items[aRow]) this.m_items[aRow]!.text = aValue;
  }
  override GetValueAsLong(aRow: number, _aCol: number): number {
    return this.m_items[aRow]?.layer ?? -1;
  }
  override SetValueAsLong(aRow: number, aCol: number, aValue: number): void {
    if (aCol === 0 && this.m_items[aRow]) this.m_items[aRow]!.layer = aValue;
  }

  /** `AppendRows`: each new row takes the next user layer no row holds. */
  override AppendRows(aNumRows = 1): boolean {
    const layers = new Set(this.m_items.map((i) => i.layer));
    let layer: number = PCB_LAYER_ID.User_1;

    for (let i = 0; i < aNumRows; ++i) {
      while (layers.has(layer)) layer += 2;

      if (!IsUserLayer(layer)) return false;

      layers.add(layer);
      this.m_items.push({ text: '', layer });
    }

    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, aNumRows);
    return true;
  }

  override DeleteRows(aPos = 0, aNumRows = 1): boolean {
    if (aPos + aNumRows > this.m_items.length) return false;

    this.m_items.splice(aPos, aNumRows);
    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aPos, aNumRows);
    return true;
  }
}

/** The `FOOTPRINT_EDITOR_SETTINGS` members this page reads and writes. */
export interface PANEL_FP_USER_LAYER_NAMES_SLICE {
  design_settings: {
    default_footprint_layer_names: Record<string, string>;
    user_layer_count: number;
  };
}

export interface PANEL_FP_USER_LAYER_NAMES_CTX {
  fpEdit: PANEL_FP_USER_LAYER_NAMES_SLICE;
  upFp: (fn: (s: PANEL_FP_USER_LAYER_NAMES_SLICE) => void) => void;
}

export function PanelFpUserLayerNames({
  ctx,
}: {
  ctx: PANEL_FP_USER_LAYER_NAMES_CTX;
}): JSX.Element {
  const { fpEdit, upFp } = ctx;
  const upFpRef = useRef(upFp);
  upFpRef.current = upFp;

  /** `PAGED_DIALOG::SetError( "Layer name %s already in use." )` (`:288-294`). */
  const [error, setError] = useState<string | null>(null);

  const [{ grid, table, tricks }] = useState(() => {
    const g = new WX_GRID();
    const t = new LAYER_NAMES_GRID_TABLE();
    g.SetTable(t, true, wxGridSelectionModes.wxGridSelectRows);
    const attr = new wxGridCellAttr();
    attr.SetRenderer(new GRID_CELL_LAYER_RENDERER(choiceOf));
    attr.SetEditor(
      new GRID_CELL_LAYER_SELECTOR(() =>
        userLayerChoices().map((c) => ({
          layer: LSET_NameToLayer(c.value),
          label: c.label,
          swatch: c.swatch,
        })),
      ),
    );
    g.SetColAttr(0, attr);
    g.SetColAttr(1, new wxGridCellAttr());
    return { grid: g, table: t, tricks: new GRID_TRICKS(g) };
  });

  const names = fpEdit.design_settings.default_footprint_layer_names;
  const written = useRef<string | null>(null);
  const key = JSON.stringify(names);

  // `loadFPSettings`: one row per user-layer entry, in the map's order.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the map's content; the grid is stable
  useLayoutEffect(() => {
    if (key === written.current) return;

    grid.BeginBatch();
    table.DeleteRows(0, table.GetNumberRows());

    for (const [canonicalName, userName] of Object.entries(names)) {
      const layer = LSET_NameToLayer(canonicalName);

      if (!IsUserLayer(layer)) continue;

      const row = table.GetNumberRows();
      table.AppendRows(1);
      table.SetValueAsLong(row, 0, layer);
      table.SetValue(row, 1, userName);
    }

    grid.EndBatch();
    written.current = key;
  }, [key]);

  /** `TransferDataFromWindow`'s map: user layers with a name. */
  const transfer = (): void => {
    const map: Record<string, string> = {};

    for (let i = 0; i < table.GetNumberRows(); ++i) {
      const layer = table.GetValueAsLong(i, 0);
      const name = table.GetValue(i, 1);

      if (layer >= 0 && IsUserLayer(layer) && name !== '') map[LSET_Name(layer)] = name;
    }

    const next = JSON.stringify(map);

    if (next === written.current) return;

    written.current = next;
    upFpRef.current((s) => {
      s.design_settings.default_footprint_layer_names = map;
    });
  };

  /** `getNextAvailableLayer` (`:300-313`). */
  const getNextAvailableLayer = (): number => {
    const usedLayers = new Set<number>();

    for (let i = 0; i < table.GetNumberRows(); ++i) usedLayers.add(table.GetValueAsLong(i, 0));

    // Upstream walks every id from User_1 up to User_45, not only the user
    // layers among them, so with User_1 taken it answers the id after it -
    // In19_Cu - and that row is then dropped on the way out. 10.0.5's own.
    for (let ii: number = PCB_LAYER_ID.User_1; ii < PCB_LAYER_ID.User_45; ++ii)
      if (!usedLayers.has(ii)) return ii;

    return -1;
  };

  // `onLayerChange`, connected to wxEVT_GRID_CELL_CHANGED.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the grid and table are stable; the handlers read refs
  useEffect(() => {
    const onLayerChange = (e: wxGridEvent): void => {
      e.Skip();

      if (e.GetCol() === 0) {
        const layer = table.GetValueAsLong(e.GetRow(), 0);

        for (let i = 0; i < grid.GetNumberRows(); ++i) {
          if (i !== e.GetRow() && table.GetValueAsLong(i, 0) === layer) {
            table.SetValueAsLong(e.GetRow(), 0, getNextAvailableLayer());
            grid.ForceRefresh();
            return;
          }
        }
      }

      for (let ii = 0; ii < grid.GetNumberRows(); ++ii) {
        const layerName = table.GetValue(ii, 1);

        if (ii !== e.GetRow() && layerName === table.GetValue(e.GetRow(), 1)) {
          setError(`Layer name ${layerName} already in use.`);
          return;
        }
      }

      setError(null);
    };
    grid.Connect(wxEVT_GRID_CELL_CHANGED, onLayerChange);
    return () => grid.Disconnect(wxEVT_GRID_CELL_CHANGED, onLayerChange);
  }, [grid, table]);

  /** `OnAddLayerItem`: a row on the next free user layer; no editor opens. */
  const onAddLayerItem = (): void => {
    grid.OnAddRow(() => {
      table.AppendRows(1);
      return [grid.GetNumberRows() - 1, -1];
    });
  };

  return (
    <div className="ze-fp-userlayers">
      {/* `bSizerUserLayerCount` — a bare horizontal sizer, so the choice sits
          immediately after its label and the slack goes to the spacer at the
          end. Not a `.ze-pref-group`: there is no heading and no rule. */}
      <div className="ze-fp-userlayer-count">
        <Sel
          label="User layers:"
          value={fpEdit.design_settings.user_layer_count}
          options={USER_LAYER_COUNTS}
          onChange={(v) =>
            upFp((s) => {
              s.design_settings.user_layer_count = v;
            })
          }
        />
      </div>
      <div className="ze-fp-defaults-title">User Layer Names</div>
      <div className="ze-grid-pane ze-fp-userlayers-grid">
        <WxGridView
          grid={grid}
          tricks={tricks}
          columns={[{ width: 200 }, { width: 220 }]}
          className="ze-fp-layernames"
          onUpdate={transfer}
          ariaLabel="User layer names"
        />
      </div>
      <div className="ze-grid-btns">
        <StdBitmapButton
          bitmap="small_plus"
          title="Add layer"
          tooltip={null}
          onClick={onAddLayerItem}
        />
        {/* `bButtonSize->Add( 20, 0, 0, wxEXPAND, 5 )`. [px] wxFormBuilder's own 20. */}
        <span className="ze-fieldnames-gap" />
        <StdBitmapButton
          bitmap="small_trash"
          title="Delete layer"
          tooltip={null}
          onClick={() => grid.OnDeleteRows((row) => table.DeleteRows(row, 1))}
        />
      </div>
      {/* `PAGED_DIALOG::SetError` puts its message in the dialog's own error
          bar; ours is beside the grid it belongs to. */}
      {error && <div className="ze-prefs-error">{error}</div>}
    </div>
  );
}
