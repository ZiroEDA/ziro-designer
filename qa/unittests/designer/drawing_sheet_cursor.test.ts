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

  it('gives the text tool KiCad’s I-beam, not the browser’s', () => {
    // `else if( isText ) -> KICURSOR::TEXT` (pl_drawing_tools.cpp:88-90), and
    // KICURSOR::TEXT is `cursor-text.xpm` (cursors.cpp:192-197) — KiCad's own
    // art. The CSS keyword `text` is a different glyph the platform draws, so
    // naming it here was a near miss, not a match.
    expect(CHAIN).toMatch(/dsAddText'[\s\S]*?kiCursor\('TEXT'\)/);
    expect(CHAIN).not.toMatch(/dsAddText'\s*\n?\s*\?\s*'text'/);
  });

  it('gives place-image the arrow, not the pencil', () => {
    // `else if( placeImage ) -> KICURSOR::ARROW` (pl_drawing_tools.cpp:91-94).
    expect(CHAIN).toMatch(/dsAddBitmap'\s*\?\s*'default'/);
  });

  it('keeps the pencil for the shape tools only', () => {
    // `else -> KICURSOR::PENCIL` (pl_drawing_tools.cpp:96-99).
    expect(CHAIN).toMatch(/placing[\s\S]*?\?[\s\S]*?kiCursor\('PENCIL'\)/);
  });

  it('keeps the remove and zoom pointers', () => {
    // picker->SetCursor( KICURSOR::REMOVE ) (pl_edit_tool.cpp:424).
    expect(CHAIN).toContain("kiCursor('REMOVE')");
    expect(CHAIN).toContain("kiCursor('ZOOM_IN')");
  });

  it('moves with the selection in move mode', () => {
    // KICURSOR::MOVING (pl_selection_tool.cpp:198, pl_edit_tool.cpp:158).
    expect(CHAIN).toMatch(/moveMode[\s\S]*?\?[\s\S]*?kiCursor\('MOVING'\)/);
  });

  it('names no cursor the chain cannot get from KiCad’s table', () => {
    // Per-occurrence, not per-file: every `url(...)` or `data:` in the chain
    // would be art invented here beside `ui/kicursors.ts`, which is exactly
    // what the hand-drawn SVG pencil and cross were.
    expect(CHAIN).not.toContain('data:image');
    expect(CHAIN).not.toContain('url(');
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
    // Scoped to the toolbar, not to this launcher: the origin and page choices
    // are toolbar controls upstream, the same case as gerbview's layer
    // selector, so one rule serves both.
    const at = SHELL.indexOf('.ze-toolbar .ze-combo {');
    expect(at, 'no .ze-toolbar .ze-combo rule').toBeGreaterThanOrEqual(0);
    const body = SHELL.slice(at, SHELL.indexOf('}', at));
    expect(body).not.toMatch(LOOKS);
  });

  it('no longer styles those combos through the dead .ze-select hook', () => {
    // They are `<Combo>` now, so a `.ze-select` rule would match nothing.
    expect(SHELL).not.toContain('.ze-wks-topbar .ze-select');
  });
});

describe('a combo on the toolbar is told apart by its border, as upstream', () => {
  /**
   * `--content-bg` is #373737 and so is `--ctl-face`, so a combo on the strip
   * is painted exactly its own backdrop. That was read here as a bug once, and
   * the strip was given `--chrome-bg` to fix it — but it is what upstream
   * does: `aToolbar->Add( m_originSelectBox )` puts a wxChoice straight onto
   * the toolbar (`toolbars_pl_editor.cpp:132,157`), on the toolbar's own face,
   * and a real one is told apart by its BORDER alone.
   *
   * So the parity requirement is not "different faces". It is that the border
   * exists and is not the face, which is what these check.
   */
  it('keeps the toolbar on the frame face, with no second strip behind it', () => {
    expect(SHELL).not.toContain('.ze-wks-topbar {');
    const at = SHELL.indexOf('.ze-toolbar {');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(SHELL.slice(at, SHELL.indexOf('}', at))).toMatch(/background:\s*var\(--content-bg\)/);
  });

  it('gives the combo a border that is not the surface it sits on', () => {
    // The bare rule, not `.ze-toolbar .ze-combo` — a substring search finds
    // the scoped one first and would read the wrong body.
    const at = SHELL.indexOf('\n.ze-combo {');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(SHELL.slice(at, SHELL.indexOf('}', at))).toMatch(
      /border:\s*1px solid var\(--ctl-border\)/,
    );
    const val = (name: string): string => {
      const m = new RegExp(`${name}:\\s*([^;]+);`).exec(SHELL);
      return (m?.[1] ?? '').trim();
    };
    // The border is what separates it, so it must differ from the strip.
    expect(val('--ctl-border')).not.toBe(val('--content-bg'));
  });
});
