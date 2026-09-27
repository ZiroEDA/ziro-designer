// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/mail_type.h`: the commands a KIWAY_MAIL_EVENT carries between
 * KIWAY_PLAYERs. Received in `KIWAY_PLAYER::KiwayMailIn()`.
 */
export enum MAIL_T {
  MAIL_CROSS_PROBE, // PCB<->SCH, CVPCB->SCH cross-probing.
  MAIL_SELECTION, // SCH<->PCB selection synchronization.
  MAIL_SELECTION_FORCE, // Explicit selection of SCH->PCB selection synchronization.
  MAIL_ASSIGN_FOOTPRINTS, // CVPCB->SCH footprint stuffing
  MAIL_SCH_SAVE, // CVPCB->SCH save the schematic
  MAIL_PCB_SAVE, // KICAD->PCB save the board
  MAIL_EESCHEMA_NETLIST, // SCH->CVPCB netlist immediately after launching CVPCB
  MAIL_SYMBOL_NETLIST, // SCH->FP_CHOOSER symbol pin & fp_filter information
  MAIL_PCB_UPDATE, // SCH->PCB forward update
  MAIL_SCH_UPDATE, // PCB->SCH forward update
  MAIL_IMPORT_FILE, // Import a different format file
  MAIL_SCH_GET_NETLIST, // Fetch a netlist from schematics
  MAIL_SCH_GET_ITEM, // Fetch item from KIID
  MAIL_PCB_GET_NETLIST, // Fetch a netlist from PCB layout
  MAIL_PCB_UPDATE_LINKS, // Update the schematic symbol paths in the PCB's footprints
  MAIL_SCH_REFRESH, // Tell the schematic editor to refresh the display.
  MAIL_ADD_LOCAL_LIB, // Add a local library to the project library table
  MAIL_LIB_EDIT,
  MAIL_FP_EDIT,
  MAIL_RELOAD_LIB, // Reload Library List if one was added
  MAIL_RELOAD_PLUGINS, // Reload python plugins
  MAIL_REFRESH_SYMBOL, // Refresh symbol in symbol viewer
  MAIL_SCH_NAVIGATE_TO_SHEET, // Navigate to sheet by filename if in hierarchy
}
