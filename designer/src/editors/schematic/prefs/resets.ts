// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RESETTABLE_PANEL::ResetPanel` for the Schematic Editor's Preferences pages.
 *
 * Upstream each of these is a method on its own panel class. Ours are gathered
 * here — still inside the editor that owns them, never in the shell — because
 * `qa`'s tsconfig sets no `--jsx` and so cannot follow a `.tsx`, and this is
 * the behaviour that has to be tested: resetting one page must leave the other
 * five alone. Same split, and same reason, as `registry.ts` vs `lazy_pages.ts`.
 *
 * `prefs/index.ts` — this editor's `CreateKiWindow` — pairs each `Panel` with
 * its `reset` again.
 *
 * Field Name Templates is deliberately absent: `PANEL_TEMPLATE_FIELDNAMES_BASE`
 * is a plain `wxPanel` (`eeschema/dialogs/panel_template_fieldnames_base.h:36`),
 * so upstream greys the button out on that page.
 */
import { EESCHEMA_DEFAULTS } from '../../../prefs/settings.js';
import { resetKeys } from '../../../dialogs/prefs/reset.js';
import { MOUSE_DEFAULTS } from './PanelSimulatorPreferences.js';
import { templateNamesNeedingTrim, transferTemplateFieldnames } from '../template_fieldnames.js';
import type { PrefsContext, PrefsTransferPrompt } from '../../../dialogs/prefs/types.js';
import { resetToolbarsPanel } from '../../../dialogs/prefs/toolbar_reset.js';

/**
 * `PANEL_EESCHEMA_DISPLAY_OPTIONS::ResetPanel`
 * (`eeschema/dialogs/panel_eeschema_display_options.cpp`) loads a default
 * `EESCHEMA_SETTINGS` into *this panel's* controls via `loadEEschemaSettings`,
 * then hands the same object to the embedded `PANEL_GAL_OPTIONS`. The rest of
 * `EESCHEMA_SETTINGS` is untouched: those widgets are on other pages.
 */
export function resetEeschemaDisplayOptions(ctx: PrefsContext): void {
  ctx.upE((s) => {
    // "Appearance". NOT `color_theme` (the Colors page) and NOT
    // `footprint_preview` (Editing Options) -- neither control is here.
    resetKeys(s.appearance, EESCHEMA_DEFAULTS.appearance, [
      'default_font',
      'show_hidden_pins',
      'show_hidden_fields',
      'show_directive_labels',
      'show_erc_errors',
      'show_erc_warnings',
      'show_erc_exclusions',
      'mark_sim_exclusions',
      'show_op_voltages',
      'show_op_currents',
      'show_pin_alt_icons',
      'show_page_limits',
    ]);
    // "Selection & Highlighting" -- every field of `selection` is on this page.
    resetKeys(s.selection, EESCHEMA_DEFAULTS.selection, [
      'thickness',
      'drag_net_collision_width',
      'highlight_thickness',
      'draw_selected_children',
      'fill_shapes',
      'highlight_netclass_colors',
      'highlight_netclass_colors_thickness',
      'highlight_netclass_colors_alpha',
    ]);
    // "Cross-probing", the whole CROSS_PROBING_SETTINGS block.
    resetKeys(s, EESCHEMA_DEFAULTS, ['cross_probing']);
    // m_galOptsPanel->ResetPanel( &cfg ): the embedded PANEL_GAL_OPTIONS, whose
    // TransferDataToWindow (common/dialogs/panel_gal_options.cpp) covers exactly
    // grid snap, grid style, grid min spacing, the crosshair mode and
    // always_show_cursor. The grid *sizes* are the Grids page, not this one.
    resetKeys(s.window.grid, EESCHEMA_DEFAULTS.window.grid, [
      'style',
      'line_width',
      'min_spacing',
      'snap',
    ]);
    resetKeys(s.window.cursor, EESCHEMA_DEFAULTS.window.cursor, [
      'crosshair',
      'always_show_cursor',
    ]);
  });
}

/**
 * `PANEL_GRID_SETTINGS::ResetPanel` (`common/dialogs/panel_grid_settings.cpp:110-113`)
 * is two lines -- `m_grids = m_cfg->DefaultGridSizeList(); RebuildGridSizes();` --
 * and nothing else in `APP_SETTINGS_BASE` is touched.
 *
 * The slice is what this panel's `TransferDataFromWindow` writes back
 * (`panel_grid_settings.cpp`): the grid list, the current-grid index, the two
 * fast-switch indices and the per-item overrides. `RebuildGridSizes` re-points
 * those indices by grid *name* after the list changes, falling back to the
 * first (last, for Grid 2) entry; since the whole page goes back to defaults
 * together here, resetting the indices to the defaults' own is the same result
 * and cannot leave one dangling past the end of the list.
 *
 * NOT the grid's appearance -- `style`, `line_width`, `min_spacing`, `snap`
 * belong to the `PANEL_GAL_OPTIONS` embedded in Display Options.
 */
export function resetEeschemaGrids(ctx: PrefsContext): void {
  ctx.upE((s) => {
    resetKeys(s.window.grid, EESCHEMA_DEFAULTS.window.grid, [
      'sizes',
      'last_size_idx',
      'fast_grid_1',
      'fast_grid_2',
      'overrides_enabled',
      'overrides',
    ]);
  });
}

/**
 * `PANEL_EESCHEMA_EDITING_OPTIONS::ResetPanel`
 * (`eeschema/dialogs/panel_eeschema_editing_options.cpp:172-178`): a default
 * `EESCHEMA_SETTINGS` pushed through `loadEEschemaSettings`, which repopulates
 * this panel's widgets and leaves every other panel alone.
 */
export function resetEeschemaEditingOptions(ctx: PrefsContext): void {
  ctx.upE((s) => {
    // "Editing" / "Defaults for New Objects" / "Rubber banding" etc.
    resetKeys(s.input, EESCHEMA_DEFAULTS.input, [
      'drag_is_move',
      'esc_clears_net_highlight',
      'allow_unconstrained_pin_swaps',
    ]);
    resetKeys(s.drawing, EESCHEMA_DEFAULTS.drawing, [
      'line_mode',
      'arc_edit_mode',
      'auto_start_wires',
      'repeat_label_increment',
      'default_repeat_offset_x',
      'default_repeat_offset_y',
      'default_sheet_border_color',
      'default_sheet_background_color',
      'new_power_symbols',
    ]);
    // NOT the rest of `drawing`: `field_names` is the Field Name Templates
    // page, and the default thicknesses/text size are Schematic Setup.
    resetKeys(s.autoplace_fields, EESCHEMA_DEFAULTS.autoplace_fields, [
      'enable',
      'allow_rejustify',
      'align_to_grid',
    ]);
    // m_checkAutoAnnotate (eeschema/dialogs/panel_eeschema_editing_options.cpp:124,
    // :164) is on this page as well as on Annotation Options; both own it, and
    // each resets only it.
    resetKeys(s.annotation, EESCHEMA_DEFAULTS.annotation, ['automatic']);
    resetKeys(s.appearance, EESCHEMA_DEFAULTS.appearance, ['footprint_preview']);
    resetKeys(s.system, EESCHEMA_DEFAULTS.system, ['never_show_rescue_dialog']);
  });
}

/**
 * `PANEL_COLOR_SETTINGS::ResetPanel` (`common/dialogs/panel_color_settings.cpp`)
 * walks its own swatches and puts each layer back to `GetDefaultColor`. Ours is
 * the same slice: drop every per-layer override, and go back to the default
 * theme. This one was already narrow.
 */
export function resetEeschemaColorSettings(ctx: PrefsContext): void {
  // Only THIS app's namespace. `colors/user.json` holds every app's colours —
  // upstream keyed by `m_colorNamespace`, here by the key's prefix — and
  // `PANEL_COLOR_SETTINGS::ResetPanel` walks `m_swatches`, which are this
  // panel's own. Emptying the file took the Gerber Viewer's 128 graphic layers
  // with it, which upstream's reset cannot do because eeschema's page has no
  // gerbview swatch to walk. Found by the Gerber Viewer's Colors page landing
  // beside it.
  ctx.setUserColors((c) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(c)) if (k.includes('.')) out[k] = v;
    return out;
  });
  ctx.upE((s) => {
    s.appearance.color_theme = EESCHEMA_DEFAULTS.appearance.color_theme;
  });
}

/**
 * `PANEL_TOOLBAR_CUSTOMIZATION::ResetPanel`
 * (`common/dialogs/panel_toolbar_customization.cpp:243-267`) over this app's
 * toolbars, through the shared implementation. It does not touch
 * `appearance.custom_toolbars`: upstream's ResetPanel refills `m_toolbars` and
 * leaves `m_CustomToolbars` exactly as the user left it.
 */
export function resetEeschemaToolbars(ctx: PrefsContext): void {
  ctx.upTb('eeschema', (s) => {
    resetToolbarsPanel(s);
  });
}

/**
 * `PANEL_SIMULATOR_PREFERENCES::ResetPanel`
 * (`eeschema/dialogs/panel_simulator_preferences.cpp:75-78`):
 *
 *     applyMouseScrollActionsToPanel( SIM_MOUSE_WHEEL_ACTION_SET::GetMouseDefaults() );
 *
 * Note it resets to `GetMouseDefaults()`, the same set the "Reset to Mouse
 * Defaults" button writes — NOT to the five PARAM defaults in
 * `eeschema_settings.cpp:587-609`. Those two happen to agree today, and the
 * button existing at all is why upstream reaches for the function rather than
 * the params: they are two answers to the same question and only one of them is
 * the panel's.
 */
export function resetSimulatorPreferences(ctx: PrefsContext): void {
  ctx.upE((s) => {
    s.simulator.mouse_wheel_actions = { ...MOUSE_DEFAULTS };
  });
}

/**
 * `PANEL_TEMPLATE_FIELDNAMES::TransferDataFromWindow`
 * (`eeschema/dialogs/panel_template_fieldnames.cpp:193-252`).
 *
 * The grid holds whatever was typed; the file may not. Filtering on every
 * keystroke would delete the row a user is halfway through clearing, so it
 * happens once, when OK is pressed — which is exactly when upstream does it.
 *
 * This page is `m_global = true`, so it transfers `drawing.field_names` and
 * nothing else. See `template_fieldnames.ts` for the three rules.
 */
export function transferTemplateFieldnamesPage(
  ctx: PrefsContext,
  confirmed?: boolean,
): PrefsTransferPrompt | void {
  const apply = (trim: boolean): void =>
    ctx.upE((s) => {
      s.drawing.field_names = transferTemplateFieldnames(s.drawing.field_names, trim);
    });

  // The second call, carrying the answer to the question below.
  if (confirmed !== undefined) return void apply(confirmed);

  /*
   *     if( field.m_Name != trimmedName )
   *     {
   *         msg.Printf( _( "The field name '%s' contains trailing and/or leading white space." ), … );
   *         KICAD_MESSAGE_DIALOG dlg( this, msg, _( "Warning" ),
   *                                   wxOK | wxCANCEL | wxCENTER | wxICON_WARNING );
   *         dlg.SetExtendedMessage( … );
   *         dlg.SetOKCancelLabels( _( "Remove White Space" ), _( "Keep White Space" ) );
   *         if( dlg.ShowModal() == wxID_OK ) field.m_Name = trimmedName;
   *     }
   *     (`panel_template_fieldnames.cpp:210-230`)
   *
   * Neither answer cancels — the field is added either way — so this holds up
   * the OK and never the page. Upstream asks once per offending field, inside
   * the loop; ours asks once for all of them, because a modal per row is a wx
   * idiom rather than a behaviour and the answer is the same for every one.
   */
  const padded = templateNamesNeedingTrim(ctx.eeschema.drawing.field_names);
  if (padded.length === 0) return void apply(false);

  return {
    caption: 'Warning',
    message:
      padded.length === 1
        ? `The field name '${padded[0]}' contains trailing and/or leading white space.`
        : `${padded.length} field names contain trailing and/or leading white space.`,
    extendedMessage:
      'This may result in what appears to be duplicate field names but are actually unique ' +
      'names differing only by white space characters.  Removing the white space characters ' +
      'will have no effect on existing symbol field names.',
    labels: { ok: 'Remove White Space', cancel: 'Keep White Space' },
  };
}
