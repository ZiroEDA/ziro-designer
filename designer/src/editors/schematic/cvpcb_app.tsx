// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CVPCB_APP` (`@ziroeda/cvpcb/cvpcb_mainframe_ui.tsx`): the program's own
 * modules Assign Footprints, the footprint viewer and Manage Footprint
 * Association Files reach through the app object, the way
 * `pagelayout_editor/pl_editor_frame_ui.tsx` reaches `PL_EDITOR_APP`.
 * `cvpcb` never imports `designer`; this is the one file that wires its
 * interface back to what designer actually has.
 */
import { useMemo, type JSX } from 'react';
import type { CVPCB_APP } from '@ziroeda/cvpcb/cvpcb_mainframe_ui.js';
import { Viewer3DFrame } from '../pcb/Viewer3DFrame.js';
import { loadFootprintIndex } from '../../widgets/footprint_list.js';
import { FP_LIBRARY_IO, footprintsBase } from '../pcb/footprint_lib_adapter_app.js';
import { installPgm } from '../pcb/pcb_canvas.js';
import { commonSettingsOf } from '../../pgm_app.js';
import { LibraryLoadingPanel } from '../../widgets/library_loading_panel.js';
import { DialogFpLibTable } from '@ziroeda/pcbnew/dialogs/panel_fp_lib_table.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { useDialogControl } from '../../ui/useDialogControl.js';
import { settings } from '../../prefs/settings.js';
import { readEquivalenceFiles } from '@ziroeda/eeschema/project_settings.js';

/**
 * Builds the `CVPCB_APP` Assign Footprints (and the two windows it opens)
 * are handed. One object per mount, like `DrawingSheetEditor.tsx`'s
 * `PL_EDITOR_APP` — everything on it is stable across renders except the two
 * values React itself must track (`colorsVersion`-style), which cvpcb has
 * none of.
 */
export function useCvpcbApp(): CVPCB_APP {
  return useMemo<CVPCB_APP>(
    () => ({
      loadFootprintIndex,
      libraryIo: FP_LIBRARY_IO,
      installPgm: () => void installPgm(),
      commonSettingsOf,
      footprintsBase,

      get pinnedFpLibs() {
        return settings.common.system.session.pinned_fp_libs;
      },
      get language() {
        return settings.common.system.language;
      },
      SetLanguage: (label) =>
        settings.updateCommon((c) => {
          c.system.language = label;
        }),
      useDialogControl,

      readEquivalenceFiles: (files) => readEquivalenceFiles(files),

      LibraryLoadingPanel: ({ label }) => <LibraryLoadingPanel kind="footprints" label={label} />,
      DialogFpLibTable: (props) => <DialogFpLibTable {...props} />,
      Preferences: (onClose) => <PreferencesDialog onClose={onClose} />,
      // `extra` is `CVPCB_APP`'s narrower `ReactNode`; the only caller
      // (Manage Footprint Association Files' Add) always hands over one real
      // element, which is all designer's own `OpenFileDialogProps` accepts.
      OpenFileDialog: (props) => (
        <OpenFileDialog {...props} extra={props.extra as JSX.Element | undefined} />
      ),

      Viewer3DFrame: (props) => <Viewer3DFrame {...props} board={{ k: props.board }} />,
    }),
    [],
  );
}
