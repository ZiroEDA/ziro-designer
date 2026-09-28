// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EESCHEMA_APP` (`@ziroeda/eeschema/eeschema_app.ts`): what the Schematic
 * Editor's window reaches through the app object, wired to what designer
 * actually has — the same job `pcb/pcbnew_app.tsx` does for `PCBNEW_APP` and
 * `cvpcb_app.tsx` for `CVPCB_APP`. `eeschema` never imports `designer`; this
 * is the one file that answers its interface.
 */
import { useMemo } from 'react';
import type { EESCHEMA_APP } from '@ziroeda/eeschema/eeschema_app.js';
import { gridSizeToIU, settings } from '../../prefs/settings.js';
import {
  overrideItemColorsFor,
  useCommonSettings,
  useEeschemaSettings,
  useHotkeyOverrides,
  useSchematicTheme,
} from '../../prefs/useSettings.js';

/** One object per mount; every member is stable across renders. */
export function useEeschemaApp(): EESCHEMA_APP {
  return useMemo<EESCHEMA_APP>(
    () => ({
      settings,
      useEeschemaSettings,
      useCommonSettings,
      useHotkeyOverrides,
      useSchematicTheme,
      overrideItemColorsFor,
      gridSizeToIU,
    }),
    [],
  );
}
