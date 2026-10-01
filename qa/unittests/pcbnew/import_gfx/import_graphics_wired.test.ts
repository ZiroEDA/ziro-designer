// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * File > Import > Graphics is reachable in the board editor.
 *
 * The parse and the placement are covered by their own tests; what this
 * guards is the wiring, which fails silently. `pcb_edit_frame_ui.tsx` is a
 * `.tsx` `qa` cannot compile against `.tsx`-importing types (see the
 * eeschema precedent, `import_gfx_wired.test.ts`), so this reads both files
 * as text, the same way that one does.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const MENUBAR = read('../../../../pcbnew/menubar_pcb_editor.ts');
const EDITOR = read('../../../../pcbnew/pcb_edit_frame_ui.tsx');

describe('File > Import > Graphics', () => {
  it('the menu row dispatches rather than being a stub', () => {
    expect(MENUBAR).toContain("action: () => h.action('importGraphics')");
    // Not `disabled: dis` any more on this row.
    expect(MENUBAR).not.toMatch(/label: 'Graphics\.\.\.', disabled: dis/);
  });

  it('the board editor answers that action with DRAWING_TOOL, which opens the dialog', () => {
    // `PCB_ACTIONS::placeImportedGraphics` -> `DRAWING_TOOL::PlaceImportedGraphics`,
    // whose DIALOG_IMPORT_GRAPHICS is the window's `showImportGraphicsDialog`.
    // The placement itself is drawing_tool_shapes.test.ts's.
    expect(EDITOR).toMatch(
      /case 'importGraphics':\s*runAction\(PCB_ACTIONS\.placeImportedGraphics\);/,
    );
    expect(EDITOR).toContain('showImportGraphicsDialog: () =>');
    expect(EDITOR).toContain('<DialogImportGraphics');
  });
});
