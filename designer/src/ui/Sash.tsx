// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `wxSplitterWindow` sash — the OTHER draggable bar, and a different widget
 * from `DockSash`.
 *
 * wxAUI's sash sits between two docked PANES, is 5px of `wxSYS_COLOUR_3DFACE`
 * and therefore invisible against the toolbar beside it. A wxSplitterWindow's
 * sash sits between the two halves of ONE control, is also 5px, and GTK paints
 * it `#181818` — a visible black bar. Both numbers were measured
 * (`qa/probes/aui_sash_probe.cpp` and `qa/probes/chooser_shell_probe.cpp`);
 * see `--aui-sash` and `--splitter-sash`.
 *
 * KiCad opens this one in three places, and they are the same widget:
 *
 *     PANEL_SYMBOL_CHOOSER   two splitters, tree | preview and preview | detail
 *                            (eeschema/widgets/panel_symbol_chooser.cpp:193-210)
 *     SYMBOL_VIEWER_FRAME    library | symbol
 *     APPEARANCE_CONTROLS    the Nets tab: Nets over Net Classes
 *                            (`m_netsTabSplitter`, appearance_controls_base.cpp:145)
 *
 * The third had no splitter at all, so a board with 220 nets pushed Net
 * Classes off the bottom of the pane and it could not be reached.
 *
 * Geometry is `resizeDock`, the same clamp `DockSash` uses: the sign rule and
 * the "MinSize wins over a cap below it" rule are one decision, and a second
 * copy is a second sign to get wrong.
 */

import type { PointerEvent as ReactPointerEvent } from 'react';
import { resizeDock, type DockEdge } from './dock_sash.js';

export interface SashProps {
  /**
   * Which edge of the resized pane the sash sits on, which is what decides the
   * drag's sign. `top`/`bottom` split horizontally, `left`/`right` vertically.
   */
  edge: DockEdge;
  /** The resized pane's current size along the drag axis, in CSS px. */
  size: number;
  /** The pane's minimum — wxSplitterWindow's `SetMinimumPaneSize`. */
  min: number;
  /** The size past which the OTHER half would be squeezed under its own. */
  max: number;
  onResize: (size: number) => void;
}

/**
 * Rendered as a SIBLING of the two panes, because a wxSplitterWindow's sash is
 * between them and takes its own 5px out of the control — the same rule
 * `DockSash` records, and the same one that made a sash rendered inside a
 * `flex-direction: column` dock collapse to nothing.
 */
export function Sash({ edge, size, min, max, onResize }: SashProps): JSX.Element {
  const vertical = edge === 'top' || edge === 'bottom';

  const onPointerDown = (e: ReactPointerEvent): void => {
    e.preventDefault();
    const start = vertical ? e.clientY : e.clientX;
    const startSize = size;
    const onMove = (ev: PointerEvent): void =>
      onResize(resizeDock(edge, startSize, (vertical ? ev.clientY : ev.clientX) - start, min, max));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={`ze-sash ${vertical ? 'h' : 'v'}`}
      onPointerDown={onPointerDown}
      title="Resize"
    />
  );
}
