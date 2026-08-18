// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Interactive Router Settings.
 * Counterparts: `pcbnew/dialogs/dialog_pns_settings.cpp` for the behaviour and
 * `dialog_pns_settings_base.cpp` for the layout, labels and control order.
 *
 * Two columns: a "Mode" group of three radio buttons, each with the checkboxes
 * that only that mode can act on indented under it, and a "General Options"
 * group of the mode-independent checkboxes. The order here is the order the
 * sizers add the controls in, label for label.
 *
 * The interlock (`onModeChange`) is the part of this dialog that carries a
 * decision, so it lives in the model, in `pcbnew/src/router/
 * pns_routing_settings.ts`, where the tests can reach it: free angle mode and
 * Allow DRC violations belong to Highlight collisions, Shove vias and Jump over
 * obstacles to Shove, and Walk around enables none of the four. Greying a box
 * out does not clear it — upstream's TransferDataFromWindow writes every
 * checkbox back regardless, so a setting made in one mode survives a trip
 * through another.
 *
 * "Suggest track finish" is in upstream's layout but the dialog calls
 * `m_suggestEnding->Hide()` on it ("Don't show options that are not
 * implemented"), so it is not rendered here either; the stored `suggest_finish`
 * value is carried through untouched, as the hidden checkbox does upstream.
 *
 * Settings persist to the `tools.pns` block of the pcbnew settings, which is
 * where KiCad's own NESTED_SETTINGS puts them (pns_tool_base.cpp:103).
 */
import { useState, type JSX } from 'react';
import {
  PnsMode,
  pnsSettingsEnableState,
  readRoutingSettings,
  writeRoutingSettings,
  type RoutingSettings,
} from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';
import { settings } from '../../../prefs/settings.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  onClose: () => void;
}

/** The mode radios, in `sbModeSizer`'s order with upstream's labels. */
const MODES: readonly (readonly [PnsMode, string])[] = [
  [PnsMode.RM_MarkObstacles, 'Highlight collisions'],
  [PnsMode.RM_Shove, 'Shove'],
  [PnsMode.RM_Walkaround, 'Walk around'],
];

export function DialogPnsSettings({ onClose }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [v, setV] = useState<RoutingSettings>(() => readRoutingSettings(settings.pcbnew.tools.pns));
  const set = (patch: Partial<RoutingSettings>): void => setV({ ...v, ...patch });

  const enabled = pnsSettingsEnableState(v.routingMode);

  const check = (
    label: string,
    value: boolean,
    onChange: (b: boolean) => void,
    tooltip: string,
    opts: { sub?: boolean; disabled?: boolean } = {},
  ): JSX.Element => (
    <label
      title={tooltip}
      className={[opts.sub ? 'ze-pns-sub' : '', opts.disabled ? 'disabled' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <input
        type="checkbox"
        checked={value}
        disabled={opts.disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );

  const radio = (mode: PnsMode, label: string): JSX.Element => (
    <label>
      <input
        type="radio"
        name="ze-pns-mode"
        checked={v.routingMode === mode}
        onChange={() => set({ routingMode: mode })}
      />
      {label}
    </label>
  );

  // TransferDataFromWindow: every control is written back, including the ones
  // the current mode has greyed out and the hidden "Suggest track finish".
  const apply = (): void => {
    settings.updatePcbnew((s) => {
      s.tools.pns = writeRoutingSettings(v);
    });
    onClose();
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-pns-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Interactive Router Settings
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-pns-body">
          <fieldset className="ze-pns-mode">
            <legend>Mode</legend>

            {radio(...MODES[0]!)}
            {check('Free angle mode', v.freeAngleMode, (b) => set({ freeAngleMode: b }), '', {
              sub: true,
              disabled: !enabled.freeAngleMode,
            })}
            {check(
              'Allow DRC violations',
              v.allowDrcViolations,
              (b) => set({ allowDrcViolations: b }),
              '(Highlight collisions mode only) - allows one to establish a track even if is violating the DRC rules.',
              { sub: true, disabled: !enabled.violateDrc },
            )}

            {radio(...MODES[1]!)}
            {check(
              'Shove vias',
              v.shoveVias,
              (b) => set({ shoveVias: b }),
              'When disabled, vias are treated as un-movable objects and hugged instead of shoved.',
              { sub: true, disabled: !enabled.shoveVias },
            )}
            {check(
              'Jump over obstacles',
              v.jumpOverObstacles,
              (b) => set({ jumpOverObstacles: b }),
              'When enabled, the router tries to move colliding tracks behind solid obstacles (e.g. pads) instead of "reflecting" back the collision',
              { sub: true, disabled: !enabled.jumpOverObstacles },
            )}

            {radio(...MODES[2]!)}
          </fieldset>

          <fieldset className="ze-pns-options">
            <legend>General Options</legend>
            {check(
              'Remove redundant tracks',
              v.removeLoops,
              (b) => set({ removeLoops: b }),
              'If the new track has the same connection as an already existing track, the old track is removed.',
            )}
            {check(
              'Optimize pad connections',
              v.smartPads,
              (b) => set({ smartPads: b }),
              'When enabled, the router tries to break out pads/vias in a clean way, avoiding acute angles and jagged breakout tracks.',
            )}
            {check(
              'Smooth dragged segments',
              v.smoothDraggedSegments,
              (b) => set({ smoothDraggedSegments: b }),
              'When enabled, the router attempts to merge several jagged segments into a single straight one (dragging mode).',
            )}
            {/* "Suggest track finish" sits here upstream, hidden. */}
            {check(
              'Optimize entire track being dragged',
              v.optimizeEntireDraggedTrack,
              (b) => set({ optimizeEntireDraggedTrack: b }),
              'When enabled, the entire portion of the track that is visible on the screen will be optimized and re-routed when a segment is dragged.  When disabled, only the area near the segment being dragged will be optimized.',
            )}
            {check(
              'Use mouse path to set track posture',
              v.autoPosture,
              (b) => set({ autoPosture: b }),
              'When enabled, the posture of tracks will be guided by how the mouse is moved from the starting location',
            )}
            {check(
              'Fix all segments on click',
              v.fixAllSegments,
              (b) => set({ fixAllSegments: b }),
              'When enabled, all track segments will be fixed in place up to the cursor location.  When disabled, the last segment (closest to the cursor) will remain free and follow the cursor.',
            )}
          </fieldset>
        </div>

        <div className="ze-modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={apply}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
