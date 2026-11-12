// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Editing Options —
 * `PANEL_EESCHEMA_EDITING_OPTIONS`
 * (`eeschema/dialogs/panel_eeschema_editing_options_base.cpp`), constructed by
 * eeschema for `PANEL_SCH_EDIT_OPTIONS` (`eeschema/eeschema.cpp:327`).
 *
 * Moved verbatim out of the Preferences dialog's `switch (page)` (as it stood
 * at 5d6a2f40, in prefs/PreferencesDialog.tsx); no behaviour change.
 */
import type { JSX } from 'react';
import { Check, ColorRow, Group, Num, Sel } from '@ziroeda/common/dialogs/pref_controls.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { _ } from '@ziroeda/wx/translation.js';

/**
 * The space between `m_staticTextArcEdit` and `m_choiceArcMode`.
 *
 * [data] `Add( m_staticTextArcEdit, 0, wxALL, 5 )` then
 * `Add( m_choiceArcMode, 0, wxALL|wxEXPAND, 5 )`
 * (`panel_eeschema_editing_options_base.cpp:46-54`) — the 5 is that wxALL.
 * pcbnew's copy of the same control is spaced by its own numbers, which is why
 * this is stated at the call site and not in `.ze-pref-stacked`.
 */
const ARC_MODE_STACK = { gap: 5 };

export function PanelEeschemaEditingOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE } = ctx;
  return (
    <div className="ze-pref-columns">
      <div>
        <Group title={_('Editing')}>
          <Sel
            label={_('Line drawing mode:')}
            value={eeschema.drawing.line_mode}
            options={[
              [0, _('Free Angle')],
              [1, _('90 deg Angle')],
              [2, _('45 deg Angle')],
            ]}
            onChange={(v) =>
              upE((s) => {
                s.drawing.line_mode = v as 0 | 1 | 2;
              })
            }
          />
          {/* `m_staticTextArcEdit` is added on its own line
              (`panel_eeschema_editing_options_base.cpp:48`) and `m_choiceArcMode`
              on the next with `wxEXPAND` (`:54`), so the choice is as wide as
              the column — its longest entry, "Keep endpoints or direction of
              starting point", does not fit beside a label. Ours put the two on
              one row, which made the left column wide enough to push the right
              one off the edge of the dialog.

              `gap: 5` is the `wxALL, 5` those two Add()s carry. It is stated
              here and not in `.ze-pref-stacked` because pcbnew's copy of this
              control is spaced by its own numbers — a `(0, 3)` spacer, and no
              wxBOTTOM on the label at all. */}
          <Sel
            label={_('Arc editing mode:')}
            ariaLabel={_('Arc editing mode')}
            stacked={ARC_MODE_STACK}
            value={eeschema.drawing.arc_edit_mode}
            options={[
              [0, _('Keep center, adjust radius')],
              [1, _('Keep endpoints or direction of starting point')],
              [2, _('Keep center and radius, adjust endpoints')],
            ]}
            onChange={(v) =>
              upE((s) => {
                s.drawing.arc_edit_mode = v as 0 | 1 | 2;
              })
            }
          />
          <Check
            label={_('Mouse drag performs Drag (G) operation')}
            checked={!eeschema.input.drag_is_move}
            title={_('If unchecked, mouse drag will perform move (M) operation')}
            onChange={(v) =>
              upE((s) => {
                s.input.drag_is_move = !v;
              })
            }
          />
          <Check
            label={_('Automatically start wires on unconnected pins')}
            checked={eeschema.drawing.auto_start_wires}
            title={_(
              'When enabled, you can start wiring by clicking on unconnected pins even when the wire tool is not active',
            )}
            onChange={(v) =>
              upE((s) => {
                s.drawing.auto_start_wires = v;
              })
            }
          />
          <Check
            label={_('<ESC> clears net highlighting')}
            checked={eeschema.input.esc_clears_net_highlight}
            title={_(
              'First <ESC> in selection tool clears selection, next clears net highlighting',
            )}
            onChange={(v) =>
              upE((s) => {
                s.input.esc_clears_net_highlight = v;
              })
            }
          />
          <Check
            label={_('Automatically annotate symbols')}
            checked={eeschema.annotation.automatic}
            onChange={(v) =>
              upE((s) => {
                s.annotation.automatic = v;
              })
            }
          />
          <Check
            label={_('Allow unconstrained pin swaps')}
            checked={eeschema.input.allow_unconstrained_pin_swaps}
            /* `allowPinSwaps` gates the context-menu entry
               (`sch_selection_tool.cpp:385`) AND `SwapPins` itself
               (`sch_edit_tool.cpp:1769`), so turning it off removes the entry
               rather than greying it, and nothing else can reach the tool. */
            title={_(
              "Allows swapping symbol pins' positions. May cause invalid design changes; use with caution.",
            )}
            onChange={(v) =>
              upE((s) => {
                s.input.allow_unconstrained_pin_swaps = v;
              })
            }
          />
        </Group>
        <Group title={_('Defaults for New Objects')}>
          <ColorRow
            label={_('Sheet border:')}
            value={eeschema.drawing.default_sheet_border_color}
            /* `sheet->SetBorderColor( cfg->m_Drawing.default_sheet_border_color )`
               (`sch_drawing_tools.cpp:3445`), stamped on the sheet as it is
               drawn. Unset — a fully transparent colour, KiCad's
               COLOR4D::UNSPECIFIED — leaves the sheet on the theme's. */
            onChange={(css) =>
              upE((s) => {
                s.drawing.default_sheet_border_color = css;
              })
            }
          />
          <ColorRow
            label={_('Sheet background:')}
            value={eeschema.drawing.default_sheet_background_color}
            /* `SetBackgroundColor` on the same line (`:3446`). */
            onChange={(css) =>
              upE((s) => {
                s.drawing.default_sheet_background_color = css;
              })
            }
          />
          <Sel
            label={_('Power Symbols:')}
            value={eeschema.drawing.new_power_symbols}
            /* `PlaceSymbol` converts the library symbol between the two power
               kinds before building the placement (`:436-471`). Default follows
               the definition, and an ordinary symbol is never promoted. */
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
        <Group title={_('Left Click Mouse Commands')}>
          {/* `m_hint1`'s string carries a newline —
              "…2 modifier keys:\nShift and Ctrl"
              (`panel_eeschema_editing_options_base.cpp:162`) — and the panel
              gives it `KIUI::GetSmallInfoFont( this ).Italic()` (`:79-81`),
              which is the GUI font two points down. It sets no colour: ours
              dimmed it to #9aa0a6, and drawing it on ONE line is what made this
              column wide enough to push the right-hand one off the dialog. */}
          <div className="ze-pref-hint">
            {_('Left click (and drag) actions depend on 2 modifier keys:')}
            <br />
            {_('Shift and Ctrl')}
          </div>
          <table className="ze-pref-mouse">
            <tbody>
              <tr>
                <td>{_('Long Click')}</td>
                <td>{_('Clarify selection from menu')}</td>
              </tr>
              <tr>
                <td>{_('Shift')}</td>
                <td>{_('Add item(s) to selection')}</td>
              </tr>
              <tr>
                <td>{_('Ctrl+Shift')}</td>
                <td>{_('Remove item(s) from selection')}</td>
              </tr>
            </tbody>
          </table>
        </Group>
      </div>
      <div>
        <Group title={_('Symbol Field Automatic Placement')}>
          <Check
            label={_('Automatically place symbol fields')}
            checked={eeschema.autoplace_fields.enable}
            onChange={(v) =>
              upE((s) => {
                s.autoplace_fields.enable = v;
              })
            }
          />
          <Check
            label={_('Allow field autoplace to change justification')}
            checked={eeschema.autoplace_fields.allow_rejustify}
            onChange={(v) =>
              upE((s) => {
                s.autoplace_fields.allow_rejustify = v;
              })
            }
          />
          <Check
            label={_('Always align autoplaced fields to the 50 mil grid')}
            checked={eeschema.autoplace_fields.align_to_grid}
            onChange={(v) =>
              upE((s) => {
                s.autoplace_fields.align_to_grid = v;
              })
            }
          />
        </Group>
        <Group title={_('Repeated Items')}>
          <Num
            label={_('Horizontal pitch:')}
            value={eeschema.drawing.default_repeat_offset_x}
            unit="mils"
            /* `m_hPitchCtrl` is a `wxTextCtrl` (`:325`) — a UNIT_BINDER's
               entry, with no stepper buttons. Only the label increment below
               is a wxSpinCtrl (`:347`). */
            spin={false}
            onChange={(v) =>
              upE((s) => {
                s.drawing.default_repeat_offset_x = v;
              })
            }
          />
          <Num
            label={_('Vertical pitch:')}
            value={eeschema.drawing.default_repeat_offset_y}
            unit="mils"
            /* `m_vPitchCtrl`, likewise a wxTextCtrl (`:336`). */
            spin={false}
            onChange={(v) =>
              upE((s) => {
                s.drawing.default_repeat_offset_y = v;
              })
            }
          />
          <Num
            label={_('Label increment:')}
            value={eeschema.drawing.repeat_label_increment}
            /* [data] `m_spinLabelRepeatStep->SetRange( -100000, 100000 )`
               (`panel_eeschema_editing_options.cpp:83`), which OVERRIDES the
               base file's own -1000000..1000000 (`:347`). Ours said -10..10,
               which is neither, and refused a repeat step of 100. */
            min={-100000}
            max={100000}
            onChange={(v) =>
              upE((s) => {
                s.drawing.repeat_label_increment = v;
              })
            }
          />
        </Group>
        <Group title={_('Dialog Preferences')}>
          <Check
            label={_('Show footprint previews in Symbol Chooser')}
            checked={eeschema.appearance.footprint_preview}
            onChange={(v) =>
              upE((s) => {
                s.appearance.footprint_preview = v;
              })
            }
          />
          <Check
            label={_('Never show Rescue Symbols tool')}
            checked={eeschema.system.never_show_rescue_dialog}
            /* `m_RescueNeverShow` suppresses exactly ONE prompt, the automatic
               one, raised in the legacy branch of the file loader —

                   if( schFileType == SCH_IO_MGR::SCH_LEGACY ) { …
                       if( ( !cfg || !cfg->m_RescueNeverShow ) && !cacheExists )
                           editor->RescueSymbolLibTableProject( false );
                   (`files-io.cpp:470`, `:616`)

               — so it fires when opening a KiCad 4/5 `.sch` whose
               `<project>-cache.lib` is missing, and that is now a thing this
               port can do: `sch_io/legacy/read-schematic.ts` reads the format
               and `loadProject` raises the prompt under exactly that condition.

               It does NOT gate the Tools > Rescue Symbols entry, and never did:
               `RescueSymbols` passes `aRunningOnDemand = true` and does not
               consult the flag (`sch_editor_control.cpp:532-541`). Ticking this
               stops the offer being made for you; it does not take the tool
               away. */
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
