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
import { PanelGalOptions } from '../../../dialogs/prefs/PanelGalOptions.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelEeschemaDisplayOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE } = ctx;
  return (
    /* `bPanelSizer->Add( bSizer9, 0, wxEXPAND|wxRIGHT, 5 )` then
       `Add( 20, 0, 0, 0, 5 )` (`:76-79`) — this page's gutter is 25, not the
       35 Common and Editing Options carry. */
    <div className="ze-pref-columns ze-gutter-25">
      <div>
        {/*
          `m_galOptsPanel = new PANEL_GAL_OPTIONS( this, aAppSettings )`, the
          shared panel embedded rather than restated
          (eeschema/dialogs/panel_eeschema_display_options.cpp). The Grid
          Display and Cursor groups used to be written out here, and had drifted
          from it in four places — a choice where upstream has radio buttons, a
          crosshair label of our own, and both numeric ranges invented.
        */}
        <PanelGalOptions
          win={eeschema.window}
          update={(fn) => upE((s) => fn(s.window))}
          idPrefix="sch"
        />
        {/* Dead, all five. These govern probes arriving in the SCHEMATIC from
            the board — Select on Schematic, and PCB net highlight — and that
            direction is not built: nothing reads `eeschema.cross_probing`. The
            board's own copy is live (`editors/pcb/PcbEditor.tsx:3302`,
            `pcbnew/src/cross_probe.ts:205`, `:287`), which is why the same
            group is enabled under PCB Editor > Display Options. */}
        <CrossProbingGroup
          peer="pcb"
          disabled
          value={eeschema.cross_probing}
          onChange={(fn) => upE((s) => fn(s.cross_probing))}
        />
      </div>
      <div>
        <Group title="Appearance">
          {/* Dead: nothing reads `appearance.default_font`. Every string in
              this port is drawn with KiCad's own stroke font or its MSDF
              atlas, so there is no second face to pick — upstream lists the
              installed fonts here. */}
          <Sel
            label="Default font:"
            value={eeschema.appearance.default_font}
            options={[['KiCad Font', 'KiCad Font']]}
            disabled
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
          {/* `m_checkShowDirectiveLabels` (`:116`) — between the hidden fields
              and the ERC rows, and missing from this page entirely. Dead:
              nothing reads it; a directive label is drawn whatever it says. */}
          <Check
            label="Show directive labels"
            checked={eeschema.appearance.show_directive_labels}
            disabled
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_directive_labels = v;
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
          {/* Dead, both: the operating-point overlays are the simulator's, and
              nothing reads `show_op_voltages` / `show_op_currents`. */}
          <Check
            label="Show OP voltages"
            checked={eeschema.appearance.show_op_voltages}
            disabled
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_op_voltages = v;
              })
            }
          />
          <Check
            label="Show OP currents"
            checked={eeschema.appearance.show_op_currents}
            disabled
            onChange={(v) =>
              upE((s) => {
                s.appearance.show_op_currents = v;
              })
            }
          />
          {/* Dead: the painter draws no alternate-mode indicator yet. */}
          <Check
            label="Show pin alternate mode indicator icons"
            checked={eeschema.appearance.show_pin_alt_icons}
            disabled
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
          {/* Dead: the selection painter draws the parent's own outline, and
              nothing reads `selection.draw_selected_children` or
              `selection.fill_shapes`. */}
          <Check
            label="Draw selected child items"
            checked={eeschema.selection.draw_selected_children}
            disabled
            onChange={(v) =>
              upE((s) => {
                s.selection.draw_selected_children = v;
              })
            }
          />
          <Check
            label="Fill selected shapes"
            checked={eeschema.selection.fill_shapes}
            disabled
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
          {/* `m_highlightColorNote` (`:263`) — a wxStaticText upstream really
              does draw here, unlike the paragraph we had under Cross-probing.
              It was already on the page as a `.ze-muted` div, which states a
              #9a9ca0 of its own; a wxStaticText takes the dialog's foreground,
              so this is the label class and the dimmed copy is gone. */}
          <div className="ze-pref-note">(selection color can be edited in the "Colors" page)</div>
          {/* `m_collisionMarkerWidthCtrl` (`:271`), missing from this page.
              Dead: dragging a wire past another net draws no collision marker
              here, so nothing reads `selection.drag_net_collision_width`. */}
          <Num
            label="Net collision marker width:"
            value={eeschema.selection.drag_net_collision_width}
            /* [data] `wxSpinCtrlDouble( …, 1, 50, 4.000000, 1 )`. */
            min={1}
            max={50}
            disabled
            onChange={(v) =>
              upE((s) => {
                s.selection.drag_net_collision_width = v;
              })
            }
          />
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
          {/* Dead, all three: netclass colours are not drawn on a selection
              here, so nothing reads the flag or either of its numbers. */}
          <Check
            label="Highlight netclass colors"
            checked={eeschema.selection.highlight_netclass_colors}
            disabled
            onChange={(v) =>
              upE((s) => {
                s.selection.highlight_netclass_colors = v;
              })
            }
          />
          <Num
            label="Color highlight thickness:"
            value={eeschema.selection.highlight_netclass_colors_thickness}
            disabled
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
            disabled
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
