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
  PcbnewSettings,
  PlEditorSettings,
  PrivacySettings,
  ToolbarApp,
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
  | 'sch-display'
  | 'sch-grids'
  | 'sch-editing'
  | 'sch-colors'
  | 'sch-toolbars'
  | 'sch-fields'
  | 'sch-datasources'
  | 'sch-simulator'
  | 'pcb-display'
  | 'pcb-toolbars'
  | 'ds-display'
  | 'ds-grids'
  | 'ds-colors'
  | 'ds-toolbars'
  | 'maintenance';

/** Which module owns a page, and therefore which bundle it is lazily pulled from. */
export type PrefsPageOwner = 'generic' | 'schematic' | 'pcb' | 'drawingsheet';

/**
 * The working copy the dialog edits, plus its setters. Handed to every panel;
 * a panel touches only the slices it owns.
 */
export interface PrefsContext {
  common: CommonSettings;
  eeschema: EeschemaSettings;
  pcbnew: PcbnewSettings;
  plEditor: PlEditorSettings;
  privacy: PrivacySettings;
  userColors: Record<string, string>;
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
  upP: (fn: (s: PcbnewSettings) => void) => void;
  upPl: (fn: (s: PlEditorSettings) => void) => void;
  /** Mutate a clone of one app's stored toolbars. */
  upTb: (app: ToolbarApp, fn: (s: ToolbarSettings) => void) => void;
  setCommon: Dispatch<SetStateAction<CommonSettings>>;
  setEeschema: Dispatch<SetStateAction<EeschemaSettings>>;
  setPcbnew: Dispatch<SetStateAction<PcbnewSettings>>;
  setPlEditor: Dispatch<SetStateAction<PlEditorSettings>>;
  setPrivacy: Dispatch<SetStateAction<PrivacySettings>>;
  setUserColors: Dispatch<SetStateAction<Record<string, string>>>;
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
}

/** `RESETTABLE_PANEL::GetResetTooltip`'s base text (`include/widgets/resettable_panel.h:66`). */
export const DEFAULT_RESET_TOOLTIP = 'Reset all settings on this page to their default';

/**
 * An editor's answer to "give me the panel for this id" — our `CreateKiWindow`.
 * Returns null for an id it does not own, exactly as the C++ switch falls
 * through to `return nullptr`.
 */
export type PrefsPanelFactory = (id: PrefsPageId) => PrefsPanelModule | null;
