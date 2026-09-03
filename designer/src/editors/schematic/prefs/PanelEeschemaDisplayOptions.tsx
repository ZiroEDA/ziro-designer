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
        {/* Live, all five. They govern probes arriving in the SCHEMATIC from
            the board — `SCH_EDIT_FRAME::KiwayMailIn`'s `MAIL_SELECTION` and the
            `$NET:` handler — and that direction now exists: the board sends its
            selection and its highlighted net, and `SCH_SELECTION_TOOL::
            SyncSelection` applies them subject to these five. */}
        <CrossProbingGroup
          peer="pcb"
          value={eeschema.cross_probing}
          onChange={(fn) => upE((s) => fn(s.cross_probing))}
        />
      </div>
      <div>
        <Group title="Appearance">
          {/* Dead, and waiting on a feature rather than on the browser.
              `default_font` is the face every text item with no `(font (face
              …))` of its own draws in (`sch_painter.cpp:620`, `:652`, `:696`),
              and this port draws every string with KiCad's stroke font or its
              MSDF atlas — so choosing a second face would change nothing on
              screen. The measuring half of that already has its seam
              (`common/src/font/font_provider.ts`, deliberately with no
              provider installed, because a face that measures one way and
              draws another is worse than no outline fonts at all); the drawing
              half is issue #154, and this list becomes the installed faces
              when it lands. */}
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
          {/* Live: `drawAltPinModesIcon` beside the pin name, for a pin that
              declares alternates (`sch_painter.cpp:1672-1679`). One painter for
              both editors — the Symbol Editor imports the same function. */}
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
          {/* Live: the shadow pass tests it at three places — a pin's name and
              number (`sch_painter.cpp:1131`), a symbol's fields (`:2702`) and a
              sheet's fields and pins (`:3102`). Off, a selected symbol glows on
              its body and pin lines alone; its reference and value stay
              unhaloed but perfectly visible, because the flag governs only the
              HALO (`if( !drawingShadows || … )`). */}
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
          {/* `m_collisionMarkerWidthCtrl` (`:196`). Live: the pen, in device
              pixels, that `SCH_DRAG_NET_COLLISION_MONITOR::Update` strokes the
              markers with (`sch_drag_net_collision.cpp:181-190`). */}
          <Num
            label="Net collision marker width:"
            value={eeschema.selection.drag_net_collision_width}
            /* [data] `wxSpinCtrlDouble( …, 1, 50, 4.000000, 1 )`. */
            min={1}
            max={50}
            onChange={(v) =>
              upE((s) => {
                s.selection.drag_net_collision_width = v;
              })
            }
          />
          <Num
            label="Highlight thickness:"
            value={eeschema.selection.highlight_thickness}
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
          {/* The control is a PERCENT and the setting is a FRACTION:
              `SetValue( …alpha * 100 )` and `…alpha = GetValue() / 100.0`
              (`panel_eeschema_display_options.cpp:73`, `:117`). */}
          <Num
            label="Color highlight opacity:"
            value={Math.round(eeschema.selection.highlight_netclass_colors_alpha * 100)}
            min={0}
            max={100}
            onChange={(v) =>
              upE((s) => {
                s.selection.highlight_netclass_colors_alpha = v / 100;
              })
            }
          />
        </Group>
      </div>
    </div>
  );
}
