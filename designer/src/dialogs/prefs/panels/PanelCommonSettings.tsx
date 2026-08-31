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
 * Four of KiCad's seven groups are not here, and all four are deliberate:
 *
 *   * **Rendering Engine** — `m_rbAccelerated` / `m_rbFallback` choose OpenGL
 *     against Cairo, and `m_antialiasing` picks the GAL's own sampling. A page
 *     does not get to choose either: the browser owns the canvas backend and
 *     antialiases it. There is nothing behind the group, so it is gone rather
 *     than shown greyed — a group whose every control is disabled teaches the
 *     reader nothing they could act on.
 *   * **Helper Applications** — `m_textEditorPath`, `m_textCtrlFileManager` and
 *     `m_PDFViewerPath` are paths to native programs. Same reasoning.
 *   * **Session** — `m_cbRememberOpenFiles` relaunches the schematic and board
 *     editors on the files they had open, which is a multi-process desktop
 *     idea; `File history size` sizes an "Open Recent" menu that is cleared
 *     from Maintenance here.
 *   * **Project Backup** — Format and Location choose between a `.history` git
 *     repository and timestamped zips, in the project directory or the user
 *     data directory. Every one of those four words is a filesystem. Ours are
 *     content-addressed versions the cloud store keeps, with nothing for a user
 *     to configure.
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
          <Check
            label="Show icons in menus"
            checked={common.appearance.use_icons_in_menus}
            onChange={(v) =>
              upC((s) => {
                s.appearance.use_icons_in_menus = v;
              })
            }
          />
          <Check
            label="Show scrollbars in editors"
            title="This change takes effect when relaunching the editor."
            checked={common.appearance.show_scrollbars}
            onChange={(v) =>
              upC((s) => {
                s.appearance.show_scrollbars = v;
              })
            }
          />
          <Check
            label="Focus follows mouse between schematic and PCB editors"
            title="Not wired yet: upstream raises whichever editor WINDOW the cursor is over. Ours are panes of one document in one tab, so this needs a focus model before it can mean anything."
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
            title="Not wired yet: no grid in this port stripes its rows, so the setting has nothing to read it. When enabled, use a different color for every other table row."
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
            title="When enabled, the browser's own cursors are used instead of KiCad's."
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
            options={[
              ['light', 'Light'],
              ['dark', 'Dark'],
              ['auto', 'Automatic'],
            ]}
            onChange={(v) =>
              upC((s) => {
                s.appearance.icon_theme = v;
              })
            }
          />
          {/* `Add( bSizerToolbarSize, 0, wxEXPAND, 5 )` — no wxTOP and no
              wxBOTTOM, so it sits against the row above and the one below.
              This is the pair that measures 24 px apart on the capture where
              every checkbox row measures 27. */}
          <Radio
            row
            borders={[]}
            label="Toolbar icon size:"
            name="pref-toolbar-icon-size"
            value={common.appearance.toolbar_icon_size}
            options={[
              ['small', 'Small'],
              ['normal', 'Normal'],
              ['large', 'Large'],
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
            min={0}
            max={100}
            onChange={(v) =>
              upC((s) => {
                s.appearance.hicontrast_dimming_factor = v;
              })
            }
          />
        </Group>
      </div>
      <div className="ze-pref-col">
        {/* `m_scalingSizer->Add( m_zoomCorrectionCtrl, 1, wxEXPAND )`
            (panel_common_settings.cpp:120) — the group is the widget and
            nothing else. */}
        <Group title="Scaling">
          <ZoomCorrectionCtrl
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
          <Check
            label="Warp mouse to anchor of moved object"
            checked={common.input.warp_mouse_on_move}
            onChange={(v) =>
              upC((s) => {
                s.input.warp_mouse_on_move = v;
              })
            }
          />
          <Check
            label="First hotkey selects tool"
            title="If not checked, hotkeys will immediately perform an action even if the relevant tool was not previously selected."
            checked={!common.input.immediate_actions}
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
