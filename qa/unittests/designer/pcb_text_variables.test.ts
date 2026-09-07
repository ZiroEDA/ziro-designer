// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Text & Graphics > Text Variables reaching board text —
 * `BOARD::ResolveTextVar` through `PCB_TEXT::GetShownText`, which is
 * `ExpandTextVars` (`common/common.cpp`).
 *
 * The page stored its rows in the project file and nothing on the board ever
 * read them, so a text reading `${REVISION}` drew those nine characters. The
 * schematic side already expanded them; the expander itself was stranded in
 * `eeschema/src/tools/`, which is why the board could not reach it. Upstream
 * keeps it in `common/` precisely because both editors call it, so it moved
 * there rather than being copied.
 *
 * `SceneFilter.resolveTextVar` is the seam, and `addText` is the single funnel
 * every board text goes through — board text, footprint fields, dimensions,
 * table cells and text boxes — so one call covers all of them.
 */
import { describe, expect, it } from 'vitest';
import { expandTextVars } from '@ziroeda/common/src/text_vars.js';
import { parse } from '@ziroeda/sexpr';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { buildScene } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup)
  (net 0 "")
  (gr_text "Rev \${REVISION}" (at 10 10) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15))))
  (gr_text "plain" (at 10 20) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15))))
)`;

const board = (): ReturnType<typeof readBoard> => readBoard(parse(BOARD_TEXT));

/**
 * A recording `ScenePathFactory`, so this runs without a DOM and — more
 * usefully — so the assertion is the glyph geometry itself rather than a
 * bucket key. Text that resolves to a different string strokes a different
 * number of segments.
 */
function glyphOps(filter = {}): number {
  let ops = 0;
  const factory = {
    path: () => ({
      moveTo: () => {
        ops++;
      },
      lineTo: () => {
        ops++;
      },
      closePath: () => {},
      arc: () => {
        ops++;
      },
      bezierCurveTo: () => {
        ops++;
      },
      quadraticCurveTo: () => {
        ops++;
      },
      rect: () => {
        ops++;
      },
      addPath: () => {},
    }),
    matrix: () => ({ translate: () => ({}), rotate: () => ({}), scale: () => ({}) }),
  };
  buildScene(board(), filter, factory as never);
  return ops;
}

describe('the expander is shared, not per editor', () => {
  it('lives in common, where ExpandTextVars does', async () => {
    // A copy in pcbnew would have been the easy move and the wrong one.
    const mod = await import('@ziroeda/common/src/text_vars.js');
    expect(typeof mod.expandTextVars).toBe('function');
  });

  it('leaves an unresolved token verbatim', () => {
    // Upstream does; a board that half-expands is worse than one that does not.
    expect(expandTextVars('Rev ${NOPE}', () => undefined)).toBe('Rev ${NOPE}');
  });

  it('resolves recursively and honours the backslash escape', () => {
    const vars: Record<string, string> = { A: '${B}', B: 'deep' };
    expect(expandTextVars('${A}', (t) => vars[t])).toBe('deep');
    expect(expandTextVars('\\${A}', (t) => vars[t])).toBe('${A}');
  });
});

describe('a board text resolves its variables when rendered', () => {
  it('draws a different glyph run once a resolver is supplied', () => {
    // "Rev ${REVISION}" is 15 characters; "Rev 2" is 5. Whatever the stroke
    // count is, it must not be the same one.
    const verbatim = glyphOps();
    const resolved = glyphOps({
      resolveTextVar: (t: string) => (t === 'REVISION' ? '2' : undefined),
    });
    expect(verbatim).toBeGreaterThan(0);
    expect(resolved).not.toBe(verbatim);
  });

  it('does not leak the resolver into the NEXT render', () => {
    // `g_resolveText` is module state for the duration of one `buildScene`, the
    // same shape the schematic renderer uses. If it is not restored, a scene
    // built after one that had a resolver keeps expanding — a board would show
    // resolved text in a context that never asked for it, and only sometimes.
    const verbatim = glyphOps();
    glyphOps({ resolveTextVar: (t: string) => (t === 'REVISION' ? '2' : undefined) });
    expect(glyphOps()).toBe(verbatim);
  });

  it('leaves a board with no variables untouched by the resolver', () => {
    // The second text is "plain"; a resolver must not perturb it. Rendering the
    // whole board with a resolver that answers nothing must equal no resolver.
    expect(glyphOps({ resolveTextVar: () => undefined })).toBe(glyphOps());
  });
});
