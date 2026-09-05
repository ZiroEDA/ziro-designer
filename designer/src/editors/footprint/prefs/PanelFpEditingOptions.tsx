// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Footprint Editor > Editing Options — `PANEL_EDIT_OPTIONS`
 * (`pcbnew/dialogs/panel_edit_options.cpp` and its `_base.cpp`), which upstream
 * is ONE class both pcbnew frames build, told apart by a flag:
 *
 *     return new PANEL_EDIT_OPTIONS( aParent, this, frame, true );
 *     (`pcbnew/pcbnew.cpp:330-343`, the `true` being `isFootprintEditor`)
 *
 * The constructor hides three things for this frame and shows one
 * (`panel_edit_options.cpp:41-71`):
 *
 *     m_sizerBoardEdit->Show( !m_isFootprintEditor );   // Track mouse-drag
 *                                                       // mode, Flip board
 *                                                       // items, Allow free pads
 *     m_rbHighlightNet->Show( false );                  // and Toggle selection
 *     m_rbToggleSel->SetValue( true );                  // is forced on
 *     m_optionsBook->SetSelection( 0 );                 // Magnetic Points as
 *                                                       // two checkboxes, not
 *                                                       // pcbnew's three choices
 *
 * so the page is: the Editing Options group without its board half, the Left
 * Click Mouse Commands table with a single Ctrl row, and a Magnetic Points
 * group of two checkboxes in the right column.
 *
 * The sizer tree (`panel_edit_options_base.cpp:13-300`):
 *
 *     bMiddleLeftSizer (V)
 *       "Editing Options" + wxStaticLine
 *       bSizerUniversal (V)                     wxEXPAND|wxALL 5
 *         m_cbConstrainHV45Mode                 wxTOP|wxBOTTOM|wxLEFT 5
 *         "Step for rotate commands:" + entry + UNIT_BINDER's "°"
 *         (0, 3) spacer
 *         "Arc editing mode:"                   wxLEFT 5
 *         (0, 3) spacer
 *         m_arcEditMode                         wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT 5
 *       m_sizerBoardEdit                        HIDDEN here
 *       "Left Click Mouse Commands" + wxStaticLine
 *       m_mouseCmdsWinLin (V)
 *         m_stHint1, in `KIUI::GetSmallInfoFont( this ).Italic()`
 *         fgSizerCmdsWinLin (2 cols, vgap 8)
 *     (20, 0) spacer
 *     m_optionsBook -> fpPage (V)
 *       "Magnetic Points" + wxStaticLine
 *       m_magneticPads / m_magneticGraphics
 *
 * **`m_ArcEditMode` is deliberately session-only**, because upstream's is.
 * `TransferDataFromWindow` writes `cfg->m_ArcEditMode` in the footprint branch
 * (`panel_edit_options.cpp:177`), but `FOOTPRINT_EDITOR_SETTINGS` registers no
 * `editing.arc_edit_mode` param for it — only `PCBNEW_SETTINGS` does
 * (`pcbnew_settings.cpp:183-185`) — so the choice takes effect and is gone at
 * the next launch. `editors/footprint/arc_edit_mode.ts` is that member: a
 * module-level value the frame reads, not a key in `fpedit.json`.
 *
 * **What reads each control.** Constrain to H, V, 45 degrees is
 * `m_AngleSnapMode`, which the left toolbar's Line mode group is the other
 * control over — `FOOTPRINT_EDITOR_CONTROL::OnAngleSnapModeChanged` maps DEG45
 * to `PCB_ACTIONS::lineMode45` (`footprint_editor_control.cpp:1031-1048`), so
 * the checkbox and those three buttons are one value. Step for rotate commands
 * is what `PCB_ACTIONS::rotateCw`/`rotateCcw` turn by. Magnetic pads and
 * Magnetic graphics are `PCB_GRID_HELPER`'s two item classes. Arc editing mode
 * is `EDIT_TOOL`'s point editor.
 */
import type { JSX } from 'react';
import { Check, Group, Num, Sel } from '../../../dialogs/prefs/widgets.js';
import { unitLabel } from '@ziroeda/common/src/eda_units.js';
import { ARC_EDIT_MODE_CHOICES } from '../arc_edit_mode.js';
import { setSessionArcEditMode, useSessionArcEditMode } from '../arc_edit_mode.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/**
 * `fgSizerCmdsWinLin` (`panel_edit_options_base.cpp:127-190`) — the non-macOS
 * table, since `m_mouseCmdsOSX` is `#ifdef __WXOSX_MAC__` and this port is not
 * that build. The Ctrl row's second radio, "Highlight net (for pads/tracks)",
 * is `Show( false )` in the footprint editor and so is not here at all.
 */
const MOUSE_COMMANDS: readonly (readonly [string, string])[] = [
  ['Click:', 'Select item(s)'],
  ['Long Click:', 'Clarify selection from menu'],
  ['Shift:', 'Add item(s) to selection'],
  ['Ctrl+Shift:', 'Remove item(s) from selection'],
  ['Ctrl:', 'Toggle selection'],
];

/**
 * The two `Add()` borders that space the Arc editing mode block.
 *
 * [data] both are the `Add( 0, 3 )` spacer wxFormBuilder emitted
 * (`panel_edit_options_base.cpp:57` and `:65`): one before the label and one
 * between the label and the choice. The label carries `wxLEFT, 5` and the
 * choice `wxBOTTOM|wxRIGHT|wxLEFT, 5`, so neither contributes a vertical border
 * of its own and the spacer is the whole of the distance.
 */
const ARC_MODE_STACK = { gap: 3, above: 3 };

export function PanelFpEditingOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp } = ctx;
  const arcMode = useSessionArcEditMode();

  return (
    <div className="ze-pref-columns ze-gutter-25">
      <div>
        <Group title="Editing Options">
          {/* `wxTOP|wxBOTTOM|wxLEFT, 5`.

              `LEADER_MODE::DEG45` when checked and `DIRECT` when clear
              (`panel_edit_options.cpp:174-175`) — DEG90 is storable and not
              reachable from this control, exactly as upstream. */}
          <Check
            label="Constrain actions to H, V, 45 degrees"
            checked={fpEdit.editing.fp_angle_snap_mode !== 0}
            borders={['top', 'bottom']}
            onChange={(v) =>
              upFp((s) => {
                s.editing.fp_angle_snap_mode = v ? 1 : 0;
              })
            }
          />
          {/* `m_rotationAngle` is a `UNIT_BINDER` on `EDA_UNITS::DEGREES`
              (`panel_edit_options.cpp:38-43`), i.e. a plain text entry with a
              units label after it — not a spin control, which is why `spin` is
              false. The setting is TENTHS of a degree, as the `PARAM_LAMBDA`
              stores it.

              The label is `°`, not the `_("deg")` in `_base.cpp:49`: that
              string is the wxFormBuilder placeholder, and `UNIT_BINDER::
              SetUnits` overwrites it with `EDA_UNIT_UTILS::GetLabel( DEGREES )`
              (`unit_binder.cpp:110`, `eda_units.cpp:153`) the moment the panel
              is built. Reading `_base.cpp` alone is how we shipped the
              placeholder. */}
          <Num
            label="Step for rotate commands:"
            value={fpEdit.editing.rotation_angle / 10}
            unit={unitLabel('degrees')}
            spin={false}
            width={60}
            title="Set increment (in degrees) for context menu and hotkey rotation."
            onChange={(v) =>
              upFp((s) => {
                // The setter ignores a stored 0 (`footprint_editor_settings.cpp:
                // 132-135`), which is upstream's guard against a file that would
                // make every rotation a no-op. Keeping the guard here means the
                // page cannot write the value the loader would refuse.
                const tenths = Math.round(v * 10);
                if (tenths !== 0) s.editing.rotation_angle = tenths;
              })
            }
          />
          {/* Not a labelled row: `m_arcEditModeLabel` is added to
              `bSizerUniversal` on its own (`wxLEFT, 5`), then a `(0, 3)`
              spacer, then `m_arcEditMode` with `wxEXPAND|wxBOTTOM|wxRIGHT|
              wxLEFT, 5` (`panel_edit_options_base.cpp:59-71`) — so the choice
              is as wide as the column, not as wide as what is left beside a
              label. Ours put the two on one row, which made the group's
              max-content control column as wide as the combo and stranded the
              rotation entry's `°` out at the far right of it. */}
          <Sel
            label="Arc editing mode:"
            ariaLabel="Arc editing mode"
            stacked={ARC_MODE_STACK}
            value={arcMode}
            options={ARC_EDIT_MODE_CHOICES}
            onChange={setSessionArcEditMode}
          />
        </Group>
        <Group title="Left Click Mouse Commands">
          {/* `m_stHint1`, set to `KIUI::GetSmallInfoFont( this ).Italic()`
              (`panel_edit_options.cpp:47-48`). Two lines upstream, broken after
              the colon. */}
          <div className="ze-pref-hint">
            Left click (and drag) actions depend on 2 modifier keys:
            <br />
            Shift and Ctrl
          </div>
          {/* `wxFlexGridSizer( 0, 2, 8, 0 )` — two columns, an 8 px vgap and no
              hgap of its own; each cell carries `wxRIGHT|wxLEFT, 5`. */}
          <div className="ze-fp-mousecmds">
            {MOUSE_COMMANDS.map(([key, action]) => (
              <div key={key} className="ze-fp-mousecmd">
                <span>{key}</span>
                <span>{action}</span>
              </div>
            ))}
          </div>
        </Group>
      </div>
      <div>
        <Group title="Magnetic Points">
          {/* `wxTOP|wxBOTTOM|wxLEFT, 5` then `wxBOTTOM|wxLEFT, 5`.

              Checked is `MAGNETIC_OPTIONS::CAPTURE_ALWAYS` and clear is
              `NO_EFFECT` (`panel_edit_options.cpp:170-172`), so the middle
              value pcbnew's three-way choice offers is unreachable here. */}
          <Check
            label="Magnetic pads"
            checked={fpEdit.editing.magnetic_pads === 2}
            borders={['top', 'bottom']}
            onChange={(v) =>
              upFp((s) => {
                s.editing.magnetic_pads = v ? 2 : 0;
              })
            }
          />
          <Check
            label="Magnetic graphics"
            checked={fpEdit.editing.magnetic_graphics}
            onChange={(v) =>
              upFp((s) => {
                s.editing.magnetic_graphics = v;
              })
            }
          />
        </Group>
      </div>
    </div>
  );
}
