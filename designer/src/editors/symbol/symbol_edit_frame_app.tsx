// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDIT_FRAME_APP` (`@ziroeda/eeschema/symbol_editor/symbol_edit_frame_app.ts`):
 * what the Symbol Editor's window reaches through the app object, wired to
 * what designer actually has — the job `schematic/eeschema_app.tsx` does for
 * `EESCHEMA_APP`. `eeschema` never imports `designer`; this is the one file
 * that answers its interface.
 */
import { useMemo, type JSX } from 'react';
import type { SYMBOL_EDIT_FRAME_APP } from '@ziroeda/eeschema/symbol_editor/symbol_edit_frame_app.js';
import { settings } from '../../prefs/settings.js';
import {
  useCommonSettings,
  useSymbolEditorSettings,
  useSymbolEditorTheme,
} from '../../prefs/useSettings.js';
import { pcm } from '../../pcm/pcmStore.js';
import { loadIndex, symbolsBase } from '../schematic/symbols/index.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { HomeLink } from '../../ui/HomeLink.js';
import { LibraryLoadingPanel } from '../../widgets/library_loading_panel.js';
import { SymbolCanvas } from './SymbolCanvas.js';

/** One object per mount; every member is stable across renders. */
export function useSymbolEditFrameApp(): SYMBOL_EDIT_FRAME_APP {
  return useMemo<SYMBOL_EDIT_FRAME_APP>(
    () => ({
      settings,
      useSymbolEditorSettings,
      useCommonSettings,
      useSymbolEditorTheme,

      loadIndex,
      symbolsBase,
      installedLibraries: () => pcm.installedLibraries(),

      useToolbarEntries,

      SymbolCanvas,
      PreferencesDialog: (props) => <PreferencesDialog {...props} />,
      HomeLink: (props) => <HomeLink {...props} />,
      OpenFileDialog: (props) => <OpenFileDialog {...props} />,
      LibraryLoadingPanel: ({ fallback, ...props }) => (
        <LibraryLoadingPanel {...props} fallback={fallback as JSX.Element | null | undefined} />
      ),
    }),
    [],
  );
}
