// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The one piece of GerbView's page arithmetic left outside `gerbview/`: the
 * Layers Manager pane's width, which the page measures against the real row
 * font. Everything else this module held - the TOP_AUX box contents, the
 * title, status field 0, the image info rows, the D-code list - is
 * GERBVIEW_FRAME's own now (`toolbars_gerber.ts`, `gerbview_frame.ts`,
 * `gerber_file_image.ts`, `tools/gerbview_inspection_tool.ts`).
 */

/**
 * `LAYER_WIDGET::GetBestSize` + `GERBVIEW_FRAME::ReFillLayerWidget`, the reason
 * KiCad's layers pane changes width when you open a set of gerbers.
 *
 *     wxSize LAYER_WIDGET::GetBestSize() const
 *     {
 *         wxArrayInt widths = m_LayersFlexGridSizer->GetColWidths();
 *         int totWidth = 0;
 *         for( ... ) totWidth += widths[i];
 *         totWidth += 15;             // "Account for the parent's frame"
 *         ...                         // same again for the Render tab
 *         return wxSize( max( renderz.x, layerz.x ), ... );
 *     }                                        gerbview/widgets/layer_widget.cpp:582
 *
 *     wxSize bestz = m_LayersManager->GetBestSize();
 *     bestz.x += 5;                   // "gives a little margin"
 *     lyrs.MinSize( bestz );
 *     lyrs.BestSize( bestz );
 *     lyrs.FloatingSize( bestz );     gerbview/gerbview_frame.cpp:381-387
 *
 * So the pane is exactly as wide as its widest row plus 20 px of chrome, and
 * **there is no cap on the pane**. The cap Akshay suspected is real but it is
 * on the *name*, one level down in `GERBER_FILE_IMAGE_LIST::GetDisplayName`:
 *
 *     const int maxlen = 30;
 *     if( !aFullName && filename.Length() > maxlen )
 *         filename = filename.Left( 2 ) + "..." + filename.Right( maxlen - 5 );
 *                                    gerbview/gerber_file_image_list.cpp:146-151
 *
 * and the floor is a string too: every row's label is a wxStaticText with
 * `SetMinimumStringLength( m_smallestLayerString )` (`layer_widget.cpp:364`),
 * which GerbView sets to the display name of a layer one past the last -
 * "Graphic layer <max+1>" (`gerbview_frame.cpp:146-148`).
 *
 * Note `MinSize` is set to the same value, so once files are loaded the pane
 * cannot be dragged narrower than its own content - the FromDIP( 80 ) floor
 * applies only to the empty pane.
 *
 * Pure, and in `.ts`, so the arithmetic can be pinned without a DOM: the widths
 * come from the caller, which measures them against the real row font.
 */
export function layersPaneWidth(
  nameWidths: readonly number[],
  smallestNameWidth: number,
  chromeWidth: number,
): number {
  const widest = nameWidths.reduce((a, b) => Math.max(a, b), smallestNameWidth);
  // 15 for the parent's frame, then ReFillLayerWidget's 5 of margin.
  return Math.ceil(widest + chromeWidth + 15 + 5);
}
