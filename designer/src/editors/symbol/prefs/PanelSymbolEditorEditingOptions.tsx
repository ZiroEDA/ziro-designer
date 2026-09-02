// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Editing Options —
 * `PANEL_SYM_EDITING_OPTIONS` (`eeschema/dialogs/panel_sym_editing_options.cpp`
 * and its `_base.cpp`), constructed by eeschema's KIFACE for
 * `PANEL_SYM_EDIT_OPTIONS` (`eeschema/eeschema.cpp:271-284`).
 *
 * The sizer tree, whole (`panel_sym_editing_options_base.cpp:12-190`):
 *
 *     p1mainSizer (H)
 *       leftColumn (V)                                    wxRIGHT 5
 *         "Defaults for New Objects" + wxStaticLine
 *         (0, 5) spacer
 *         gbSizer1 = wxGridBagSizer( 2, 0 ), EmptyCellSize( -1, 8 )   wxALL 5
 *           (0,0..2) "&Default line width:"  | wxTextCtrl | "mils"
 *           (1,0..2) m_widthHelpText, span 3               wxBOTTOM|wxLEFT 5
 *           (2,0..2) "Default text size:"    | wxTextCtrl | "mils"  wxTOP 5
 *           (3,*)    EMPTY -> the 8 px of SetEmptyCellSize
 *           (4,0..2) "D&efault pin length:"
 *           (5,0..2) "De&fault pin number size:"
 *           (6,0..2) "Def&ault pin name size:"
 *         (0, 15) spacer
 *         "Repeated Items" + wxStaticLine
 *         (0, 5) spacer
 *         gbSizer2 = wxGridBagSizer( 5, 0 )                wxTOP|wxRIGHT|wxLEFT 5
 *           (0,0..2) "&Pitch of repeated pins:" | wxTextCtrl | "mils"
 *           (1,0..1) "Label increment:"         | wxSpinCtrl( -10, 10, 1 ), span 2
 *       (25, 0) spacer
 *       rightColumn (V)                                    wxRIGHT 5
 *         "General Editing" + wxStaticLine
 *         (0, 5) spacer
 *         m_dragPinsWithEdges                              wxALL 5
 *         (0, 15) spacer, proportion 1
 *
 * The gutter is 5 + the 25 px spacer = 30, the same number
 * `PANEL_SYM_DISPLAY_OPTIONS` reaches by another route; see `.ze-gutter-30`.
 *
 * **The units.** Every numeric field here is a `UNIT_BINDER` over a plain
 * `wxTextCtrl`, and the file stores MILS —
 * `cfg->m_Defaults.line_width = schIUScale.IUToMils( m_lineWidth.GetIntValue() )`
 * (`panel_sym_editing_options.cpp:83-91`). The binder would relabel the `mils`
 * static texts if the frame were in millimetres; our Grids page makes the same
 * simplification for the same reason — the frame's live display unit is toolbar
 * state rather than a key we model — so the fields are in the unit the frame
 * opens on, which for `symbol_editor` is mils
 * (`common/settings/app_settings.cpp:228-238`).
 *
 * **What reads each control**, which is why three of the eight are drawn
 * disabled:
 *
 *  - the five `defaults.*` fields are live. `editors/symbol/defaults.ts`
 *    converts them once and `SymbolEditor.tsx` seeds `lastPin` (upstream's
 *    `g_LastPin*` delayed initialisation, `symbol_editor_pin_tool.cpp:50-79`),
 *    the text dialog's opening size (`symbol_editor_drawing_tools.cpp:238-246`)
 *    and a new shape's stroke width (`:480`) from it;
 *  - **Pitch of repeated pins** and **Label increment** have no reader.
 *    Upstream both are `SYMBOL_EDITOR_PIN_TOOL::RepeatPin`'s
 *    (`symbol_editor_pin_tool.cpp:425-445`), reached by `ACTIONS::doDelete`'s
 *    neighbour `SCH_ACTIONS::repeatDrawItem` (Insert), and by Add/Duplicate in
 *    `DIALOG_LIB_EDIT_PIN_TABLE` (`:566`, `:1330`). This port has neither the
 *    repeat action nor an editable pin table, so the two would store a number
 *    nothing steps by;
 *  - **Keep pins attached when dragging edges** has no reader. Its one use is
 *    `SCH_POINT_EDITOR` (`eeschema/tools/sch_point_editor.cpp:653`), which is
 *    wired into the schematic here and not into the symbol editor, so there is
 *    no outline-edge drag for it to change.
 *
 * Building those actions is its own piece of work; the page does not get to
 * pretend they exist in the meantime.
 */
import type { JSX } from 'react';
import { Check, Group, Num } from '../../../dialogs/prefs/widgets.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/**
 * `m_widthHelpText`'s string, verbatim, newline and all
 * (`panel_sym_editing_options_base.cpp:48`). It is the only prose on the page
 * and it is upstream's; the panel gives it `KIUI::GetInfoFont( this ).Italic()`
 * (`panel_sym_editing_options.cpp:51`), the GUI font one point down.
 */
const WIDTH_HELP = ['Set to 0 to allow symbols to inherit line width properties', 'from schematic'];

/**
 * `m_spinRepeatLabel`'s range: `new wxSpinCtrl( …, wxSP_ARROW_KEYS, -10, 10, 1 )`
 * (`panel_sym_editing_options_base.cpp:143`). [data] KiCad's own literals.
 */
const LABEL_INCREMENT_RANGE = { min: -10, max: 10 } as const;

export function PanelSymbolEditorEditingOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { symbolEditor, upSym } = ctx;
  const d = symbolEditor.defaults;
  return (
    <div className="ze-pref-columns ze-gutter-30">
      <div>
        <Group title="Defaults for New Objects">
          {/* `gbSizer1`, whose vgap is 2 and not the 5 every other group here
              carries, and which has one deliberately empty row. */}
          <div className="ze-sym-gbsizer">
            <Num
              label="Default line width:"
              unit="mils"
              spin={false}
              borders={[]}
              value={d.line_width}
              onChange={(v) =>
                upSym((s) => {
                  s.defaults.line_width = v;
                })
              }
            />
            <div className="ze-pref-infotext">
              {WIDTH_HELP[0]}
              <br />
              {WIDTH_HELP[1]}
            </div>
            <Num
              label="Default text size:"
              unit="mils"
              spin={false}
              borders={['top']}
              value={d.text_size}
              onChange={(v) =>
                upSym((s) => {
                  s.defaults.text_size = v;
                })
              }
            />
            {/* `gbSizer1->SetEmptyCellSize( wxSize( -1, 8 ) )` and row 3 left
                unfilled — an 8 px gap stated by the sizer, not by a spacer. */}
            <div className="ze-sym-gb-empty" />
            <Num
              label="Default pin length:"
              unit="mils"
              spin={false}
              borders={[]}
              value={d.pin_length}
              onChange={(v) =>
                upSym((s) => {
                  s.defaults.pin_length = v;
                })
              }
            />
            {/* Number size is row 5 and name size row 6 — that order, which is
                the reverse of the way the pin dialog lists them. */}
            <Num
              label="Default pin number size:"
              unit="mils"
              spin={false}
              borders={[]}
              value={d.pin_num_size}
              onChange={(v) =>
                upSym((s) => {
                  s.defaults.pin_num_size = v;
                })
              }
            />
            <Num
              label="Default pin name size:"
              unit="mils"
              spin={false}
              borders={[]}
              value={d.pin_name_size}
              onChange={(v) =>
                upSym((s) => {
                  s.defaults.pin_name_size = v;
                })
              }
            />
          </div>
        </Group>
        <Group title="Repeated Items">
          {/* Dead: nothing repeats a pin. `SCH_ACTIONS::repeatDrawItem` is not
              built and the pin table has no Add/Duplicate, so
              `SYMBOL_EDITOR_PIN_TOOL::RepeatPin`'s two readers
              (`symbol_editor_pin_tool.cpp:431-444`) do not exist here. */}
          <Num
            label="Pitch of repeated pins:"
            unit="mils"
            spin={false}
            disabled
            value={symbolEditor.repeat.pin_step}
            onChange={(v) =>
              upSym((s) => {
                s.repeat.pin_step = v;
              })
            }
          />
          {/* Dead with the pitch above it: `IncrementString( nextName,
              cfg->m_Repeat.label_delta )` is in the same function. */}
          <Num
            label="Label increment:"
            disabled
            min={LABEL_INCREMENT_RANGE.min}
            max={LABEL_INCREMENT_RANGE.max}
            value={symbolEditor.repeat.label_delta}
            onChange={(v) =>
              upSym((s) => {
                s.repeat.label_delta = v;
              })
            }
          />
        </Group>
      </div>
      <div>
        <Group title="General Editing">
          {/* Dead: `SCH_POINT_EDITOR` is the only reader
              (`sch_point_editor.cpp:653`) and it is not wired into this
              editor, so no outline edge can be dragged for pins to follow. */}
          <Check
            label="Keep pins attached when dragging edges"
            checked={symbolEditor.drag_pins_along_with_edges}
            disabled
            borders={['top', 'bottom']}
            onChange={(v) =>
              upSym((s) => {
                s.drag_pins_along_with_edges = v;
              })
            }
          />
        </Group>
      </div>
    </div>
  );
}
