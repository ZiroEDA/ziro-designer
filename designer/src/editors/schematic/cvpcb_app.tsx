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
import { FootprintCanvas } from '@ziroeda/pcbnew/pcb_draw_panel_gal_ui.js';
import { footprintToBoard, parseFootprint } from '@ziroeda/pcbnew/footprint_edit_frame.js';
import { DEFAULT_DRAW_OPTIONS } from '@ziroeda/pcbnew/renderBoard.js';
import { holderHandle } from '../pcb/widgets/footprint_preview_3d.js';
import { Viewer3DFrame } from '../pcb/Viewer3DFrame.js';
import { loadFootprint, loadFootprintIndex } from '../../widgets/footprint_list.js';
import { footprintsBase } from '../footprint/footprint_edit_frame_app.js';
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
      loadFootprint,
      parseFootprint,
      footprintToBoard,
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

      FootprintCanvas: (props, ref) => (
        <FootprintCanvas
          ref={ref}
          footprint={props.footprint}
          visible={props.visible}
          showGrid={props.showGrid}
          crosshairMode={props.crosshairMode}
          gridIU={props.gridIU}
          activeTool={props.activeTool}
          measureUnits={props.measureUnits}
          onZoomAreaApplied={props.onZoomAreaApplied}
          onFootprintChange={props.onFootprintChange}
          onCursorMove={props.onCursorMove}
          onScaleChange={props.onScaleChange}
          // FRAME_CVPCB_DISPLAY: the DEFAULT fit margin, not the footprint
          // editor's 1.48 (`display_footprints_frame.tsx`'s own header).
          fitFrame="cvpcb_display"
          drawOpts={{ ...DEFAULT_DRAW_OPTIONS, ...props.drawOpts }}
        />
      ),
      Viewer3DFrame: (props) => <Viewer3DFrame {...props} board={holderHandle(props.board)} />,
    }),
    [],
  );
}
