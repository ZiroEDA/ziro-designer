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

export interface DockSashProps {
  /** Which edge of the pane this sits on; decides the drag sign. */
  edge: 'left' | 'right';
  /** Current pane width in CSS px. */
  width: number;
  /** `wxAuiPaneInfo::MinSize`, in CSS px. */
  min: number;
  /** The width past which the centre pane would be squeezed out. */
  max: number;
  onResize: (width: number) => void;
}

/**
 * wxAUI's sash is 5px on GTK (`wxAuiDockArt` `wxAUI_DOCKART_SASH_SIZE`), and it
 * overlays the pane edge rather than taking space in the layout, so turning it
 * on cannot move anything else by a pixel.
 */
export function DockSash({ edge, width, min, max, onResize }: DockSashProps): JSX.Element {
  const onPointerDown = (e: ReactPointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    // A pane on the right grows as the pointer moves *left*, and one on the
    // left grows as it moves right. Getting this backwards is invisible until
    // someone drags, which is how it stayed wrong.
    const sign = edge === 'left' ? -1 : 1;
    const onMove = (ev: PointerEvent): void =>
      onResize(Math.max(min, Math.min(max, startW + sign * (ev.clientX - startX))));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className="ze-dock-sash"
      onPointerDown={onPointerDown}
      title="Resize"
      style={{ [edge]: 0 }}
    />
  );
}
