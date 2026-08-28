// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * EDA_BASE_FRAME::m_aboutTitle, one per frame.
 *
 * Two different strings are easy to conflate here, and we had them the wrong
 * way round in both directions.
 *
 * The **menu entry** is ACTIONS::about, whose FriendlyName is "About KiCad" -
 * constant, in all fourteen frames. That is ABOUT_LABEL in help_menu.ts.
 *
 * The **dialog title** is not constant. DIALOG_ABOUT does
 *
 *     m_titleName = aParent->GetAboutTitle();
 *     ...
 *     SetTitle( wxString::Format( _( "About %s" ), m_titleName ) );
 *
 * and every frame sets m_aboutTitle to its own name, with the product name in
 * front of it:
 *
 *     kicad_manager_frame.cpp     "KiCad"
 *     sch_edit_frame.cpp          _HKI( "KiCad Schematic Editor" )
 *     symbol_edit_frame.cpp       _HKI( "KiCad Symbol Editor" )
 *     pcb_edit_frame.cpp          _HKI( "KiCad PCB Editor" )
 *     footprint_edit_frame.cpp    _HKI( "KiCad Footprint Editor" )
 *     gerbview_frame.cpp          _HKI( "KiCad Gerber Viewer" )
 *     pl_editor_frame.cpp         _HKI( "KiCad Drawing Sheet Editor" )
 *     bitmap2cmp_frame.cpp        _HKI( "KiCad Image Converter" )
 *     pcb_calculator_frame.cpp    _HKI( "KiCad Calculator Tools" )
 *     eda_3d_viewer_frame.cpp     _HKI( "KiCad 3D Viewer" )
 *
 * So "About KiCad PCB Editor" is the PCB editor's About window, and the menu
 * entry that opens it still reads "About KiCad". Ours said "About Image
 * Converter" and "About Calculator Tools" - the frame name without the product
 * in front - while three editors showed the bare product name for a frame.
 */

/** The product name, which every frame's title is built on. */
export const PRODUCT = 'Ziro Designer';

export const ABOUT_TITLES = {
  /** kicad_manager_frame.cpp sets the bare product name, not "<product> Project Manager". */
  manager: PRODUCT,
  schematic: `${PRODUCT} Schematic Editor`,
  symbol: `${PRODUCT} Symbol Editor`,
  pcb: `${PRODUCT} PCB Editor`,
  footprint: `${PRODUCT} Footprint Editor`,
  gerbview: `${PRODUCT} Gerber Viewer`,
  drawingSheet: `${PRODUCT} Drawing Sheet Editor`,
  imageConverter: `${PRODUCT} Image Converter`,
  calculator: `${PRODUCT} Calculator Tools`,
  viewer3d: `${PRODUCT} 3D Viewer`,
  /** cvpcb_mainframe.cpp:88 is the one frame that does NOT put the product in
   *  front: `m_aboutTitle = _( "Assign Footprints" )`, so its About window is
   *  titled "About Assign Footprints". Mirrored rather than regularised - the
   *  point of this table is to be upstream's, including where upstream is
   *  inconsistent. */
  cvpcb: 'Assign Footprints',
} as const;

/** `wxString::Format( _( "About %s" ), m_titleName )`. */
export const aboutWindowTitle = (frameTitle: string): string => `About ${frameTitle}`;
