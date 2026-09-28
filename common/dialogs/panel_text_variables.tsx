// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text Variables panel. Counterpart: `common/dialogs/panel_text_variables.cpp`
 * (PANEL_TEXT_VARIABLES), the project's `${NAME}` substitutions in a
 * two-column WX_GRID (Variable Name / Text Substitution) with GRID_TRICKS, an
 * add and a delete bitmap button at the bottom-left.
 *
 * As upstream: rows select whole (`wxGridSelectRows`); a name refuses the
 * characters `{}[]()%~<>"='\`;:.,&?/\|$` as they are typed; an empty name is
 * vetoed on `wxEVT_GRID_CELL_CHANGING` and reported, with the editor reopened
 * on it; Add opens the new row's name, Delete removes the selected rows.
 */

import { type JSX, useEffect } from 'react';
import { DisplayErrorMessage } from '../confirm.js';
import type { TextVar } from '../project/project_file.js';
import { GRID_CELL_TEXT_EDITOR } from '../widgets/grid_text_helpers.js';
import { Icon } from '../widgets/icons.js';
import type { WX_GRID } from '../widgets/wx_grid.js';
import {
  wxEVT_GRID_CELL_CHANGING,
  wxGridCellAttr,
  type wxGridEvent,
  wxGridSelectionModes,
} from '../wx/grid.js';
import { useStringGrid, WxGridView } from '../wx/grid_ui.js';

// The data model lives beside the class it describes in common/;
// re-exported here so the panel stays the import site for its slice.
export type { TextVar } from '../project/project_file.js';

const TV_NAME_COL = 0;
const TV_VALUE_COL = 1;

interface Props {
  vars: TextVar[];
  onChange: (next: TextVar[]) => void;
}

/** `AppendTextVar`'s name-cell editor: the name validator. */
function nameEditorAttr(): wxGridCellAttr {
  const editor = new GRID_CELL_TEXT_EDITOR();
  // prohibit these characters in the alias names: []{}()%~<>"='`;:.,&?/\|$
  editor.SetValidator('{}[]()%~<>"=\'`;:.,&?/\\|$');
  const attr = new wxGridCellAttr();
  attr.SetEditor(editor);
  return attr;
}

function onAddTextVar(aGrid: WX_GRID): void {
  aGrid.OnAddRow(() => {
    aGrid.AppendRows(1);
    return [aGrid.GetNumberRows() - 1, TV_NAME_COL];
  });
}

export function PanelTextVariables({ vars, onChange }: Props): JSX.Element {
  const { grid, tricks, onUpdate } = useStringGrid<TextVar>({
    labels: ['Variable Name', 'Text Substitution'],
    mode: wxGridSelectionModes.wxGridSelectRows,
    rows: vars,
    toCells: (v) => [v.name, v.value],
    fromCells: (c) => ({ name: c[TV_NAME_COL]!, value: c[TV_VALUE_COL]! }),
    onChange,
    setup: (g) => g.SetColAttr(TV_NAME_COL, nameEditorAttr()),
    onAddRow: onAddTextVar,
  });

  // OnGridCellChanging: an empty name is refused, reported from OnUpdateUI,
  // and the editor goes back on it.
  useEffect(() => {
    const onChanging = (e: wxGridEvent): void => {
      if (e.GetString() === '' && e.GetCol() === TV_NAME_COL) {
        e.Veto();
        const row = e.GetRow();
        queueMicrotask(() => {
          DisplayErrorMessage('Variable name cannot be empty.');
          grid.SetGridCursor(row, TV_NAME_COL);
          grid.EnableCellEditControl(true);
        });
        return;
      }

      e.Skip();
    };
    grid.Connect(wxEVT_GRID_CELL_CHANGING, onChanging);
    return () => grid.Disconnect(wxEVT_GRID_CELL_CHANGING, onChanging);
  }, [grid]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '2px 2px' }}>
      <div className="ze-grid-pane" style={{ flex: 1, minHeight: 0 }}>
        <WxGridView
          grid={grid}
          tricks={tricks}
          columns={[{ width: 160 }]}
          flexCol={TV_VALUE_COL}
          onUpdate={onUpdate}
          ariaLabel="Text variables"
        />
      </div>

      <div className="ze-grid-btns">
        <button
          type="button"
          className="ze-gridbtn"
          title="Add text variable"
          onClick={() => onAddTextVar(grid)}
        >
          <Icon name="plus" />
        </button>
        <span style={{ width: 15 }} />
        <button
          type="button"
          className="ze-gridbtn"
          title="Delete text variable"
          onClick={() => grid.OnDeleteRows((row) => grid.DeleteRows(row, 1))}
        >
          <Icon name="delete" />
        </button>
      </div>
    </div>
  );
}
