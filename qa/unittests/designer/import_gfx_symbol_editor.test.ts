// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Import Graphics in the Symbol Editor — `SYMBOL_EDITOR_DRAWING_TOOLS::
 * ImportGraphics` (symbol_editor_drawing_tools.cpp:688-830), the second arm
 * of the action that #501 shipped for the sheet (#511).
 *
 * The dialog is the one `DIALOG_IMPORT_GFX_SCH`; what differs is the sink it
 * reads the file through, and where the items go: `symbol->AddDrawItem`
 * into the unit being edited, straight away or after riding the cursor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PARAMS,
  runImport,
} from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_import_gfx.js';
import { symbolEditorMenus } from '@ziroeda/designer/src/editors/symbol/menubar.js';
import { moveGraphic } from '@ziroeda/designer/src/editors/symbol/edits.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const dxf = (pairs: (readonly [number, string])[]): string =>
  `${pairs.map(([c, v]) => `${c}\n${v}`).join('\n')}\n`;
const entities = (pairs: (readonly [number, string])[]): string =>
  dxf([[0, 'SECTION'], [2, 'ENTITIES'], ...pairs, [0, 'ENDSEC'], [0, 'EOF']]);

/** A line and a text: the two kinds the sinks disagree about. */
const LINE_AND_TEXT = entities([
  [0, 'LINE'],
  [8, '0'],
  [10, '0'],
  [20, '0'],
  [11, '10'],
  [21, '0'],
  [0, 'TEXT'],
  [8, '0'],
  [1, 'AB'],
  [10, '0'],
  [20, '5'],
  [40, '4'],
]);

describe('the sink', () => {
  it('through GRAPHICS_IMPORTER_LIB_SYMBOL a text is a LibGraphic, and no label is produced', () => {
    // The schematic sink reports a `(text …)` as a SchLabel for `doc.labels`;
    // a library symbol has no labels, its text is a drawing item.
    const sch = runImport('a.dxf', LINE_AND_TEXT, DEFAULT_PARAMS, 'sch');
    expect(sch.graphics.map((g) => g.kind)).toStrictEqual(['polyline']);
    expect(sch.labels).toHaveLength(1);
    const lib = runImport('a.dxf', LINE_AND_TEXT, DEFAULT_PARAMS, 'lib_symbol');
    expect(lib.graphics.map((g) => g.kind)).toStrictEqual(['polyline', 'text']);
    expect(lib.labels).toHaveLength(0);
    expect(lib.error).toBeUndefined();
  });

  it('the default is the schematic sink, as before', () => {
    expect(runImport('a.dxf', LINE_AND_TEXT, DEFAULT_PARAMS).labels).toHaveLength(1);
  });
});

describe('the way in', () => {
  it('File > Import > Graphics... is live in the Symbol Editor, with Ctrl+Shift+F', () => {
    // `EDIT_TOOL( SCH_ACTIONS::importGraphics )` (symbol_edit_frame.cpp:656):
    // live exactly when the symbol is editable.
    const calls: string[] = [];
    const rows = (isEditable: boolean) => {
      const menus = symbolEditorMenus(
        { action: (id: string) => calls.push(id) } as never,
        {} as never,
        { isEditable, haveSymbol: true } as never,
      );
      const file = menus.find((m) => m.label === 'File')!;
      const imp = file.items.find((i) => 'label' in i && i.label === 'Import') as {
        submenu: { label: string; id?: string; shortcut?: string; disabled?: boolean }[];
      };
      return imp.submenu.find((r) => r.label === 'Graphics...')!;
    };
    const live = rows(true) as { disabled?: boolean; shortcut?: string; action?: () => void };
    expect(live.disabled).toBeFalsy();
    expect(live.shortcut).toBe('Ctrl+Shift+F');
    live.action?.();
    expect(calls).toStrictEqual(['importGraphics']);
    expect(rows(false).disabled).toBe(true);
  });

  it('the editor answers the action, commits under "Import Graphic", and drops at the cursor', () => {
    const editor = read('../../../designer/src/editors/symbol/SymbolEditor.tsx');
    expect(editor).toContain("case 'importGraphics':");
    expect(editor).toContain("commit(sym, 'Import Graphic')");
    // `item->Move( delta )` with delta = cursorPos: the origin rides the cursor.
    expect(editor).toContain('pendingImport.map((g) => moveGraphic(g, pos))');
    expect(editor).toContain("'No graphic items found in file.'");
  });
});

describe('the drop', () => {
  it('moves every kind of imported item by the cursor position', () => {
    const lib = runImport('a.dxf', LINE_AND_TEXT, DEFAULT_PARAMS, 'lib_symbol');
    const moved = lib.graphics.map((g) => moveGraphic(g, { x: 1000, y: -2000 }));
    const line = moved[0]!;
    const text = moved[1]!;
    if (line.kind !== 'polyline' || text.kind !== 'text') throw new Error('kinds');
    expect(line.points[0]).toStrictEqual({ x: 1000, y: -2000 });
    expect(text.at.y - (lib.graphics[1] as { at: { y: number } }).at.y).toBe(-2000);
  });
});
