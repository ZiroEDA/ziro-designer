// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the program gives `pcb_edit_frame_ui.tsx`'s window — `Pgm()` (the
 * `pcbnew.json`/`common.json` slices, the language, the colour themes with
 * the user's overrides), the Preferences and Save As dialogs, the 3D viewer,
 * the footprint chooser and its hosted library index, and the way home —
 * the same shape `cvpcb/cvpcb_mainframe_ui.tsx`'s `CVPCB_APP` and
 * `pagelayout_editor/pl_editor_frame_ui.tsx`'s `PL_EDITOR_APP` already give
 * their windows. `pcbnew` never imports `designer`; the designer-side
 * `usePcbnewApp()` hook (`designer/src/editors/pcb/pcbnew_app.tsx`) is the
 * one file that wires this interface back to what designer actually has,
 * the same way `cvpcb_app.tsx` does for `CVPCB_APP`.
 */
import type { ReactNode } from 'react';
import type { PCBNEW_JSON_SETTINGS_LIKE } from '../pcb_edit_frame.js';
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import type { WINDOW_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import type { ToolbarDefaults, ToolbarLoc } from '@ziroeda/common/tool/ui/toolbar_configuration.js';
import type { ToolEntry } from '@ziroeda/common/tool/action_toolbar_types.js';
import type { FootprintIndexLibrary } from '../footprint_info_impl.js';
import type { PcbFootprint, Board } from '../types.js';
import type { NetClassAssignmentLike } from '@ziroeda/common/netclass_resolve.js';

/** `SaveAsDialog`'s props, the slice `PcbEditor` actually passes. */
export interface PcbnewSaveAsDialogProps {
  title?: string;
  initialName: string;
  filters?: readonly ChooserFilter[];
  projectDir?: string | null;
  initialPath?: string;
  onDone: (path: string | null, placeId?: string) => void;
}

/**
 * `FootprintChooserFrame`'s props, unchanged — including
 * `loadFootprintIndex`/`loadFootprint`, which `PcbEditor.tsx` already gets
 * from `PCBNEW_APP` itself (see `footprint_chooser_frame.tsx`'s own doc
 * comment: "the seam PCBNEW_APP / CVPCB_APP give a frame; this dialog is
 * not a `_ui.tsx` frame yet, so it takes the two functions directly").
 */
export interface PcbnewFootprintChooserFrameProps {
  preselect?: string;
  fpFilters?: readonly string[];
  pinCount?: number;
  onOk: (libId: string) => void;
  onCancel: () => void;
  loadFootprintIndex: () => Promise<FootprintIndexLibrary[]>;
  loadFootprint: (libId: string) => Promise<PcbFootprint | null>;
}

/** `settings.common`, the fields `PcbEditor` reads at render time. */
export interface PcbnewCommonSettingsLike {
  appearance: { hicontrast_dimming_factor: number };
  input: { immediate_actions: boolean };
  system: { clear_3d_cache_interval: number; language: string };
  graphics: { antialiasing_mode: number };
  /** `APP_SETTINGS_BASE::m_SearchPane`, the docked Search pane's menu. */
  search_pane: {
    selection_zoom: 'none' | 'pan' | 'zoom';
    search_hidden_fields: boolean;
    search_metadata: boolean;
  };
}

/** The designer's grid and cursor preferences, the half of `m_Window` the GAL reads. */
export interface WindowGridCursorPrefsLike {
  style: 'dots' | 'lines' | 'crosses';
  line_width: number;
  min_spacing: number;
  snap: 0 | 1 | 2;
  crosshair: 'small' | 'full' | '45';
  always_show_cursor: boolean;
}

export interface PCBNEW_APP {
  // ----- windows/dialogs (component-shaped, called as JSX) ----------------
  /** `EDA_BASE_FRAME::ShowPreferences()`. */
  PreferencesDialog: (props: { onClose: () => void }) => ReactNode;
  /** The home link in the menu bar's left slot. */
  HomeLink: (props: { onClick?: () => void }) => ReactNode;
  SaveAsDialog: (props: PcbnewSaveAsDialogProps) => ReactNode;
  /** `DIALOG_FOOTPRINT_CHOOSER`, with the two library reads baked in. */
  FootprintChooserFrame: (props: PcbnewFootprintChooserFrameProps) => ReactNode;
  /** The 3D viewer child frame; every prop is the caller's own board state,
   *  so this stays untyped here rather than importing 3d-viewer's types. */
  Viewer3DFrame: (props: Record<string, unknown>) => ReactNode;

  // ----- settings ----------------------------------------------------------
  /** `usePcbnewSettings()`'s value for this render — `pcbnew.json`. */
  pcbnewSettings: PCBNEW_JSON_SETTINGS_LIKE;
  /** `useCommonSettings()`'s value for this render — `common.json`. */
  commonSettings: PcbnewCommonSettingsLike;
  updatePcbnewSettings(mutate: (s: PCBNEW_JSON_SETTINGS_LIKE) => void): void;
  updateCommonSettings(mutate: (c: PcbnewCommonSettingsLike) => void): void;
  /**
   * `settings.common.input.immediate_actions`, read live at call time — not
   * the render snapshot: the one call site is a `useEffect` gated on the
   * active tool alone, which must see a preference changed after the effect
   * last ran, the same way the direct singleton read it replaces did.
   */
  commonInputImmediateActionsLive(): boolean;
  /** `PGM_BASE::InitPgm` (`Pgm().GetCommonSettings()`), live, for the GAL. */
  commonSettingsOf(): COMMON_SETTINGS_LIKE;
  /** `APP_SETTINGS_BASE::m_Window.grid`/`.cursor`, from a `WindowGridCursorPrefs`-shaped object. */
  windowSettingsOf(prefs: WindowGridCursorPrefsLike): WINDOW_SETTINGS;
  /** `PGM_BASE::InitPgm` + pcbnew's KIFACE settings registration. */
  installPgm(): void;
  reloadUserColorSettings(): void;
  userColors: Record<string, string>;
  userThemes: Record<string, { name: string; colors: Record<string, string> }>;

  // ----- toolbars ------------------------------------------------------
  useToolbarEntries(app: 'pcbnew', loc: ToolbarLoc, defaults: ToolbarDefaults): ToolEntry[];

  // ----- footprint libraries / 3D cache ------------------------------------
  loadFootprintIndex(): Promise<FootprintIndexLibrary[]>;
  loadFootprint(libId: string): Promise<PcbFootprint | null>;
  preloadBoardLibraries(board: Board): void;
  cleanup3dCache(clearCacheInterval: number): Promise<number>;

  // ----- misc ----------------------------------------------------------
  EMPTY_PCB: string;
  /**
   * `NET_SETTINGS::SetNetclassPatternAssignment` with bus-pattern expansion
   * (`eeschema/tools/assign_netclass.ts`'s `addNetclassAssignment` — the
   * expansion needs schematic bus notation, `parseBusVector`/`parseBusGroup`,
   * so it cannot move to `common/` the way `netclass_resolve.ts`'s read side
   * did). `pcbnew` may not import `eeschema` directly.
   */
  addNetclassAssignment(
    assignments: readonly NetClassAssignmentLike[],
    pattern: string,
    netClass: string,
  ): NetClassAssignmentLike[];
}
