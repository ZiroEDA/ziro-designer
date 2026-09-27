// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FRAME_T` (include/frame_type.h): the set of #EDA_BASE_FRAME derivatives,
 * typically stored in EDA_BASE_FRAME::m_Ident.
 */
export enum FRAME_T {
  FRAME_SCH = 0,
  FRAME_SCH_SYMBOL_EDITOR,
  FRAME_SCH_VIEWER,
  FRAME_SYMBOL_CHOOSER,
  FRAME_SIMULATOR,
  FRAME_SCH_DIFF,
  FRAME_SYM_DIFF,

  FRAME_PCB_EDITOR,
  FRAME_FOOTPRINT_EDITOR,
  FRAME_FOOTPRINT_CHOOSER,
  FRAME_FOOTPRINT_VIEWER,
  FRAME_FOOTPRINT_WIZARD,
  FRAME_PCB_DISPLAY3D,
  FRAME_FOOTPRINT_PREVIEW,
  FRAME_PCB_DIFF,
  FRAME_FOOTPRINT_DIFF,

  FRAME_CVPCB,
  FRAME_CVPCB_DISPLAY,

  FRAME_PYTHON,

  FRAME_GERBER,

  FRAME_PL_EDITOR,

  FRAME_BM2CMP,

  FRAME_CALC,

  KIWAY_PLAYER_COUNT, // counts subset of FRAME_T's which are KIWAY_PLAYER derivatives
  KICAD_MAIN_FRAME_T = KIWAY_PLAYER_COUNT,

  FRAME_T_COUNT,

  PANEL_SYM_DISP_OPTIONS = FRAME_T_COUNT,
  PANEL_SYM_EDIT_GRIDS,
  PANEL_SYM_EDIT_OPTIONS,
  PANEL_SYM_COLORS,
  PANEL_SYM_TOOLBARS,

  PANEL_SCH_DISP_OPTIONS,
  PANEL_SCH_GRIDS,
  PANEL_SCH_EDIT_OPTIONS,
  PANEL_SCH_COLORS,
  PANEL_SCH_TOOLBARS,
  PANEL_SCH_FIELD_NAME_TEMPLATES,
  PANEL_SCH_SIMULATOR,
  PANEL_SCH_DATA_SOURCES,

  PANEL_FP_DISPLAY_OPTIONS,
  PANEL_FP_GRIDS,
  PANEL_FP_EDIT_OPTIONS,
  PANEL_FP_COLORS,
  PANEL_FP_TOOLBARS,
  PANEL_FP_DEFAULT_FIELDS,
  PANEL_FP_DEFAULT_GRAPHICS_VALUES,
  PANEL_FP_USER_LAYER_NAMES,
  PANEL_FP_ORIGINS_AXES,

  PANEL_PCB_DISPLAY_OPTS,
  PANEL_PCB_GRIDS,
  PANEL_PCB_EDIT_OPTIONS,
  PANEL_PCB_COLORS,
  PANEL_PCB_TOOLBARS,
  PANEL_PCB_ACTION_PLUGINS,
  PANEL_PCB_ORIGINS_AXES,

  PANEL_3DV_DISPLAY_OPTIONS,
  PANEL_3DV_OPENGL,
  PANEL_3DV_RAYTRACING,
  PANEL_3DV_TOOLBARS,

  PANEL_GBR_DISPLAY_OPTIONS,
  PANEL_GBR_EDIT_OPTIONS,
  PANEL_GBR_EXCELLON_OPTIONS,
  PANEL_GBR_GRIDS,
  PANEL_GBR_COLORS,
  PANEL_GBR_TOOLBARS,

  PANEL_DS_DISPLAY_OPTIONS,
  PANEL_DS_GRIDS,
  PANEL_DS_COLORS,
  PANEL_DS_TOOLBARS,

  // Library table dialogs are transient and are never returned
  DIALOG_CONFIGUREPATHS,
  DIALOG_DESIGN_BLOCK_LIBRARY_TABLE,
  DIALOG_SCH_LIBRARY_TABLE,
  DIALOG_PCB_LIBRARY_TABLE,
}

/** `ARC_EDIT_MODE` (include/settings/app_settings.h:58). */
export enum ARC_EDIT_MODE {
  /**
   * When editing endpoints, the angle and radius are adjusted.
   * When editing the midpoint, the radius is adjusted.
   * When editing the center, the arcs is moved
   */
  KEEP_CENTER_ADJUST_ANGLE_RADIUS,
  /**
   * When editing endpoints, the other end point remains fixed and the center is adjusted
   * (radius follows). When editing the midpoint, the endpoints remain fixed and the
   * radius is adjusted. When editing the center, the arc is moved
   */
  KEEP_ENDPOINTS_OR_START_DIRECTION,
  /**
   * When editing endpoints, the center is kept and the angle changes.
   * When editing the midpoint, the radius is adjusted.
   * When editing the center, the arcs is moved
   */
  KEEP_CENTER_ENDS_ADJUST_ANGLE,
}

/** The `wxID_*` a TOOL_ACTION can carry as its custom UI id (wx/defs.h, wxID_LOWEST = 4999). */
export enum wxID {
  wxID_OPEN = 5000,
  wxID_CLOSE,
  wxID_NEW,
  wxID_SAVE,
  wxID_SAVEAS,
  wxID_REVERT,
  wxID_EXIT,
  wxID_UNDO,
  wxID_REDO,
  wxID_HELP,
  wxID_PRINT,
  wxID_PRINT_SETUP,
  wxID_PAGE_SETUP,
  wxID_PREVIEW,
  wxID_ABOUT,
  wxID_HELP_CONTENTS,
  wxID_HELP_INDEX,
  wxID_HELP_SEARCH,
  wxID_HELP_COMMANDS,
  wxID_HELP_PROCEDURES,
  wxID_HELP_CONTEXT,
  wxID_CLOSE_ALL,
  wxID_PREFERENCES,

  wxID_EDIT = 5030,
  wxID_CUT,
  wxID_COPY,
  wxID_PASTE,
}
