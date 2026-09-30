// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_DESIGN_BLOCK_PREVIEW_WIDGET` (eeschema/widgets/sch_design_block_preview_widget.cpp):
 * the Design Blocks dock's preview — the block's schematic drawn fitted to the
 * pane, pins' electrical types, pin numbers, hidden pins and hidden fields
 * off, or the status text when there is nothing to show.
 *
 * Upstream draws on a `SCH_PREVIEW_PANEL`; this draws with the schematic
 * painter onto a 2D canvas, the way `SYMBOL_PREVIEW_WIDGET` does here.
 * `DisplayDesignBlock` loads the block's `.kicad_sch`, and a block with none
 * shows no preview (upstream's `m_previewItem` stays null).
 */
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import { parse } from '@ziroeda/sexpr';
import type { DESIGN_BLOCK } from '@ziroeda/common/design_block.js';
import { wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import { readSchematic } from '../sch_io/sexpr/read-schematic.js';
import { fitToContent, renderSchematic } from '../sch_painter.js';
import { DEFAULT_RENDER_OPTS, type Theme } from '../sch_render_settings.js';
import type { Schematic } from '../types.js';

/** `DisplayDesignBlock`'s load: the block's schematic, or null when it has none. */
export function loadDesignBlockSchematic(aDesignBlock: DESIGN_BLOCK | null): Schematic | null {
  if (!aDesignBlock || aDesignBlock.GetSchematicFile() === '') return null;

  const bytes = wxReadFileSync(aDesignBlock.GetSchematicFile());

  if (!bytes) return null;

  try {
    return readSchematic(parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export function SchDesignBlockPreviewWidget({
  designBlock,
  theme,
}: {
  designBlock: DESIGN_BLOCK | null;
  /** `::GetColorSettings( cfg->m_ColorTheme )`: eeschema's theme. */
  theme: Theme;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sch = useMemo(() => loadDesignBlockSchematic(designBlock), [designBlock]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sch) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Zoom_Automatique on the item's bounding box, the page left out.
    const view = fitToContent(sch, canvas.width, canvas.height, false);
    renderSchematic(ctx, sch, view, theme, canvas.width, canvas.height, undefined, undefined, {
      ...DEFAULT_RENDER_OPTS,
      // m_ShowHiddenPins / m_ShowHiddenFields / m_ShowPinAltIcons off; the
      // electrical types and pin numbers follow each symbol's own flags here.
      showHiddenPins: false,
      showHiddenFields: false,
      showPinAltIcons: false,
      showDrawingSheet: false,
      grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
    });
  }, [sch, theme]);

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div className="ze-dbpreview" style={{ background: theme.background }}>
      {sch ? <canvas ref={canvasRef} className="ze-dbpreview-canvas" /> : null}
    </div>
  );
}
