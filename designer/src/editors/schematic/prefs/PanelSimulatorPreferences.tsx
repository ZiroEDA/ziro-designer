// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Simulator — `PANEL_SIMULATOR_PREFERENCES`
 * (`eeschema/dialogs/panel_simulator_preferences{,_base}.cpp`), which eeschema
 * builds for `PANEL_SCH_SIMULATOR` (`eeschema/eeschema.cpp:379-381`).
 *
 * The whole page is one question asked five times: what a wheel gesture does on
 * a simulator plot, per modifier. The values are `SIM_MOUSE_WHEEL_ACTION`
 * (`eeschema/sim/sim_preferences.h:37-50`) and they live in
 * `EESCHEMA_SETTINGS::m_Simulator.preferences.mouse_wheel_actions`.
 *
 * The page is LIVE. Nothing reads these values yet — the simulator itself is
 * the piece this port has not built — but the page's own job is to write
 * `m_Simulator.preferences.mouse_wheel_actions`, and it does that completely.
 * Greying it would mean a user who enables the simulator has to come back here
 * and set the page up again, and it would also mean this page is the one place
 * in the dialog whose behaviour is not upstream's: KiCad's controls are live
 * whether or not a plot window is open.
 *
 * That is a narrower rule than "enabled exactly when something reads it", and
 * deliberately so: a control that cannot be honoured by anything, ever — a
 * local socket, a native interpreter — is REMOVED here. One whose reader is
 * merely unbuilt is live, so the setting is already right when the reader
 * arrives.
 *
 * Note the choice lists are NOT the same on both halves. Vertical offers all
 * seven actions; horizontal offers three, and `horizontalScrollSelectionToAction`
 * maps its indices 0/1/2 onto NONE / PAN_LEFT_RIGHT / ZOOM_HORIZONTALLY
 * (`panel_simulator_preferences.cpp:127-150`) — so the horizontal choice's
 * index is not the enum ordinal, which is the one thing on this page that is
 * easy to port wrongly.
 */
import { Fragment, type JSX } from 'react';
import { Combo } from '../../../ui/Combo.js';
import { Group } from '../../../dialogs/prefs/widgets.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/**
 * `SIM_MOUSE_WHEEL_ACTION` (`sim_preferences.h:37-50`) and the labels
 * `verticalChoiceItems` gives them (`panel_simulator_preferences.cpp:39-48`).
 * The array index IS the enum ordinal, which is what the settings store.
 */
const VERTICAL_ACTIONS: readonly string[] = [
  'No action',
  'Pan left/right',
  'Pan right/left',
  'Pan up/down',
  'Zoom',
  'Zoom horizontally',
  'Zoom vertically',
];

/**
 * `horizontalChoiceItems` (`:60-66`) — three entries, and their positions are
 * not ordinals: `horizontalScrollSelectionToAction` sends 0/1/2 to NONE,
 * PAN_LEFT_RIGHT and ZOOM_HORIZONTALLY (`:127-150`).
 */
const HORIZONTAL_ACTIONS: readonly [number, string][] = [
  [0, 'No action'],
  [1, 'Pan left/right'],
  [5, 'Zoom horizontally'],
];

/** `SIM_MOUSE_WHEEL_ACTION_SET::GetMouseDefaults()` (`sim_preferences.h:65-76`). */
const MOUSE_DEFAULTS = {
  vertical_unmodified: 4,
  vertical_with_ctrl: 1,
  vertical_with_shift: 3,
  vertical_with_alt: 0,
  horizontal: 0,
} as const;

/** `SIM_MOUSE_WHEEL_ACTION_SET::GetTrackpadDefaults()` (`:78-89`). */
const TRACKPAD_DEFAULTS = {
  vertical_unmodified: 3,
  vertical_with_ctrl: 4,
  vertical_with_shift: 1,
  vertical_with_alt: 0,
  horizontal: 1,
} as const;

/** The four vertical rows, in the order `fgVScroll` adds them. */
const VERTICAL_ROWS: readonly [keyof typeof MOUSE_DEFAULTS, string][] = [
  ['vertical_unmodified', 'None:'],
  ['vertical_with_ctrl', 'Ctrl:'],
  ['vertical_with_shift', 'Shift:'],
  ['vertical_with_alt', 'Alt:'],
];

export function PanelSimulatorPreferences({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const wheel = ctx.eeschema.simulator.mouse_wheel_actions;
  const setWheel = (patch: Partial<typeof wheel>): void =>
    ctx.upE((s) => {
      Object.assign(s.simulator.mouse_wheel_actions, patch);
    });

  return (
    // `m_lblScrollHeading` with `m_scrollLine` under it — a heading and a
    // wxStaticLine, which is what `Group` draws.
    <Group title="Scroll Gestures">
      {/* `bScrollMargins`: the choices on the left at proportion 1, the two
          reset buttons on the right with `wxLEFT, 50`. */}
      <div className="ze-simprefs">
        <div className="ze-simprefs-col">
          <div className="ze-simprefs-heading">Vertical Touchpad or Scroll Wheel Movement</div>
          <div className="ze-simprefs-grid">
            <span className="ze-simprefs-colhead">Modifier</span>
            <span className="ze-simprefs-colhead ze-simprefs-action">Action</span>
            {/* Each row is TWO cells of the one `fgVScroll`: the modifier
                label, then its wxChoice. */}
            {VERTICAL_ROWS.map(([key, label]) => (
              <Fragment key={key}>
                <span className="ze-simprefs-rowlabel">{label}</span>
                <Combo
                  value={String(wheel[key])}
                  ariaLabel={`Vertical ${label.replace(':', '')}`}
                  options={VERTICAL_ACTIONS.map((l, i) => ({ value: String(i), label: l }))}
                  onChange={(v) => setWheel({ [key]: Number(v) })}
                  className="ze-simprefs-choice"
                />
              </Fragment>
            ))}
          </div>

          <div className="ze-simprefs-heading ze-simprefs-heading2">
            Horizontal Touchpad Movement
          </div>
          <div className="ze-simprefs-grid">
            <span className="ze-simprefs-colhead">Modifier</span>
            <span className="ze-simprefs-colhead ze-simprefs-action">Action</span>
            <span className="ze-simprefs-rowlabel">Any:</span>
            <Combo
              value={String(wheel.horizontal)}
              ariaLabel="Horizontal Any"
              options={HORIZONTAL_ACTIONS.map(([v, l]) => ({ value: String(v), label: l }))}
              onChange={(v) => setWheel({ horizontal: Number(v) })}
              className="ze-simprefs-choice"
            />
          </div>
        </div>

        <div className="ze-simprefs-btns">
          {/* `onMouseDefaults` / `onTrackpadDefaults` write
              `GetMouseDefaults()` / `GetTrackpadDefaults()` into the PANEL's
              controls (`panel_simulator_preferences.cpp`), not into the
              settings — the values land in the file on OK with the rest of the
              page, which is what `setWheel` does here. */}
          <button type="button" className="ze-btn" onClick={() => setWheel(MOUSE_DEFAULTS)}>
            Reset to Mouse Defaults
          </button>
          <button type="button" className="ze-btn" onClick={() => setWheel(TRACKPAD_DEFAULTS)}>
            Reset to Trackpad Defaults
          </button>
        </div>
      </div>
    </Group>
  );
}

export { MOUSE_DEFAULTS, TRACKPAD_DEFAULTS, VERTICAL_ACTIONS, HORIZONTAL_ACTIONS };
