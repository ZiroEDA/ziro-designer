// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Field Name Templates —
 * `PANEL_TEMPLATE_FIELDNAMES` (`common/dialogs/panel_template_fieldnames_base.cpp`),
 * constructed by eeschema for `PANEL_SCH_FIELD_NAME_TEMPLATES`.
 *
 * This page has no "Reset to Defaults":
 * `PANEL_TEMPLATE_FIELDNAMES_BASE` derives from plain `wxPanel`
 * (`eeschema/dialogs/panel_template_fieldnames_base.h:36`), not
 * `RESETTABLE_PANEL`, and declares no `ResetPanel`, so
 * `PAGED_DIALOG::UpdateResetButton` (`common/widgets/paged_dialog.cpp:329-355`)
 * finds no `wxRESETTABLE` style bit and disables the button. It exports no
 * `reset`, which is how our factory says the same thing.
 */
import type { JSX } from 'react';
import { Group } from '../../../dialogs/prefs/widgets.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelTemplateFieldnames({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE } = ctx;
  return (
    <Group title="Field Name Templates">
      <table className="ze-pref-hotkeys">
        <thead>
          <tr>
            <th>Name</th>
            <th>Visible</th>
            <th>URL</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {eeschema.drawing.field_names.map((f, i) => (
            <tr key={i}>
              <td>
                <input
                  className="ze-search"
                  value={f.name}
                  onChange={(e) =>
                    upE((s) => {
                      s.drawing.field_names[i]!.name = e.target.value;
                    })
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={f.visible}
                  onChange={(e) =>
                    upE((s) => {
                      s.drawing.field_names[i]!.visible = e.target.checked;
                    })
                  }
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={f.url}
                  onChange={(e) =>
                    upE((s) => {
                      s.drawing.field_names[i]!.url = e.target.checked;
                    })
                  }
                />
              </td>
              <td>
                <button
                  className="ze-btn sm"
                  onClick={() =>
                    upE((s) => {
                      s.drawing.field_names.splice(i, 1);
                    })
                  }
                >
                  −
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ze-pref-row">
        <button
          className="ze-btn sm"
          onClick={() =>
            upE((s) => {
              s.drawing.field_names.push({ name: '', visible: false, url: false });
            })
          }
        >
          + Add field
        </button>
      </div>
      <div className="ze-muted">
        Template fields are added to every new symbol placed on the schematic.
      </div>
    </Group>
  );
}
