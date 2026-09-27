// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/properties/pg_cell_renderer.cpp`: `PG_CELL_RENDERER`, which every
 * PROPERTIES_PANEL grid draws its cells with. The painting is the panel
 * widget's CSS; the decisions `Render` makes about a VALUE cell are here:
 *
 *  - a `PGPROPERTY_COLOR4D` whose colour was not given as text is a swatch,
 *    not text (`COLOR_SWATCH::RenderToDC` at `SWATCH_SIZE` 24 x 16 dialog
 *    units, over a checkerboard);
 *  - a read-only property that is not selected draws its value in
 *    `GetCellDisabledTextColour()` - the value only, the name column keeps its
 *    normal foreground;
 *  - anything else is wxPropertyGrid's default rendering.
 *
 * The name column's own branch (ellipsized label, image offset) is the grid's
 * default layout and lives in the widget's CSS.
 */

/** How `PG_CELL_RENDERER::Render` draws a value cell (`aColumn > 0`). */
export type PG_VALUE_RENDER = 'swatch' | 'disabled' | 'default';

export const PG_CELL_RENDERER = {
  /** The swatch `Render` asks for: `ConvertDialogToPixels( wxSize( 24, 16 ) )`. */
  SWATCH_SIZE_DU: { x: 24, y: 16 } as const,

  /**
   * The value-column branch of `Render`. `aIsColor` is a `PGPROPERTY_COLOR4D`
   * whose colour has no `m_text`; `aReadOnly` is `wxPG_PROP_READONLY`.
   */
  RenderValue(aIsColor: boolean, aReadOnly: boolean, aSelected: boolean): PG_VALUE_RENDER {
    if (aIsColor) return 'swatch';

    if (aReadOnly && !aSelected) return 'disabled';

    return 'default';
  },
};
