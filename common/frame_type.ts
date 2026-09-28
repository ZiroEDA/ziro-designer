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

/** One page in the Preferences book. The web mirror of KiCad's `PANEL_*`
 *  ids (this file's `frame_type.h`); moved from designer's dialogs/prefs/types.ts. */
export type PrefsPageId =
  | 'common'
  | 'mouse'
  // Upstream this one is `#if defined(__linux__) || defined(__FreeBSD__)`
  // (`common/eda_base_frame.cpp:1590`). The parity target is a Linux build, so
  // it is in the tree.
  | 'spacemouse'
  | 'hotkeys'
  | 'version-control'
  // `PANEL_SYM_DISP_OPTIONS`, `PANEL_SYM_EDIT_GRIDS`, `PANEL_SYM_EDIT_OPTIONS`,
  // `PANEL_SYM_COLORS`, `PANEL_SYM_TOOLBARS` (`include/frame_type.h:72-76`),
  // added in that order at `common/eda_base_frame.cpp:1633-1637`.
  | 'sym-display'
  | 'sym-grids'
  | 'sym-editing'
  | 'sym-colors'
  | 'sym-toolbars'
  | 'sch-display'
  | 'sch-grids'
  | 'sch-editing'
  | 'sch-colors'
  | 'sch-toolbars'
  | 'sch-fields'
  | 'sch-datasources'
  | 'sch-simulator'
  // The Footprint Editor's nine, added at `common/eda_base_frame.cpp:1667-1675`
  // in this order. Upstream's ids are `PANEL_FP_DISPLAY_OPTIONS`,
  // `PANEL_FP_GRIDS`, `PANEL_FP_ORIGINS_AXES`, `PANEL_FP_EDIT_OPTIONS`,
  // `PANEL_FP_COLORS`, `PANEL_FP_TOOLBARS`, `PANEL_FP_DEFAULT_FIELDS`,
  // `PANEL_FP_DEFAULT_GRAPHICS_VALUES` and `PANEL_FP_USER_LAYER_NAMES`.
  | 'fp-display'
  | 'fp-grids'
  | 'fp-origins'
  | 'fp-editing'
  | 'fp-colors'
  | 'fp-toolbars'
  | 'fp-defaults'
  | 'fp-graphics'
  | 'fp-userlayers'
  | 'pcb-display'
  | 'pcb-origins'
  | 'pcb-editing'
  | 'pcb-colors'
  | 'pcb-grids'
  | 'pcb-toolbars'
  // `PANEL_3DV_TOOLBARS`, the second row under the 3D Viewer heading (`:1694`).
  | '3dv-general'
  | '3dv-opengl'
  | '3dv-toolbars'
  // gerbview's KIFACE is consulted after pcbnew's and before pl_editor's, and
  // its five ids are `PANEL_GBR_DISPLAY_OPTIONS`, `PANEL_GBR_COLORS`,
  // `PANEL_GBR_TOOLBARS`, `PANEL_GBR_GRIDS`, `PANEL_GBR_EXCELLON_OPTIONS`
  // (`common/eda_base_frame.cpp:1714-1718`). `frame_type.h:111` declares a
  // sixth, `PANEL_GBR_EDIT_OPTIONS`, that `ShowPreferences` never adds and
  // `gerbview.cpp`'s switch never constructs: a dead enumerator, not a page.
  | 'gbr-display'
  | 'gbr-colors'
  | 'gbr-toolbars'
  | 'gbr-grids'
  | 'gbr-excellon'
  | 'ds-display'
  | 'ds-grids'
  | 'ds-colors'
  | 'ds-toolbars'
  | 'maintenance';
