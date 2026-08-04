// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The toolbar *data* types, split out of `Toolbar.tsx` for the same reason
 * `menu_types.ts` was split out of `MenuBar.tsx`: every editor's toolbar
 * inventory is a plain data module, but importing these types from a `.tsx`
 * put it beyond `qa`'s tsconfig, which compiles `.ts` only.
 *
 * `Toolbar.tsx` re-exports all four, so existing importers are unaffected.
 */

export interface ToolButton {
  id: string;
  icon: string;
  title: string;
  toggle?: boolean;
  /** Feature not implemented yet, shown greyed in its upstream position. */
  disabled?: boolean;
}

/**
 * A TOOLBAR_GROUP_CONFIG / ACTION_GROUP: rendered as a single button showing
 * the selected action (first action by default) with a triangle in the
 * bottom-right corner. Click runs the selected action; pressing for 500 ms or
 * dragging off the button pops up a palette with every action in the group
 * (common/tool/action_toolbar.cpp).
 */
export interface ToolGroup {
  group: string;
  actions: ToolButton[];
  /** Open the palette on a normal click instead of activating the shown action. */
  paletteOnClick?: boolean;
}

/**
 * A TOOLBAR_CONFIGURATION::AppendControl slot: the widget itself is supplied by
 * the frame through `controls`, exactly as KiCad frames register control
 * factories (RegisterCustomToolbarControlFactory) for e.g. the symbol viewer's
 * unit and body-style choices.
 */
export interface ToolControl {
  control: string;
}

export type ToolEntry = ToolButton | ToolGroup | ToolControl | 'sep';
