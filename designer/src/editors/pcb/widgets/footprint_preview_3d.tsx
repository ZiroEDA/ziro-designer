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
import { BOARD, BOARD_USE } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { Viewer3D } from '@ziroeda/3d-viewer/viewer3d_types.js';
import { MODELS3D_HOST } from '../../../libraryHosts.js';
import '../viewer3d_cache_shim.js';

/**
 * The panel's `dummyBoard` as a file: `SetBoardThickness( 1.6 )`, front and
 * back masks enabled, `BuildDefaultStackupList( &dummy_bds, 2 )`. No edge —
 * the footprint holder's outline is the item bounds, as upstream's is.
 */
export const HOLDER_BOARD = `(kicad_pcb (version 20241229) (generator "ziroeda")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user)
    (37 "F.SilkS" user) (36 "B.SilkS" user) (39 "F.Mask" user) (38 "B.Mask" user)
    (35 "F.Paste" user) (34 "B.Paste" user) (33 "F.Fab" user) (32 "B.Fab" user)
    (49 "F.CrtYd" user) (48 "B.CrtYd" user))
  (net 0 "")
)`;

/**
 * The chooser's dummy board (`GetBoard()->SetBoardUse( BOARD_USE::FPHOLDER )`,
 * footprint_chooser_frame.cpp:135-138), holding \a aFootprint at the origin.
 */
function holderBOARD(aFootprint: FOOTPRINT | null): BOARD {
  const holder = new BOARD();
  holder.SetBoardUse(BOARD_USE.FPHOLDER);

  if (aFootprint) {
    aFootprint.SetPosition({ x: 0, y: 0 });
    holder.Add(aFootprint);
  }

  return holder;
}

export function useFootprintHolderBoard(
  footprint: string,
  loadFootprint: (libId: string) => Promise<FOOTPRINT | null>,
): BOARD | null {
  const [board, setBoard] = useState<BOARD | null>(null);

  // `m_preview3DCanvas->ReloadRequest()` on every selection: load the
  // footprint into the holder and rebuild.
  useEffect(() => {
    let cancelled = false;
    // No selection is the EMPTY holder, not no canvas: the frame builds
    // `m_preview3DCanvas` in its constructor and it draws the background and
    // the navigator with nothing loaded.
    if (!footprint) {
      setBoard(holderBOARD(null));
      return;
    }
    void loadFootprint(footprint).then((fp) => {
      if (!cancelled) setBoard(holderBOARD(fp));
    });
    return () => {
      cancelled = true;
    };
  }, [footprint, loadFootprint]);

  return board;
}

export interface FootprintPreview3DProps {
  /** `useFootprintHolderBoard`'s answer; null draws an empty canvas. */
  board: BOARD | null;
}

export function FootprintPreview3D({ board }: FootprintPreview3DProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !board) return undefined;
    let viewer: Viewer3D | null = null;
    let cancelled = false;
    void import('@ziroeda/3d-viewer/pcb3d.js').then(({ mount3DViewer }) => {
      if (cancelled) return;
      try {
        viewer = mount3DViewer(el, board, [], undefined, { footprintHolder: true }, MODELS3D_HOST);
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
