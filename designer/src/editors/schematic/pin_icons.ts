// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The bitmap a pin's Electrical Type / Graphic Style cell draws beside its text.
 *
 * `m_typeAttr->SetRenderer( new GRID_CELL_ICON_TEXT_RENDERER( PinTypeIcons(),
 * PinTypeNames() ) )` and the same for shapes
 * (`dialog_symbol_properties.cpp:131-142`). DIALOG_PIN_PROPERTIES builds the
 * identical pair (`dialog_pin_properties.cpp:234-235`), which is why the table
 * is here rather than inside one dialog.
 *
 * This is a NAME table, not an icon table: all 21 files are already vendored
 * under `assets/toolbar/` and `toolbarIcons.ts` already resolves a KiCad bitmap
 * by name for exactly this kind of call site. Keeping the lookup there and the
 * table here is the same split that file already documents — `import.meta.glob`
 * is Vite-only and would make the table untestable.
 *
 * The mapping is `g_pinElectricalTypes` and `g_pinShapes`
 * (`eeschema/pin_type.cpp:85-108`), one entry each, in upstream's order. It is
 * DATA in CLAUDE.md's sense — a table KiCad hardcodes — so it mirrors that
 * table rather than inventing names.
 */

/** `ElectricalPinTypeGetBitmap` — our type token -> KiCad's BITMAPS name. */
export const PIN_TYPE_BITMAPS: Record<string, string> = {
  input: 'pintype_input',
  output: 'pintype_output',
  bidirectional: 'pintype_bidi',
  tri_state: 'pintype_3states',
  passive: 'pintype_passive',
  free: 'pintype_nic',
  unspecified: 'pintype_notspecif',
  power_in: 'pintype_powerinput',
  power_out: 'pintype_poweroutput',
  open_collector: 'pintype_opencoll',
  open_emitter: 'pintype_openemit',
  no_connect: 'pintype_noconnect',
};

/** `PinShapeGetBitmap` — our shape token -> KiCad's BITMAPS name. */
export const PIN_SHAPE_BITMAPS: Record<string, string> = {
  line: 'pinshape_normal',
  inverted: 'pinshape_invert',
  clock: 'pinshape_clock_normal',
  inverted_clock: 'pinshape_clock_invert',
  input_low: 'pinshape_active_low_input',
  clock_low: 'pinshape_clock_active_low',
  output_low: 'pinshape_active_low_output',
  falling_edge_clock: 'pinshape_clock_fall',
  non_logic: 'pinshape_nonlogic',
};
