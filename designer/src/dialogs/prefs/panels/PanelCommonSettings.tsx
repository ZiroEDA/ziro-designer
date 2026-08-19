// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Common — `PANEL_COMMON_SETTINGS`
 * (`common/dialogs/panel_common_settings_base.cpp`), a generic page the base
 * frame adds itself (`common/eda_base_frame.cpp:1578-1583`), not an editor's.
 *
 * Moved verbatim out of the Preferences dialog's `switch (page)` (as it stood
 * at 5d6a2f40, in prefs/PreferencesDialog.tsx); no behaviour change.
 */
import type { JSX } from 'react';
import { Check, Group, Num, Sel } from '../widgets.js';
import type { PrefsContext } from '../types.js';

export function PanelCommonSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { common, upC, privacy, setPrivacy } = ctx;
  return (
    <>
      <Group title="Antialiasing">
        <Sel
          label="Accelerated graphics:"
          value={0}
          options={[
            [0, 'No Antialiasing'],
            [1, 'Fast Antialiasing'],
            [2, 'High Quality Antialiasing'],
          ]}
          onChange={() => {}}
        />
        <Sel
          label="Fallback graphics:"
          value={0}
          options={[
            [0, 'No Antialiasing'],
            [1, 'Fast Antialiasing'],
            [2, 'High Quality Antialiasing'],
          ]}
          onChange={() => {}}
        />
        <div className="ze-muted">
          (The browser canvas antialiases on its own; these choices have no effect here.)
        </div>
      </Group>
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
          checked={common.appearance.show_scrollbars}
          onChange={(v) =>
            upC((s) => {
              s.appearance.show_scrollbars = v;
            })
          }
        />
        <Sel
          label="Icon theme:"
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
        <Sel
          label="Toolbar icon size:"
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
        <Num
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
          checked={!common.input.immediate_actions}
          title="If not checked, hotkeys will immediately perform an action even if the relevant tool was not previously selected."
          onChange={(v) =>
            upC((s) => {
              s.input.immediate_actions = !v;
            })
          }
        />
        <Check
          label="Show popup indicator when toggling settings with hotkeys"
          checked={common.input.hotkey_feedback}
          onChange={(v) =>
            upC((s) => {
              s.input.hotkey_feedback = v;
            })
          }
        />
      </Group>
      <Group title="Session">
        <Check
          label="Remember open files for next project launch"
          checked={common.system.session.remember_open_files}
          onChange={(v) =>
            upC((s) => {
              s.system.session.remember_open_files = v;
            })
          }
        />
        <Num
          label="Auto save:"
          value={Math.round(common.system.autosave_interval / 60)}
          unit="minutes"
          min={0}
          max={60}
          onChange={(v) =>
            upC((s) => {
              s.system.autosave_interval = v * 60;
            })
          }
        />
        <Num
          label="File history size:"
          value={common.system.file_history_size}
          min={0}
          max={50}
          onChange={(v) =>
            upC((s) => {
              s.system.file_history_size = v;
            })
          }
        />
      </Group>
      <Group title="Project Backup">
        <Check
          label="Automatically backup projects"
          checked={common.backup.enabled}
          onChange={(v) =>
            upC((s) => {
              s.backup.enabled = v;
            })
          }
        />
        <Check
          label="Create backups when auto save occurs"
          checked={common.backup.backup_on_autosave}
          onChange={(v) =>
            upC((s) => {
              s.backup.backup_on_autosave = v;
            })
          }
        />
        <Num
          label="Maximum backups to keep:"
          value={common.backup.limit_total_files}
          min={0}
          onChange={(v) =>
            upC((s) => {
              s.backup.limit_total_files = v;
            })
          }
        />
        <Num
          label="Maximum backups per day:"
          value={common.backup.limit_daily_files}
          min={0}
          onChange={(v) =>
            upC((s) => {
              s.backup.limit_daily_files = v;
            })
          }
        />
        <Num
          label="Minimum time between backups:"
          value={Math.round(common.backup.min_interval / 60)}
          unit="minutes"
          min={0}
          onChange={(v) =>
            upC((s) => {
              s.backup.min_interval = v * 60;
            })
          }
        />
        <Num
          label="Maximum total backup size:"
          value={Math.round(common.backup.limit_total_size / 1048576)}
          unit="MB"
          min={0}
          onChange={(v) =>
            upC((s) => {
              s.backup.limit_total_size = v * 1048576;
            })
          }
        />
      </Group>
      {/* Not a KiCad panel, KiCad is a desktop app and collects nothing.
          Placed last on Common so the KiCad-mirrored groups read in order. */}
      <Group title="Privacy">
        <Check
          label="Send anonymous crash reports"
          title="Sends the error and stack trace when the app crashes, with file names removed and no project data. Used only to find and fix bugs."
          checked={privacy.crash_reports}
          onChange={(v) => setPrivacy({ ...privacy, crash_reports: v })}
        />
      </Group>
    </>
  );
}
