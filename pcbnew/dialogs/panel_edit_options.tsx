// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_EDIT_OPTIONS` (`pcbnew/dialogs/panel_edit_options.cpp` and its
 * `_base.cpp`): ONE class both pcbnew frames build, told apart by
 * `isFootprintEditor`. It is written here as the two pages' bodies in the file
 * upstream keeps them in, each under the header it had as a module of its own,
 * plus `FOOTPRINT_EDITOR_SETTINGS::m_ArcEditMode` which the footprint page
 * loads and stores.
 *
 * The pages read the Preferences working copy through the narrow structural
 * contexts below; the app's `PrefsContext` satisfies both and this module
 * names nothing of the designer.
 */
import { useSyncExternalStore, type JSX } from 'react';
import { Check, Group, Num, Radio, Sel } from '@ziroeda/common/wx/controls.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';

// ---------------------------------------------------------------------------
// FOOTPRINT_EDITOR_SETTINGS::m_ArcEditMode, session only
// ---------------------------------------------------------------------------
/**
 * `FOOTPRINT_EDITOR_SETTINGS::m_ArcEditMode` — a member of the settings object
 * that is **not one of its params**, and therefore never reaches the file.
 *
 * This is upstream's, not ours. The constructor seeds it
 * (`pcbnew/footprint_editor_settings.cpp:56`), `PANEL_EDIT_OPTIONS` loads and
 * stores it in the footprint branch like any other control
 * (`panel_edit_options.cpp:150`, `:177`), and `EDIT_TOOL`'s point editor reads
 * it — but `m_params.emplace_back( … "editing.arc_edit_mode" … )` appears only
 * in `PCBNEW_SETTINGS` (`pcbnew_settings.cpp:183-185`). So in the Footprint
 * Editor the choice applies for the session and is back to
 * `KEEP_CENTER_ADJUST_ANGLE_RADIUS` at the next launch.
 *
 * A key in `fpedit.json` would be a different settings file from KiCad's, and
 * greying the control would be a different dialog. A module-level value with a
 * subscription is the third thing: the same lifetime the C++ member has, which
 * is the frame's, and something outside the Preferences dialog reads it.
 *
 * Not in `prefs/settings.ts` because everything there is persisted; that is the
 * whole contract of that module.
 */

/**
 * `ARC_EDIT_MODE` (`include/tool/edit_points.h`), in the order
 * `arcEditModeToComboIndex` maps it to the wxChoice
 * (`panel_edit_options.cpp:75-98`): the enum's own order and the combo's agree,
 * which is why upstream can cast between them and still writes the two
 * switches out.
 */
export type ArcEditMode = 0 | 1 | 2;

/** `m_arcEditModeChoices` (`panel_edit_options_base.cpp:66-69`), verbatim. */
export const ARC_EDIT_MODE_CHOICES: [ArcEditMode, string][] = [
  [0, 'Keep center, adjust radius'],
  [1, 'Keep endpoints or direction of starting point'],
  [2, 'Keep center and radius, adjust endpoints'],
];

/** `ARC_EDIT_MODE::KEEP_CENTER_ADJUST_ANGLE_RADIUS`, the constructor's seed. */
export const DEFAULT_ARC_EDIT_MODE: ArcEditMode = 0;

let mode: ArcEditMode = DEFAULT_ARC_EDIT_MODE;
const listeners = new Set<() => void>();

/** The current mode, for a non-React reader (the point editor). */
export function sessionArcEditMode(): ArcEditMode {
  return mode;
}

/** `PANEL_EDIT_OPTIONS::TransferDataFromWindow`'s one line for this control. */
export function setSessionArcEditMode(next: ArcEditMode): void {
  if (next === mode) return;
  mode = next;
  for (const l of listeners) l();
}

/** `ResetPanel`: default-construct a `FOOTPRINT_EDITOR_SETTINGS` and reload. */
export function resetSessionArcEditMode(): void {
  setSessionArcEditMode(DEFAULT_ARC_EDIT_MODE);
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The React binding, so the page and the canvas see the same value. */
export function useSessionArcEditMode(): ArcEditMode {
  return useSyncExternalStore(subscribe, sessionArcEditMode, sessionArcEditMode);
}

// ---------------------------------------------------------------------------
// The PCB Editor's page
// ---------------------------------------------------------------------------
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

/** The `PCBNEW_SETTINGS` members this page reads. */
export interface PANEL_EDIT_OPTIONS_PCB_SLICE {
  editing: {
    pcb_angle_snap_mode: number;
    rotation_angle: number;
    arc_edit_mode: number;
    track_drag_action: number;
    flip_left_right: boolean;
    allow_free_pads: boolean;
    ctrl_click_highlight: boolean;
    magnetic_pads: number;
    magnetic_tracks: number;
    magnetic_graphics: boolean;
    esc_clears_net_highlight: boolean;
    show_courtyard_collisions: boolean;
    auto_fill_zones: boolean;
  };
  pcb_display: {
    ratsnest_footprint: boolean;
    ratsnest_curved: boolean;
    ratsnest_thickness: number;
    show_page_borders: boolean;
  };
}

export interface PANEL_EDIT_OPTIONS_PCB_CTX {
  pcbnew: PANEL_EDIT_OPTIONS_PCB_SLICE;
  upP: (fn: (s: PANEL_EDIT_OPTIONS_PCB_SLICE) => void) => void;
}

export function PanelPcbEditingOptions({ ctx }: { ctx: PANEL_EDIT_OPTIONS_PCB_CTX }): JSX.Element {
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

// ---------------------------------------------------------------------------
// The Footprint Editor's page
// ---------------------------------------------------------------------------
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

/**
 * `fgSizerCmdsWinLin` (`panel_edit_options_base.cpp:127-190`) — the non-macOS
 * table, since `m_mouseCmdsOSX` is `#ifdef __WXOSX_MAC__` and this port is not
 * that build. The Ctrl row's second radio, "Highlight net (for pads/tracks)",
 * is `Show( false )` in the footprint editor and so is not here at all.
 */
const FP_MOUSE_COMMANDS: readonly (readonly [string, string])[] = [
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

/** The `FOOTPRINT_EDITOR_SETTINGS` members this page reads. */
export interface PANEL_EDIT_OPTIONS_FP_SLICE {
  editing: {
    fp_angle_snap_mode: number;
    rotation_angle: number;
    magnetic_pads: number;
    magnetic_graphics: boolean;
  };
}

export interface PANEL_EDIT_OPTIONS_FP_CTX {
  fpEdit: PANEL_EDIT_OPTIONS_FP_SLICE;
  upFp: (fn: (s: PANEL_EDIT_OPTIONS_FP_SLICE) => void) => void;
}

export function PanelFpEditingOptions({ ctx }: { ctx: PANEL_EDIT_OPTIONS_FP_CTX }): JSX.Element {
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
            {FP_MOUSE_COMMANDS.map(([key, action]) => (
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
