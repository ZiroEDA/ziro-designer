// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SPACEMOUSE` (common/dialogs/panel_spacemouse_base.cpp) — the
 * 3Dconnexion device page, added inside `#if defined(__linux__) ||
 * defined(__FreeBSD__)` (`common/eda_base_frame.cpp:1590-1596`), and the parity
 * target is a Linux build.
 *
 * One group, "Pan and Rotate", built as `m_gbSizer = new wxGridBagSizer( 1, 10 )`
 * — vgap 1, hgap 10 — with a slider in column 1 and everything else spanning
 * both columns:
 *
 *     (0,0) Rotation speed:        (0,1) m_rotationSpeed   wxSlider
 *     (1,0) Reverse rotation direction                     span 2
 *     (3,0) Pan speed:             (3,1) m_autoPanSpeed    wxSlider
 *     (4,0) Reverse vertical pan direction                 span 2
 *     (5,0) Reverse horizontal pan direction               span 2, wxTOP 3
 *     (7,0) Reverse zoom direction                         span 2
 *
 * Rows 2 and 6 are EMPTY, and that is the only thing holding "Pan speed:" and
 * "Reverse zoom direction" away from the rows above them.
 *
 * Everything here is drawn and disabled, and unlike most greyed controls in
 * this port these are not waiting on work. There is nothing to port.
 *
 * On the parity target a SpaceMouse reaches KiCad through libspnav, a client
 * of the `spacenavd` daemon over a UNIX domain socket
 * (`common/spacenav/libspnav_driver.cpp`, linked at
 * `common/CMakeLists.txt:332` and included by every 2D frame as
 * `spacenav/spnav_2d_plugin.h`). The Windows and macOS builds use
 * 3Dconnexion's 3dxware SDK through each app's `navlib` directory instead. A
 * page can open neither a UNIX socket nor a native SDK, and while WebHID could
 * in principle see the raw device, on Linux `spacenavd` has already claimed
 * it — and there would be no KiCad code to port, only a 6-DOF decoder invented
 * here.
 *
 * That last point is the decisive one for these six settings. Their ONLY
 * readers upstream are inside the spnav event callbacks —
 * `spnav_2d_plugin.cpp:78-105` and
 * `3d-viewer/3d_spacenav/spnav_viewer_plugin.cpp:68-93` — which fire only when
 * the daemon delivers a motion event. With no device there is no callback and
 * no reader, in KiCad exactly as here.
 *
 * Worth knowing before anyone tries: two of the six do nothing in a 2D editor
 * even in KiCad. `spnav_2d_plugin.cpp` reads `pan_speed`, `reverse_pan_x`,
 * `reverse_pan_y` and `reverse_zoom`, and never touches `rotate_speed` or
 * `reverse_rotate` — those two are the 3D viewer's alone
 * (`spnav_viewer_plugin.cpp:91-93`). KiCad still draws all six on this one
 * page, so we do too.
 *
 * The reason belongs HERE, in the source — it was on the page as a banner and
 * repeated in every control's tooltip, and KiCad has neither.
 *
 * The controls still bind to the stored settings rather than to literals: the
 * page is a `RESETTABLE_PANEL` upstream (`panel_spacemouse.cpp:61`), so its
 * footer button reads "Reset SpaceMouse to Defaults" and has to have something
 * to reset.
 */
import type { JSX } from 'react';
import { Check, Group } from '../widgets.js';
import { Slider } from '../../../ui/Slider.js';
import type { PrefsContext } from '../types.js';

export function PanelSpacemouse({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { common, upC } = ctx;
  const sm = common.spacemouse;

  return (
    /* `bSizer10->Add( bSizer1, 1, 0, 5 )` (`:80`) — proportion 1 with flags of
       ZERO, so the page takes its own best width and aligns left rather than
       stretching to the panel. The same construct as Mouse and Touchpad. */
    <div className="ze-pref-page-natural">
      <Group title="Pan and Rotate">
        <div className="ze-spacemouse-grid">
          <span className="lbl">Rotation speed:</span>
          <Slider
            min={1}
            max={10}
            value={sm.rotate_speed}
            /* `m_rotationSpeed->SetToolTip(…)` (`:40`) — upstream's own words,
               odd as they are for a rotation control. */
            title="How far to zoom in for each rotation of the mouse wheel"
            ariaLabel="Rotation speed"
            disabled
            onChange={(v) =>
              upC((s) => {
                s.spacemouse.rotate_speed = v;
              })
            }
          />
          {/* `wxGBSpan( 1, 2 )` — the checkboxes cross both columns. */}
          <div className="gb-span">
            <Check
              label="Reverse rotation direction"
              title="Swap the direction of rotation"
              checked={sm.reverse_rotate}
              disabled
              onChange={(v) =>
                upC((s) => {
                  s.spacemouse.reverse_rotate = v;
                })
              }
            />
          </div>
          {/* Row 2 of the grid bag sizer, which is empty. */}
          <div className="gb-empty" />
          <span className="lbl">Pan speed:</span>
          <Slider
            min={1}
            max={10}
            value={sm.pan_speed}
            title="How fast to pan when moving an object off the edge of the screen"
            ariaLabel="Pan speed"
            disabled
            onChange={(v) =>
              upC((s) => {
                s.spacemouse.pan_speed = v;
              })
            }
          />
          <div className="gb-span">
            <Check
              label="Reverse vertical pan direction"
              checked={sm.reverse_pan_y}
              disabled
              onChange={(v) =>
                upC((s) => {
                  s.spacemouse.reverse_pan_y = v;
                })
              }
            />
          </div>
          {/* `wxALIGN_CENTER_VERTICAL|wxTOP, 3` — the one row with a border of
              its own. */}
          <div className="gb-span gb-top3">
            <Check
              label="Reverse horizontal pan direction"
              checked={sm.reverse_pan_x}
              disabled
              onChange={(v) =>
                upC((s) => {
                  s.spacemouse.reverse_pan_x = v;
                })
              }
            />
          </div>
          {/* Row 6, empty. */}
          <div className="gb-empty" />
          <div className="gb-span">
            <Check
              label="Reverse zoom direction"
              checked={sm.reverse_zoom}
              disabled
              onChange={(v) =>
                upC((s) => {
                  s.spacemouse.reverse_zoom = v;
                })
              }
            />
          </div>
        </div>
      </Group>
    </div>
  );
}
