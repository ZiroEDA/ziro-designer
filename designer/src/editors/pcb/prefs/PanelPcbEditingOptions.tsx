// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > PCB Editor > Editing Options — `PANEL_EDIT_OPTIONS`
 * (`pcbnew/dialogs/panel_edit_options.cpp` and its `_base.cpp`) with
 * `isFootprintEditor = false` (`pcbnew/pcbnew.cpp:425-439`).
 *
 * ONE class both pcbnew frames build; the constructor is the whole of the
 * difference (`panel_edit_options.cpp:41-72`):
 *
 *     m_magneticPads->Show( m_isFootprintEditor );      // the fp checkboxes
 *     m_magneticGraphics->Show( m_isFootprintEditor );
 *     m_sizerBoardEdit->Show( !m_isFootprintEditor );   // shown HERE
 *     m_optionsBook->SetSelection( isFootprintEditor ? 0 : 1 );
 *
 * so this page has everything the footprint editor's has, plus `m_sizerBoardEdit`
 * (Track mouse-drag mode, Flip board items, Allow free pads), plus the Ctrl
 * row's second radio, plus the book's page 1 instead of its page 0 — Magnetic
 * Points as three choices rather than two checkboxes, then Ratsnest and
 * Miscellaneous.
 *
 *     bMiddleLeftSizer (V)
 *       "Editing Options" + rule
 *         m_cbConstrainHV45Mode
 *         "Step for rotate commands:" + entry + °
 *         "Arc editing mode:" (stacked)
 *       m_sizerBoardEdit                     shown here, hidden in fpedit
 *         "Track mouse-drag mode:" (stacked)
 *         "Flip board items:" + two radios ON ONE ROW
 *         m_allowFreePads
 *       "Left Click Mouse Commands" + rule
 *         m_stHint1 + fgSizerCmdsWinLin, whose Ctrl row is a RADIO PAIR here
 *     (20, 0)
 *     m_optionsBook -> pcbPage (V)
 *       "Magnetic Points" + rule      Snap to pads / tracks and vias / graphics
 *       "Ratsnest" + rule             selected, curved, line thickness
 *       "Miscellaneous" + rule        ESC clears, page limits, courtyard, refill
 *
 * **What reads each control.**
 *
 *  - Constrain to H, V, 45 is `m_AngleSnapMode`, which the left toolbar's Line
 *    mode group is the other control over — one value, two controls.
 *  - Step for rotate commands is what `PCB_ACTIONS::rotateCw/rotateCcw` turn by.
 *  - Arc editing mode is `EDIT_TOOL`'s point editor; unlike the footprint
 *    editor's, this one IS stored (`editing.arc_edit_mode` exists only on
 *    `PCBNEW_SETTINGS`, `pcbnew_settings.cpp:183-185`).
 *  - Track mouse-drag mode is `ROUTER_TOOL`'s `m_TrackDragAction`.
 *  - Flip board items is `FLIP_DIRECTION`, which `EDIT_TOOL::Flip` mirrors about.
 *  - The three Magnetic Points choices are `PCB_GRID_HELPER`'s item classes.
 *  - Ratsnest's three and Show page limits are `PcbDrawOptions` fields.
 *  - Automatically refill zones is `ZONE_FILLER_TOOL`'s post-edit hook.
 *  - `<ESC> clears net highlighting` is the Escape handler's branch.
 */
import type { JSX } from 'react';
import { Check, Group, Num, Radio, Sel } from '../../../dialogs/prefs/widgets.js';
import { unitLabel } from '@ziroeda/common/src/eda_units.js';
import { ARC_EDIT_MODE_CHOICES } from '../../footprint/arc_edit_mode.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/**
 * `fgSizerCmdsWinLin` (`panel_edit_options_base.cpp:127-190`) — the non-macOS
 * table, since `m_mouseCmdsOSX` is `#ifdef __WXOSX_MAC__` and this port is not
 * that build.
 *
 * The Ctrl row is NOT here: in the board editor it is a pair of radio buttons
 * (`m_rbToggleSel` / `m_rbHighlightNet`) rather than a static string, because
 * Ctrl+click can be made to highlight a net instead of toggling the selection.
 * `m_rbHighlightNet->Show( false )` is what makes it a string in the footprint
 * editor.
 */
const MOUSE_COMMANDS: readonly (readonly [string, string])[] = [
  ['Click:', 'Select item(s)'],
  ['Long Click:', 'Clarify selection from menu'],
  ['Shift:', 'Add item(s) to selection'],
  ['Ctrl+Shift:', 'Remove item(s) from selection'],
];

/** `m_trackMouseDragCtrlChoices` (`_base.cpp:87`) — `TRACK_DRAG_ACTION`. */
const TRACK_DRAG_CHOICES: readonly (readonly [number, string])[] = [
  [0, 'Move'],
  [1, 'Drag (45 degree mode)'],
  [2, 'Drag (free angle)'],
];

/**
 * `m_magneticPadChoiceChoices` / `m_magneticTrackChoiceChoices` (`_base.cpp:342`,
 * `:356`) — `MAGNETIC_OPTIONS` (`pcbnew_settings.h:53-58`) in enum order, so
 * the selection index IS the stored value.
 */
const MAGNETIC_CHOICES: readonly (readonly [number, string])[] = [
  [0, 'Never'],
  [1, 'When routing tracks'],
  [2, 'Always'],
];

/**
 * `m_magneticGraphicsChoiceChoices` (`_base.cpp:370`) — Always/Never, and the
 * value stored is `!GetSelection()` (`panel_edit_options.cpp:205`). So row 0 is
 * `true`, which is the OPPOSITE way round from the two above it and is the one
 * thing on this page that cannot be read off the row order.
 */
const MAGNETIC_GRAPHICS_CHOICES: readonly (readonly [number, string])[] = [
  [1, 'Always'],
  [0, 'Never'],
];

/** `m_rbFlipLeftRight` / `m_rbFlipTopBottom` — `FLIP_DIRECTION`. */
const FLIP_CHOICES = [
  [1, 'Left/right'],
  [0, 'Top/bottom'],
] as const;

/** The Ctrl row's pair (`_base.cpp:183-186`), `m_rbToggleSel` first. */
const CTRL_CLICK_CHOICES = [
  [0, 'Toggle selection'],
  [1, 'Highlight net (for pads/tracks)'],
] as const;

/** The two `Add( 0, 3 )` spacers around a stacked label + choice. */
const STACK = { gap: 3, above: 3 };

export function PanelPcbEditingOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { pcbnew, upP } = ctx;
  const editing = pcbnew.editing;
  const display = pcbnew.pcb_display;
  const upE = (patch: Partial<typeof editing>): void =>
    upP((s) => {
      Object.assign(s.editing, patch);
    });
  const upD = (patch: Partial<typeof display>): void =>
    upP((s) => {
      Object.assign(s.pcb_display, patch);
    });

  return (
    <div className="ze-pref-columns ze-gutter-25">
      <div>
        <Group title="Editing Options">
          {/* `LEADER_MODE::DEG45` when checked and `DIRECT` when clear
              (`panel_edit_options.cpp:189-190`) — DEG90 is storable and not
              reachable from this control, exactly as upstream. */}
          <Check
            label="Constrain actions to H, V, 45 degrees"
            checked={editing.pcb_angle_snap_mode !== 0}
            borders={['top', 'bottom']}
            onChange={(v) => upE({ pcb_angle_snap_mode: v ? 1 : 0 })}
          />
          {/* A `UNIT_BINDER` on `EDA_UNITS::DEGREES`: a plain text entry with a
              unit label after it, not a spin control. The setting is TENTHS of
              a degree, as the `PARAM_LAMBDA` stores it. */}
          <Num
            label="Step for rotate commands:"
            value={editing.rotation_angle / 10}
            unit={unitLabel('degrees')}
            spin={false}
            width={60}
            title="Set increment (in degrees) for context menu and hotkey rotation."
            onChange={(v) => {
              // The setter ignores a stored 0 (`pcbnew_settings.cpp:210-214`),
              // upstream's guard against a file that would make every rotation
              // a no-op.
              const tenths = Math.round(v * 10);
              if (tenths !== 0) upE({ rotation_angle: tenths });
            }}
          />
          <Sel
            label="Arc editing mode:"
            ariaLabel="Arc editing mode"
            stacked={STACK}
            value={editing.arc_edit_mode}
            options={ARC_EDIT_MODE_CHOICES}
            onChange={(v) => upE({ arc_edit_mode: v })}
          />
          {/* `m_sizerBoardEdit`, `Show( !m_isFootprintEditor )` — the three
              controls the footprint editor's page does not have. They are in
              this group and not one of their own: the sizer is added straight
              to `bMiddleLeftSizer` with no heading and no rule of its own. */}
          <Sel
            label="Track mouse-drag mode:"
            ariaLabel="Track mouse-drag mode"
            stacked={STACK}
            value={editing.track_drag_action}
            options={TRACK_DRAG_CHOICES.map((c) => [c[0], c[1]] as [number, string])}
            onChange={(v) => upE({ track_drag_action: v as 0 | 1 | 2 })}
          />
          {/* `bSizerFlip`, a HORIZONTAL sizer: the label and both radios sit on
              one row, unlike every other radio group on this page. */}
          <Radio
            label="Flip board items:"
            row
            name="pcb-flip"
            value={editing.flip_left_right ? 1 : 0}
            options={FLIP_CHOICES}
            onChange={(v) => upE({ flip_left_right: v === 1 })}
          />
          <Check
            label="Allow free pads"
            title="If checked, pads can be moved with respect to the rest of the footprint."
            checked={editing.allow_free_pads}
            borders={['top', 'bottom']}
            onChange={(v) => upE({ allow_free_pads: v })}
          />
        </Group>
        <Group title="Left Click Mouse Commands">
          {/* `m_stHint1`, in `KIUI::GetSmallInfoFont( this ).Italic()`. */}
          <div className="ze-pref-hint">
            Left click (and drag) actions depend on 2 modifier keys:
            <br />
            Shift and Ctrl
          </div>
          <div className="ze-fp-mousecmds">
            {MOUSE_COMMANDS.map(([key, action]) => (
              <div key={key} className="ze-fp-mousecmd">
                <span>{key}</span>
                <span>{action}</span>
              </div>
            ))}
            {/* The Ctrl row: a label and a stacked radio pair, which is why it
                is not in the table above. */}
            <div className="ze-fp-mousecmd">
              <span>Ctrl:</span>
              <Radio
                name="pcb-ctrl-click"
                value={editing.ctrl_click_highlight ? 1 : 0}
                options={CTRL_CLICK_CHOICES}
                onChange={(v) => upE({ ctrl_click_highlight: v === 1 })}
              />
            </div>
          </div>
        </Group>
      </div>
      <div>
        <Group title="Magnetic Points">
          <Sel
            label="Snap to pads:"
            ariaLabel="Snap to pads"
            title="Capture cursor when the mouse enters a pad area"
            value={editing.magnetic_pads}
            options={MAGNETIC_CHOICES.map((c) => [c[0], c[1]] as [number, string])}
            onChange={(v) => upE({ magnetic_pads: v as 0 | 1 | 2 })}
          />
          <Sel
            label="Snap to tracks and vias:"
            ariaLabel="Snap to tracks and vias"
            title="Capture cursor when the mouse approaches a track"
            value={editing.magnetic_tracks}
            options={MAGNETIC_CHOICES.map((c) => [c[0], c[1]] as [number, string])}
            onChange={(v) => upE({ magnetic_tracks: v as 0 | 1 | 2 })}
          />
          <Sel
            label="Snap to graphics:"
            ariaLabel="Snap to graphics"
            title="Capture cursor when the mouse approaches graphical control points"
            value={editing.magnetic_graphics ? 1 : 0}
            options={MAGNETIC_GRAPHICS_CHOICES.map((c) => [c[0], c[1]] as [number, string])}
            onChange={(v) => upE({ magnetic_graphics: v === 1 })}
          />
        </Group>
        <Group title="Ratsnest">
          <Check
            label="Always show selected ratsnest"
            checked={display.ratsnest_footprint}
            borders={['top', 'bottom']}
            onChange={(v) => upD({ ratsnest_footprint: v })}
          />
          <Check
            label="Show ratsnest with curved lines"
            checked={display.ratsnest_curved}
            onChange={(v) => upD({ ratsnest_curved: v })}
          />
          {/* `wxSpinCtrlDouble( …, 0.5, 10, 0.5, 0.5 )` with `SetDigits( 1 )`
              (`_base.cpp:406-407`): min 0.5, max 10, initial 0.5, step 0.5. */}
          <Num
            label="Ratsnest line thickness:"
            value={display.ratsnest_thickness}
            min={0.5}
            max={10}
            step={0.5}
            digits={1}
            onChange={(v) => upD({ ratsnest_thickness: v })}
          />
        </Group>
        <Group title="Miscellaneous">
          <Check
            label="<ESC> clears net highlighting"
            checked={editing.esc_clears_net_highlight}
            borders={['top', 'bottom']}
            onChange={(v) => upE({ esc_clears_net_highlight: v })}
          />
          <Check
            label="Show page limits"
            title="Draw an outline to show the sheet size."
            checked={display.show_page_borders}
            onChange={(v) => upD({ show_page_borders: v })}
          />
          <Check
            label="Show courtyard collisions when moving/dragging"
            checked={editing.show_courtyard_collisions}
            onChange={(v) => upE({ show_courtyard_collisions: v })}
          />
          <Check
            label="Automatically refill zones"
            title="If checked, zones will be re-filled after each edit operation"
            checked={editing.auto_fill_zones}
            onChange={(v) => upE({ auto_fill_zones: v })}
          />
        </Group>
      </div>
    </div>
  );
}
