// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_DRAWING_TOOLS::DrawTable`, end to end.
 *
 * Two things were missing and neither could fail a test, because both live in
 * `.tsx` that `qa` cannot compile:
 *
 *  - **the preview was a rectangle.** Upstream's motion branch rebuilds the
 *    whole table — cells and all — on every mouse move and re-adds it to the
 *    view preview, so the grid you are about to get is on screen while you are
 *    still dragging. Ours drew a plain notes-layer box that turned into a table
 *    on release;
 *  - **and the dialog only reported the counts.** `DrawTable` ends with
 *    `DIALOG_TABLE_PROPERTIES`, whose OK is what commits the table and whose
 *    Cancel deletes it. Ours had OK/Cancel over three read-only lines, so a
 *    table could be created but never given contents or a border.
 *
 * Read as source text, which is crude, but it is the only way to see these two
 * files from here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CANVAS = read('../../../designer/src/editors/schematic/components/SchematicCanvas.tsx');
const EDITOR = read('../../../designer/src/editors/schematic/SchematicEditor.tsx');
const DIALOG = read('../../../designer/src/editors/schematic/dialogs/dialog_table_properties.tsx');

describe('the preview while the table is being dragged out', () => {
  it('builds a real table, not a rectangle', () => {
    // `makeTableFromDrag` is the same builder the commit uses, so what you see
    // while dragging is what you get.
    expect(CANVAS).toContain('makeTableFromDrag(ds.start, size');
    expect(CANVAS).toContain('addItems({\n          tables: [');
  });

  it('and the table tool no longer previews through makeRectangle', () => {
    // The three that really are rectangles keep sharing that branch.
    const preview = CANVAS.slice(
      CANVAS.indexOf('function previewGraphic'),
      CANVAS.indexOf('function previewGraphic') + 900,
    );
    expect(preview).toContain("case 'rectangle':");
    expect(preview).toContain("case 'textbox':");
    // `case 'table':` is still listed — returning null, with a comment — so the
    // exhaustive switch keeps flagging any shape kind nobody handled.
    expect(preview).toContain("case 'table':");
    expect(preview).not.toMatch(/case 'table':\s*\n\s*return makeRectangle/);
  });

  it('using the default text size, which decides the column count', () => {
    // `int colCount = std::max( 1, requestedSize.x / ( fontSize * 15 ) );`
    expect(CANVAS).toContain('tableFontSizeIU');
    expect(EDITOR).toContain('tableFontSizeIU={setup.formatting.defaultTextSizeMils');
  });

  it('and the raw drag delta, so a backwards drag gives 1x1 as upstream does', () => {
    // `VECTOR2I requestedSize( cursorPos - origin );` — unnormalized. It is
    // `table->Normalize()` on the second click that squares things up, and
    // `std::max( 1, … )` that keeps a backwards drag to a single cell.
    expect(CANVAS).toContain(
      'const size = { x: ds.cursor.x - ds.start.x, y: ds.cursor.y - ds.start.y };',
    );
  });
});

describe('the dialog the tool ends with', () => {
  it('is opened for a table just drawn and for one already on the sheet', () => {
    expect(EDITOR).toContain('<DialogTableProperties');
    expect(EDITOR).toContain("setTableProps({ kind: 'edit', index: idx })");
    expect(EDITOR).toContain("kind: 'new',");
  });

  it('edits the cell contents', () => {
    expect(DIALOG).toContain('Cell contents');
    expect(DIALOG).toContain('setCell(row, col, e.target.value)');
  });

  it('and the border and separator controls upstream has', () => {
    for (const label of [
      'External border',
      'Header border',
      'Row lines',
      'Column lines',
      'Width:',
      'Color:',
      'Style:',
    ])
      expect(DIALOG).toContain(label);
  });

  it('greying out the line controls when the lines are off', () => {
    // `m_borderWidth.Enable( StrokeExternal() || StrokeHeaderSeparator() )`.
    expect(DIALOG).toContain('borderControlsEnabled(v)');
    expect(DIALOG).toContain('separatorControlsEnabled(v)');
  });

  it('and the old read-only stub is gone', () => {
    // It reported the counts the drag had produced and offered nothing else.
    expect(EDITOR).not.toContain('tableDrawGrid');
    expect(EDITOR).not.toContain('setTableEdit');
  });
});
