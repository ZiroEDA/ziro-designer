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
  PrivacySettings,
} from '../../prefs/settings.js';

/** One page in the book. The web mirror of KiCad's `PANEL_*` ids. */
export type PrefsPageId =
  | 'common'
  | 'mouse'
  | 'hotkeys'
  | 'sch-display'
  | 'sch-grids'
  | 'sch-editing'
  | 'sch-annotation'
  | 'sch-colors'
  | 'sch-fields'
  | 'pcb-display';

/** Which module owns a page, and therefore which bundle it is lazily pulled from. */
export type PrefsPageOwner = 'generic' | 'schematic' | 'pcb';

/**
 * The working copy the dialog edits, plus its setters. Handed to every panel;
 * a panel touches only the slices it owns.
 */
export interface PrefsContext {
  common: CommonSettings;
  eeschema: EeschemaSettings;
  pcbnew: PcbnewSettings;
  privacy: PrivacySettings;
  userColors: Record<string, string>;
  hotkeys: HotkeyOverrides;
  /** Mutate a clone of the common settings (KiCad edits `COMMON_SETTINGS` in place). */
  upC: (fn: (s: CommonSettings) => void) => void;
  upE: (fn: (s: EeschemaSettings) => void) => void;
  upP: (fn: (s: PcbnewSettings) => void) => void;
  setCommon: Dispatch<SetStateAction<CommonSettings>>;
  setEeschema: Dispatch<SetStateAction<EeschemaSettings>>;
  setPcbnew: Dispatch<SetStateAction<PcbnewSettings>>;
  setPrivacy: Dispatch<SetStateAction<PrivacySettings>>;
  setUserColors: Dispatch<SetStateAction<Record<string, string>>>;
  setHotkeys: Dispatch<SetStateAction<HotkeyOverrides>>;
}

/** A constructed page: its body, and its "Reset to Defaults" (`RESETTABLE_PANEL::ResetPanel`). */
export interface PrefsPanelModule {
  Panel: (props: { ctx: PrefsContext }) => JSX.Element;
  reset: (ctx: PrefsContext) => void;
}

/**
 * An editor's answer to "give me the panel for this id" — our `CreateKiWindow`.
 * Returns null for an id it does not own, exactly as the C++ switch falls
 * through to `return nullptr`.
 */
export type PrefsPanelFactory = (id: PrefsPageId) => PrefsPanelModule | null;
