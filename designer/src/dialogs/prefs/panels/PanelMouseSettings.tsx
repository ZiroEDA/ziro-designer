// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Mouse and Touchpad — `PANEL_MOUSE_SETTINGS`
 * (`common/dialogs/panel_mouse_settings_base.cpp`), added by the base frame
 * itself (`common/eda_base_frame.cpp:1585-1589`).
 *
 * Three groups, and none of the three is a plain stack of rows — which is what
 * this port drew:
 *
 *   * **Pan and Zoom** is `gbSizer1`, a `wxGridBagSizer` two columns wide with
 *     a 30 px spacer between them (`:31-88`). "Center and warp cursor on zoom"
 *     and "Automatically pan while moving object" share row 0; "Use zoom
 *     acceleration" spans all three cells of row 1; and row 2 carries the two
 *     slider sizers side by side, Zoom speed at (2,0) and Auto pan speed at
 *     (2,2).
 *   * **Drag Gestures** is `fgSizer1`, a `wxFlexGridSizer( 0, 3, 5, 5 )` of
 *     label / choice / spacer (`:117-172`). Every choice carries `wxEXPAND`, so
 *     they all take the width of the widest — which is why KiCad's four combos
 *     are one width and ours were three.
 *   * **Scroll Gestures** is `bMargins`, horizontal: the label, the modifier
 *     grid and the horizontal-pan checkbox on the left, and the two Reset
 *     buttons stacked at the RIGHT (`:315-338`). Ours put them underneath.
 *
 * The fourth Drag Gestures row was missing entirely: "Pan on mouse movement
 * with key", `m_choicePanMoveKey` (`:161-169`), whose four choices are None /
 * Alt / Ctrl / Shift.
 *
 * The label beside the group text is `m_scrollWarning`, a `wxStaticBitmap` of
 * `BITMAPS::small_warning` that is hidden until two scroll rows claim the same
 * modifier (`panel_mouse_settings.cpp:50-51`, `:295`, `:330-333`). Ours instead
 * folded the warning's TOOLTIP into the label text, so the sentence was always
 * on screen and the condition it warns about was never shown.
 */
import type { JSX } from 'react';
import { Check, Group } from '../widgets.js';
import { Combo } from '../../../ui/Combo.js';
import { Slider } from '../../../ui/Slider.js';
import { bitmapUrl } from '../../../ui/toolbarIcons.js';
import type { PrefsContext } from '../types.js';
import type { MouseDragAction, ScrollModifier } from '../../../prefs/settings.js';

const mouseActionOpts: [MouseDragAction, string][] = [
  ['select', 'Draw selection rectangle'],
  ['drag_selected', 'Drag selected objects; otherwise draw selection rectangle'],
  ['drag_any', 'Drag any object (selected or not)'],
];
const panZoomNone: [MouseDragAction, string][] = [
  ['pan', 'Pan'],
  ['zoom', 'Zoom'],
  ['none', 'None'],
];
/** `m_choicePanMoveKeyChoices[] = { None, Alt, Ctrl, Shift }` (`:165`). */
const panMoveKeyOpts: [ScrollModifier, string][] = [
  ['none', 'None'],
  ['alt', 'Alt'],
  ['ctrl', 'Ctrl'],
  ['shift', 'Shift'],
];
const scrollCols: [ScrollModifier, string][] = [
  ['none', '--'],
  ['ctrl', 'Ctrl'],
  ['shift', 'Shift'],
  ['alt', 'Alt'],
];

/**
 * `isScrollModSetValid` (`panel_mouse_settings.cpp:330-333`):
 *
 *     return ( aSet.zoom != aSet.panh && aSet.panh != aSet.panv
 *              && aSet.panv != aSet.zoom );
 *
 * Exported so the rule can be tested without a DOM.
 */
export function isScrollModSetValid(zoom: string, panH: string, panV: string): boolean {
  return zoom !== panH && panH !== panV && panV !== zoom;
}

/** One row of the scroll-modifier grid: a label and its four radio cells. */
function ScrollRow({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: ScrollModifier;
  onChange: (v: ScrollModifier) => void;
}): JSX.Element {
  return (
    <>
      <span className="lbl">{label}</span>
      {scrollCols.map(([v]) => (
        // A `wxRadioButton` with an EMPTY label (`:245-255`): the column
        // heading above it is the only text, so the button is the cell.
        <label key={v} className="ze-pref-radio">
          <input
            type="radio"
            name={name}
            aria-label={`${label} ${v}`}
            checked={value === v}
            onChange={() => onChange(v)}
          />
        </label>
      ))}
    </>
  );
}

export function PanelMouseSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { common, upC } = ctx;
  const input = common.input;
  const warn = !isScrollModSetValid(
    input.scroll_modifier_zoom,
    input.scroll_modifier_pan_h,
    input.scroll_modifier_pan_v,
  );

  return (
    /* `bSizer10->Add( bSizer1, 1, 0, 5 )` (`panel_mouse_settings_base.cpp:340`)
       — proportion 1 and flags of ZERO. No wxEXPAND, so the page's content is
       NOT stretched to the width of the panel it sits in: it takes its own best
       width and aligns left, which is why KiCad's Reset buttons stop level with
       the Drag Gestures combos and leave the rest of the page empty. Ours had
       them pinned to the far right edge, because a block element fills its
       parent. */
    <div className="ze-pref-page-natural">
      <Group title="Pan and Zoom">
        {/* `gbSizer1` — two columns of controls with `Add( 30, 0, wxGBPosition( 0, 1 ) )`
            between them. */}
        <div className="ze-mouse-panzoom">
          {/* Dead: upstream this is `m_warpCursor`
              (`wx_view_controls.cpp:177`), and `onWheel` acts on it at `:472`
              — `IsCursorWarpingEnabled()` recentres the view on the cursor's
              world point and then WARPS the pointer to the middle of the
              canvas. A page cannot move the pointer, so only half of that is
              reachable here and `wheelAction` implements neither: it zooms
              about the cursor whatever this says. */}
          <Check
            label="Center and warp cursor on zoom"
            title="Center the cursor on screen when zooming."
            checked={input.center_on_zoom}
            disabled
            onChange={(v) =>
              upC((s) => {
                s.input.center_on_zoom = v;
              })
            }
          />
          {/* (0,2). Dead: nothing reads `input.auto_pan`. Upstream the view
              controls pan when a drag approaches the edge of the canvas
              (`WX_VIEW_CONTROLS::handleAutoPanning`); ours have no autopan
              timer at all, and the speed below it feeds the same absent code. */}
          <div className="gb-col3">
            <Check
              label="Automatically pan while moving object"
              title="When drawing a track or moving an item, pan when approaching the edge of the display."
              checked={input.auto_pan}
              disabled
              onChange={(v) =>
                upC((s) => {
                  s.input.auto_pan = v;
                })
              }
            />
          </div>
          {/* (1,0) spanning all three: `wxGBSpan( 1, 3 )`.

              LIVE. `input.zoom_acceleration` is the second of the three values
              `WX_VIEW_CONTROLS::LoadSettings` branches on when it builds
              `m_zoomController` (`wx_view_controls.cpp:196-214`), and
              `ui/view_controls.ts`'s `zoomControllerFor` is that branch:
              ACCELERATING_ZOOM_CONTROLLER instead of the constant one. It was
              greyed while only the constant controller existed here.

              Ticking it does nothing while `Automatic` above is also ticked,
              and that is upstream's behaviour on this platform rather than an
              omission: `GetZoomControllerForPlatform` (`:55-71`) returns a
              CONSTANT_ZOOM_CONTROLLER on GTK3 without consulting the flag at
              all. The control stays enabled because KiCad's is — it is the
              Automatic box that decides whether this one is consulted, not
              the port. */}
          <div className="gb-span">
            <Check
              label="Use zoom acceleration"
              title="Zoom faster when scrolling quickly"
              checked={input.zoom_acceleration}
              onChange={(v) =>
                upC((s) => {
                  s.input.zoom_acceleration = v;
                })
              }
            />
          </div>
          {/* `m_zoomSizer` at (2,0): label, slider, "Automatic". */}
          <div className="ze-mouse-slider">
            <span className="lbl">Zoom speed:</span>
            <Slider
              min={1}
              max={10}
              value={input.zoom_speed}
              title="How far to zoom in for each rotation of the mouse wheel"
              ariaLabel="Zoom speed"
              /* `m_zoomSpeed->Enable( !m_checkAutoZoomSpeed->GetValue() )`
                 (`panel_mouse_settings.cpp:56`, `:161`) — the checkbox beside
                 it owns this, and the LABEL stays lit either way, because wx
                 disables the slider and not the wxStaticText. */
              disabled={input.zoom_speed_auto}
              onChange={(v) =>
                upC((s) => {
                  s.input.zoom_speed = v;
                })
              }
            />
            <Check
              label="Automatic"
              title="Pick the zoom speed automatically"
              checked={input.zoom_speed_auto}
              onChange={(v) =>
                upC((s) => {
                  s.input.zoom_speed_auto = v;
                })
              }
            />
          </div>
          {/* `m_panSizer` at (2,2). Dead with the checkbox above it. */}
          <div className="ze-mouse-slider gb-col3">
            <span className="lbl">Auto pan speed:</span>
            <Slider
              min={1}
              max={10}
              value={input.auto_pan_acceleration}
              title="How fast to pan when moving an object off the edge of the screen"
              ariaLabel="Auto pan speed"
              disabled
              onChange={(v) =>
                upC((s) => {
                  s.input.auto_pan_acceleration = v;
                })
              }
            />
          </div>
        </div>
      </Group>
      <Group title="Drag Gestures">
        {/* `fgSizer1`, three columns: label, choice at wxEXPAND, and a
            proportion-1 spacer that absorbs the slack so the choices do not. */}
        <div className="ze-mouse-drag">
          <span className="lbl">Left button drag:</span>
          <Combo
            value={input.mouse_left}
            options={mouseActionOpts.map(([v, l]) => ({ value: v, label: l }))}
            ariaLabel="Left button drag"
            onChange={(v) =>
              upC((s) => {
                s.input.mouse_left = v as MouseDragAction;
              })
            }
          />
          <span />
          <span className="lbl">Middle button drag:</span>
          <Combo
            value={input.mouse_middle}
            options={panZoomNone.map(([v, l]) => ({ value: v, label: l }))}
            ariaLabel="Middle button drag"
            onChange={(v) =>
              upC((s) => {
                s.input.mouse_middle = v as MouseDragAction;
              })
            }
          />
          <span />
          <span className="lbl">Right button drag:</span>
          <Combo
            value={input.mouse_right}
            options={panZoomNone.map(([v, l]) => ({ value: v, label: l }))}
            ariaLabel="Right button drag"
            onChange={(v) =>
              upC((s) => {
                s.input.mouse_right = v as MouseDragAction;
              })
            }
          />
          <span />
          {/* Dead: `input.motion_pan_modifier` is read by
              `WX_VIEW_CONTROLS::LoadSettings` (`wx_view_controls.cpp:193`) and
              nothing here — our view controls pan on a drag, never on a bare
              move with a key held. */}
          <span className="lbl">Pan on mouse movement with key:</span>
          <Combo
            value={input.motion_pan_modifier}
            disabled
            options={panMoveKeyOpts.map(([v, l]) => ({ value: v, label: l }))}
            ariaLabel="Pan on mouse movement with key"
            onChange={(v) =>
              upC((s) => {
                s.input.motion_pan_modifier = v as ScrollModifier;
              })
            }
          />
          <span />
        </div>
      </Group>
      <Group title="Scroll Gestures">
        {/* `bMargins`: the settings at proportion 1, the two buttons at 0. */}
        <div className="ze-mouse-scroll">
          <div>
            {/* `bSizer4`: the label, then `m_scrollWarning` — hidden until two
                rows claim one modifier. */}
            <div className="ze-mouse-scroll-head">
              <span>Vertical touchpad or scroll wheel movement:</span>
              {warn && (
                <img
                  src={bitmapUrl('small_warning')}
                  alt=""
                  title="Only one action can be assigned to each column"
                />
              )}
            </div>
            {/* `fgSizer2 = new wxFlexGridSizer( 0, 6, 8, 0 )` — six columns
                (label, --, Ctrl, Shift, Alt, Reverse) and a vgap of 8. */}
            <div className="ze-mouse-scrollgrid">
              <span />
              {scrollCols.map(([, l]) => (
                <span key={l} className="col-head">
                  {l}
                </span>
              ))}
              <span />
              <ScrollRow
                label="Zoom:"
                name="scroll-zoom"
                value={input.scroll_modifier_zoom}
                onChange={(v) =>
                  upC((s) => {
                    s.input.scroll_modifier_zoom = v;
                  })
                }
              />
              <Check
                label="Reverse"
                checked={input.reverse_scroll_zoom}
                onChange={(v) =>
                  upC((s) => {
                    s.input.reverse_scroll_zoom = v;
                  })
                }
              />
              <ScrollRow
                label="Pan up/down:"
                name="scroll-panv"
                value={input.scroll_modifier_pan_v}
                onChange={(v) =>
                  upC((s) => {
                    s.input.scroll_modifier_pan_v = v;
                  })
                }
              />
              <span />
              <ScrollRow
                label="Pan left/right:"
                name="scroll-panh"
                value={input.scroll_modifier_pan_h}
                onChange={(v) =>
                  upC((s) => {
                    s.input.scroll_modifier_pan_h = v;
                  })
                }
              />
              <Check
                label="Reverse"
                checked={input.reverse_scroll_pan_h}
                onChange={(v) =>
                  upC((s) => {
                    s.input.reverse_scroll_pan_h = v;
                  })
                }
              />
            </div>
            {/* Enabled, and it does nothing — in KiCad either. `m_horizontalPan`
                is loaded (`wx_view_controls.cpp:181`, `draw_panel_gal.cpp:825`)
                and read by nothing: `onWheel` pans horizontally for a native
                horizontal wheel event whatever it says, and its own comment at
                `:424` describes a modifier branch the code does not have. Ours
                behaves the same way for the same reason, so the box stays as
                upstream draws it. Greying it here would be OUR divergence. */}
            <Check
              label="Pan left/right with horizontal movement"
              title="Pan the canvas left and right when scrolling left to right on the touchpad"
              checked={input.horizontal_pan}
              onChange={(v) =>
                upC((s) => {
                  s.input.horizontal_pan = v;
                })
              }
            />
          </div>
          {/* `bSizerRight`: both buttons `wxEXPAND`, so they are one width. */}
          <div className="ze-pref-buttoncol">
            <button
              type="button"
              className="ze-btn"
              onClick={() =>
                upC((s) => {
                  s.input.scroll_modifier_zoom = 'none';
                  s.input.scroll_modifier_pan_h = 'ctrl';
                  s.input.scroll_modifier_pan_v = 'shift';
                  s.input.reverse_scroll_zoom = false;
                  s.input.reverse_scroll_pan_h = false;
                  s.input.horizontal_pan = false;
                })
              }
            >
              Reset to Mouse Defaults
            </button>
            <button
              type="button"
              className="ze-btn"
              onClick={() =>
                upC((s) => {
                  s.input.scroll_modifier_zoom = 'ctrl';
                  s.input.scroll_modifier_pan_h = 'shift';
                  s.input.scroll_modifier_pan_v = 'none';
                  s.input.horizontal_pan = true;
                })
              }
            >
              Reset to Trackpad Defaults
            </button>
          </div>
        </div>
      </Group>
    </div>
  );
}
