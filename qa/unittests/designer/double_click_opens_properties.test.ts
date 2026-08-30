// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A left double-click runs the SAME action the E key runs.
 *
 * `SCH_SELECTION_TOOL` (sch_selection_tool.cpp:676-694) has one rule:
 *
 *     if( item && item->Type() == SCH_SHEET_T )   PostAction( enterSheet );
 *     else if( ...SCH_GROUP_T )                   EnterGroup();
 *     else                                        PostAction( properties );
 *
 * and `SCH_ACTIONS::properties` is exactly what E is bound to. One action, one
 * router.
 *
 * WE HAD TWO. `onEditItem` — what the canvas called on a double-click — knew
 * symbol, field, label, text box, table, directive and sheet. `openProperties`
 * — what E called — knew all of those AND graphics, lines, images, junctions
 * and bus entries. So double-clicking a rectangle did nothing at all: it was
 * simply not on the shorter list, and Akshay found it by double-clicking the
 * box around his circuit and getting no Graphic Properties dialog.
 *
 * This is a SOURCE check, deliberately. The two routers are closures inside a
 * 9000-line component, and the bug was not that either behaved wrongly — each
 * did what it said — but that the canvas was wired to the narrower one. A
 * rendered test would have to mount the whole editor to see that wiring; the
 * wiring itself is one line, and it is the thing to pin.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/schematic/SchematicEditor.tsx', import.meta.url),
  ),
  'utf8',
);

/** The `onEditItem` prop handed to the canvas — the double-click seam. */
function canvasDoubleClickHandler(): string {
  const i = SRC.indexOf('onEditItem={(id, kind) =>');
  expect(i, 'the canvas must take a double-click handler').toBeGreaterThan(-1);
  return SRC.slice(i, SRC.indexOf('}}', i));
}

describe('the canvas double-click', () => {
  it('routes through openProperties, not through the narrower router', () => {
    expect(canvasDoubleClickHandler()).toContain('openProperties(id)');
  });

  it('and still enters a sheet rather than opening a dialog for it', () => {
    // `if( item->Type() == SCH_SHEET_T ) PostAction( enterSheet )`.
    expect(canvasDoubleClickHandler()).toContain("kind === 'sheet'");
  });
});

describe('openProperties is the complete router', () => {
  /**
   * The kinds it must reach. `graphic` is the one that was missing from the
   * double-click path — a rectangle, circle or arc, whose dialog is
   * DIALOG_SHAPE_PROPERTIES.
   */
  it.each([
    'symbol',
    'label',
    'textbox',
    'table',
    'image',
    'graphic',
    'line',
    'junction',
  ])('knows about %s', (kind) => {
    const i = SRC.indexOf('const openProperties = useCallback');
    const body = SRC.slice(i, SRC.indexOf('\n  );', i));
    const plural: Record<string, string> = {
      symbol: 'd.symbols',
      label: 'd.labels',
      textbox: 'd.textBoxes',
      table: 'd.tables',
      image: 'd.images',
      graphic: 'd.graphics',
      line: 'd.lines',
      junction: 'd.junctions',
    };
    expect(body).toContain(plural[kind]!);
  });
});
