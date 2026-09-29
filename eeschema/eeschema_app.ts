// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the program gives the Schematic Editor's window (`SCH_EDIT_FRAME`) —
 * `Pgm()`'s `eeschema.json` / `common.json` slices and the colour theme,
 * and, as the frame's other designer-only reaches are threaded through, the
 * dialogs, libraries and services it asks the app for. The same shape
 * `pcbnew/browser/pcbnew_app.ts`'s `PCBNEW_APP` and `cvpcb/cvpcb_mainframe_ui.tsx`'s
 * `CVPCB_APP` give their windows. `eeschema` never imports `designer`; the
 * designer-side `useEeschemaApp()` hook
 * (`designer/src/editors/schematic/eeschema_app.tsx`) is the one file that
 * wires this interface back to what designer actually has.
 */
import type { ForwardRefExoticComponent, ReactNode, RefAttributes } from 'react';
import type { CommonSettings } from '@ziroeda/common/settings/common_settings.js';
import type { FpLibRow } from '@ziroeda/common/fp_lib_table.js';
import type { PrefsPageId } from '@ziroeda/common/frame_type.js';
import type { ChooserFilter, OpenedFile } from '@ziroeda/common/wx/filedlg.js';
import type { ToolEntry } from '@ziroeda/common/tool/action_toolbar_types.js';
import type { ToolbarDefaults, ToolbarLoc } from '@ziroeda/common/tool/ui/toolbar_configuration.js';
import type { KeyLike } from '@ziroeda/common/hotkeys_basic_keys.js';
import type { Menu } from '@ziroeda/common/tool/action_menu_types.js';
import type { LibSymbol, Schematic } from './types.js';
import type { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import type { ProjectFile } from '@ziroeda/common/project_paths.js';
import type { RawFile } from '@ziroeda/common';
import type { CanvasController, SchematicCanvasProps } from './sch_draw_panel.js';
import type { DialogSymbolChooserProps } from './picksymbol.js';
import type { DialogRescueEachProps } from './project_rescue.js';
import type { DialogChangeSymbolsProps } from './tools/change_symbols.js';
import type {
  PeerRole,
  PresenceInfo,
  ProjectSyncTransport,
} from './browser/project_sync_transport.js';
import type { EeschemaSettings } from './eeschema_settings.js';
import type { Theme } from './sch_render_settings.js';

/**
 * `Pgm().GetSettingsManager()`, the part the frame reads and writes: the
 * `eeschema.json` and `common.json` slices, live (not a render snapshot), and
 * the user's hotkey overrides.
 */
export interface EESCHEMA_SETTINGS_STORE {
  readonly eeschema: EeschemaSettings;
  readonly common: CommonSettings;
  /** `user.hotkeys`: action name to key, `null` for unbound. */
  readonly hotkeys: Record<string, string | null>;
  updateEeschema(mutate: (s: EeschemaSettings) => void): void;
  updateCommon(mutate: (c: CommonSettings) => void): void;
}

/** The Open dialog over the account's files, the props the frame passes. */
export interface EeschemaOpenFileDialogProps {
  filters?: readonly ChooserFilter[];
  title?: string;
  accept?: string;
  onDone: (file: OpenedFile | null) => void;
}

/** The Save As dialog, the props the frame passes. */
export interface EeschemaSaveAsDialogProps {
  title?: string;
  initialName: string;
  filters?: readonly ChooserFilter[];
  projectDir?: string | null;
  initialPath?: string;
  onDone: (path: string | null, placeId?: string) => void;
}

/** One hosted footprint library, as far as ERC's footprint tests read it. */
export interface EeschemaFootprintIndexLibrary {
  name: string;
  footprints: readonly string[];
}

/** One hosted symbol library in the index, as far as the frame reads it. */
export interface EeschemaSymbolIndexLibrary {
  name: string;
  symbols: readonly string[];
}

/** A loaded footprint, as far as ERC's pad tests read it. */
export interface EeschemaFootprintPads {
  pads: readonly { number: string }[];
}

export interface EESCHEMA_APP {
  // ----- windows/dialogs (component-shaped, called as JSX) ----------------
  /** SCH_DRAW_PANEL: the canvas (its contract is `sch_draw_panel.ts`). */
  SchematicCanvas: ForwardRefExoticComponent<
    SchematicCanvasProps & RefAttributes<CanvasController>
  >;
  /** `DIALOG_SYMBOL_CHOOSER`, `PickSymbolFromLibrary`'s dialog (`picksymbol.ts`). */
  DialogSymbolChooser: (props: DialogSymbolChooserProps) => ReactNode;
  /** `SYMBOL_VIEWER_FRAME`, the Symbol Library Browser. */
  SymbolLibraryBrowser: (props: {
    onPick: (lib: LibSymbol) => void;
    onClose: () => void;
  }) => ReactNode;
  /** `DIALOG_RESCUE_EACH` (`project_rescue.ts` holds its contract). */
  DialogRescueEach: (props: DialogRescueEachProps) => ReactNode;
  /** `DIALOG_CHANGE_SYMBOLS` (`tools/change_symbols.ts` holds its contract). */
  DialogChangeSymbols: (props: DialogChangeSymbolsProps) => ReactNode;
  /** `EDA_BASE_FRAME::ShowPreferences()`, opened on a page. */
  PreferencesDialog: (props: { initialPage?: PrefsPageId; onClose: () => void }) => ReactNode;
  /** The home link in the menu bar's left slot. */
  HomeLink: (props: { onClick?: () => void }) => ReactNode;
  OpenFileDialog: (props: EeschemaOpenFileDialogProps) => ReactNode;
  SaveAsDialog: (props: EeschemaSaveAsDialogProps) => ReactNode;
  /** Preferences > Manage Symbol Libraries (`PANEL_SYM_LIB_TABLE`). */
  DialogSymLibTable: (props: {
    projectFiles: readonly { name: string; text: string }[];
    globalLibraries: readonly string[];
    globalBase: string;
    onSave: (rows: FpLibRow[]) => void;
    onClose: () => void;
  }) => ReactNode;
  /** `FRAME_FOOTPRINT_CHOOSER`, with the hosted footprint library reads baked in. */
  FootprintChooserFrame: (props: {
    preselect?: string;
    fpFilters?: readonly string[];
    pinCount?: number;
    onOk: (libId: string) => void;
    onCancel: () => void;
  }) => ReactNode;

  // ----- toolbars ------------------------------------------------------
  useToolbarEntries(app: 'eeschema', loc: ToolbarLoc, defaults: ToolbarDefaults): ToolEntry[];

  // ----- footprint libraries (ERC's footprint tests) ------------------------
  loadFootprintIndex(): Promise<readonly EeschemaFootprintIndexLibrary[]>;
  loadFootprint(libId: string): Promise<EeschemaFootprintPads | null>;

  // ----- settings ----------------------------------------------------------
  settings: EESCHEMA_SETTINGS_STORE;
  /** The `eeschema.json` slice for this render (re-renders on change). */
  useEeschemaSettings(): EeschemaSettings;
  /** The `common.json` slice for this render. */
  useCommonSettings(): CommonSettings;
  /** The hotkey overrides for this render. */
  useHotkeyOverrides(): Record<string, string | null>;
  /** `SCH_RENDER_SETTINGS::LoadColors` of the active colour theme, for this render. */
  useSchematicTheme(): Theme;
  /** Whether a colour theme overrides item colours (a user theme's own flag). */
  overrideItemColorsFor(themeId: string): boolean;

  // ----- symbol libraries -------------------------------------------------
  /** The hosted symbol library index (names and their symbols). */
  loadIndex(): Promise<readonly EeschemaSymbolIndexLibrary[]>;
  /** One symbol from a hosted library, by library nickname and item name. */
  loadSymbol(library: string, symbolName: string): Promise<LibSymbol | undefined>;
  /** Where the hosted symbol libraries are served from. */
  symbolsBase(): string;
  /** A hosted library's `.kicad_sym` URI. */
  libraryUri(library: string): string;
  /** Warm the symbol and footprint libraries a set of sheets uses. */
  preloadSchematicLibraries(docs: Iterable<Schematic>): void;

  // ----- hotkeys -------------------------------------------------------
  /** The event the user's hotkey overrides turn a keystroke into (null: swallowed). */
  remapEvent<T extends KeyLike>(
    e: T,
    overrides?: Readonly<Record<string, string | null>>,
  ): KeyLike | null;
  /** The menus with the user's own keys shown against each action. */
  applyHotkeyOverrides(
    menus: readonly Menu[],
    overrides: Readonly<Record<string, string | null>>,
  ): Menu[];

  // ----- live collaboration ------------------------------------------------
  /** The project's shared live connection, or null when there is none. */
  useProjectSync(): ProjectSyncTransport | null;
  /** The signed-in account, as far as presence reads it (its email). */
  useAuth(): { session: { user: { email?: string | null } } | null };
  /** The presence popover the "N other viewers" badge opens. */
  PresencePanel: (props: {
    me: { peerId: string; role: PeerRole; displayName: string | null };
    peers: readonly PresenceInfo[];
    onSetRole: (peerId: string, role: 'editor' | 'viewer') => void;
    onClose: () => void;
  }) => ReactNode;

  // ----- the other KIWAY players --------------------------------------------
  // eeschema reaches CvPcb and pcbnew through the app, as upstream reaches
  // them through KIWAY: `cvpcb` imports eeschema, so a direct import back
  // would be a package cycle, and eeschema takes no pcbnew dependency.

  /** CvPcb's Assign Footprints window (`FRAME_CVPCB`), given this project. */
  AssignFootprints: (props: {
    docs: ReadonlyMap<string, Schematic>;
    files?: readonly string[];
    projectFootprints?: readonly { name: string; text: string }[];
    kiway?: KIWAY;
    onSaveLibTable?: (rows: FpLibRow[]) => void;
    onSaveEquFiles?: (files: readonly string[], newFiles: readonly ProjectFile[]) => void;
    onClose: () => void;
  }) => ReactNode;
  /**
   * `PCB_EDIT_FRAME::FetchNetlistFromSchematic`'s headless path over a set of
   * project files: the netlist text, when it reads back as a netlist.
   */
  fetchNetlistFromSchematic(
    files: readonly RawFile[],
    annotateMessage: string,
    rootPro?: string,
  ): { ok: true; netlistText: string } | { ok: false };
  /**
   * The cross-probe view decision both frames spell identically
   * (`SCH_SELECTION_TOOL::SyncSelection`, `PCB_SELECTION_TOOL::…`); the zoom
   * LUT is the caller's.
   */
  crossProbeViewChange(
    cfg: CROSS_PROBING_SETTINGS,
    bbox: { minX: number; minY: number; maxX: number; maxY: number } | null,
    view: { scale: number; cx: number; cy: number },
    canvas: { width: number; height: number },
    zoomScale?: (
      bbox: { minX: number; minY: number; maxX: number; maxY: number },
      screen: { x: number; y: number },
      scale: number,
    ) => number | null,
  ): { scale: number; cx: number; cy: number } | null;
  /** The selection shown at a cross-probe flash phase. */
  crossProbeFlashSelection(phase: number, ids: readonly string[]): readonly string[];
  /** The flash timer's period and last phase. */
  CROSS_PROBE_FLASH_INTERVAL_MS: number;
  CROSS_PROBE_FLASH_LAST_PHASE: number;
}
