// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The contract between the Preferences shell and the panels it shows.
 *
 * Upstream a preferences panel is a `RESETTABLE_PANEL` that the owning app
 * constructs on demand — `KIFACE::CreateKiWindow( parent, PANEL_<ID>, kiway )`
 * (`eeschema/eeschema.cpp:304-320`, `pcbnew/pcbnew.cpp:306-485`) — and the
 * dialog (`EDA_BASE_FRAME::ShowPreferences`, `common/eda_base_frame.cpp:1585`)
 * only ever names it by its `PANEL_*` id. The dialog asks; the app constructs.
 *
 * Ours mirrors that: `PrefsPageId` is the `PANEL_*` enum, `PrefsPanelFactory`
 * is `CreateKiWindow`, and `PrefsPanelModule.reset` is `ResetPanel`.
 *
 * The one thing the C++ gets for free and we do not: wx panels write straight
 * into the settings object, while ours edit a working copy the shell commits on
 * OK. So the factory is handed a `PrefsContext` carrying that working copy and
 * its setters. The setters are React dispatchers with exactly the signatures the
 * inlined panels used before the split, so a moved panel body is unchanged text.
 *
 * This is the ONLY module in the shared prefs code that names an editor path,
 * and it does so with `import type`, which erases at build time: no runtime edge
 * exists, so a lazily-loaded editor bundle stays out of the dialog. (That
 * `HotkeyOverrides` lives under `editors/schematic/` at all is pre-existing debt
 * — upstream it is `common/hotkeys_basic.cpp`, app-wide. Not moved here; a
 * refactor that also relocates it could not be reviewed as a no-op.)
 */
import type { Dispatch, SetStateAction } from 'react';
import type { HotkeyOverrides } from '../../editors/schematic/hotkey_bindings.js';
import type {
  CommonSettings,
  EeschemaSettings,
  GerbviewSettings,
  PcbnewSettings,
  PlEditorSettings,
  PrivacySettings,
  FpEditSettings,
  SymbolEditorSettings,
  ToolbarApp,
  UserColorTheme,
  Viewer3dSettings,
} from '../../prefs/settings.js';
import type { ToolbarSettings } from '../../ui/toolbar_config.js';

/** One page in the book. The web mirror of KiCad's `PANEL_*` ids. */
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
  // `PANEL_FP_TOOLBARS`, the sixth row under the Footprint Editor heading
  // (`common/eda_base_frame.cpp:1672`).
  | 'fp-toolbars'
  | 'pcb-display'
  | 'pcb-grids'
  | 'pcb-toolbars'
  // `PANEL_3DV_TOOLBARS`, the second row under the 3D Viewer heading (`:1694`).
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

/** Which module owns a page, and therefore which bundle it is lazily pulled from. */
export type PrefsPageOwner =
  | 'generic'
  | 'symbol'
  | 'schematic'
  // Upstream the Footprint Editor's pages come out of pcbnew's KIFACE, the same
  // `CreateKiWindow` switch the board editor's do. Its own owner here for the
  // reason the Symbol Editor has one: the two editors are separate bundles, and
  // routing this page through the board's factory would pull `editors/pcb` in
  // whenever a footprint-editor user opened Preferences.
  | 'footprint'
  | 'pcb'
  | 'gerbview'
  | 'drawingsheet';

/**
 * The working copy the dialog edits, plus its setters. Handed to every panel;
 * a panel touches only the slices it owns.
 */
export interface PrefsContext {
  common: CommonSettings;
  eeschema: EeschemaSettings;
  /**
   * `symbol_editor.json`. A settings object of its own, not a slice of
   * eeschema's — see {@link SymbolEditorSettings}. Upstream the same KIFACE
   * hands out both, and the panels differ only in which one they are given.
   */
  symbolEditor: SymbolEditorSettings;
  pcbnew: PcbnewSettings;
  /** `fpedit.json` — the Footprint Editor's own file (`pcbnew.cpp:381`). */
  fpEdit: FpEditSettings;
  /** `3d_viewer.json` — the 3D Viewer's own file (`pcbnew.cpp:483`). */
  viewer3d: Viewer3dSettings;
  /** `gerbview.json` — see {@link GerbviewSettings}. */
  gerbview: GerbviewSettings;
  plEditor: PlEditorSettings;
  privacy: PrivacySettings;
  userColors: Record<string, string>;
  /** Every theme "New Theme..." made — see {@link UserColorTheme}. */
  userThemes: Record<string, UserColorTheme>;
  hotkeys: HotkeyOverrides;
  /**
   * Each app's `TOOLBAR_SETTINGS`, which upstream is a second object the KIFACE
   * hands the Toolbars page beside `APP_SETTINGS_BASE`:
   *
   *     PANEL_TOOLBAR_CUSTOMIZATION( aParent, cfg, tb, FRAME_PL_EDITOR, … )
   *     (pagelayout_editor/pl_editor.cpp:85-100)
   *
   * It is not part of any app's settings object because upstream it is not part
   * of any app's settings FILE — `pl_editor-toolbars.json` sits beside
   * `pl_editor.json`.
   */
  toolbars: Record<ToolbarApp, ToolbarSettings>;
  /** Mutate a clone of the common settings (KiCad edits `COMMON_SETTINGS` in place). */
  upC: (fn: (s: CommonSettings) => void) => void;
  upE: (fn: (s: EeschemaSettings) => void) => void;
  /** Mutate a clone of `symbol_editor.json`'s working copy. */
  upSym: (fn: (s: SymbolEditorSettings) => void) => void;
  upP: (fn: (s: PcbnewSettings) => void) => void;
  /** Mutate a clone of `fpedit.json`'s working copy. */
  upFp: (fn: (s: FpEditSettings) => void) => void;
  /** Mutate a clone of `3d_viewer.json`'s working copy. */
  up3d: (fn: (s: Viewer3dSettings) => void) => void;
  /** Mutate a clone of `gerbview.json`'s working copy. */
  upGbr: (fn: (s: GerbviewSettings) => void) => void;
  upPl: (fn: (s: PlEditorSettings) => void) => void;
  /** Mutate a clone of one app's stored toolbars. */
  upTb: (app: ToolbarApp, fn: (s: ToolbarSettings) => void) => void;
  setCommon: Dispatch<SetStateAction<CommonSettings>>;
  setEeschema: Dispatch<SetStateAction<EeschemaSettings>>;
  setSymbolEditor: Dispatch<SetStateAction<SymbolEditorSettings>>;
  setPcbnew: Dispatch<SetStateAction<PcbnewSettings>>;
  setGerbview: Dispatch<SetStateAction<GerbviewSettings>>;
  setPlEditor: Dispatch<SetStateAction<PlEditorSettings>>;
  setPrivacy: Dispatch<SetStateAction<PrivacySettings>>;
  setUserColors: Dispatch<SetStateAction<Record<string, string>>>;
  setUserThemes: Dispatch<SetStateAction<Record<string, UserColorTheme>>>;
  setHotkeys: Dispatch<SetStateAction<HotkeyOverrides>>;
  /**
   * `wxQueueEvent( m_parent, new wxCommandEvent( …, wxID_CANCEL ) )` — close
   * the dialog DISCARDING the working copy.
   *
   * Only `PANEL_MAINTENANCE::onResetAll` needs it
   * (`common/dialogs/panel_maintenance.cpp:138-148`), and it is not cosmetic
   * there: the panels edit a copy the shell commits on OK, so a Reset All that
   * left the dialog open would write the pre-reset copy back over the defaults
   * it had just restored.
   */
  cancelDialog: () => void;
}

/** A constructed page: its body, and its "Reset to Defaults" (`RESETTABLE_PANEL::ResetPanel`). */
export interface PrefsPanelModule {
  Panel: (props: { ctx: PrefsContext }) => JSX.Element;
  /**
   * `RESETTABLE_PANEL::ResetPanel` (`include/widgets/resettable_panel.h:57`),
   * and the whole point of it being here rather than in the shell: a page
   * resets **its own fields and no others**. Upstream that falls out of the
   * widget tree — `PANEL_MOUSE_SETTINGS::ResetPanel` default-constructs a
   * `COMMON_SETTINGS` and calls `applySettingsToPanel`, which only ever touches
   * the controls this panel owns, so `TransferDataFromWindow` writes back only
   * those (`common/dialogs/panel_mouse_settings.cpp`,
   * `common/dialogs/panel_grid_settings.cpp:110-113`, which assigns `m_grids`
   * alone). We have no widget tree to bound it, so a panel names its slice
   * explicitly, with `resetKeys` from `./reset.js`.
   *
   * **Optional**, because not every page is a `RESETTABLE_PANEL`:
   * `PANEL_TEMPLATE_FIELDNAMES_BASE` derives from plain `wxPanel`
   * (`eeschema/dialogs/panel_template_fieldnames_base.h:36`) and has no
   * `ResetPanel`, so `PAGED_DIALOG::UpdateResetButton`
   * (`common/widgets/paged_dialog.cpp:329-355`) greys the button out on it.
   * Omitting `reset` is how a page says that here.
   */
  reset?: (ctx: PrefsContext) => void;
  /**
   * `RESETTABLE_PANEL::GetResetTooltip` (`include/widgets/resettable_panel.h:64`),
   * which two panels override (`include/panel_hotkeys_editor.h:55`,
   * `include/dialogs/panel_color_settings.h:48`). Defaults to
   * `DEFAULT_RESET_TOOLTIP` when absent.
   */
  resetTooltip?: string;
  /**
   * `wxPanel::TransferDataFromWindow` — the page's own chance to turn what its
   * controls hold into what the settings file may contain, run once when OK is
   * pressed.
   *
   * A grid or a text field holds whatever was typed, and for most pages that is
   * already the stored value. For some it is not:
   * `PANEL_TEMPLATE_FIELDNAMES::TransferDataFromWindow`
   * (`eeschema/dialogs/panel_template_fieldnames.cpp:193-252`) drops blank
   * names, refuses a case variant of a mandatory field name and collapses
   * duplicates — none of which a keystroke handler can do, because deleting the
   * row a user is halfway through clearing is not a filter, it is a fight.
   *
   * **Optional**, and it lives here rather than in the shell for the reason
   * {@link reset} does: the shell knows no editor, and a page's transfer touches
   * that page's slice and no other.
   */
  transfer?: (ctx: PrefsContext, confirmed?: boolean) => PrefsTransferPrompt | void;
}

/**
 * A question a page's transfer has to ask before it can finish — upstream, a
 * `KICAD_MESSAGE_DIALOG` raised from inside `TransferDataFromWindow`
 * (`eeschema/dialogs/panel_template_fieldnames.cpp:210-230` is the only one).
 *
 * It is DATA, not a component, and that is the point: the shell renders it with
 * the app's own message dialog and never learns which editor asked. The shell
 * then calls `transfer` a second time with the answer in `confirmed`, which is
 * how the same function does the work both times.
 */
export interface PrefsTransferPrompt {
  /** The window title — upstream's third `KICAD_MESSAGE_DIALOG` argument. */
  caption: string;
  message: string;
  /** `SetExtendedMessage`, the smaller line under it. */
  extendedMessage?: string;
  /** `SetOKCancelLabels`. `ok` is the affirmative, which becomes `confirmed`. */
  labels: { ok: string; cancel: string };
}

/** `RESETTABLE_PANEL::GetResetTooltip`'s base text (`include/widgets/resettable_panel.h:66`). */
export const DEFAULT_RESET_TOOLTIP = 'Reset all settings on this page to their default';

/**
 * An editor's answer to "give me the panel for this id" — our `CreateKiWindow`.
 * Returns null for an id it does not own, exactly as the C++ switch falls
 * through to `return nullptr`.
 */
export type PrefsPanelFactory = (id: PrefsPageId) => PrefsPanelModule | null;
