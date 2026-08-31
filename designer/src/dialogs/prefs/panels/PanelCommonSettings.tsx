// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Common — `PANEL_COMMON_SETTINGS`
 * (`common/dialogs/panel_common_settings_base.cpp`), a generic page the base
 * frame adds itself (`common/eda_base_frame.cpp:1578-1583`), not an editor's.
 *
 * `bPanelSizer->Add( bLeftSizer, 0, wxRIGHT, 35 )` (`:325`) makes it two
 * columns, and which group sits in which is upstream's.
 *
 * **Four of KiCad's seven groups were REMOVED, on purpose, because every
 * control in them is irrelevant in a browser** — not unfinished, not
 * unimplemented: there is no version of this app in which a page in a tab
 * answers them. A control that can never be answered is deleted outright
 * rather than drawn greyed; greying is reserved for what we will actually
 * build, and a permanently dead row is only a promise the app cannot keep.
 * **Do not add them back.**
 *
 *   * **Rendering Engine** — `m_rbAccelerated` / `m_rbFallback` choose OpenGL
 *     against Cairo, and `m_antialiasing` picks the GAL's own sampling. A page
 *     does not get to choose either: the browser owns the canvas backend and
 *     antialiases it, and a WebGL context that cannot be created falls back on
 *     its own without asking anyone.
 *   * **Helper Applications** — `m_textEditorPath`, `m_textCtrlFileManager` and
 *     `m_PDFViewerPath` are paths to native programs, and a page cannot start a
 *     process. There is no text editor to point at, no file manager to open,
 *     and the only PDF viewer reachable is whatever the browser gives a new
 *     tab.
 *   * **Session** — `m_cbRememberOpenFiles` relaunches the schematic and board
 *     editors on the files they had open, which is a multi-process desktop
 *     idea; ours are panes of one document in one tab. `File history size`
 *     sizes an "Open Recent" menu that is cleared from Maintenance here.
 *   * **Project Backup** — Format and Location choose between a `.history` git
 *     repository and timestamped zips, in the project directory or the user
 *     data directory. Every one of those four words is a filesystem, and a page
 *     has none. Ours are content-addressed versions the cloud store keeps, with
 *     nothing for a user to configure.
 *
 * The Privacy group went with them. It was never KiCad's -- it was ours, for
 * crash reporting -- and a page being trimmed to what KiCad shows is not the
 * place to keep the one group KiCad does not have.
 *
 * What IS here follows the 10.0.5 layout, which differs from 9's in two places
 * this port had inherited: `Show popup indicator when toggling settings with
 * hotkeys` belongs to User Interface, not Editing; and Project Backup is now
 * Format / Location / Maximum total backup size rather than a set of counts and
 * intervals (`common_settings.cpp:128-138`). Session lost its `Auto save:` row
 * with them — the setting survives and autosave still runs, KiCad simply no
 * longer offers the interval here.
 *
 * Controls that are drawn but disabled are the ones whose ENGINE is not built
 * yet, not ones that cannot be built; each says which in its tooltip.
 */
import type { JSX } from 'react';
import { Check, Group, Num, Radio, Sel } from '../widgets.js';
import {
  ZoomCorrectionCtrl,
  type ZoomCorrectionUnits,
} from '../../../widgets/zoom_correction_ctrl.js';
import { useState } from 'react';
import type { PrefsContext } from '../types.js';

export function PanelCommonSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { common, upC } = ctx;
  // ZOOM_CORRECTION_CTRL keeps its unit choice in the widget, not in the
  // settings: `m_unitsChoice` has no PARAM behind it and resets to MM each
  // time the panel is built (`zoom_correction_ctrl.cpp:172`).
  const [zoomUnits, setZoomUnits] = useState<ZoomCorrectionUnits>('mm');

  return (
    /* `bPanelSizer`, horizontal: `bPanelSizer->Add( bLeftSizer, 0, wxRIGHT, 35 )`
       (panel_common_settings_base.cpp:325) then the right column. */
    <div className="ze-pref-columns">
      <div className="ze-pref-col">
        <Group title="User Interface">
          {/* No "Show icons in menus" row. `m_checkBoxIconsInMenus->Show(
              KIPLATFORM::UI::AllowIconsInMenus() )`
              (panel_common_settings.cpp:123), and the GTK port answers that by
              reading `gtk-menu-images` (`wxgtk/ui.cpp:296-300`) — deprecated
              and off in GTK3, so the row is invisible on the parity target and
              a KiCad menu draws no bitmap whatever the setting says. Ours draws
              none either (`qa/…/menu_no_icons.test.ts`), so the checkbox was a
              control over nothing, in a place KiCad has no control at all.
              `appearance.use_icons_in_menus` itself stays: upstream keeps the
              setting and only hides its widget. */}
          {/* Dead: no canvas in this port draws the scrollbars
              `EDA_DRAW_PANEL_GAL` puts around its viewport, so nothing reads
              `appearance.show_scrollbars`. The tooltip is upstream's own and
              nothing else — a disabled control explains itself in the code,
              not in a tip KiCad does not have. */}
          <Check
            label="Show scrollbars in editors"
            title="This change takes effect when relaunching the editor."
            checked={common.appearance.show_scrollbars}
            disabled
            onChange={(v) =>
              upC((s) => {
                s.appearance.show_scrollbars = v;
              })
            }
          />
          <Check
            label="Focus follows mouse between schematic and PCB editors"
            /* Dead: upstream raises whichever editor WINDOW the cursor is
               over, and ours are panes of one document in one tab. */
            title="If the mouse cursor is moved over the canvas of a schematic or PCB editor window, that window is raised."
            checked={common.input.focus_follow_sch_pcb}
            disabled
            onChange={(v) =>
              upC((s) => {
                s.input.focus_follow_sch_pcb = v;
              })
            }
          />
          <Check
            label="Show popup indicator when toggling settings with hotkeys"
            title="When enabled, certain hotkeys that cycle between settings will show a popup indicator briefly to indicate the change in settings."
            checked={common.input.hotkey_feedback}
            onChange={(v) =>
              upC((s) => {
                s.input.hotkey_feedback = v;
              })
            }
          />
          <Check
            label="Use alternating row colors in tables"
            /* Dead: no grid in this port stripes its rows. */
            title="When enabled, use a different color for every other table row"
            checked={common.appearance.grid_striping}
            disabled
            onChange={(v) =>
              upC((s) => {
                s.appearance.grid_striping = v;
              })
            }
          />
          <Check
            label="Disable custom cursors"
            title="When enabled, KiCad will use default system cursors instead of custom ones"
            checked={!common.appearance.use_custom_cursors}
            onChange={(v) =>
              upC((s) => {
                s.appearance.use_custom_cursors = !v;
              })
            }
          />
          {/* `bUserInterfaceSizer->Add( bSizerIconsTheme, 0, wxEXPAND|wxTOP, 5 )`
              — the one row in this group that asks for space above it, which
              is where KiCad's checkbox run visibly ends. */}
          <Radio
            row
            borders={['top']}
            label="Icon theme:"
            name="pref-icon-theme"
            value={common.appearance.icon_theme}
            /* Dead: every icon in this app is one SVG taking `currentColor`,
               so there is no light set and no dark set to choose between and
               nothing reads `appearance.icon_theme`. */
            disabled
            options={[
              ['light', 'Light', 'Use icons designed for light window backgrounds'],
              ['dark', 'Dark', 'Use icons designed for dark window backgrounds'],
              [
                'auto',
                'Automatic',
                'Automatically choose light or dark icons based on the system color theme',
              ],
            ]}
            onChange={(v) =>
              upC((s) => {
                s.appearance.icon_theme = v;
              })
            }
          />
          {/* `Add( bSizerToolbarSize, 0, wxEXPAND, 5 )` — no wxTOP and no
              wxBOTTOM, so the only space between this row and Icon theme above
              it is the wxALL 5 their own children carry, twice.
              [px] `qa/probes/prefs_ui_group_probe.cpp` builds this sizer with
              wxWidgets here and reads the widgets back: 32 px from Icon theme
              to Toolbar icon size, against 27 through the checkbox run and 37
              from the last checkbox to Icon theme. (An earlier note here said
              24, which is under the checkbox pitch and cannot be right — these
              rows are FURTHER apart than the checkboxes, not closer.) */}
          <Radio
            row
            borders={[]}
            label="Toolbar icon size:"
            name="pref-toolbar-icon-size"
            value={common.appearance.toolbar_icon_size}
            /* Dead: the toolbars draw at one size — nothing reads
               `appearance.toolbar_icon_size`, which upstream turns into the
               16 / 24 / 32 px bitmap it asks `KiBitmapBundle` for. */
            disabled
            options={[
              ['small', 'Small', 'Use compact icons in the toolbars'],
              ['normal', 'Normal', 'Use the default KiCad icon size in the toolbars'],
              ['large', 'Large', 'Use larger icons in the toolbars'],
            ]}
            onChange={(v) =>
              upC((s) => {
                s.appearance.toolbar_icon_size = v;
              })
            }
          />
          {/* `Add( bSizerHighContrast, 0, wxEXPAND|wxTOP|wxBOTTOM, 5 )` — the
              only row here that borders on both sides. */}
          <Num
            borders={['top', 'bottom']}
            label="High-contrast mode dimming factor:"
            value={common.appearance.hicontrast_dimming_factor}
            unit="%"
            /* `m_highContrastCtrl` is a `wxTextCtrl`
               (`panel_common_settings_base.cpp:283`), NOT a wxSpinCtrl: no
               up/down arrows, and its digits sit where the entry puts them.
               `SetMinSize( GetTextExtent( "XXX.XXX" ) )`
               (`panel_common_settings.cpp:145-148`) sizes it to its widest
               value — [px] 58 on this theme, from
               `qa/probes/prefs_ui_group_probe.cpp`. */
            spin={false}
            width={58}
            min={0}
            max={100}
            /* Dead until the factor is actually read. `PCB_PAINTER::
               ::GetColor` takes `m_hiContrastFactor = 1.0 -
               hicontrast_dimming_factor` (`pcbnew/pcb_painter.cpp:176`), and
               ours is the CONSTANT that expression yields at the shipped
               default: `HI_CONTRAST_FACTOR = 0.2` in
               `common/src/render_settings.ts`, read by the board, GerbView and
               the drawing sheet alike. Nothing anywhere reads the setting, so
               typing 40 here would dim nothing. It is drawn and disabled until
               the painters take it. */
            disabled
            onChange={(v) =>
              upC((s) => {
                s.appearance.hicontrast_dimming_factor = v;
              })
            }
          />
        </Group>
      </div>
      {/* `bPanelSizer->Add( rightSizer, 1, wxLEFT|wxRIGHT, 5 )` (`:479`) — the
          one column on any of these pages with a proportion, which is what
          lets the Scaling ruler stretch across it. */}
      <div className="ze-pref-col ze-grow">
        {/* `m_scalingSizer->Add( m_zoomCorrectionCtrl, 1, wxEXPAND )`
            (panel_common_settings.cpp:120) — the group is the widget and
            nothing else. */}
        <Group title="Scaling">
          {/* Dead: nothing reads `appearance.zoom_correction_factor`. Upstream
              every GAL view scales by it, so a millimetre on the canvas is a
              millimetre on the glass; here the canvases still work in CSS
              pixels against the browser's own device pixel ratio, and the
              ruler measures nothing. Drawn and disabled until they take it. */}
          <ZoomCorrectionCtrl
            disabled
            value={common.appearance.zoom_correction_factor}
            onChange={(v) =>
              upC((s) => {
                s.appearance.zoom_correction_factor = v;
              })
            }
            units={zoomUnits}
            onUnitsChange={setZoomUnits}
          />
        </Group>
        <Group title="Editing">
          {/* Dead: `input.warp_mouse_on_move` has no reader. Upstream a move
              starts by warping the pointer onto the item's anchor
              (`EDA_DRAW_FRAME` / the selection tool), and nothing here moves
              the pointer at all -- a page cannot, outside of Pointer Lock. */}
          <Check
            label="Warp mouse to anchor of moved object"
            checked={common.input.warp_mouse_on_move}
            disabled
            onChange={(v) =>
              upC((s) => {
                s.input.warp_mouse_on_move = v;
              })
            }
          />
          {/* Dead: `input.immediate_actions` is named in three comments in the
              schematic editor and read by none of them. Every hotkey here acts
              at once, which is what the setting's default asks for -- but the
              other answer is not implemented, so the box cannot offer it. */}
          <Check
            label="First hotkey selects tool"
            title="If not checked, hotkeys will immediately perform an action even if the relevant tool was not previously selected."
            checked={!common.input.immediate_actions}
            disabled
            onChange={(v) =>
              upC((s) => {
                s.input.immediate_actions = !v;
              })
            }
          />
        </Group>
      </div>
    </div>
  );
}
