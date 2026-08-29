// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol graphics preview with a status-text overlay ("No symbol selected",
 * "Loading…"). Mirrors kicad/eeschema/widgets/symbol_preview_widget.cpp
 * (SYMBOL_PREVIEW_WIDGET); the GAL canvas becomes a 2D <canvas>, and like that
 * canvas it zooms with the wheel and pans with a middle/right drag, refitting
 * whenever the pane resizes or another symbol is displayed.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { LibSymbol } from '@ziroeda/eeschema';
import { renderSymbolPreview } from '../render/renderer.js';
import { useSchematicTheme } from '../../../prefs/useSettings.js';
import {
  usePreviewViewControls,
  type PreviewView,
} from '../../../widgets/preview_view_controls.js';
import type { InputPrefs } from '../../../ui/view_controls.js';

export interface SymbolPreviewWidgetProps {
  /** Symbol to display, or null to show the status text instead. */
  symbol: LibSymbol | null;
  /** Unit to display (0/undefined = first unit, as upstream DisplaySymbol). */
  unit?: number;
  /**
   * Status label shown when no symbol is displayed.
   *
   * `SYMBOL_PREVIEW_WIDGET::SetStatusText`
   * (eeschema/widgets/symbol_preview_widget.cpp:141-148) is the widget's ONLY
   * text state, and its callers pass exactly three things: "No symbol
   * selected" (panel_symbol_chooser.cpp:672), "" and, on the footprint one,
   * "No footprint specified" / "Invalid footprint specified". None of them is
   * a loading message — upstream's preview never has one, because
   * `IFACE::PreloadLibraries` has already run by the time the chooser opens.
   */
  statusText?: string;
  /** Mouse preferences (PANEL_MOUSE_SETTINGS) for the zoom/pan gestures. */
  inputPrefs?: InputPrefs;
}

export function SymbolPreviewWidget({
  symbol,
  unit = 0,
  statusText = '',
  inputPrefs,
}: SymbolPreviewWidgetProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const symbolRef = useRef<LibSymbol | null>(symbol);
  symbolRef.current = symbol;
  const unitRef = useRef(unit);
  unitRef.current = unit;

  const viewRef = useRef<PreviewView | null>(null);

  /**
   * The colour theme the user picked, not a fixed one.
   * `SYMBOL_PREVIEW_WIDGET`'s constructor loads
   * `::GetColorSettings( app_settings->m_ColorTheme )`
   * (symbol_preview_widget.cpp:77-78), falling back to DEFAULT_THEME. This
   * pane was pinned to KiCad Classic, whose schematic background is
   * `legacy('WHITE')`, so the preview stayed pure white while the editor
   * behind it drew the default theme's rgb(245, 244, 239).
   */
  const theme = useSchematicTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const sym = symbolRef.current;
    if (!canvas || !sym) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const used = renderSymbolPreview(
      ctx,
      sym,
      canvas.width,
      canvas.height,
      themeRef.current,
      unitRef.current,
      viewRef.current ?? undefined,
    );
    viewRef.current = used;
  }, []);

  const view = usePreviewViewControls(canvasRef, draw, inputPrefs, viewRef);

  // DisplaySymbol / onSize: a new symbol (or unit) refits, and so does a resize.
  // biome-ignore lint/correctness/useExhaustiveDependencies: symbol/unit trigger the refit
  useEffect(() => {
    viewRef.current = null;
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      viewRef.current = null; // onSize -> fitOnDrawArea
      draw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [symbol, unit, draw]);

  return (
    <div className="ze-symbol-preview">
      {symbol ? (
        <canvas
          ref={canvasRef}
          className="ze-preview-canvas"
          onWheel={view.handlers.onWheel}
          onPointerDown={view.handlers.onPointerDown}
          onPointerMove={view.handlers.onPointerMove}
          onPointerUp={view.handlers.onPointerUp}
          onPointerCancel={view.handlers.onPointerUp}
          onContextMenu={view.handlers.onContextMenu}
        />
      ) : (
        <div className="ze-preview-status">{statusText}</div>
      )}
    </div>
  );
}
