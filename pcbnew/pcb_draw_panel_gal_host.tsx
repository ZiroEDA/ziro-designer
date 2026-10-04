// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The canvas a PCB_BASE_FRAME draws on: what each frame's constructor does
 * with `new PCB_DRAW_PANEL_GAL( this, -1, …, GetGalDisplayOptions(),
 * m_canvasType )` + `SetCanvas( drawPanel )`, and later `ActivateGalCanvas()`,
 * for a `<canvas>` React has mounted.
 *
 * Every frame builds its panel the same way upstream — the board editor, the
 * footprint editor, the viewers — so this is the one place a frame's window
 * asks for it. The panel then routes the canvas's mouse, wheel and key events
 * through the frame's TOOL_DISPATCHER itself (`PCB_BASE_FRAME::ActivateGalCanvas`
 * sets it), and the frame's tools do the rest.
 */

import { type RefObject, useEffect, useState } from 'react';
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import type { PCB_BASE_FRAME } from './pcb_base_frame.js';
import { createPcbDrawPanel, loadBitmapFontImage } from './pcb_canvas.js';
import type { PCB_DRAW_PANEL_GAL } from './pcb_draw_panel_gal.js';

export interface PCB_DRAW_PANEL_GAL_HOST_ENV {
  /** `Pgm()`: installed before the panel, whose painter and controls read it. */
  installPgm(): void;
  /** `Pgm().GetCommonSettings()`, for `m_galDisplayOptions.ReadCommonConfig`. */
  commonSettings(): COMMON_SETTINGS_LIKE;
}

/**
 * Build `aFrame`'s panel on the canvas `aCanvasRef` holds, display the frame's
 * board on it and `ActivateGalCanvas()` — after which a new board reaches the
 * panel through `PCB_BASE_EDIT_FRAME::SetBoard`'s own `DisplayBoard`; tear it down on unmount or a lost
 * WebGL context. Answers the panel once it exists.
 */
export function usePcbDrawPanel(
  aFrame: PCB_BASE_FRAME | null,
  aCanvasRef: RefObject<HTMLCanvasElement | null>,
  aEnv: PCB_DRAW_PANEL_GAL_HOST_ENV,
): PCB_DRAW_PANEL_GAL | null {
  const [fontImage, setFontImage] = useState<ImageBitmap | null>(null);
  const [panel, setPanel] = useState<PCB_DRAW_PANEL_GAL | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;

    loadBitmapFontImage().then(
      (img) => {
        if (!cancelled) setFontImage(img);
      },
      (err: unknown) => console.warn(`Could not load the bitmap font: ${(err as Error).message}`),
    );

    return () => {
      cancelled = true;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the frame, the font and a restored context are the triggers; aEnv is read at build time
  useEffect(() => {
    const canvas = aCanvasRef.current;

    if (!canvas || !aFrame || !fontImage) return;

    aEnv.installPgm();

    // `EDA_DRAW_FRAME::EDA_DRAW_FRAME`: `m_galDisplayOptions.ReadCommonConfig(
    // *Pgm().GetCommonSettings(), this )` before the canvas is built.
    aFrame.GetGalDisplayOptions().ReadCommonConfig(aEnv.commonSettings(), window);

    const built = createPcbDrawPanel(aFrame, canvas, fontImage);

    if (!built) return;

    const board = aFrame.GetBoard();

    // The drawing sheet is PCB_EDIT_FRAME's alone (`attachBoardToPanel`); a
    // footprint editor or viewer draws none.
    if (board) {
      built.DisplayBoard(board);
      built.UpdateColors();
    }

    aFrame.ActivateGalCanvas();
    setPanel(built);

    // A lost context takes the GAL with it until it is restored and the panel rebuilt.
    const onLost = (e: Event): void => {
      e.preventDefault();
      built.Destroy();
      aFrame.SetCanvas(null);
      setPanel(null);
    };
    const onRestored = (): void => setGeneration((g) => g + 1);

    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      built.Destroy();
      aFrame.SetCanvas(null);
      setPanel(null);
    };
  }, [aFrame, fontImage, generation]);

  return panel;
}
