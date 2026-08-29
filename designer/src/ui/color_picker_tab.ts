// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_COLOR_PICKER`'s remembered notebook page.
 *
 * Two halves, and both are the dialog's own:
 *
 * ```
 * m_notebook->SetSelection( cfg->m_ColorPicker.default_tab );   // :89, ctor
 * cfg->m_ColorPicker.default_tab = m_notebook->GetSelection();  // :114, dtor
 * ```
 *
 * so the page is not a constant to hardcode: the picker opens on whichever
 * page you last closed it on, and only a *fresh profile* opens on page 0. The
 * shipped default is `PARAM<int>( "color_picker.default_tab", …, 0 )`
 * (common/settings/app_settings.cpp:137-138), and page 0 is "Color Picker" —
 * `m_notebook->AddPage( m_panelFreeColors, _( "Color Picker" ), true )` comes
 * first and "Defined Colors" second (dialog_color_picker_base.cpp:140, :160).
 *
 * Split out of the component, the way `dialog_control_state.ts` is split out of
 * `useDialogControl.ts`: the store and the page numbering stay testable without
 * a React tree, and the dialog keeps one call at each end of its life.
 */
import { settings } from '../prefs/settings.js';

/** The notebook's page order (dialog_color_picker_base.cpp:140, :160). */
export type ColorPickerTab = 'free' | 'defined';

/** Page index -> page, and back. Page 0 is "Color Picker". */
export const COLOR_PICKER_TABS: readonly ColorPickerTab[] = ['free', 'defined'];

/**
 * `m_notebook->SetSelection( cfg->m_ColorPicker.default_tab )`.
 *
 * An index the notebook has no page for cannot be selected, so it falls back to
 * page 0 rather than leaving the dialog with neither page shown.
 */
export function loadColorPickerTab(): ColorPickerTab {
  return COLOR_PICKER_TABS[settings.common.color_picker.default_tab] ?? 'free';
}

/**
 * `cfg->m_ColorPicker.default_tab = m_notebook->GetSelection()`, which the
 * destructor runs unconditionally — after OK, after Cancel and after Esc
 * alike, because it is not part of TransferDataFromWindow.
 */
export function saveColorPickerTab(tab: ColorPickerTab): void {
  // `indexOf` cannot miss: `ColorPickerTab` is the union of exactly the two
  // members of this array, so there is no out-of-range branch to guard here.
  // The guard belongs on the way IN, where the stored number is whatever the
  // file happens to hold.
  const index = COLOR_PICKER_TABS.indexOf(tab);
  settings.updateCommon((s) => {
    s.color_picker.default_tab = index;
  });
}
