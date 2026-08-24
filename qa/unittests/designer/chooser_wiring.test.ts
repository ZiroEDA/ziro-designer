// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every launcher opens its documents through the ONE file dialog.
 *
 * Upstream that is not a choice: `wxFileDialog` is one class and every frame
 * builds one, so the sidebar, the filter combo, the overwrite prompt and the
 * places are the same in eeschema, pcbnew, the symbol editor and pl_editor
 * without anyone maintaining four of them.
 *
 * Ours had a hidden `<input type="file">` per launcher — the operating system's
 * picker, which knows nothing about the account. A document saved into the
 * account could not be re-opened from inside the editor at all, only downloaded
 * and picked off the local disk, and `accept` flattens KiCad's named wildcards
 * into one unlabelled group.
 *
 * This is per-occurrence because the rule is: one launcher still on the OS
 * picker is one launcher that cannot see the account.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

/** Source with comments blanked, so a citation cannot read as code. */
const code = (s: string): string =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('the document editors use the chooser, not the OS picker', () => {
  const wired: [string, string, string | null][] = [
    // file,                                        kind it asks for,  and why
    ['editors/drawingsheet/DrawingSheetEditor.tsx', 'templates', 'GetUserTemplatesPath'],
    ['editors/symbol/SymbolEditor.tsx', 'symbols', 'GetDefaultUserSymbolsPath'],
    ['editors/footprint/FootprintEditor.tsx', 'footprints', 'GetDefaultUserFootprintsPath'],
  ];

  it('asks for the shared folder its document kind belongs in', () => {
    // Raw source: a `kind="..."` prop inside a citation is not a thing, and
    // blanking block comments across a whole file mis-pairs on a `/*` in a
    // string and eats live code with it.
    for (const [file, kind] of wired) {
      expect(src(file), `${file} does not name its kind`).toContain(`kind="${kind}"`);
    }
  });

  it('cites the PATHS:: function that folder comes from', () => {
    // Each is a real upstream path, not a folder we invented.
    for (const [file, , cite] of wired) {
      if (cite) expect(src(file), `${file} cites no PATHS:: source`).toContain(cite);
    }
  });

  it('opens none of its OWN documents through the OS picker', () => {
    // Narrowed to KiCad document types on purpose. A bitmap picker is allowed
    // to stay: `accept="image/*"` needs bytes, which the chooser cannot hand
    // back yet — see the block below. What must not survive is a hidden input
    // that takes a `.kicad_*` file, because that is the account's own document
    // being asked for from the local disk.
    for (const [file] of [...wired, ['editors/schematic/SchematicEditor.tsx']] as [string][]) {
      const body = code(src(file));
      for (const m of body.matchAll(/<input[\s\S]{0,240}?type="file"[\s\S]{0,240}?\/>/g)) {
        expect(m[0], `${file} picks a KiCad document off the local disk`).not.toMatch(
          /accept="[^"]*\.kicad_/,
        );
      }
    }
  });
});

describe('what is deliberately NOT wired, and why', () => {
  /**
   * Said here rather than discovered later. Both need a capability the chooser
   * does not have yet, and neither is a wiring job:
   *
   *   GerbView          opens MANY files at once - a whole plot folder - and one
   *                     of them may be a .zip. `FileChooser` selects one file
   *                     and `OpenFileDialog` hands back text, so this needs
   *                     multi-select and bytes first.
   *   Image converter   takes a bitmap. Same bytes problem.
   *
   * The schematic's `Place > Image` and the hotkey importer are the same shape.
   */
  it('leaves GerbView and the image converter on the OS picker for now', () => {
    for (const file of ['editors/gerbview/GerberViewer.tsx', 'editors/image/ImageConverter.tsx']) {
      expect(code(src(file)), `${file} was wired without multi-select or bytes`).toContain(
        'type="file"',
      );
    }
  });

  it('so the chooser still cannot do either, which is what blocks them', () => {
    const chooser = code(src('fs/FileChooser.tsx'));
    // One selection, not a set. When this becomes a set, GerbView can move.
    expect(chooser).toContain('const [selected, setSelected] = useState<string | null>(null);');
    // And the open dialog decodes to text rather than handing bytes over.
    expect(code(src('fs/OpenFileDialog.tsx'))).toContain('new TextDecoder().decode(bytes)');
  });
});
