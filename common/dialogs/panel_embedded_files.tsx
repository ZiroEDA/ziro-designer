// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Embedded Files panel. Counterpart:
 * `common/dialogs/panel_embedded_files_base.cpp` (PANEL_EMBEDDED_FILES), a
 * read-only "Filename / Embedded Reference" grid, then a button row: add
 * (browse), remove, an "Embed fonts" checkbox, and Export. Files stored in the
 * schematic are referenced elsewhere as ${EMBED_...}.
 */

import { type JSX, useLayoutEffect, useRef, useState } from 'react';
import type { EmbeddedFile, EmbeddedFilesData } from '../embedded_files.js';
import { SaveClipboard } from '../clipboard.js';
import { GRID_TRICKS, GRIDTRICKS_FIRST_CLIENT_ID } from '../grid_tricks.js';
import { Icon } from '../widgets/icons.js';
import { WX_GRID } from '../widgets/wx_grid.js';
import { type wxGridEvent, wxGridStringTable } from '../wx/grid.js';
import { WxGridView } from '../wx/grid_ui.js';
import type { wxMenu, wxMenuEvent } from '../wx/menu.js';

// The data model lives beside the class it describes in common/;
// re-exported here so the panel stays the import site for its slice.
export {
  defaultEmbeddedFiles,
  type EmbeddedFile,
  type EmbeddedFilesData,
} from '../embedded_files.js';

const EMBEDDED_FILES_GRID_TRICKS_COPY_FILENAME = GRIDTRICKS_FIRST_CLIENT_ID;

/** `EMBEDDED_FILES_GRID_TRICKS`: "Copy Embedded Reference" over a cell. */
export class EMBEDDED_FILES_GRID_TRICKS extends GRID_TRICKS {
  private m_curRow = -1;

  protected override showPopupMenu(aMenu: wxMenu, aEvent: wxGridEvent): void {
    const row = aEvent.GetRow();

    if (row >= 0 && row < this.m_grid.GetNumberRows()) {
      this.m_curRow = row;
      aMenu.Append(
        EMBEDDED_FILES_GRID_TRICKS_COPY_FILENAME,
        'Copy Embedded Reference',
        'Copy the reference for this embedded file',
      );
      aMenu.AppendSeparator();
      super.showPopupMenu(aMenu, aEvent);
    } else {
      this.m_curRow = -1;
    }
  }

  protected override doPopupSelection(aEvent: wxMenuEvent): void {
    if (aEvent.GetId() === EMBEDDED_FILES_GRID_TRICKS_COPY_FILENAME) {
      if (this.m_curRow >= 0) SaveClipboard(this.m_grid.GetCellValue(this.m_curRow, 1));
    } else {
      super.doPopupSelection(aEvent);
    }
  }
}

interface Props {
  value: EmbeddedFilesData;
  onChange: (next: EmbeddedFilesData) => void;
  /** Export all files to downloads (PANEL_EMBEDDED_FILES::onExportFiles
   *  exports the whole collection to a chosen directory). */
  onExport?: (files: EmbeddedFile[]) => void;
}

export function PanelEmbeddedFiles({ value, onChange, onExport }: Props): JSX.Element {
  const [{ grid, tricks }] = useState(() => {
    const g = new WX_GRID();
    g.SetTable(new wxGridStringTable(0, 2), true);
    g.EnableEditing(false);
    g.SetColLabelValue(0, 'Filename');
    g.SetColLabelValue(1, 'Embedded Reference');
    g.EnableAlternateRowColors();
    return { grid: g, tricks: new EMBEDDED_FILES_GRID_TRICKS(g) };
  });
  const fileInput = useRef<HTMLInputElement | null>(null);

  // TransferDataToWindow: one row per file, name and link.
  const key = JSON.stringify(value.files.map((f) => [f.name, f.reference]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the rows' content; the grid is stable
  useLayoutEffect(() => {
    const rows = JSON.parse(key) as [string, string][];
    grid.BeginBatch();
    grid.ClearRows();
    grid.AppendRows(rows.length);
    rows.forEach(([name, link], ii) => {
      grid.SetCellValue(ii, 0, name);
      grid.SetCellValue(ii, 1, link);
    });
    grid.EndBatch();
  }, [key]);

  /** `onDeleteEmbeddedFile`: `OnDeleteRows`, each row's file by its name. */
  const removeSel = (): void => {
    const names: string[] = [];
    grid.OnDeleteRows((row) => {
      names.push(grid.GetCellValue(row, 0));
      grid.DeleteRows(row, 1);
    });
    if (names.length)
      onChange({ ...value, files: value.files.filter((f) => !names.includes(f.name)) });
  };

  // onAddEmbeddedFiles: multi-select picker; AddFile(name, overwrite=true)
  // replaces same-name entries and the std::map keeps the list name-sorted.
  const addFiles = async (picked: FileList | null): Promise<void> => {
    if (!picked || picked.length === 0) return;
    const added: EmbeddedFile[] = [];
    for (const f of Array.from(picked)) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      added.push({ name: f.name, reference: `kicad-embed://${f.name}`, pendingBytes: bytes });
    }
    const names = new Set(added.map((a) => a.name));
    const files = [...value.files.filter((f) => !names.has(f.name)), ...added].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    onChange({ ...value, files });
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="ze-grid-pane" style={{ flex: 1, minHeight: 0 }}>
        <WxGridView
          grid={grid}
          tricks={tricks}
          columns={[{ width: 100 }, { width: 180 }]}
          flexCol={1}
          ariaLabel="Embedded files"
        />
      </div>
      <div className="ze-grid-btns" style={{ alignItems: 'center' }}>
        <input
          ref={fileInput}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="ze-gridbtn"
          title="Add embedded file"
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="plus" />
        </button>
        <span style={{ width: 15 }} />
        <button
          type="button"
          className="ze-gridbtn"
          title="Remove embedded file"
          onClick={removeSel}
        >
          <Icon name="delete" />
        </button>
        <span style={{ flex: 1 }} />
        <label className="ze-pref-check">
          <input
            type="checkbox"
            checked={value.embedFonts}
            onChange={(e) => onChange({ ...value, embedFonts: e.target.checked })}
          />
          Embed fonts
        </label>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="ze-btn"
          title="Export embedded files"
          disabled={!onExport || value.files.length === 0}
          onClick={() => onExport?.(value.files)}
        >
          Export...
        </button>
      </div>
    </div>
  );
}
