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
import { registerAiBridge } from '@ziroeda/ai';
import { schBridge } from '@ziroeda/ai/sch_bridge.js';
import type { SchScriptApi } from '@ziroeda/eeschema';
import { useMemo } from 'react';
import type { EESCHEMA_APP } from '@ziroeda/eeschema/eeschema_app.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { SaveAsDialog } from '../../fs/SaveAsDialog.js';
import { HomeLink } from '../../ui/HomeLink.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { DialogSymLibTable } from '../../widgets/dialog_sym_lib_table.js';
import { loadFootprint, loadFootprintIndex } from '../../widgets/footprint_list.js';
import { FootprintChooserFrame } from '../pcb/dialogs/footprint_chooser_frame.js';
import {
  libraryUri,
  loadIndex,
  loadLibrarySymbols,
  loadSymbol,
  symbolsBase,
} from './symbols/index.js';
import { preloadSchematicLibraries } from './preload.js';
import { remapEvent } from './hotkey_bindings.js';
import { applyHotkeyOverrides } from './hotkey_list.js';
import { useProjectSync } from '../../sync/ProjectSyncProvider.js';
import { useAuth } from '../../auth/AuthProvider.js';
import { PresencePanel } from '../../ui/PresencePanel.js';
import { DialogAssignFootprints } from '@ziroeda/cvpcb/cvpcb_mainframe_ui.js';
import { useCvpcbApp } from './cvpcb_app.js';
import { SchematicCanvas } from './components/SchematicCanvas.js';
import { DialogSymbolChooser } from './dialogs/dialog_symbol_chooser.js';
import { SymbolLibraryBrowser } from '@ziroeda/eeschema/symbol_viewer_frame_ui.js';
import type { SYMBOL_VIEWER_FRAME_APP } from '@ziroeda/eeschema/symbol_viewer_frame.js';
import { LibraryLoadingPanel } from '../../widgets/library_loading_panel.js';
import { DialogRescueEach } from './dialogs/dialog_rescue_each.js';
import { DialogChangeSymbols } from './dialogs/dialog_change_symbols.js';
import type { ComponentProps, JSX } from 'react';
import { SchematicEditor } from '@ziroeda/eeschema/sch_edit_frame_ui.js';

/** CvPcb's window with the program's own `CVPCB_APP` — a component so the
 *  `useCvpcbApp()` hook runs inside it. */
function AssignFootprintsWithApp(
  props: Omit<ComponentProps<typeof DialogAssignFootprints>, 'app'>,
): JSX.Element {
  const cvpcbApp = useCvpcbApp();
  return <DialogAssignFootprints app={cvpcbApp} {...props} />;
}
import { settings } from '../../prefs/settings.js';
import {
  overrideItemColorsFor,
  useCommonSettings,
  useEeschemaSettings,
  useHotkeyOverrides,
  useSchematicTheme,
} from '../../prefs/useSettings.js';

/** `SYMBOL_VIEWER_FRAME_APP`, the Symbol Library Browser's seam. */
function useSymbolViewerFrameApp(): SYMBOL_VIEWER_FRAME_APP {
  return useMemo<SYMBOL_VIEWER_FRAME_APP>(
    () => ({
      settings,
      useSchematicTheme,
      loadIndex,
      loadLibrarySymbols,
      libraryUri,
      LibraryLoadingPanel: ({ fallback, ...props }) => (
        <LibraryLoadingPanel {...props} fallback={fallback as JSX.Element | null | undefined} />
      ),
    }),
    [],
  );
}

/** One object per mount; every member is stable across renders. */
export function useEeschemaApp(): EESCHEMA_APP {
  const symbolViewerApp = useSymbolViewerFrameApp();
  return useMemo<EESCHEMA_APP>(
    () => ({
      settings,
      useEeschemaSettings,
      useCommonSettings,
      useHotkeyOverrides,
      useSchematicTheme,
      overrideItemColorsFor,

      SchematicCanvas,
      DialogSymbolChooser: (props) => <DialogSymbolChooser {...props} />,
      SymbolLibraryBrowser: (props) => <SymbolLibraryBrowser app={symbolViewerApp} {...props} />,
      DialogRescueEach: (props) => <DialogRescueEach {...props} />,
      DialogChangeSymbols: (props) => <DialogChangeSymbols {...props} />,
      PreferencesDialog: (props) => <PreferencesDialog {...props} />,
      HomeLink: (props) => <HomeLink {...props} />,
      OpenFileDialog: (props) => <OpenFileDialog {...props} />,
      SaveAsDialog: (props) => <SaveAsDialog {...props} />,
      DialogSymLibTable: (props) => <DialogSymLibTable {...props} />,
      FootprintChooserFrame: (props) => (
        <FootprintChooserFrame
          {...props}
          loadFootprintIndex={loadFootprintIndex}
          loadFootprint={loadFootprint}
        />
      ),

      useToolbarEntries,

      loadFootprintIndex,
      loadFootprint,

      loadIndex,
      loadSymbol,
      symbolsBase,
      libraryUri,
      preloadSchematicLibraries,

      // The schematic's own registry (remapEvent's default `app`).
      remapEvent: (e, overrides) => remapEvent(e, overrides),
      applyHotkeyOverrides,

      useProjectSync,
      useAuth,
      PresencePanel: (props) => <PresencePanel {...props} />,

      AssignFootprints: (props) => <AssignFootprintsWithApp {...props} />,
    }),
    [symbolViewerApp],
  );
}

/** The AI pane drives whichever schematic frame is shown. */
const registerAiScriptApi = (api: SchScriptApi) => registerAiBridge(schBridge(api));

/**
 * The Schematic Editor's window with the program's own `EESCHEMA_APP` —
 * what `App.tsx` mounts, the way it mounts `PcbEditorMount`. Lazily loaded
 * with the frame, so neither lands in the entry chunk.
 */
export function SchematicEditorMount(
  props: Omit<ComponentProps<typeof SchematicEditor>, 'app'>,
): JSX.Element {
  const app = useEeschemaApp();
  return <SchematicEditor app={app} registerScriptApi={registerAiScriptApi} {...props} />;
}
