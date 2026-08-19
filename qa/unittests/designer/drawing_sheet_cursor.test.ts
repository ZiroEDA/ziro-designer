// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which pointer the drawing sheet canvas shows, and who owns a combo's looks.
 *
 * `PL_SELECTION_TOOL::Main` ends its cursor chain at
 *
 *     m_frame->GetCanvas()->SetCurrentCursor( KICURSOR::ARROW );   // :209
 *
 * so the selection tool shows the ordinary pointer. Ours showed a `crosshair`,
 * which doubled with the crosshair the canvas already *draws* at the cursor —
 * KiCad paints that mark itself and leaves the system pointer alone, so we were
 * showing two crosshairs at once.
 *
 * The placing tools are not uniform either (pl_drawing_tools.cpp:83-99):
 *
 *     if( item )         -> KICURSOR::PLACE
 *     else if( isText )  -> KICURSOR::TEXT
 *     else if( placeImage ) -> KICURSOR::ARROW
 *     else               -> KICURSOR::PENCIL
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CANVAS = read('../../../designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx');
const SHELL = read('../../../designer/src/ui/shell.css');

/** The `const cursor = …` chain, which is where every pointer decision is made. */
const CHAIN = (() => {
  const at = CANVAS.indexOf('const cursor =');
  expect(at, 'DrawingSheetCanvas has no cursor chain').toBeGreaterThanOrEqual(0);
  return CANVAS.slice(at, CANVAS.indexOf(';', at));
})();

describe('the drawing sheet canvas shows KiCad’s pointer', () => {
  it('idles on the arrow, not a crosshair', () => {
    // pl_selection_tool.cpp:209. The crosshair is DRAWN, not pointed.
    expect(CHAIN.trimEnd().endsWith("'default'")).toBe(true);
    expect(CHAIN).not.toContain("'crosshair'");
  });

  it('still draws the crosshair mark itself', () => {
    // Removing the pointer crosshair must not remove the drawn one — that is
    // the mark KiCad's always_show_cursor puts on the canvas.
    expect(CANVAS).toContain('drawCrosshair(');
  });

  it('gives the text tool an I-beam', () => {
    // `else if( isText ) -> KICURSOR::TEXT` (pl_drawing_tools.cpp:88-90).
    expect(CHAIN).toMatch(/dsAddText'\s*\?\s*'text'/);
  });

  it('gives place-image the arrow, not the pencil', () => {
    // `else if( placeImage ) -> KICURSOR::ARROW` (pl_drawing_tools.cpp:91-94).
    expect(CHAIN).toMatch(/dsAddBitmap'\s*\?\s*'default'/);
  });

  it('keeps the pencil for the shape tools only', () => {
    // `else -> KICURSOR::PENCIL` (pl_drawing_tools.cpp:96-99).
    expect(CHAIN).toMatch(/placing\s*\n?\s*\?\s*PENCIL_CURSOR/);
  });

  it('keeps the remove and zoom pointers', () => {
    // picker->SetCursor( KICURSOR::REMOVE ) (pl_edit_tool.cpp:424).
    expect(CHAIN).toContain('REMOVE_CURSOR');
    expect(CHAIN).toContain("'zoom-in'");
  });

  it('moves with the selection in move mode', () => {
    // KICURSOR::MOVING (pl_selection_tool.cpp:198, pl_edit_tool.cpp:158).
    expect(CHAIN).toMatch(/moveMode\s*\n?\s*\?\s*'move'/);
  });
});

describe('a launcher does not restate what the shared combo owns', () => {
  /**
   * This is the bug class, not one bug. `.ze-combo` is (0,1,0), so ANY rule of
   * the form `.<launcher-scope> .<something>` that sets a combo's face, border,
   * radius or height is (0,2,0) and silently wins — which is why fixing the
   * widget centrally changed nothing at the call sites that had one. Layout
   * (flex, width, margin) is the panel's business and stays allowed.
   */
  const LOOKS = /(background|border|border-radius|color|font-size)\s*:/;

  it('leaves the top strip only layout, never looks', () => {
    const at = SHELL.indexOf('.ze-wks-topbar .ze-combo {');
    expect(at, 'no .ze-wks-topbar .ze-combo rule').toBeGreaterThanOrEqual(0);
    const body = SHELL.slice(at, SHELL.indexOf('}', at));
    expect(body).not.toMatch(LOOKS);
  });

  it('no longer styles those combos through the dead .ze-select hook', () => {
    // They are `<Combo>` now, so `.ze-wks-topbar .ze-select` matches nothing.
    expect(SHELL).not.toContain('.ze-wks-topbar .ze-select');
  });
});

describe('the top strip does not swallow the combos on it', () => {
  /**
   * `--content-bg` is #373737 and so is `--ctl-face`, so a combo on that strip
   * was painted exactly its own backdrop and disappeared — while the identical
   * combos in the properties panel stood out against #272727. A control must
   * never take the same face as the surface it sits on.
   */
  it('paints the strip the toolbar face, not the control face', () => {
    const at = SHELL.indexOf('.ze-wks-topbar {');
    expect(at).toBeGreaterThanOrEqual(0);
    const body = SHELL.slice(at, SHELL.indexOf('}', at));
    expect(body).toMatch(/background:\s*var\(--chrome-bg\)/);
    expect(body).not.toMatch(/background:\s*var\(--content-bg\)/);
  });

  it('keeps the strip and the control on different tokens', () => {
    const val = (name: string): string => {
      const m = new RegExp(`${name}:\\s*([^;]+);`).exec(SHELL);
      return (m?.[1] ?? '').trim();
    };
    expect(val('--chrome-bg')).not.toBe(val('--ctl-face'));
  });
});
