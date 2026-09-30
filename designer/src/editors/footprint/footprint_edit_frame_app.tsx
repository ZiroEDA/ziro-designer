// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The program's side of the Footprint Editor: what `pcbnew`'s footprint
 * modules ask of the app they run in, wired to what `designer` actually has.
 * `pcbnew` never imports `designer`; this is the one file that answers it,
 * the way `editors/schematic/cvpcb_app.tsx` answers `CVPCB_APP`.
 */
import { FootprintModelPreview3D } from '../pcb/widgets/footprint_model_preview_3d.js';
import { useMemo, type JSX } from 'react';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import type { FOOTPRINT_LIBRARY_IO } from '@ziroeda/pcbnew/footprint_libraries_utils.js';
import {
  FootprintEditFrame,
  type FOOTPRINT_EDIT_FRAME_APP,
  type FootprintEditorFile,
} from '@ziroeda/pcbnew/footprint_edit_frame_ui.js';
import { footprintText } from '../../libraryBundleStore.js';
import { libraryBase } from '../../libraryHosts.js';
import { settings } from '../../prefs/settings.js';
import {
  useCommonSettings,
  useFpEditSettings,
  useUserColors,
  useUserThemes,
} from '../../prefs/useSettings.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { trackLibraryLoad } from '../../widgets/library_loading.js';
import { LibraryLoadingPanel } from '../../widgets/library_loading_panel.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { HomeLink } from '../../ui/HomeLink.js';

// The hosted footprint library set, or the bundled subset when it is
// unreachable (see libraryHosts.ts).
export const footprintsBase = (): string => libraryBase.footprints;

/** `FootprintLibraryManager`'s storage: the resident catalogue, the hosted
 *  library set, and `pcbnew.json`'s flip direction. */
export const FP_LIBRARY_IO: FOOTPRINT_LIBRARY_IO = {
  footprintText: (libName, fpName) =>
    // Resident catalogue first; null falls through to the network, which
    // is what a device without a bundle still uses.
    trackLibraryLoad(
      'footprints',
      `Loading ${libName}...`,
      footprintText(libName, fpName).then(async (resident) => {
        if (resident !== null) return resident;
        const r = await fetch(
          `${footprintsBase()}/${encodeURIComponent(libName)}.pretty/${encodeURIComponent(fpName)}.kicad_mod`,
        );
        if (!r.ok) throw new Error(`${r.status}`);
        return r.text();
      }),
    ),
  flipLeftRight: () => settings.pcbnew.editing.flip_left_right,
};

/**
 * Builds the `FOOTPRINT_EDIT_FRAME_APP` the Footprint Editor is handed. One
 * object per mount, like `useCvpcbApp`: the hooks on it subscribe inside the
 * frame, so nothing on it has to change between renders.
 */
export function useFootprintEditFrameApp(): FOOTPRINT_EDIT_FRAME_APP {
  return useMemo<FOOTPRINT_EDIT_FRAME_APP>(
    () => ({
      useFpEditSettings,
      fpEdit: () => settings.fpEdit,
      updateFpEdit: (mutate) => settings.updateFpEdit(mutate),
      useCommonSettings,
      common: () => settings.common,
      SetLanguage: (label) =>
        settings.updateCommon((c) => {
          c.system.language = label;
        }),
      useUserColors,
      useUserThemes,
      useToolbarEntries,

      libraryIo: FP_LIBRARY_IO,
      footprintsBase,

      LibraryLoadingPanel: ({ label, fallback }) => (
        <LibraryLoadingPanel kind="footprints" fallback={fallback} label={label} />
      ),
      Preferences: (onClose, initialPage) => (
        <PreferencesDialog
          onClose={onClose}
          {...(initialPage === undefined ? {} : { initialPage })}
          // `if( GetFrameType() == FRAME_FOOTPRINT_EDITOR ) expand.push_back( … )`
          // (`common/eda_base_frame.cpp:1663-1664`) — the section the tree opens
          // expanded is the one the window was opened FROM.
          frameOwner="footprint"
        />
      ),
      // `Add Library` and `Import Footprint`, over the account's tree. A
      // footprint library lives in the project or in
      // `PATHS::GetDefaultUserFootprintsPath()` (paths.cpp:93).
      OpenFileDialog: (props) => <OpenFileDialog {...props} kind="footprints" />,
      HomeLink: ({ onClick }) => <HomeLink onClick={onClick} />,
      ModelPreview3D: (props) => <FootprintModelPreview3D {...props} />,
    }),
    [],
  );
}

/** The Footprint Editor window (`pcbnew/footprint_edit_frame_ui.tsx`), handed
 *  this program's `FOOTPRINT_EDIT_FRAME_APP`. */
export function FootprintEditor(props: {
  onExitToHome: () => void;
  initialProject?: FootprintEditorFile[] | null;
  kiway?: KIWAY;
}): JSX.Element {
  const app = useFootprintEditFrameApp();
  return <FootprintEditFrame app={app} {...props} />;
}
