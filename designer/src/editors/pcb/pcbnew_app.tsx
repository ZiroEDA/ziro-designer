// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCBNEW_APP` (`@ziroeda/pcbnew/browser/pcbnew_app.ts`): what the program gives
 * `PcbEditor.tsx`, the way `cvpcb/cvpcb_mainframe_ui.tsx`'s `CVPCB_APP` and
 * `pagelayout_editor/pl_editor_frame_ui.tsx`'s `PL_EDITOR_APP` reach theirs.
 * `pcbnew` never imports `designer`; this is the one file that wires its
 * interface back to what designer actually has.
 */
import { type ComponentProps, useMemo } from 'react';
import type { PCBNEW_APP } from '@ziroeda/pcbnew/browser/pcbnew_app.js';
import { PcbEditor } from '@ziroeda/pcbnew/pcb_edit_frame_ui.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { HomeLink } from '../../ui/HomeLink.js';
import { SaveAsDialog } from '../../fs/SaveAsDialog.js';
import { FootprintChooserFrame } from './dialogs/footprint_chooser_frame.js';
import { Viewer3DFrame, type Viewer3DFrameProps } from './Viewer3DFrame.js';
import { commonSettingsOf, windowSettingsOf } from '../../pgm_app.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { EMPTY_PCB } from '../../home/new_project.js';
import { settings } from '../../prefs/settings.js';
import {
  useCommonSettings,
  usePcbnewSettings,
  useUserColors,
  useUserThemes,
} from '../../prefs/useSettings.js';
import { loadFootprint, loadFootprintIndex } from '../../widgets/footprint_list.js';
import { preloadBoardLibraries } from './preload.js';
import { cleanup3dCache } from './model_cache.js';
import { installPgm, reloadUserColorSettings } from './pcb_canvas.js';
import { addNetclassAssignment } from '@ziroeda/eeschema/tools/assign_netclass.js';

/**
 * Builds the `PCBNEW_APP` `PcbEditor` is handed. One object per mount, like
 * `DrawingSheetEditor.tsx`'s `PL_EDITOR_APP` and `cvpcb_app.tsx`'s
 * `useCvpcbApp()` — everything on it is stable across renders except the
 * settings snapshots React itself must track.
 */
export function usePcbnewApp(): PCBNEW_APP {
  const pcbCfg = usePcbnewSettings();
  const commonCfg = useCommonSettings();
  const userColors = useUserColors();
  const userThemes = useUserThemes();

  return useMemo<PCBNEW_APP>(
    () => ({
      PreferencesDialog: (props) => <PreferencesDialog {...props} />,
      HomeLink: (props) => <HomeLink {...props} />,
      SaveAsDialog: (props) => <SaveAsDialog {...props} />,
      FootprintChooserFrame: (props) => <FootprintChooserFrame {...props} />,
      // `PCBNEW_APP.Viewer3DFrame` takes an untyped prop bag (pcbnew/ does
      // not import 3d-viewer's types), so PcbEditor.tsx's own call site is
      // what actually shapes the props; this cast just re-attaches that
      // real shape for the designer-side component.
      Viewer3DFrame: (props) => <Viewer3DFrame {...(props as unknown as Viewer3DFrameProps)} />,

      pcbnewSettings: pcbCfg,
      commonSettings: commonCfg,
      updatePcbnewSettings: (mutate) => settings.updatePcbnew(mutate),
      updateCommonSettings: (mutate) => settings.updateCommon(mutate),
      commonInputImmediateActionsLive: () => settings.common.input.immediate_actions,
      commonSettingsOf,
      windowSettingsOf,
      installPgm: () => void installPgm(),
      reloadUserColorSettings,
      userColors,
      userThemes,

      useToolbarEntries,

      loadFootprintIndex,
      loadFootprint,
      preloadBoardLibraries,
      cleanup3dCache,

      EMPTY_PCB,
      addNetclassAssignment,
    }),
    [pcbCfg, commonCfg, userColors, userThemes],
  );
}

/**
 * The PCB editor with its `PCBNEW_APP`. The hooks `usePcbnewApp` calls only
 * run while this is mounted, as `PcbEditor`'s own settings subscriptions did
 * before the move.
 */
export function PcbEditorMount(props: Omit<ComponentProps<typeof PcbEditor>, 'app'>): JSX.Element {
  const app = usePcbnewApp();
  return <PcbEditor app={app} {...props} />;
}
