// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Bus Alias Definitions panel. Counterpart: `eeschema/dialogs/
 * panel_setup_buses.cpp` over `..._base.cpp` (PANEL_SETUP_BUSES): "Bus
 * Definitions", an Alias grid with add and delete, and beside it a simplebook
 * whose first page is "Members of '<alias>'" over a Net or Nested Bus Name
 * grid, and whose second page is blank - shown until an alias has the cursor.
 *
 * Both grids are WX_GRIDs with GRID_TRICKS, rows selected whole. As upstream:
 * a duplicate alias name and an empty member are vetoed and reported with the
 * editor reopened on them; the members pane follows the alias cursor
 * (`OnUpdateUI`); a member typed with spaces becomes one member per word
 * (`updateAliasMembers`); aliases load sorted by name, case-blind.
 */
import { type JSX, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { GetClipboardText } from '@ziroeda/common/clipboard.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_CELL_CHANGING,
  type wxGridEvent,
  wxGridSelectionModes,
  wxGridStringTable,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import type { BusAlias } from '@ziroeda/eeschema/schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export { defaultBusAliases, type BusAlias } from '@ziroeda/eeschema/schematic_settings.js';

interface Props {
  aliases: BusAlias[];
  onChange: (next: BusAlias[]) => void;
}

function makeGrid(aLabel: string): WX_GRID {
  const g = new WX_GRID();
  g.SetTable(new wxGridStringTable(0, 1), true, wxGridSelectionModes.wxGridSelectRows);
  g.SetColLabelValue(0, aLabel);
  return g;
}

/** `wxString::CmpNoCase`. */
const cmpNoCase = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export function PanelSetupBuses({ aliases, onChange }: Props): JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // m_aliases, m_lastAlias, m_lastAliasName, m_source's text, the book page.
  const model = useRef<BusAlias[]>([]);
  const lastAlias = useRef(0);
  const lastAliasName = useRef('');
  const [source, setSource] = useState('(source)');
  const [membersPage, setMembersPage] = useState(1);
  const emitted = useRef<string | null>(null);
  const error = useRef<{ msg: string; grid: WX_GRID; row: number } | null>(null);

  const [{ aliasesGrid, membersGrid, aliasTricks, memberTricks }] = useState(() => {
    const a = makeGrid('Alias');
    const m = makeGrid('Net or Nested Bus Name');
    return {
      aliasesGrid: a,
      membersGrid: m,
      aliasTricks: new GRID_TRICKS(a, () => onAddAlias()),
      memberTricks: new GRID_TRICKS(m, () => onAddMember()),
    };
  });

  /** The project's aliases, as the panel has them now. */
  const emit = (): void => {
    const next = model.current.map((al) => ({ name: al.name, members: [...al.members] }));
    const key = JSON.stringify(next);

    if (key === emitted.current) return;

    emitted.current = key;
    onChangeRef.current(next);
  };

  /** `updateAliasMembers`: the members grid into the alias, split at spaces. */
  const updateAliasMembers = (aAliasIndex: number): void => {
    if (
      model.current.length > 0 &&
      membersGrid.GetNumberRows() > 0 &&
      aAliasIndex >= 0 &&
      aAliasIndex < model.current.length
    ) {
      const members: string[] = [];
      let dirty = false;

      for (let ii = 0; ii < membersGrid.GetNumberRows(); ++ii) {
        const tokens = membersGrid
          .GetCellValue(ii, 0)
          .split(' ')
          .filter((t) => t !== '');

        if (tokens.length > 1) dirty = true;

        members.push(...tokens);
      }

      model.current[aAliasIndex] = { ...model.current[aAliasIndex]!, members };

      if (dirty) queueMicrotask(doReloadMembersGrid);
    }
  };

  /** `doReloadMembersGrid`. */
  const doReloadMembersGrid = (): void => {
    if (lastAlias.current >= 0 && lastAlias.current < aliasesGrid.GetNumberRows()) {
      const alias = model.current[lastAlias.current]!;
      setSource('');
      membersGrid.BeginBatch();
      membersGrid.ClearRows();
      membersGrid.AppendRows(alias.members.length);
      alias.members.forEach((member, ii) => {
        membersGrid.SetCellValue(ii, 0, member);
      });
      membersGrid.EndBatch();
    }
  };

  /** `loadAliases` / `ImportSettingsFrom`. */
  const key = JSON.stringify(aliases);

  // A layout effect, so the load lands before the first OnUpdateUI (a passive
  // effect of the grid view) could read an empty model back out.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the content of aliases; the grids are stable
  useLayoutEffect(() => {
    if (key === emitted.current) return;

    model.current = [...aliases]
      .sort((a, b) => cmpNoCase(a.name, b.name))
      .map((a) => ({ name: a.name, members: [...a.members] }));
    emitted.current = key;

    aliasesGrid.BeginBatch();
    aliasesGrid.ClearRows();
    aliasesGrid.AppendRows(model.current.length);
    model.current.forEach((al, ii) => {
      aliasesGrid.SetCellValue(ii, 0, al.name);
    });
    aliasesGrid.EndBatch();
    lastAlias.current = -1;
    lastAliasName.current = '';
    setMembersPage(1);
    bump();
  }, [key]);

  const onAddAlias = (): void => {
    if (!aliasesGrid.CommitPendingChanges() || !membersGrid.CommitPendingChanges()) return;

    aliasesGrid.OnAddRow(() => {
      model.current.push({ name: '', members: [] });
      const row = aliasesGrid.GetNumberRows();

      if (row > 0 && lastAlias.current === row - 1) updateAliasMembers(row - 1);

      aliasesGrid.AppendRows(1);
      return [row, 0];
    });
    emit();
  };

  const onDeleteAlias = (): void => {
    if (!aliasesGrid.CommitPendingChanges() || !membersGrid.CommitPendingChanges()) return;

    aliasesGrid.OnDeleteRows((row) => {
      membersGrid.ClearRows();
      lastAlias.current = -1;
      lastAliasName.current = '';
      model.current.splice(row, 1);
      aliasesGrid.DeleteRows(row, 1);
    });
    emit();
  };

  /** `OnAddMember`: with text on the clipboard the new row waits for a paste. */
  const onAddMember = (): void => {
    membersGrid.OnAddRow(() => {
      const row = membersGrid.GetNumberRows();
      membersGrid.AppendRows(1);
      return [row, GetClipboardText() !== null && GetClipboardText() !== '' ? -1 : 0];
    });
  };

  const onRemoveMember = (): void => {
    membersGrid.OnDeleteRows((row) => {
      membersGrid.DeleteRows(row, 1);
      const alias = model.current[lastAlias.current];

      if (alias) {
        model.current[lastAlias.current] = {
          ...alias,
          members: Array.from({ length: membersGrid.GetNumberRows() }, (_, ii) =>
            membersGrid.GetCellValue(ii, 0),
          ),
        };
      }
    });
    emit();
  };

  // The cell-changing vetoes and the members' write-back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the grids and the model refs are stable; updateAliasMembers reads only refs
  useEffect(() => {
    const onAliasChanging = (e: wxGridEvent): void => {
      const row = e.GetRow();

      if (row >= 0) {
        const name = e.GetString();

        for (let ii = 0; ii < aliasesGrid.GetNumberRows(); ++ii) {
          if (ii === row) continue;

          if (name === aliasesGrid.GetCellValue(ii, 0)) {
            error.current = { msg: `Alias name '${name}' already in use.`, grid: aliasesGrid, row };
            e.Veto();
            return;
          }
        }

        model.current[row] = { ...model.current[row]!, name };
      }

      e.Skip();
    };
    const onMemberChanging = (e: wxGridEvent): void => {
      if (e.GetRow() >= 0 && e.GetString() === '') {
        error.current = {
          msg: 'Member net/alias name cannot be empty.',
          grid: membersGrid,
          row: e.GetRow(),
        };
        e.Veto();
        return;
      }

      e.Skip();
    };
    const onMemberChanged = (e: wxGridEvent): void => {
      if (e.GetRow() >= 0 && lastAlias.current >= 0 && lastAlias.current < model.current.length)
        updateAliasMembers(lastAlias.current);

      e.Skip();
    };

    aliasesGrid.Connect(wxEVT_GRID_CELL_CHANGING, onAliasChanging);
    membersGrid.Connect(wxEVT_GRID_CELL_CHANGING, onMemberChanging);
    membersGrid.Connect(wxEVT_GRID_CELL_CHANGED, onMemberChanged);
    return () => {
      aliasesGrid.Disconnect(wxEVT_GRID_CELL_CHANGING, onAliasChanging);
      membersGrid.Disconnect(wxEVT_GRID_CELL_CHANGING, onMemberChanging);
      membersGrid.Disconnect(wxEVT_GRID_CELL_CHANGED, onMemberChanged);
    };
  }, [aliasesGrid, membersGrid]);

  /** `OnUpdateUI`: the error, then the members pane following the alias cursor. */
  const onUpdateUI = (): void => {
    if (error.current) {
      const { msg, grid, row } = error.current;
      error.current = null;
      DisplayErrorMessage(msg);
      grid.SetGridCursor(row, 0);
      grid.EnableCellEditControl(true);
      return;
    }

    // Edits to names and members since the last look.
    for (let ii = 0; ii < aliasesGrid.GetNumberRows() && ii < model.current.length; ++ii) {
      const name = aliasesGrid.GetCellValue(ii, 0);

      if (model.current[ii]!.name !== name) model.current[ii] = { ...model.current[ii]!, name };
    }

    if (!membersGrid.IsCellEditControlShown()) {
      let row = -1;
      let aliasName = '';

      if (aliasesGrid.IsCellEditControlShown()) {
        row = aliasesGrid.GetGridCursorRow();
        aliasName = aliasesGrid.GetCurrentEditor()?.m_value ?? '';
      } else if (aliasesGrid.GetGridCursorRow() >= 0) {
        row = aliasesGrid.GetGridCursorRow();
        aliasName = aliasesGrid.GetCellValue(row, 0);
      } else if (lastAlias.current >= 0 && lastAlias.current < aliasesGrid.GetNumberRows()) {
        row = lastAlias.current;
        aliasName = lastAliasName.current;
      }

      if (row < 0) {
        if (membersPage !== 1) setMembersPage(1);
      } else if (row !== lastAlias.current || aliasName !== lastAliasName.current) {
        lastAlias.current = row;
        lastAliasName.current = aliasName;
        setMembersPage(0);
        model.current[row] = { ...model.current[row]!, name: aliasName };
        queueMicrotask(doReloadMembersGrid);
      }
    }

    emit();
  };

  return (
    <div className="ze-busdefs">
      <div className="ze-busdefs-col">
        <div className="ze-busdefs-label">Bus Definitions</div>
        <div className="ze-grid-pane ze-busdefs-grid">
          <WxGridView
            grid={aliasesGrid}
            tricks={aliasTricks}
            columns={[{ width: 300 }]}
            onUpdate={onUpdateUI}
            ariaLabel="Bus aliases"
          />
        </div>
        <div className="ze-grid-btns">
          <StdBitmapButton
            bitmap="small_plus"
            title="Add alias"
            tooltip={null}
            onClick={onAddAlias}
          />
          <span className="ze-busdefs-gap" />
          <StdBitmapButton
            bitmap="small_trash"
            title="Delete alias"
            tooltip={null}
            onClick={onDeleteAlias}
          />
          <span className="ze-busdefs-stretch" />
          <span className="ze-busdefs-source">{source}</span>
        </div>
      </div>
      <div className="ze-busdefs-col">
        {membersPage === 0 && (
          <>
            <div className="ze-busdefs-label">{`Members of '${lastAliasName.current}'`}</div>
            <div className="ze-grid-pane ze-busdefs-grid">
              <WxGridView
                grid={membersGrid}
                tricks={memberTricks}
                columns={[{ width: 300 }]}
                onUpdate={onUpdateUI}
                ariaLabel="Bus members"
              />
            </div>
            <div className="ze-grid-btns">
              <StdBitmapButton
                bitmap="small_plus"
                title="Add member"
                tooltip={null}
                onClick={onAddMember}
              />
              <span className="ze-busdefs-gap" />
              <StdBitmapButton
                bitmap="small_trash"
                title="Remove member"
                tooltip={null}
                onClick={onRemoveMember}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
