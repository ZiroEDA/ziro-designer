// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_TEMPLATE_FIELDNAMES` (`eeschema/dialogs/panel_template_fieldnames.cpp`
 * over `..._base.cpp`) — the Name / Visible / URL grid of template field names.
 *
 * **One class, two pages.** Upstream the constructor takes a `TEMPLATES*` and
 * branches on it once:
 *
 *     if( aProjectTemplateMgr )  m_title->SetLabel( _( "Project Field Name Templates" ) );
 *     else                       m_title->SetLabel( _( "Global Field Name Templates" ) );
 *     (`:44-52`)
 *
 * Schematic Setup passes the project's manager; Preferences passes nullptr and
 * the panel reads `EESCHEMA_SETTINGS`' own `m_Drawing.field_names`. Everything
 * else — the grid, the buttons, the row rules — is shared, which is why the two
 * pages are the same page with one word different.
 *
 * We had TWO of them: this one, and a second hand-rolled table under
 * `prefs/PanelTemplateFieldnames.tsx` with a `+ Add field` text button, a per-row
 * `−`, a heading in a group box KiCad does not draw, and a sentence
 * ("Template fields are added to every new symbol placed on the schematic")
 * that appears nowhere in KiCad. That one is gone; this is the panel both pages
 * construct, as upstream does.
 *
 * The grid is a `WX_GRID`: `CreateGrid( 0, 3 )` with column widths 180 / 48 / 48,
 * `SetRowLabelSize( 0 )`, `SetSelectionMode( wxGridSelectRows )` and a
 * `wxGridCellBoolRenderer` on columns 1 and 2 — the Visible and URL cells are
 * check boxes in the grid, not controls beside it.
 */

import { useState, type JSX } from 'react';
import { StdBitmapButton } from '../../../../ui/StdBitmapButton.js';
import type { FieldTemplate } from '../../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export type { FieldTemplate } from '../../schematic_settings.js';

interface Props {
  templates: FieldTemplate[];
  onChange: (next: FieldTemplate[]) => void;
  /**
   * `aProjectTemplateMgr == nullptr` — the Preferences copy, which edits the
   * application's own templates rather than this project's. It changes the
   * title and nothing else, exactly as upstream's one branch does.
   */
  global?: boolean;
}

/** `TEMPLATE_FIELDNAME( _( "Untitled Field" ) )` with `m_Visible = false` (`:99-103`). */
const NEW_FIELD: FieldTemplate = { name: 'Untitled Field', visible: false, url: false };

export function PanelTemplateFieldnames({ templates, onChange, global }: Props): JSX.Element {
  const [sel, setSel] = useState<number | null>(templates.length ? 0 : null);

  const setAt = (i: number, patch: Partial<FieldTemplate>): void =>
    onChange(templates.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  /** `OnAddButtonClick` — append, then put the caret in the new row's name. */
  const add = (): void => {
    onChange([...templates, { ...NEW_FIELD }]);
    setSel(templates.length);
  };

  /** `OnDeleteButtonClick` — `m_grid->OnDeleteRows`, which works on the selection. */
  const removeSel = (): void => {
    if (sel === null) return;
    onChange(templates.filter((_, j) => j !== sel));
    setSel(templates.length - 1 > sel ? sel : sel - 1 >= 0 ? sel - 1 : null);
  };

  /** `OnMoveUp` / `OnMoveDown` — `m_grid->SwapRows( row, row ± 1 )`. */
  const move = (dir: -1 | 1): void => {
    if (sel === null) return;
    const j = sel + dir;
    if (j < 0 || j >= templates.length) return;
    const next = [...templates];
    [next[sel], next[j]] = [next[j]!, next[sel]!];
    onChange(next);
    setSel(j);
  };

  return (
    <div className="ze-fieldnames">
      {/* `m_title`, a plain wxStaticText added `wxTOP|wxLEFT|wxEXPAND, 8` — not a
          group box, and with no rule under it. */}
      <div className="ze-fieldnames-title">
        {global ? 'Global Field Name Templates' : 'Project Field Name Templates'}
      </div>
      <div className="ze-grid-pane ze-fieldnames-grid">
        <table className="ze-grid">
          <colgroup>
            {/* `SetupColumnAutosizer( 0 )` — column 0 takes the slack; the two
                boolean columns keep the widths the base file gives them. */}
            <col />
            <col className="ze-fieldnames-bool" />
            <col className="ze-fieldnames-bool" />
          </colgroup>
          <thead>
            <tr>
              <th>Name</th>
              <th>Visible</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the row index IS a
              // grid row's identity; two blank templates are equal values.
              <tr
                key={i}
                className={i === sel ? 'selected' : undefined}
                onFocusCapture={() => setSel(i)}
                onMouseDown={() => setSel(i)}
              >
                <td>
                  <input
                    type="text"
                    value={t.name}
                    aria-label="Name"
                    onChange={(e) => setAt(i, { name: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </td>
                {/* `SetCellRenderer( row, 1, new wxGridCellBoolRenderer() )` and
                    `SetCellAlignment( row, 1, wxALIGN_CENTRE, wxALIGN_CENTRE )`. */}
                <td className="ze-fieldnames-bool">
                  <input
                    type="checkbox"
                    checked={t.visible}
                    aria-label="Visible"
                    onChange={(e) => setAt(i, { visible: e.target.checked })}
                  />
                </td>
                <td className="ze-fieldnames-bool">
                  <input
                    type="checkbox"
                    checked={t.url}
                    aria-label="URL"
                    onChange={(e) => setAt(i, { url: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* `bSizer10`: add, up, down, a fixed 20 px gap, delete. Four
          STD_BITMAP_BUTTONs carrying KiCad's own small_* bitmaps — the tooltips
          are on up and down alone, which is where the base file sets them. */}
      <div className="ze-grid-btns">
        <StdBitmapButton bitmap="small_plus" title="Add field" tooltip={null} onClick={add} />
        <StdBitmapButton
          bitmap="small_up"
          title="Move up"
          disabled={sel === null || sel === 0}
          onClick={() => move(-1)}
        />
        <StdBitmapButton
          bitmap="small_down"
          title="Move down"
          disabled={sel === null || sel === templates.length - 1}
          onClick={() => move(1)}
        />
        {/* `bSizer10->Add( 20, 0, 0, wxEXPAND, 5 )`. [px] wxFormBuilder's own 20. */}
        <span className="ze-fieldnames-gap" />
        <StdBitmapButton
          bitmap="small_trash"
          title="Delete field"
          tooltip={null}
          disabled={sel === null}
          onClick={removeSel}
        />
      </div>
    </div>
  );
}
