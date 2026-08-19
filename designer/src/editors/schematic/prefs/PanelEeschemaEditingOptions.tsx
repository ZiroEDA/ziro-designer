// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Editing Options —
 * `PANEL_EESCHEMA_EDITING_OPTIONS`
 * (`eeschema/dialogs/panel_eeschema_editing_options_base.cpp`), constructed by
 * eeschema for `PANEL_SCH_EDIT_OPTIONS` (`eeschema/eeschema.cpp:327`).
 *
 * Moved verbatim out of `prefs/PreferencesDialog.tsx`'s `switch (page)`;
 * no behaviour change.
 */
import type { JSX } from 'react';
import { Check, ColorRow, Group, Num, Sel } from '../../../dialogs/prefs/widgets.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { EESCHEMA_DEFAULTS } from '../../../prefs/settings.js';

export function PanelEeschemaEditingOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE } = ctx;
  return (
    <div className="ze-pref-columns">
      <div>
        <Group title="Editing">
          <Sel
            label="Line drawing mode:"
            value={eeschema.drawing.line_mode}
            options={[
              [0, 'Free Angle'],
              [1, '90 deg Angle'],
              [2, '45 deg Angle'],
            ]}
            onChange={(v) =>
              upE((s) => {
                s.drawing.line_mode = v as 0 | 1 | 2;
              })
            }
          />
          <Sel
            label="Arc editing mode:"
            value={eeschema.drawing.arc_edit_mode}
            options={[
              [0, 'Keep center, adjust radius'],
              [1, 'Keep endpoints or direction of starting point'],
              [2, 'Keep center and radius, adjust endpoints'],
            ]}
            onChange={(v) =>
              upE((s) => {
                s.drawing.arc_edit_mode = v as 0 | 1 | 2;
              })
            }
          />
          <Check
            label="Mouse drag performs Drag (G) operation"
            checked={!eeschema.input.drag_is_move}
            title="If unchecked, mouse drag will perform move (M) operation"
            onChange={(v) =>
              upE((s) => {
                s.input.drag_is_move = !v;
              })
            }
          />
          <Check
            label="Automatically start wires on unconnected pins"
            checked={eeschema.drawing.auto_start_wires}
            title="When enabled, you can start wiring by clicking on unconnected pins even when the wire tool is not active"
            onChange={(v) =>
              upE((s) => {
                s.drawing.auto_start_wires = v;
              })
            }
          />
          <Check
            label="<ESC> clears net highlighting"
            checked={eeschema.input.esc_clears_net_highlight}
            title="First <ESC> in selection tool clears selection, next clears net highlighting"
            onChange={(v) =>
              upE((s) => {
                s.input.esc_clears_net_highlight = v;
              })
            }
          />
          <Check
            label="Automatically annotate symbols"
            checked={eeschema.annotation.automatic}
            onChange={(v) =>
              upE((s) => {
                s.annotation.automatic = v;
              })
            }
          />
          <Check
            label="Allow unconstrained pin swaps"
            checked={eeschema.input.allow_unconstrained_pin_swaps}
            title="Allows swapping symbol pins' positions. May cause invalid design changes; use with caution."
            onChange={(v) =>
              upE((s) => {
                s.input.allow_unconstrained_pin_swaps = v;
              })
            }
          />
        </Group>
        <Group title="Defaults for New Objects">
          <ColorRow
            label="Sheet border:"
            value={eeschema.drawing.default_sheet_border_color}
            fallback="rgb(132, 0, 0)"
            onChange={(css) =>
              upE((s) => {
                s.drawing.default_sheet_border_color = css;
              })
            }
          />
          <ColorRow
            label="Sheet background:"
            value={eeschema.drawing.default_sheet_background_color}
            fallback="rgb(255, 255, 194)"
            onChange={(css) =>
              upE((s) => {
                s.drawing.default_sheet_background_color = css;
              })
            }
          />
          <Sel
            label="Power Symbols:"
            value={eeschema.drawing.new_power_symbols}
            options={[
              [0, 'Default'],
              [1, 'Global'],
              [2, 'Local'],
            ]}
            onChange={(v) =>
              upE((s) => {
                s.drawing.new_power_symbols = v as 0 | 1 | 2;
              })
            }
          />
        </Group>
        <Group title="Left Click Mouse Commands">
          <div className="ze-pref-hint">
            Left click (and drag) actions depend on 2 modifier keys: Shift and Ctrl
          </div>
          <table className="ze-pref-mouse">
            <tbody>
              <tr>
                <td>Long Click</td>
                <td>Clarify selection from menu</td>
              </tr>
              <tr>
                <td>Shift</td>
                <td>Add item(s) to selection</td>
              </tr>
              <tr>
                <td>Ctrl+Shift</td>
                <td>Remove item(s) from selection</td>
              </tr>
            </tbody>
          </table>
        </Group>
      </div>
      <div>
        <Group title="Symbol Field Automatic Placement">
          <Check
            label="Automatically place symbol fields"
            checked={eeschema.autoplace_fields.enable}
            onChange={(v) =>
              upE((s) => {
                s.autoplace_fields.enable = v;
              })
            }
          />
          <Check
            label="Allow field autoplace to change justification"
            checked={eeschema.autoplace_fields.allow_rejustify}
            onChange={(v) =>
              upE((s) => {
                s.autoplace_fields.allow_rejustify = v;
              })
            }
          />
          <Check
            label="Always align autoplaced fields to the 50 mil grid"
            checked={eeschema.autoplace_fields.align_to_grid}
            onChange={(v) =>
              upE((s) => {
                s.autoplace_fields.align_to_grid = v;
              })
            }
          />
        </Group>
        <Group title="Repeated Items">
          <Num
            label="Horizontal pitch:"
            value={eeschema.drawing.default_repeat_offset_x}
            unit="mils"
            onChange={(v) =>
              upE((s) => {
                s.drawing.default_repeat_offset_x = v;
              })
            }
          />
          <Num
            label="Vertical pitch:"
            value={eeschema.drawing.default_repeat_offset_y}
            unit="mils"
            onChange={(v) =>
              upE((s) => {
                s.drawing.default_repeat_offset_y = v;
              })
            }
          />
          <Num
            label="Label increment:"
            value={eeschema.drawing.repeat_label_increment}
            min={-10}
            max={10}
            onChange={(v) =>
              upE((s) => {
                s.drawing.repeat_label_increment = v;
              })
            }
          />
        </Group>
        <Group title="Dialog Preferences">
          <Check
            label="Show footprint previews in Symbol Chooser"
            checked={eeschema.appearance.footprint_preview}
            onChange={(v) =>
              upE((s) => {
                s.appearance.footprint_preview = v;
              })
            }
          />
          <Check
            label="Never show Rescue Symbols tool"
            checked={eeschema.system.never_show_rescue_dialog}
            onChange={(v) =>
              upE((s) => {
                s.system.never_show_rescue_dialog = v;
              })
            }
          />
        </Group>
      </div>
    </div>
  );
}

/** `RESETTABLE_PANEL::ResetPanel`: the eeschema settings back to EESCHEMA_SETTINGS' defaults. */
export function resetEeschemaEditingOptions(ctx: PrefsContext): void {
  ctx.setEeschema(structuredClone(EESCHEMA_DEFAULTS));
}
