// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Annotation Options —
 * `PANEL_EESCHEMA_ANNOTATION_OPTIONS`
 * (`eeschema/dialogs/panel_eeschema_annotation_options_base.cpp`).
 *
 * NOTE: upstream this is a *Schematic Setup* page, not a Preferences page --
 * `eeschema/dialogs/dialog_schematic_setup.cpp:71` is its only construction
 * site -- and we already have it correctly there, in
 * `editors/schematic/dialogs/panels/panel_eeschema_annotation_options.tsx`.
 * This is therefore a hand-rolled second copy of the same controls over the
 * same settings, reported in PR 543 and still not collapsed: deleting a page
 * is a behaviour change and this branch is a no-op refactor. Moved here so the
 * duplicate is at least visible as a file rather than buried in a switch.
 *
 * Moved verbatim out of the Preferences dialog's `switch (page)` (as it stood
 * at 5d6a2f40, in prefs/PreferencesDialog.tsx); no behaviour change.
 */
import type { JSX } from 'react';
import { Check, Group } from '../../../dialogs/prefs/widgets.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { EESCHEMA_DEFAULTS } from '../../../prefs/settings.js';
import { resetKeys } from '../../../dialogs/prefs/reset.js';

export function PanelEeschemaAnnotationOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE } = ctx;
  return (
    <>
      <Group title="Annotation">
        <Check
          label="Automatically annotate symbols"
          checked={eeschema.annotation.automatic}
          onChange={(v) =>
            upE((s) => {
              s.annotation.automatic = v;
            })
          }
        />
      </Group>
      <Group title="Order">
        <label className="ze-pref-check">
          <input
            type="radio"
            name="anno-order"
            checked={eeschema.annotation.sort_order === 0}
            onChange={() =>
              upE((s) => {
                s.annotation.sort_order = 0;
              })
            }
          />
          Sort symbols by X position
        </label>
        <label className="ze-pref-check">
          <input
            type="radio"
            name="anno-order"
            checked={eeschema.annotation.sort_order === 1}
            onChange={() =>
              upE((s) => {
                s.annotation.sort_order = 1;
              })
            }
          />
          Sort symbols by Y position
        </label>
      </Group>
      <Group title="Numbering">
        <label className="ze-pref-check">
          <input
            type="radio"
            name="anno-method"
            checked={eeschema.annotation.method === 0}
            onChange={() =>
              upE((s) => {
                s.annotation.method = 0;
              })
            }
          />
          Use first free number after:
        </label>
        <label className="ze-pref-check">
          <input
            type="radio"
            name="anno-method"
            checked={eeschema.annotation.method === 1}
            onChange={() =>
              upE((s) => {
                s.annotation.method = 1;
              })
            }
          />
          First free after sheet number X 100
        </label>
        <label className="ze-pref-check">
          <input
            type="radio"
            name="anno-method"
            checked={eeschema.annotation.method === 2}
            onChange={() =>
              upE((s) => {
                s.annotation.method = 2;
              })
            }
          />
          First free after sheet number X 1000
        </label>
      </Group>
    </>
  );
}

/** `RESETTABLE_PANEL::ResetPanel`: the eeschema settings back to EESCHEMA_SETTINGS' defaults. */
export function resetEeschemaAnnotationOptions(ctx: PrefsContext): void {
  ctx.upE((s) => {
    // PANEL_EESCHEMA_ANNOTATION_OPTIONS::ResetPanel
    // (eeschema/dialogs/panel_eeschema_annotation_options.cpp) builds a default
    // SCHEMATIC_SETTINGS and calls loadEEschemaSettings on it, which sets this
    // panel's three controls and no others.
    resetKeys(s.annotation, EESCHEMA_DEFAULTS.annotation, ['automatic', 'method', 'sort_order']);
  });
}
