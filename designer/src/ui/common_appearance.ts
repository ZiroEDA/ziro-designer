// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_BASE_FRAME::CommonSettingsChanged` (`common/eda_base_frame.cpp:959-995`),
 * the half of it that is appearance:
 *
 *     GetBitmapStore()->ThemeChanged();
 *     ThemeChanged();
 *     ReCreateMenuBar();
 *     RecreateToolbars();
 *
 * Upstream every frame re-reads `m_Appearance` and rebuilds the widgets that
 * depend on it — a bitmap store that caches per icon size and theme, toolbars
 * that ask `KiBitmapBundleDef( icon, iconSize )`, a `WX_GRID` whose attr
 * provider is installed from `grid_striping`. Nothing is pushed *down* to the
 * widgets; each one asks again.
 *
 * Ours cannot work that way for the settings CSS decides. A `.ze-grid` is a
 * `<table>` in thirty-four places and a toolbar button's size is a token every
 * toolbar metric derives from, so the equivalent of "rebuild every widget" is
 * "restate the values on the document root and let the cascade do it". That is
 * one place rather than thirty-four, and — more to the point — it cannot be
 * MISSED: a new grid inherits the striping by existing, where a per-table class
 * is one a future table forgets.
 *
 * This module is deliberately small and deliberately the only one of its kind.
 * A setting whose reader is JavaScript reads `settings.common` at the point of
 * use, as `ui/kicursors.ts` does for `use_custom_cursors`; only the ones whose
 * reader is the stylesheet come through here.
 */
import { settings } from '../prefs/settings.js';
import { setZoomCorrection } from './status_format.js';

/**
 * `appearance.toolbar_icon_size`'s range, `PARAM<int>( …, 24, 16, 64 )`
 * (`common_settings.cpp:115-116`). A stored value outside it is damage, and a
 * toolbar button an inch tall is worse than one that ignores the setting. [data]
 */
export const TOOLBAR_ICON_MIN = 16;
export const TOOLBAR_ICON_MAX = 64;

/**
 * The three sizes `PANEL_COMMON_SETTINGS`' radios write
 * (`panel_common_settings.cpp:206-211`, `:314-318`). [data]
 *
 * A value that is none of them is legal — the panel's switch has no default, so
 * all three radios come up unselected and the toolbars still use it.
 */
export const TOOLBAR_ICON_SIZES = { small: 16, normal: 24, large: 32 } as const;

/**
 * Push the appearance settings the stylesheet reads onto `root`.
 *
 * Exported for its own tests, and taking the element rather than reaching for
 * `document` so those tests need no page.
 */
export function applyCommonAppearance(root: HTMLElement): void {
  const a = settings.common.appearance;

  // `ACTION_TOOLBAR::AddAction`: `KiBitmapBundleDef( aAction.GetIcon(), iconSize )`
  // and `paddingDip = ( ToDIP( m_buttonSize.GetWidth() ) - iconSize ) / 2`. Ours
  // is the same derivation stated once — `--toolbar-button-size` is
  // `--toolbar-icon-size` plus twice the padding — so setting this one property
  // resizes every toolbar metric together, exactly as the one int does upstream.
  const size = Math.min(TOOLBAR_ICON_MAX, Math.max(TOOLBAR_ICON_MIN, a.toolbar_icon_size));
  root.style.setProperty('--toolbar-icon-size', `${size}px`);

  // `WX_GRID::EnableAlternateRowColors( … grid_striping )` (`wx_grid.cpp:329`).
  // An attribute rather than a class: `.ze-grid` is a class thirty-four tables
  // already carry, and a second one on the root is what the rows select against.
  if (a.grid_striping) root.dataset.gridStriping = '1';
  else delete root.dataset.gridStriping;

  // `GAL::computeWorldScale`'s `m_worldScale *= zoom_correction_factor`. Not a
  // DOM property, and here anyway because this module is the port of "the
  // common settings changed, tell everything that reads them" — and because
  // `ui/status_format.ts` cannot read the settings store itself without
  // importing a cycle. See `setZoomCorrection`.
  setZoomCorrection(a.zoom_correction_factor);
}

/**
 * Keep the root in step with the settings for as long as the app is up, and
 * return the disposer.
 *
 * `settings.subscribe` is `CommonSettingsChanged` being *raised*: the dialog's
 * OK writes the slice, the store notifies, and every reader re-reads. The first
 * call is not on a change — it is the frame being built, where upstream reads
 * the same values in each widget's constructor.
 */
export function installCommonAppearance(root: HTMLElement): () => void {
  applyCommonAppearance(root);
  return settings.subscribe(() => applyCommonAppearance(root));
}
