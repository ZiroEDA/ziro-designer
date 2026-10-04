// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_CHOOSER_FRAME` (`pcbnew/footprint_chooser_frame.tsx`), handed
 * this program's widgets: the footprint preview panel, the 3D preview and its
 * holder board, and the 3D viewer child frame. The frame itself moved to
 * `pcbnew/`; this is its wiring, so every caller keeps the props it had.
 */
import type { JSX } from 'react';
import {
  FootprintChooserFrame as FootprintChooserFrameUi,
  type FOOTPRINT_CHOOSER_FRAME_APP,
  type FootprintChooserFrameProps as FootprintChooserFrameUiProps,
} from '@ziroeda/pcbnew/footprint_chooser_frame.js';
import {
  FootprintPreview3D,
  holderHandle,
  useFootprintHolderBoard,
} from '../widgets/footprint_preview_3d.js';
import { Viewer3DFrame } from '../Viewer3DFrame.js';
import { PCB_FOOTPRINT_PREVIEW_PANEL } from '../footprint_preview_panel.js';

const FOOTPRINT_CHOOSER_APP: FOOTPRINT_CHOOSER_FRAME_APP = {
  previewPanel: PCB_FOOTPRINT_PREVIEW_PANEL,
  useFootprintHolderBoard,
  FootprintPreview3D: ({ board }) => <FootprintPreview3D board={board} />,
  Viewer3DFrame: (props) => <Viewer3DFrame {...props} board={holderHandle(props.board)} />,
};

export type FootprintChooserFrameProps = Omit<FootprintChooserFrameUiProps, 'app'>;

export function FootprintChooserFrame(props: FootprintChooserFrameProps): JSX.Element {
  return <FootprintChooserFrameUi {...props} app={FOOTPRINT_CHOOSER_APP} />;
}
