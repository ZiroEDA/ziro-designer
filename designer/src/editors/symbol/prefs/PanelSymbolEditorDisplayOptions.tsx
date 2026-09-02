// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Display Options —
 * `PANEL_SYM_DISPLAY_OPTIONS`
 * (`eeschema/dialogs/panel_sym_display_options.cpp` and its `_base.cpp`),
 * constructed by eeschema's KIFACE for `PANEL_SYM_DISP_OPTIONS`:
 *
 *     return new PANEL_SYM_DISPLAY_OPTIONS( aParent,
 *             GetAppSettings<SYMBOL_EDITOR_SETTINGS>( "symbol_editor" ) );
 *     (`eeschema/eeschema.cpp:251-252`)
 *
 * The sizer tree, whole (`panel_sym_display_options_base.cpp:12-58`):
 *
 *     bPanelSizer (H)
 *       m_galOptionsSizer (V) -> PANEL_GAL_OPTIONS   wxRIGHT 5, then wxRIGHT 15
 *       bRightColumn (V)                             wxBOTTOM|wxLEFT 10
 *         "Appearance" + wxStaticLine
 *         bAppearanceSizer (V)                       wxTOP|wxLEFT 5
 *           m_checkShowHiddenPins        wxEXPAND|wxALL 5
 *           m_checkShowHiddenFields      wxBOTTOM|wxRIGHT|wxLEFT|wxEXPAND 5
 *           m_showPinElectricalTypes     wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT 5
 *           m_checkShowPinAltModeIcons   wxBOTTOM|wxEXPAND|wxLEFT|wxRIGHT 5
 *
 * One heading, four checkboxes, and the shared `PANEL_GAL_OPTIONS` beside them.
 * There is nothing else on the page: no Selection group, no Cross-probing
 * group, no default font — those belong to `PANEL_EESCHEMA_DISPLAY_OPTIONS`,
 * which is a different class, and putting any of them here would be an
 * invention.
 *
 * **What reads each control.** All four Appearance boxes are the settings the
 * left toolbar's own toggle buttons read and write — `SYMBOL_EDIT_FRAME::
 * setupUIConditions` gives each button a `CHECK` condition that reads
 * `libeditconfig()->m_Show*` directly (`symbol_edit_frame.cpp:566-606`), and
 * `SYMBOL_EDITOR_CONTROL::ToggleHiddenPins` and friends invert the same field
 * (`symbol_editor_control.cpp:714-752`). Ours goes through
 * `editors/symbol/toggles.ts`, which is the same relationship: the file is the
 * state and the toolbar set is derived from it. Three of the four therefore
 * change the canvas the moment OK is pressed.
 *
 * The fourth, Show pin alternate mode indicator icons, is **disabled**: the
 * renderer draws no alternate-mode indicator at all, so `show_pin_alt_icons`
 * has no reader. `editors/symbol/menubar.ts` already greys the matching View
 * row for the same reason, and upstream leaves the button commented out of the
 * toolbar (`toolbars_symbol_editor.cpp:85`), so there is no live control here
 * for a greyed one to be inconsistent with.
 */
import type { JSX } from 'react';
import { Check, Group } from '../../../dialogs/prefs/widgets.js';
import { PanelGalOptions } from '../../../dialogs/prefs/PanelGalOptions.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelSymbolEditorDisplayOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { symbolEditor, upSym } = ctx;
  return (
    <div className="ze-pref-columns ze-gutter-30">
      <div>
        {/* `m_galOptsPanel = new PANEL_GAL_OPTIONS( this, aAppSettings )`
            (`panel_sym_display_options.cpp:34`) — the shared panel over this
            editor's own settings object.

            Every control in it is live here: Style, Grid thickness and Minimum
            grid spacing reach `drawGrid` through `SymbolViewOptions`, Snap to
            grid is `symbolSnappingEnabled` in `editors/symbol/grid.ts`
            (`GAL::GetGridSnapping`), and the Cursor group is what
            `SymbolCanvas` hands `drawCrosshair`. */}
        <PanelGalOptions
          win={symbolEditor.window}
          update={(fn) => upSym((s) => fn(s.window))}
          idPrefix="sym"
        />
      </div>
      <div>
        <Group title="Appearance">
          {/* `wxEXPAND|wxALL, 5` — the only row in this group with a top border. */}
          <Check
            label="Show hidden pins"
            checked={symbolEditor.show_hidden_lib_pins}
            borders={['top', 'bottom']}
            onChange={(v) =>
              upSym((s) => {
                s.show_hidden_lib_pins = v;
              })
            }
          />
          <Check
            label="Show hidden fields"
            checked={symbolEditor.show_hidden_lib_fields}
            onChange={(v) =>
              upSym((s) => {
                s.show_hidden_lib_fields = v;
              })
            }
          />
          <Check
            label="Show pin electrical type"
            checked={symbolEditor.show_pin_electrical_type}
            onChange={(v) =>
              upSym((s) => {
                s.show_pin_electrical_type = v;
              })
            }
          />
          {/* Dead: nothing reads `show_pin_alt_icons`. `drawPin`
              (`render/symbolRenderer.ts`) has no alternate-mode indicator to
              draw, so this would store a flag the canvas cannot act on. */}
          <Check
            label="Show pin alternate mode indicator icons"
            checked={symbolEditor.show_pin_alt_icons}
            disabled
            onChange={(v) =>
              upSym((s) => {
                s.show_pin_alt_icons = v;
              })
            }
          />
        </Group>
      </div>
    </div>
  );
}
