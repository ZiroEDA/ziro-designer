// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where wxAUI draws a line, and where it draws five pixels of face instead.
 *
 * Two values, both read out of `wxAuiDefaultDockArt` on this machine by
 * `qa/probes/aui_sash_probe.cpp`, and they do different jobs:
 *
 *     wxAUI_DOCKART_PANE_BORDER_SIZE  1     BORDER_COLOUR  rgb(41, 41, 41)
 *     wxAUI_DOCKART_SASH_SIZE         5     SASH_COLOUR    rgb(55, 55, 55)
 *
 * The border belongs to a pane that asked for one, and in an editor frame the
 * pane that always does is the canvas: `EDA_PANE().Canvas()` is
 * `PaneBorder( true )` (eda_base_frame.h:975-981). The sash is what wxAUI puts
 * between two docks, and because SASH_COLOUR is wxSYS_COLOUR_3DFACE it is the
 * same grey as the toolbar - so a pane, its sash and the toolbar beside it
 * read as one continuous strip.
 *
 * [px] a live pcbnew at 1920x1200 (2026-09-03), scanned at y=1000:
 *
 *     x 66..365    Properties pane
 *     x 366..370   #373737   the sash
 *     x 371..404   #373737   the left toolbar, 34px around a 30px button
 *     x 405        #292929   the canvas pane's border
 *
 * and along y=1140, the row above the message panel:
 *
 *     x 405..1631  #292929   the SAME border, under the canvas
 *     everywhere else        #373737, straight through - no rule at all
 *
 * Ours had this backwards in both directions: 1px of --chrome-border where the
 * sash belongs, which made our toolbar strip measure 35px against KiCad's 40
 * and put a black rule down it; and the canvas's bottom border drawn full-width
 * as a `border-top` on the message panel, which cut every toolbar and both
 * docked panes off from the strip below them.
 *
 * `qa/probes/vtoolbar_probe.cpp` measures the other half of that: a vertical
 * `wxAuiToolBar` of 24px icons is 34px wide - the width itself was never wrong.
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

describe('the canvas pane border', () => {
  it('is the dock art value, and not the near-black chrome border', () => {
    expect(SHELL).toMatch(/--aui-pane-border:\s*#292929/);
    expect(SHELL).toMatch(/--aui-pane-border-size:\s*1px/);
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

  it('the three sides drawn from a toolbar all take the token', () => {
    for (const side of [
      '.ze-toolbar.horizontal:not(:has(+ .ze-toolbar.horizontal))',
      '.ze-toolbar.vertical.left',
      '.ze-toolbar.vertical.right',
    ]) {
      expect(body(side)).toMatch(
        /border-(bottom|right|left):\s*var\(--aui-pane-border-size\) solid var\(--aui-pane-border\)/,
      );
    }
  });

  it('a vertical toolbar covers that edge in its own column', () => {
    // The seam at x=84 in the pl_editor capture: a docked toolbar butts against
    // the one above it. Ours drew the edge across the full width, so the -1px
    // is what puts the strip's own face over it.
    expect(body('.ze-toolbar.vertical')).toMatch(/margin-top:\s*-1px/);
  });

  it('the fourth side is on the canvas, which is where it stops', () => {
    // The bottom edge has no toolbar beside it to draw it from, and it is NOT
    // the message panel's: [px] at y=1140 the rule spans x 405..1631 only.
    expect(body('.ze-canvas-wrap')).toMatch(
      /border-bottom:\s*var\(--aui-pane-border-size\) solid var\(--aui-pane-border\)/,
    );
    expect(body('.ze-msgpanel')).not.toMatch(/border/);
  });

  it('the status bar has no rule above it at all', () => {
    // [px] pcbnew down x=1660 and x=1700: #373737 through y=1176, then #2c2c2c
    // from y=1177 with nothing between. Ours wrote a literal #292929.
    expect(body('.ze-statusbar')).not.toMatch(/border-top/);
    // And the Search pane below the canvas draws none either — it is
    // `.PaneBorder( false )` (pcb_edit_frame.cpp:403-405), so the canvas's own
    // border is the only line there. Two rules put two lines on one edge.
    expect(body('.ze-bottomdock')).not.toMatch(/border/);
  });
});

describe('the sash, not a rule, separates a dock from the toolbar beside it', () => {
  it('a dock with a sash next to it draws no border', () => {
    // pcbnew's Properties and Appearance, GerbView's Layers Manager and the
    // project tree are all added with `PaneBorder( false )`.
    expect(body('.ze-leftdock')).not.toMatch(/border/);
    expect(body('.ze-rightdock')).not.toMatch(/border/);
    expect(SHELL).toContain('.ze-leftdock:not(:has(+ .ze-dock-sash))');
    expect(SHELL).toContain(':not(.ze-dock-sash) + .ze-rightdock');
  });

  it("pl_editor's palette keeps its border, because that pane asked for one", () => {
    // `EDA_PANE().Palette()` sets `PaneBorder( true )` and pl_editor never
    // turns it back off (pl_editor_frame.cpp:200), unlike pcbnew and GerbView.
    // So it is the ONE dock with a line, and the line is wxAUI's colour.
    expect(body('.ze-leftdock.on-right')).toMatch(
      /border-left:\s*var\(--aui-pane-border-size\) solid var\(--aui-pane-border\)/,
    );
  });

  it('is 5px of the toolbar face, so pane and toolbar read as one strip', () => {
    expect(body('.ze-dock-sash')).toMatch(/width:\s*var\(--aui-sash-size\)/);
    expect(body('.ze-dock-sash')).toMatch(/background:\s*var\(--aui-sash\)/);
    expect(SHELL).toMatch(/--aui-sash-size:\s*5px/);
    // The face it shares with the toolbar. .ze-toolbar paints --content-bg;
    // both are wxSYS_COLOUR_3DFACE, which is why the seam is invisible.
    const sash = /--aui-sash:\s*([^;]+);/.exec(SHELL)?.[1]?.trim();
    const content = /--content-bg:\s*([^;]+);/.exec(SHELL)?.[1]?.trim();
    expect(sash).toBe(content);
  });
});

/**
 * The sash has a width and no height, so a dock column swallows it.
 *
 * `.ze-leftdock` and `.ze-rightdock` are `flex-direction: column`. A
 * `<DockSash>` rendered as their CHILD is a column item: `flex: 0 0 auto` gives
 * it a flex-basis of auto, its height is its content, and its content is
 * nothing - so it is in the markup and 0px on screen. That is exactly how
 * pcbnew lost both of its sashes while still importing the component.
 */
describe('a DockSash is a sibling of its pane, never a child', () => {
  const FRAMES = [
    'editors/pcb/PcbEditor.tsx',
    'editors/gerbview/GerberViewer.tsx',
    'editors/drawingsheet/DrawingSheetEditor.tsx',
  ];

  /** A line's leading-space count. */
  const indent = (line: string): number => line.length - line.trimStart().length;

  /**
   * The indents at which a file opens a dock element.
   *
   * Walks back from the `ze-…dock` class name to the `<div` that carries it,
   * because two of the three frames put the className on its own line.
   */
  function dockIndents(lines: string[]): Set<number> {
    const out = new Set<number>();
    lines.forEach((line, i) => {
      if (!/\bze-(?:left|right)dock\b/.test(line)) return;
      for (let j = i; j >= 0 && j > i - 6; j--) {
        if (lines[j]!.trimStart().startsWith('<div')) {
          out.add(indent(lines[j]!));
          return;
        }
      }
    });
    return out;
  }

  it.each(FRAMES)('%s keeps every sash outside the dock', (rel) => {
    // These files are biome-formatted, so indentation IS nesting: a sibling of
    // the dock sits at the dock's own indent and a child sits deeper. That is
    // the whole check, and it is the one a brace matcher cannot do reliably
    // here — JSX attributes carry both `>` (inside arrow functions) and
    // self-closing tags, so counting `<div`/`</div>` mis-pairs and the check
    // silently stops catching anything. It did: a DockSash put back inside
    // `.ze-leftdock` survived the brace-matching version of this test.
    const lines = readFileSync(
      fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)),
      'utf8',
    ).split('\n');

    const docks = dockIndents(lines);
    expect(docks.size, `no ze-leftdock/ze-rightdock element in ${rel}`).toBeGreaterThan(0);

    const sashes = lines.filter((l) => l.trimStart().startsWith('<DockSash'));
    expect(sashes.length, `${rel} renders no DockSash`).toBeGreaterThan(0);
    for (const sash of sashes) {
      expect(
        docks.has(indent(sash)),
        `${rel}: a DockSash at indent ${indent(sash)} is nested inside a dock ` +
          `(docks open at ${[...docks].join(', ')}); a width-only rule collapses it there`,
      ).toBe(true);
    }
  });
});
