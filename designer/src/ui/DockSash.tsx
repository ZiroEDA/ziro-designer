// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The drag handle between a docked pane and the canvas - wxAUI's sash.
 *
 * KiCad never writes one of these. Every frame adds its palette with
 * `m_auimgr.AddPane( widget, EDA_PANE().Palette()... )` and wxAUI puts a sash
 * between that pane and the centre one, so *every* dock in *every* editor is
 * draggable for free (`gerbview_frame.cpp:168`, `pcb_edit_frame.cpp`, and the
 * rest). We had the behaviour written out by hand in PcbEditor, twice, and not
 * at all in GerbView - which is why the Gerber Viewer's layers pane was a
 * fixed 240px strip you could not resize.
 *
 * So this is the one place it lives. `min` and `max` are the caller's, because
 * upstream takes them from the pane's own `MinSize` and from the centre pane's
 * minimum rather than from any shared constant.
 */

import type { PointerEvent as ReactPointerEvent } from 'react';
import { resizeDock, type DockEdge } from './dock_sash.js';

export interface DockSashProps {
  /** Which edge of the pane this sits on; decides the drag sign. */
  edge: DockEdge;
  /** Current pane width in CSS px. */
  width: number;
  /** `wxAuiPaneInfo::MinSize`, in CSS px. */
  min: number;
  /** The width past which the centre pane would be squeezed out. */
  max: number;
  onResize: (width: number) => void;
}

/**
 * Rendered as a **sibling** of the pane, not a child of it.
 *
 * wxAUI's sash sits between the pane and the centre one and takes its own
 * space: the pane keeps the width it asked for and the canvas is narrower by
 * the sash. Drawing it inside the pane, overlaid on its edge, is what we did
 * first - it left the pane 5px wider than KiCad's and put the bar on top of
 * the pane's own border.
 *
 * Size and colour come from the `--aui-sash` tokens, which carry the numbers
 * `qa/probes/aui_sash_probe.cpp` read out of `wxAuiDefaultDockArt`. The bar is
 * visible, because KiCad's is.
 */
export function DockSash({ edge, width, min, max, onResize }: DockSashProps): JSX.Element {
  const onPointerDown = (e: ReactPointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: PointerEvent): void =>
      onResize(resizeDock(edge, startW, ev.clientX - startX, min, max));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return <div className="ze-dock-sash" onPointerDown={onPointerDown} title="Resize" />;
}
