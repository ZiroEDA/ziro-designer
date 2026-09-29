// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the program gives the Symbol Editor's window (`SYMBOL_EDIT_FRAME`) —
 * `Pgm()`'s `symbol_editor.json` / `common.json` slices and the colour theme,
 * the hosted symbol libraries and the ones the Plugin and Content Manager
 * installed, and the app's own dialogs and canvas. The same shape as
 * `eeschema_app.ts`'s `EESCHEMA_APP`; `eeschema` never imports `designer`,
 * and the designer-side `useSymbolEditFrameApp()`
 * (`designer/src/editors/symbol/symbol_edit_frame_app.tsx`) is the one file
 * that answers it.
 */
import type { ForwardRefExoticComponent, ReactNode, RefAttributes } from 'react';
import type { CommonSettings } from '@ziroeda/common/settings/common_settings.js';
import type { PrefsPageId } from '@ziroeda/common/frame_type.js';
import type { ChooserFilter, OpenedFile } from '@ziroeda/common/wx/filedlg.js';
import type { ToolEntry } from '@ziroeda/common/tool/action_toolbar_types.js';
import type { ToolbarDefaults, ToolbarLoc } from '@ziroeda/common/tool/ui/toolbar_configuration.js';
import type { Theme } from '../sch_render_settings.js';
import type { SymbolEditorSettings } from './symbol_editor_settings.js';
import type { SymbolCanvasController, SymbolCanvasProps } from '../sch_draw_panel.js';

/** `Pgm().GetSettingsManager()`, the part the Symbol Editor reads and writes. */
export interface SYMBOL_EDITOR_SETTINGS_STORE {
  readonly symbolEditor: SymbolEditorSettings;
  readonly common: CommonSettings;
  updateSymbolEditor(mutate: (s: SymbolEditorSettings) => void): void;
  updateCommon(mutate: (c: CommonSettings) => void): void;
}

/** One hosted symbol library in the index, as far as the frame reads it. */
export interface SymbolEditorIndexLibrary {
  name: string;
  symbols: string[];
  descr?: string;
}

export interface SYMBOL_EDIT_FRAME_APP {
  // ----- settings ----------------------------------------------------------
  settings: SYMBOL_EDITOR_SETTINGS_STORE;
  useSymbolEditorSettings(): SymbolEditorSettings;
  useCommonSettings(): CommonSettings;
  /** The Symbol Editor's colour theme (its own, or the schematic's). */
  useSymbolEditorTheme(): Theme;

  // ----- libraries -----------------------------------------------------
  /** The hosted symbol library index. */
  loadIndex(): Promise<readonly SymbolEditorIndexLibrary[]>;
  /** Where the hosted symbol libraries are served from. */
  symbolsBase(): string;
  /** The libraries the Plugin and Content Manager installed, as `.kicad_sym` text. */
  installedLibraries(): readonly { name: string; text: string }[];

  // ----- toolbars ------------------------------------------------------
  useToolbarEntries(app: 'symbol_editor', loc: ToolbarLoc, defaults: ToolbarDefaults): ToolEntry[];

  // ----- windows/dialogs (component-shaped, called as JSX) ----------------
  /** The symbol editor's canvas (its contract is in `sch_draw_panel.ts`). */
  SymbolCanvas: ForwardRefExoticComponent<
    SymbolCanvasProps & RefAttributes<SymbolCanvasController>
  >;
  /** `EDA_BASE_FRAME::ShowPreferences()`, opened on this frame's section. */
  PreferencesDialog: (props: {
    onClose: () => void;
    frameOwner: 'symbol';
    initialPage?: PrefsPageId;
  }) => ReactNode;
  /** The home link in the menu bar's left slot. */
  HomeLink: (props: { onClick?: () => void }) => ReactNode;
  /** The Open dialog over the account's files, on the symbol-library folder. */
  OpenFileDialog: (props: {
    title?: string;
    accept?: string;
    kind?: 'symbols';
    filters?: readonly ChooserFilter[];
    onDone: (file: OpenedFile | null) => void;
  }) => ReactNode;
  /** The "still loading" pane the library tree shows. */
  LibraryLoadingPanel: (props: {
    kind?: 'symbols';
    fallback?: ReactNode;
    label?: string;
  }) => ReactNode;
}
