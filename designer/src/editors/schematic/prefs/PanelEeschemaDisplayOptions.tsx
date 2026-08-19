// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Display Options — `PANEL_EESCHEMA_DISPLAY_OPTIONS`
 * (`eeschema/dialogs/panel_eeschema_display_options_base.cpp`, plus the GAL
 * options), constructed by eeschema itself for `PANEL_SCH_DISP_OPTIONS`
 * (`eeschema/eeschema.cpp:307-308`). Owned by this editor, reached from the
 * dialog only through the id.
 *
 * Moved verbatim out of the Preferences dialog's `switch (page)` (as it stood
 * at 5d6a2f40, in prefs/PreferencesDialog.tsx); no behaviour change.
 */
import type { JSX } from 'react';
import { Check, Group, Num, Sel } from '../../../dialogs/prefs/widgets.js';
import { CrossProbingGroup } from '../../../dialogs/prefs/CrossProbingGroup.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelEeschemaDisplayOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE } = ctx;
  return (
    <div className="ze-pref-columns">
      <div>
        <Group title="Grid Display">
          <Sel
            label="Style:"
            value={eeschema.window.grid.style}
            options={[
              ['dots', 'Dots'],
              ['lines', 'Lines'],
              ['crosses', 'Small crosses'],
            ]}
            onChange={(v) =>
              upE((s) => {
                s.window.grid.style = v;
              })
            }
          />
          <Num
            label="Grid thickness:"
            value={eeschema.window.grid.line_width}
            unit="pixels"
            min={1}
            max={5}
            onChange={(v) =>
              upE((s) => {
                s.window.grid.line_width = v;
              })
            }
          />
          <Num
            label="Minimum grid spacing:"
            value={eeschema.window.grid.min_spacing}
            unit="pixels"
            min={2}
            max={50}
            onChange={(v) =>
              upE((s) => {
                s.window.grid.min_spacing = v;
              })
            }
          />
          <Sel
            label="Snap to grid:"
            value={eeschema.window.grid.snap}
            options={[
              [0, 'Always'],
              [1, 'When grid shown'],
              [2, 'Never'],
            ]}
            onChange={(v) =>
              upE((s) => {
                s.window.grid.snap = v as 0 | 1 | 2;
              })
            }
          />
        </Group>
        <Group title="Cursor">
          <Sel
            label="Crosshair:"
            value={eeschema.window.cursor.crosshair}
            options={[
              ['small', 'Small crosshairs'],
              ['full', 'Full window crosshairs'],
              ['45', '45° full window crosshairs'],
            ]}
            onChange={(v) =>
              upE((s) => {
                s.window.cursor.crosshair = v;
              })
            }
          />
          <Check
            label="Always show crosshairs"
            checked={eeschema.window.cursor.always_show_cursor}
            onChange={(v) =>
              upE((s) => {
                s.window.cursor.always_show_cursor = v;
              })
            }
          />
        </Group>
        <CrossProbingGroup
          peer="pcb"
          value={eeschema.cross_probing}
          onChange={(fn) => upE((s) => fn(s.cross_probing))}
          note="(These govern probes arriving in the schematic from the board — Select on
                Schematic and PCB net highlight. That direction is not implemented yet, so
                they are stored but inert; the board's own copy, which governs Select on
                PCB, is under PCB Editor > Display Options.)"
        />
      </div>
      <div>
        <Group title="Appearance">
          <Sel
            label="Default font:"
            value={eeschema.appearance.default_font}
            options={[['KiCad Font', 'KiCad Font']]}
            onChange={(v) =>
              upE((s) => {
                s.appearance.default_font = v;
              })
            }
          />
          <Check
            label="Show hidden pins"
            checked={eeschema.appearance.show_hidden_pins}
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_hidden_pins = v;
              })
            }
          />
          <Check
            label="Show hidden fields"
            checked={eeschema.appearance.show_hidden_fields}
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_hidden_fields = v;
              })
            }
          />
          <Check
            label="Show ERC errors"
            checked={eeschema.appearance.show_erc_errors}
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_erc_errors = v;
              })
            }
          />
          <Check
            label="Show ERC warnings"
            checked={eeschema.appearance.show_erc_warnings}
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_erc_warnings = v;
              })
            }
          />
          <Check
            label="Show ERC exclusions"
            checked={eeschema.appearance.show_erc_exclusions}
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_erc_exclusions = v;
              })
            }
          />
          <Check
            label="Mark items which are excluded from simulation"
            checked={eeschema.appearance.mark_sim_exclusions}
            onChange={(v) =>
              upE((s) => {
                s.appearance.mark_sim_exclusions = v;
              })
            }
          />
          <Check
            label="Show OP voltages"
            checked={eeschema.appearance.show_op_voltages}
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_op_voltages = v;
              })
            }
          />
          <Check
            label="Show OP currents"
            checked={eeschema.appearance.show_op_currents}
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_op_currents = v;
              })
            }
          />
          <Check
            label="Show pin alternate mode indicator icons"
            checked={eeschema.appearance.show_pin_alt_icons}
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_pin_alt_icons = v;
              })
            }
          />
          <Check
            label="Show page limits"
            checked={eeschema.appearance.show_page_limits}
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_page_limits = v;
              })
            }
          />
        </Group>
        <Group title="Selection & Highlighting">
          <Check
            label="Draw selected child items"
            checked={eeschema.selection.draw_selected_children}
            onChange={(v) =>
              upE((s) => {
                s.selection.draw_selected_children = v;
              })
            }
          />
          <Check
            label="Fill selected shapes"
            checked={eeschema.selection.fill_shapes}
            onChange={(v) =>
              upE((s) => {
                s.selection.fill_shapes = v;
              })
            }
          />
          <Num
            label="Selection thickness:"
            value={eeschema.selection.thickness}
            unit="mils"
            min={0}
            max={50}
            onChange={(v) =>
              upE((s) => {
                s.selection.thickness = v;
              })
            }
          />
          <div className="ze-muted">(selection color can be edited in the "Colors" page)</div>
          <Num
            label="Highlight thickness:"
            value={eeschema.selection.highlight_thickness}
            unit="mils"
            min={0}
            max={50}
            onChange={(v) =>
              upE((s) => {
                s.selection.highlight_thickness = v;
              })
            }
          />
          <Check
            label="Highlight netclass colors"
            checked={eeschema.selection.highlight_netclass_colors}
            onChange={(v) =>
              upE((s) => {
                s.selection.highlight_netclass_colors = v;
              })
            }
          />
          <Num
            label="Color highlight thickness:"
            value={eeschema.selection.highlight_netclass_colors_thickness}
            min={0}
            max={50}
            onChange={(v) =>
              upE((s) => {
                s.selection.highlight_netclass_colors_thickness = v;
              })
            }
          />
          <Num
            label="Color highlight opacity:"
            value={eeschema.selection.highlight_netclass_colors_alpha}
            unit="%"
            min={0}
            max={100}
            onChange={(v) =>
              upE((s) => {
                s.selection.highlight_netclass_colors_alpha = v;
              })
            }
          />
        </Group>
      </div>
    </div>
  );
}
