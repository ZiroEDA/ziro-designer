// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_CHOOSER_FRAME::m_preview3DCanvas` — the EDA_3D_CANVAS the frame
 * builds in `build3DCanvas()` (footprint_chooser_frame.cpp) and adds to the
 * chooser panel's right column under the footprint view:
 *
 *     m_chooserPanel->m_RightPanelSizer->Add( m_preview3DCanvas, 1, wxEXPAND, 5 );
 *
 * It renders the panel's dummy board — `BOARD_USE::FPHOLDER`, 1.6 mm, a
 * two-layer stackup (panel_footprint_chooser.cpp:107-115) — with the selected
 * footprint loaded into it, through the same `mount3DViewer` the 3D viewer
 * frame uses, in its footprint-holder mode.
 */
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { parse } from '@ziroeda/sexpr';
import { placeFootprint, readBoard, type Board } from '@ziroeda/pcbnew';
import { loadFootprint } from '../../../widgets/footprint_list.js';
import type { Viewer3D } from '../viewer3d_types.js';

/**
 * The panel's `dummyBoard` as a file: `SetBoardThickness( 1.6 )`, front and
 * back masks enabled, `BuildDefaultStackupList( &dummy_bds, 2 )`. No edge —
 * the footprint holder's outline is the item bounds, as upstream's is.
 */
const HOLDER_BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user)
    (37 "F.SilkS" user) (36 "B.SilkS" user) (39 "F.Mask" user) (38 "B.Mask" user)
    (35 "F.Paste" user) (34 "B.Paste" user) (33 "F.Fab" user) (32 "B.Fab" user)
    (49 "F.CrtYd" user) (48 "B.CrtYd" user))
  (net 0 "")
)`;

function holderBoard(): Board {
  return readBoard(parse(HOLDER_BOARD));
}

/**
 * The holder board with the selected footprint loaded into it — what both the
 * in-panel canvas and the "own window" EDA_3D_VIEWER_FRAME render. The bare
 * holder while nothing is selected; null only until the first answer.
 */
export function useFootprintHolderBoard(footprint: string): Board | null {
  const [board, setBoard] = useState<Board | null>(null);

  // `m_preview3DCanvas->ReloadRequest()` on every selection: load the
  // footprint into the holder and rebuild.
  useEffect(() => {
    let cancelled = false;
    // No selection is the EMPTY holder, not no canvas: the frame builds
    // `m_preview3DCanvas` in its constructor and it draws the background and
    // the navigator with nothing loaded (`createBoardPolygon` says "No
    // footprint loaded." and the scene has no board body).
    if (!footprint) {
      setBoard(holderBoard());
      return;
    }
    void loadFootprint(footprint).then((lib) => {
      if (cancelled) return;
      if (!lib) {
        setBoard(holderBoard());
        return;
      }
      const holder = holderBoard();
      const fp = placeFootprint(lib, { fpid: footprint, at: { x: 0, y: 0 } });
      setBoard(fp ? { ...holder, footprints: [fp] } : holder);
    });
    return () => {
      cancelled = true;
    };
  }, [footprint]);

  return board;
}

export interface FootprintPreview3DProps {
  /** `useFootprintHolderBoard`'s answer; null draws an empty canvas. */
  board: Board | null;
}

export function FootprintPreview3D({ board }: FootprintPreview3DProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !board) return undefined;
    let viewer: Viewer3D | null = null;
    let cancelled = false;
    void import('../pcb3d.js').then(({ mount3DViewer }) => {
      if (cancelled) return;
      try {
        viewer = mount3DViewer(el, board, [], undefined, { footprintHolder: true });
      } catch {
        viewer = null;
      }
    });
    return () => {
      cancelled = true;
      viewer?.dispose();
      viewer = null;
      el.replaceChildren();
    };
  }, [board]);

  return <div className="ze-fpchooser-3d" ref={hostRef} />;
}
