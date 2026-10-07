// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The program's side of the Footprint Library Browser: what
 * `pcbnew/footprint_viewer_frame_ui.tsx`'s `FOOTPRINT_VIEWER_FRAME_APP` asks
 * for, wired to what `designer` has — the hosted footprint index and loader
 * every chooser already reads, `pcbnew.json`'s `footprint_viewer.*` slice,
 * the footprint editor's grid look, and the 3D viewer. `pcbnew` never imports
 * `designer`; this is the one file that answers it, as
 * `footprint_edit_frame_app.tsx` answers the Footprint Editor.
 */
import { useMemo, type JSX } from 'react';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import {
  FootprintViewerFrame,
  type FOOTPRINT_VIEWER_FRAME_APP,
} from '@ziroeda/pcbnew/footprint_viewer_frame_ui.js';
import { loadFootprintIndex } from '../../widgets/footprint_list.js';
import { LibraryLoadingPanel } from '../../widgets/library_loading_panel.js';
import { settings } from '../../prefs/settings.js';
import { HomeLink } from '../../ui/HomeLink.js';
import { FP_LIBRARY_IO, footprintsBase } from '../footprint/footprint_edit_frame_app.js';
import { Viewer3DFrame } from './Viewer3DFrame.js';
import { installPgm } from './pcb_canvas.js';
import { commonSettingsOf } from '../../pgm_app.js';

/** Builds the browser's `FOOTPRINT_VIEWER_FRAME_APP`; one object per mount. */
export function useFootprintViewerFrameApp(): FOOTPRINT_VIEWER_FRAME_APP {
  return useMemo<FOOTPRINT_VIEWER_FRAME_APP>(
    () => ({
      loadFootprintIndex,
      libraryIo: FP_LIBRARY_IO,
      installPgm,
      commonSettingsOf,
      // `LIBRARY_MANAGER::GetFullURI`, expanded: where the hosted `.pretty` lives.
      libraryUri: (nickname) => `${footprintsBase()}/${nickname}.pretty`,
      pinnedFootprintLibs: () => settings.common.system.session.pinned_fp_libs,
      footprintViewerSettings: () => settings.pcbnew.footprint_viewer,
      updateFootprintViewerSettings: (mutate) =>
        settings.updatePcbnew((s) => mutate(s.footprint_viewer)),
      padNumbers: () => settings.pcbnew.pcb_display.pad_numbers,
      setPadNumbers: (on) =>
        settings.updatePcbnew((s) => {
          s.pcb_display.pad_numbers = on;
        }),
      galGridOptions: () => {
        const g = settings.fpEdit.window.grid;
        return { style: g.style, lineWidthPx: g.line_width, minSpacingPx: g.min_spacing };
      },
      HomeLink: ({ onClick }) => <HomeLink onClick={onClick} />,
      LibraryLoadingPanel: ({ label, fallback }) => (
        <LibraryLoadingPanel kind="footprints" fallback={fallback} label={label} />
      ),
      Viewer3DFrame: (props) => <Viewer3DFrame {...props} board={{ k: props.board }} />,
    }),
    [],
  );
}

/**
 * `FOOTPRINT_VIEWER_FRAME`, handed this program's app. The GAL painter needs
 * `Pgm()` the way the PCB editor's does, and the browser can be the first
 * PCB frame to open.
 */
export function FootprintViewer(props: {
  kiway?: KIWAY;
  onClose: () => void;
  onExitToHome?: () => void;
}): JSX.Element {
  useMemo(() => void installPgm(), []);
  const app = useFootprintViewerFrameApp();
  return <FootprintViewerFrame app={app} {...props} />;
}
