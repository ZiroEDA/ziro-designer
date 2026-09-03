// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where the toolbar block ends and where it does not.
 *
 * wxAUI docks toolbars against each other and against the canvas, and the two
 * boundaries look different. Measured down three columns of a live pl_editor
 * capture (2026-08-21):
 *
 *     x=1000, canvas column       #373737 to y=132, then ONE #292929
 *     x=1850, properties column   #373737 to y=132, then ONE #292929
 *     x=84,   left-toolbar column #373737 straight through the seam
 *
 * So the edge fences the toolbar block off from CONTENT, and two docked
 * toolbars simply butt together. A gerbview capture gives the same answer from
 * the other side: an unbroken face from the menu bar to y=170, one #292929 at
 * y=171, then the canvas.
 *
 * Ours drew `border-bottom` on every horizontal row in `--chrome-border`
 * (#1e1e1e) — a near-black rule between TOP_MAIN and TOP_AUX, and another one
 * cutting the left strip away from the bar above it. Both are wrong, and the
 * second is the one a user notices, because it breaks a corner that should
 * read as one continuous surface.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SHELL = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);

/** A rule's body, by exact selector — a substring search finds scoped ones. */
function body(selector: string): string {
  const at = SHELL.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return SHELL.slice(at, SHELL.indexOf('}', at));
}

describe('the dock edge fences off content, not another toolbar', () => {
  it('is its own token, and not the near-black border', () => {
    expect(SHELL).toMatch(/--toolbar-dock-edge:\s*#292929/);
    const chrome = /--chrome-border:\s*([^;]+);/.exec(SHELL)?.[1]?.trim();
    expect(chrome).not.toBe('#292929');
  });

  it('a horizontal row draws no divider under the next one', () => {
    // The rule that carries the edge is scoped to the LAST horizontal toolbar.
    // Left unscoped, TOP_MAIN drew a rule between itself and TOP_AUX, which
    // KiCad has nowhere.
    expect(body('.ze-toolbar.horizontal')).not.toMatch(/border-bottom/);
    expect(SHELL).toContain('.ze-toolbar.horizontal:not(:has(+ .ze-toolbar.horizontal))');
  });

  it('the edge that does exist is the dock-edge token', () => {
    const at = SHELL.indexOf('.ze-toolbar.horizontal:not(:has(+ .ze-toolbar.horizontal))');
    const rule = SHELL.slice(at, SHELL.indexOf('}', at));
    expect(rule).toMatch(/border-bottom:\s*1px solid var\(--toolbar-dock-edge\)/);
  });

  it('a vertical toolbar covers that edge in its own column', () => {
    // The seam at x=84 in the capture: a docked toolbar butts against the one
    // above it. Ours drew the edge across the full width, so the -1px is what
    // puts the strip's own face over it. Without this the corner reads as a
    // black rule cutting the left bar away from the top bar.
    expect(body('.ze-toolbar.vertical')).toMatch(/margin-top:\s*-1px/);
  });

  it('a vertical toolbar meeting the canvas still draws one', () => {
    // The other half of the same rule: sideways, a toolbar DOES meet content.
    // [px] a live GerbView at y=500 — face to x=99, one #292929, then canvas.
    for (const side of ['.ze-toolbar.vertical.left', '.ze-toolbar.vertical.right']) {
      expect(body(side)).toMatch(/border-(right|left):\s*1px solid var\(--toolbar-dock-edge\)/);
    }
  });
});
