// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_DESIGN_BLOCK_PREVIEW_WIDGET` (pcbnew/widgets/pcb_design_block_preview_widget.cpp):
 * the Design Blocks dock's preview - the block's board drawn fitted to the
 * pane, or the status text when there is nothing to show.
 *
 * Upstream draws on a `FOOTPRINT_PREVIEW_PANEL` (a GAL canvas); this draws the
 * loaded board with the board painter onto a 2D canvas, the way
 * `footprint_preview_panel.tsx` does. `DisplayDesignBlock` loads the block's
 * `.kicad_pcb` (`PCB_IO_KICAD_SEXPR::LoadBoard`), all of its layers shown
 * (`SyncLayersVisibility`), and fits the union of the items' boxes - a hidden
 * field left out - with 1/1.2 of whitespace round it (`fitOnDrawArea`). A
 * block with no board file shows no preview.
 */
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import type { DESIGN_BLOCK } from '@ziroeda/common/design_block.js';
import { drawGrid } from '@ziroeda/common/draw_panel_gal_grid_cursor.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { wxFileExists, wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { BOARD } from '../board.js';
import type { PCB_FIELD } from '../pcb_field.js';
import { ParseBoard } from '../pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { boardFromBOARD } from '../pcb_io/kicad_sexpr/board_view.js';
import { PCB_BACKGROUND } from '../pcbTheme.js';
import { buildScene, DEFAULT_DRAW_OPTIONS, drawBoard, pcbGridOptions } from '../renderBoard.js';

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
 * `fitOnDrawArea()` (:171-191): the scale that fits \a aBox in the client area,
 * less a fifth for whitespace, and the view that centres it.
 */
export function fitDesignBlockView(
  aBox: BOX2I,
  aWidthPx: number,
  aHeightPx: number,
): { scale: number; tx: number; ty: number } {
  const scale =
    Math.min(
      Math.abs(aWidthPx / Math.max(1, aBox.GetWidth())),
      Math.abs(aHeightPx / Math.max(1, aBox.GetHeight())),
    ) / 1.2;
  const c = aBox.Centre();

  return { scale, tx: aWidthPx / 2 - c.x * scale, ty: aHeightPx / 2 - c.y * scale };
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

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !board) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PCB_BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const view = fitDesignBlockView(designBlockItemBBox(board), canvas.width, canvas.height);
    const flat = boardFromBOARD(board);
    const scene = buildScene(flat);
    drawGrid(
      ctx,
      view,
      canvas.width,
      canvas.height,
      pcbGridOptions({ show: true, devicePixelRatio: dpr }),
    );
    drawBoard(
      ctx,
      scene,
      view,
      new Set(flat.layers.map((l) => l.name)),
      canvas.width,
      canvas.height,
      { ...DEFAULT_DRAW_OPTIONS, drawingSheet: false },
    );
  }, [board]);

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div className="ze-dbpreview" style={{ background: PCB_BACKGROUND }}>
      {board ? <canvas ref={canvasRef} className="ze-dbpreview-canvas" /> : null}
    </div>
  );
}
