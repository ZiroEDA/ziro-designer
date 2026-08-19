// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Mouse and Touchpad — `PANEL_MOUSE_SETTINGS`
 * (`common/dialogs/panel_mouse_settings_base.cpp`), added by the base frame
 * itself (`common/eda_base_frame.cpp:1585-1589`).
 *
 * Moved verbatim out of the Preferences dialog's `switch (page)` (as it stood
 * no behaviour change. The three option tables came with it — they were
 * declared in the dialog but read only here.
 */
import type { JSX } from 'react';
import { Check, Group, Sel } from '../widgets.js';
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
const scrollCols: [ScrollModifier, string][] = [
  ['none', '--'],
  ['ctrl', 'Ctrl'],
  ['shift', 'Shift'],
  ['alt', 'Alt'],
];

export function PanelMouseSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { common, upC } = ctx;
  return (
    <>
      <Group title="Pan and Zoom">
        <Check
          label="Center and warp cursor on zoom"
          title="Center the cursor on screen when zooming."
          checked={common.input.center_on_zoom}
          onChange={(v) =>
            upC((s) => {
              s.input.center_on_zoom = v;
            })
          }
        />
        <Check
          label="Automatically pan while moving object"
          title="When drawing a track or moving an item, pan when approaching the edge of the display."
          checked={common.input.auto_pan}
          onChange={(v) =>
            upC((s) => {
              s.input.auto_pan = v;
            })
          }
        />
        <Check
          label="Use zoom acceleration"
          title="Zoom faster when scrolling quickly"
          checked={common.input.zoom_acceleration}
          onChange={(v) =>
            upC((s) => {
              s.input.zoom_acceleration = v;
            })
          }
        />
        <div className="ze-pref-row">
          <span className="lbl">Zoom speed:</span>
          <input
            type="range"
            min={1}
            max={10}
            value={common.input.zoom_speed}
            disabled={common.input.zoom_speed_auto}
            onChange={(e) =>
              upC((s) => {
                s.input.zoom_speed = Number(e.target.value);
              })
            }
          />
          <Check
            label="Automatic"
            checked={common.input.zoom_speed_auto}
            onChange={(v) =>
              upC((s) => {
                s.input.zoom_speed_auto = v;
              })
            }
          />
        </div>
        <div className="ze-pref-row">
          <span className="lbl">Auto pan speed:</span>
          <input
            type="range"
            min={1}
            max={9}
            value={common.input.auto_pan_acceleration}
            onChange={(e) =>
              upC((s) => {
                s.input.auto_pan_acceleration = Number(e.target.value);
              })
            }
          />
        </div>
      </Group>
      <Group title="Drag Gestures">
        <Sel
          label="Left button drag:"
          value={common.input.mouse_left}
          options={mouseActionOpts}
          onChange={(v) =>
            upC((s) => {
              s.input.mouse_left = v;
            })
          }
        />
        <Sel
          label="Middle button drag:"
          value={common.input.mouse_middle}
          options={panZoomNone}
          onChange={(v) =>
            upC((s) => {
              s.input.mouse_middle = v;
            })
          }
        />
        <Sel
          label="Right button drag:"
          value={common.input.mouse_right}
          options={panZoomNone}
          onChange={(v) =>
            upC((s) => {
              s.input.mouse_right = v;
            })
          }
        />
      </Group>
      <Group title="Scroll Gestures">
        <div className="ze-muted">
          Vertical touchpad or scroll wheel movement, only one action can be assigned to each
          column:
        </div>
        <table className="ze-pref-scrolltable">
          <thead>
            <tr>
              <th></th>
              {scrollCols.map(([, l]) => (
                <th key={l}>{l}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Zoom:</td>
              {scrollCols.map(([v]) => (
                <td key={v}>
                  <input
                    type="radio"
                    name="scroll-zoom"
                    checked={common.input.scroll_modifier_zoom === v}
                    onChange={() =>
                      upC((s) => {
                        s.input.scroll_modifier_zoom = v;
                      })
                    }
                  />
                </td>
              ))}
              <td>
                <Check
                  label="Reverse"
                  checked={common.input.reverse_scroll_zoom}
                  onChange={(v) =>
                    upC((s) => {
                      s.input.reverse_scroll_zoom = v;
                    })
                  }
                />
              </td>
            </tr>
            <tr>
              <td>Pan up/down:</td>
              {scrollCols.map(([v]) => (
                <td key={v}>
                  <input
                    type="radio"
                    name="scroll-panv"
                    checked={common.input.scroll_modifier_pan_v === v}
                    onChange={() =>
                      upC((s) => {
                        s.input.scroll_modifier_pan_v = v;
                      })
                    }
                  />
                </td>
              ))}
              <td></td>
            </tr>
            <tr>
              <td>Pan left/right:</td>
              {scrollCols.map(([v]) => (
                <td key={v}>
                  <input
                    type="radio"
                    name="scroll-panh"
                    checked={common.input.scroll_modifier_pan_h === v}
                    onChange={() =>
                      upC((s) => {
                        s.input.scroll_modifier_pan_h = v;
                      })
                    }
                  />
                </td>
              ))}
              <td>
                <Check
                  label="Reverse"
                  checked={common.input.reverse_scroll_pan_h}
                  onChange={(v) =>
                    upC((s) => {
                      s.input.reverse_scroll_pan_h = v;
                    })
                  }
                />
              </td>
            </tr>
          </tbody>
        </table>
        <Check
          label="Pan left/right with horizontal movement"
          title="Pan the canvas left and right when scrolling left to right on the touchpad"
          checked={common.input.horizontal_pan}
          onChange={(v) =>
            upC((s) => {
              s.input.horizontal_pan = v;
            })
          }
        />
        <div className="ze-pref-row">
          <button
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
      </Group>
    </>
  );
}
