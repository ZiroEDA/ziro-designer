// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Hotkeys — `PANEL_HOTKEYS_EDITOR`, which the base frame adds
 * itself (`common/eda_base_frame.cpp:1599`).
 *
 * A three-line adapter, because the editable hotkeys widget predates the
 * registry and is also mounted by `ui/dialog_hotkey_list.tsx` (KiCad's
 * `DIALOG_HOTKEY_LIST`, the read-only viewer over the same `HOTKEY_STORE`).
 * It keeps its own props rather than taking the whole working copy.
 */
import type { JSX } from 'react';
import { PanelHotkeysEditor } from './PanelHotkeysEditor.js';
import type { PrefsContext } from '../types.js';

export function PanelHotkeys({ ctx }: { ctx: PrefsContext }): JSX.Element {
  return <PanelHotkeysEditor overrides={ctx.hotkeys} onChange={ctx.setHotkeys} />;
}
