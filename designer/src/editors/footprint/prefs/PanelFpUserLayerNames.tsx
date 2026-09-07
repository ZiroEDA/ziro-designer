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
 * **What reads it.** `editors/footprint/footprintBoard.ts`'
 * `FOOTPRINT_LAYERS` — the layer set the canvas, the layer selector and the
 * Appearance panel all read — takes its `User.n` rows from the count, and each
 * row's shown name from this map. That is `BOARD::GetLayerName` over
 * `m_UserLayerNames`, which is where upstream's names surface too.
 */
import { useState, type JSX } from 'react';
import { Combo } from '../../../ui/Combo.js';
import { StdBitmapButton } from '../../../ui/StdBitmapButton.js';
import { Sel } from '../../../dialogs/prefs/widgets.js';
import { userLayerChoices } from '../fp_layer_choices.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/** `m_choiceUserLayersChoices` — "0" … "9" (`_base.cpp:29-30`). */
const USER_LAYER_COUNTS: [number, string][] = Array.from({ length: 10 }, (_, i) => [i, String(i)]);

export function PanelFpUserLayerNames({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp } = ctx;
  const choices = userLayerChoices();
  const names = fpEdit.design_settings.default_footprint_layer_names;
  /**
   * The grid, as an ordered list. The setting is a MAP, and a map has no row
   * order — so the rows are its entries in insertion order, which is what
   * `loadFPSettings`' `for( const auto& [canonicalName, userName] : … )` walks
   * and what a `nlohmann::json` object preserves.
   */
  const rows = Object.entries(names);
  const [sel, setSel] = useState<number | null>(null);
  /** `SetError( "Layer name %s already in use." )` (`:288-294`). */
  const [error, setError] = useState<string | null>(null);

  /**
   * `getNextAvailableLayer` (`:299-313`): the first `User_n` no other row
   * holds, walked in layer order. Upstream stops at `User_45`; ours stops at
   * the end of the offered list, which is the same statement over the layers
   * this board has.
   */
  const nextFreeLayer = (taken: ReadonlySet<string>): string | null =>
    choices.find((c) => !taken.has(c.value))?.value ?? null;

  const addRow = (): void => {
    const free = nextFreeLayer(new Set(rows.map(([k]) => k)));
    // `AppendRows` returns false when no user layer is left, and the grid
    // simply gains no row (`:290-310` of the table class).
    if (free === null) return;
    upFp((s) => {
      s.design_settings.default_footprint_layer_names[free] = '';
    });
  };

  const deleteRow = (): void => {
    if (sel === null) return;
    const key = rows[sel]?.[0];
    if (key === undefined) return;
    upFp((s) => {
      delete s.design_settings.default_footprint_layer_names[key];
    });
    setSel(null);
    setError(null);
  };

  /** Column 0: re-key the entry, keeping every row's position. */
  const setLayer = (i: number, next: string): void => {
    const taken = new Set(rows.filter((_, j) => j !== i).map(([k]) => k));
    // Rule 2: a layer already spoken for silently becomes the next free one.
    const layer = taken.has(next) ? (nextFreeLayer(taken) ?? next) : next;
    upFp((s) => {
      const map = s.design_settings.default_footprint_layer_names;
      const entries = Object.entries(map);
      const rebuilt: Record<string, string> = {};
      entries.forEach(([k, v], j) => {
        if (j === i) rebuilt[layer] = v;
        else rebuilt[k] = v;
      });
      s.design_settings.default_footprint_layer_names = rebuilt;
    });
  };

  /** Column 1: the name, with rule 3's duplicate check. */
  const setName = (i: number, next: string): void => {
    const key = rows[i]?.[0];
    if (key === undefined) return;
    const clash = rows.some(([k, v], j) => j !== i && v === next && next !== '');
    setError(clash ? `Layer name ${next} already in use.` : null);
    upFp((s) => {
      s.design_settings.default_footprint_layer_names[key] = next;
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
        <table className="ze-grid ze-fp-layernames">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Name</th>
              {/* `SetColSize` 200 / 220 with nothing autosized: the columns
                  stop at 420 and the rest of the grid window is this strip. */}
              <th className="ze-grid-filler" />
            </tr>
          </thead>
          <tbody>
            {rows.map(([layer, name], i) => (
              <tr
                key={layer}
                className={i === sel ? 'selected' : undefined}
                onFocusCapture={() => setSel(i)}
                onMouseDown={() => setSel(i)}
              >
                <td>
                  <Combo
                    value={layer}
                    ariaLabel="Layer"
                    options={choices}
                    onChange={(v) => setLayer(i, v)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={name}
                    aria-label="Name"
                    onChange={(e) => setName(i, e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="ze-grid-filler" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ze-grid-btns">
        <StdBitmapButton bitmap="small_plus" title="Add layer" tooltip={null} onClick={addRow} />
        {/* `bButtonSize->Add( 20, 0, 0, wxEXPAND, 5 )`. [px] wxFormBuilder's own 20. */}
        <span className="ze-fieldnames-gap" />
        <StdBitmapButton
          bitmap="small_trash"
          title="Delete layer"
          tooltip={null}
          disabled={sel === null}
          onClick={deleteRow}
        />
      </div>
      {/* `PAGED_DIALOG::SetError` puts its message in the dialog's own error
          bar; ours is beside the grid it belongs to. */}
      {error && <div className="ze-prefs-error">{error}</div>}
    </div>
  );
}
