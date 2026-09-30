// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_DESIGN_BLOCK_PREVIEW_WIDGET` (pcbnew/widgets/pcb_design_block_preview_widget.cpp):
 * the Design Blocks dock's preview - the block's board drawn fitted to the
 * pane, or the status text when there is nothing to show.
 *
 * Like upstream this draws through a `PCB_DRAW_PANEL_GAL` (WebGL, the panel
 * the editor itself uses), with no parent frame, so it takes the
 * `FRAME_FOOTPRINT_PREVIEW` painter. `DisplayDesignBlock` loads the block's
 * `.kicad_pcb` (`PCB_IO_KICAD_SEXPR::LoadBoard`), all of its layers shown
 * (`SyncLayersVisibility`), and fits the union of the items' boxes - a hidden
 * field left out - with 1/1.2 of whitespace round it (`fitOnDrawArea`). A
 * block with no board file shows no preview.
 */
import { useEffect, useMemo, useRef, type JSX } from 'react';
import type { DESIGN_BLOCK } from '@ziroeda/common/design_block.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { drawPanelWindow, loadBitmapFontImage } from '@ziroeda/common/gal/gal_window.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { wxFileExists, wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { BOARD } from '../board.js';
import type { PCB_FIELD } from '../pcb_field.js';
import { ParseBoard } from '../pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_DRAW_PANEL_GAL } from '../pcb_draw_panel_gal.js';

/**
 * `DisplayDesignBlock`'s load: the block's board, or null when it has none or
 * it cannot be read (\a aOnError is `DisplayErrorMessage( "Error loading board
 * file:\n%s" )`).
 */
export function loadDesignBlockBoard(
  aDesignBlock: DESIGN_BLOCK | null,
  aOnError?: (aMessage: string, aDetail: string) => void,
): BOARD | null {
  if (!aDesignBlock || !wxFileExists(aDesignBlock.GetBoardFile())) return null;

  const bytes = wxReadFileSync(aDesignBlock.GetBoardFile());

  if (!bytes) return null;

  try {
    return ParseBoard(new TextDecoder().decode(bytes), aDesignBlock.GetBoardFile());
  } catch (e) {
    if (!(e instanceof IO_ERROR)) throw e;

    aOnError?.(`Error loading board file:\n${aDesignBlock.GetBoardFile()}`, e.message);
    return null;
  }
}

/** `m_itemBBox`: every item's box, a hidden field's left out (:196-207). */
export function designBlockItemBBox(aBoard: BOARD): BOX2I {
  const bBox = new BOX2I();

  for (const item of aBoard.GetItemSet()) {
    if (item.Type() === KICAD_T.PCB_FIELD_T && !(item as PCB_FIELD).IsVisible()) continue;

    bBox.Merge(item.GetBoundingBox());
  }

  return bBox;
}

/**
 * `fitOnDrawArea()` (:171-191), the arithmetic: given the client area in world
 * units at scale 1.0, the scale that fits \a aBox, less a fifth for whitespace,
 * and the point the view is centred on.
 */
export function fitDesignBlockView(
  aClientWorld: { x: number; y: number },
  aBox: BOX2I,
): { scale: number; center: { x: number; y: number } } {
  const scale =
    Math.min(
      Math.abs(aClientWorld.x / Math.max(1, aBox.GetWidth())),
      Math.abs(aClientWorld.y / Math.max(1, aBox.GetHeight())),
    ) / 1.2;

  return { scale, center: aBox.Centre() };
}

/** `fitOnDrawArea()` on the panel's VIEW. */
function fitOnDrawArea(aPanel: PCB_DRAW_PANEL_GAL, aBox: BOX2I): void {
  const view = aPanel.GetView();

  // Calculate the drawing area size, in internal units, for a scaling factor = 1.0
  view.SetScale(1.0);
  const clientWorld = view.ToWorld(aPanel.GetClientSize(), false);
  const fit = fitDesignBlockView(clientWorld, aBox);

  view.SetScale(fit.scale);
  view.SetCenter(fit.center);
}

export function PcbDesignBlockPreviewWidget({
  designBlock,
  onError,
}: {
  designBlock: DESIGN_BLOCK | null;
  /** `DisplayErrorMessage( this, msg, detail )`. */
  onError?: (aMessage: string, aDetail: string) => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const board = useMemo(
    () => loadDesignBlockBoard(designBlock, (m, d) => onErrorRef.current?.(m, d)),
    [designBlock],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !board) return;
    let cancelled = false;
    let panel: PCB_DRAW_PANEL_GAL | null = null;
    let observer: ResizeObserver | null = null;

    loadBitmapFontImage().then(
      (fontImage) => {
        if (cancelled) return;

        try {
          panel = new PCB_DRAW_PANEL_GAL(
            null,
            drawPanelWindow(canvas, fontImage),
            new GAL_DISPLAY_OPTIONS(),
          );
        } catch (err) {
          console.warn(`Could not use OpenGL: ${(err as Error).message}`);
          return;
        }

        panel.SetStealsFocus(false);
        panel.GetGAL().SetAxesEnabled(false);
        panel.UpdateColors();
        panel.DisplayBoard(board);
        // The preview panel was built around a 2-layer dummy board. Re-sync layer
        // visibility to the loaded block so inner copper layers are shown.
        panel.SyncLayersVisibility(board);

        const box = designBlockItemBBox(board);
        fitOnDrawArea(panel, box);
        panel.ForceRefresh();

        const p = panel;
        observer = new ResizeObserver(() => {
          fitOnDrawArea(p, box);
          p.ForceRefresh();
        });
        observer.observe(canvas);
      },
      (err: unknown) => console.warn(`Could not use OpenGL: ${(err as Error).message}`),
    );

    return () => {
      cancelled = true;
      observer?.disconnect();
      panel?.Destroy();
    };
  }, [board]);

  return (
    <div className="ze-dbpreview">
      <canvas ref={canvasRef} className="ze-dbpreview-canvas" hidden={!board} />
    </div>
  );
}
