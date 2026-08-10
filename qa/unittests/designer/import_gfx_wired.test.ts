// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Import Graphics is reachable and lands on the sheet (#501).
 *
 * The parse and the shape mapping are covered by their own tests; what this
 * guards is the wiring, which is the part that cannot fail loudly. A dialog
 * nothing opens, a hotkey nothing binds, or a menu entry still greyed out all
 * look exactly like a feature that was never written — and all three live in
 * `.tsx` that `qa` cannot compile, so nothing else here would notice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HOTKEYS } from '@ziroeda/designer/src/editors/schematic/hotkeys.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const EDITOR = read('../../../designer/src/editors/schematic/SchematicEditor.tsx');
const MENUBAR = read('../../../designer/src/editors/schematic/menubar.ts');
const DIALOG = read('../../../designer/src/editors/schematic/dialogs/dialog_import_gfx.tsx');

describe('the way in', () => {
  it('the File > Import > Graphics entry dispatches rather than being a stub', () => {
    expect(MENUBAR).toContain("actNoIcon('Graphics...', 'importGraphics', 'Ctrl+Shift+F')");
  });

  it('the editor answers that action', () => {
    expect(EDITOR).toContain("id === 'importGraphics'");
  });

  it('and Ctrl+Shift+F is bound, ahead of the Ctrl+F find arms', () => {
    // The find handlers do not test shift, so the order is what keeps
    // Ctrl+Shift+F out of their hands.
    const importAt = EDITOR.indexOf('SCH_ACTIONS::importGraphics (Ctrl+Shift+F)');
    const findAt = EDITOR.indexOf('ACTIONS::find (Ctrl+F)');
    expect(importAt).toBeGreaterThan(0);
    expect(findAt).toBeGreaterThan(0);
    expect(importAt).toBeLessThan(findAt);
  });

  it('and the hotkey list advertises it', () => {
    const row = HOTKEYS.find((h) => h.id === 'importGraphics');
    expect(row?.keys).toBe('Ctrl+Shift+F');
    expect(row?.upstream).toBe('SCH_ACTIONS::importGraphics');
  });
});

describe('the dialog', () => {
  it('offers upstream fields, with its labels', () => {
    for (const label of [
      'File:',
      'Placement',
      'Interactive placement',
      'Import Parameters',
      'Import scale:',
      'DXF Parameters',
      'Default line width:',
      'Default units:',
    ])
      expect(DIALOG).toContain(label);
  });

  it('picks its plugin from the manager rather than sniffing the extension', () => {
    // `GetPluginByExt` is what decides, so the formats the dialog offers and
    // the formats it can read cannot drift apart.
    expect(DIALOG).toContain('getPluginByExt(fileExtension(name))');
    expect(DIALOG).toContain('accept={acceptedExtensions()}');
  });

  it('and the DXF group is enabled only for a DXF, as onFilename does', () => {
    // Neither the width nor the units mean anything to an SVG, which carries
    // both: "m_defaultLineWidth.Enable( enableDXFControls )".
    expect(DIALOG).toContain('instanceof DXF_IMPORT_PLUGIN');
    expect(DIALOG).toContain('disabled={!isDxf}');
  });

  it('the import re-runs when a parameter changes, not only when a file is picked', () => {
    // The scale, the origin, the width and the units all change what the
    // import *produces*, not what is done with it afterwards.
    expect(DIALOG).toContain('}, [file, params, interactive]);');
  });

  it('and what the import could not carry is shown, not swallowed', () => {
    // Both halves report: the plugin for entities it skipped, the importer for
    // shapes a sheet has no item for.
    expect(DIALOG).toContain('imported?.notes.map');
    expect(DIALOG).toContain('plugin.GetMessages(), importer.GetMessages()');
  });

  it('says so when a file holds nothing importable', () => {
    // `wxMessageBox( _( "No graphic items found in file." ) );`
    expect(DIALOG).toContain('No graphic items found in file.');
  });

  it('and OK is refused until something imported', () => {
    expect(DIALOG).toContain('disabled={!imported || empty || !!imported.error}');
  });
});

describe('what OK does', () => {
  it('adds what was imported directly when a position was given', () => {
    // Both arms: a `(text …)` is a SchLabel and lives in doc.labels, so an
    // import that only produced text would otherwise land nothing.
    expect(EDITOR).toContain('runCommand(addItems({ graphics, labels }))');
  });

  it('and hands them to the cursor for interactive placement', () => {
    // The paste gesture: the drawing follows the cursor and a click drops it,
    // which is what upstream's placement loop does with the imported items.
    expect(EDITOR).toContain('setPastePending({');
    expect(EDITOR).toContain('graphics,');
    expect(EDITOR).toContain('labels,');
  });
});
