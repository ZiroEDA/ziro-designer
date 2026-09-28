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
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { SaveAsDialog } from '../../fs/SaveAsDialog.js';
import { HomeLink } from '../../ui/HomeLink.js';
import { SelectionFilterPanel } from '../../ui/SelectionFilterPanel.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { DialogSymLibTable } from '../../widgets/dialog_sym_lib_table.js';
import { loadFootprint, loadFootprintIndex } from '../../widgets/footprint_list.js';
import { FootprintChooserFrame } from '../pcb/dialogs/footprint_chooser_frame.js';
import { libraryUri, loadIndex, loadSymbol, symbolsBase } from './symbols/index.js';
import { preloadSchematicLibraries } from './preload.js';
import { remapEvent } from './hotkey_bindings.js';
import { applyHotkeyOverrides } from './hotkey_list.js';
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

      PreferencesDialog: (props) => <PreferencesDialog {...props} />,
      HomeLink: (props) => <HomeLink {...props} />,
      OpenFileDialog: (props) => <OpenFileDialog {...props} />,
      SaveAsDialog: (props) => <SaveAsDialog {...props} />,
      SelectionFilterPanel: (props) => <SelectionFilterPanel {...props} />,
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
    }),
    [],
  );
}
