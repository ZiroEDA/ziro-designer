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

// The pointer each tool asks for is PL_DRAWING_TOOLS' and ZOOM_TOOL's own now,
// driven through the frame in unittests/pagelayout_editor/pl_editor_chrome.test.ts.

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SHELL = read('../../../common/widgets/shell.css');

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
