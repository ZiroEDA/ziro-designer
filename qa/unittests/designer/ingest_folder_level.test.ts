// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A picked folder must not become a folder inside a folder.
 *
 * Akshay opened Save As in the schematic editor, standing in project
 * `ecc83-pp`, and the listing held one folder called `ecc83` and no `.kicad_sch`
 * at all — with the filter set to schematic files, in the project whose
 * schematic he was editing.
 *
 * Both halves are the same cause. `webkitRelativePath` puts the picked folder's
 * own name on the front of every path, and the drag-drop walker builds the same
 * prefix; nothing stripped it. Stored verbatim under a project that is itself
 * NAMED for that folder, every document ends up one level below the project
 * root — so the root lists a folder, and the documents are not in it.
 *
 * Upstream never meets this: KiCad is pointed at a `.kicad_pro` already on
 * disk, and the directory holding it IS the project directory. The extra level
 * is an artefact of carrying a folder into a browser.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripCommonFolder } from '@ziroeda/designer/src/home/project_picker.js';

const file = (name: string) => ({ name, bytesOf: async () => new Uint8Array() });
const names = (out: { name: string }[]) => out.map((f) => f.name);

describe('the folder you picked is not kept as a level', () => {
  it('drops it when every file is inside it', () => {
    expect(
      names(
        stripCommonFolder([
          file('ecc83-pp/ecc83-pp.kicad_sch'),
          file('ecc83-pp/ecc83-pp.kicad_pcb'),
          file('ecc83-pp/fp-lib-table'),
        ]),
      ),
    ).toStrictEqual(['ecc83-pp.kicad_sch', 'ecc83-pp.kicad_pcb', 'fp-lib-table']);
  });

  it('keeps the structure BELOW it', () => {
    // Only the one level goes. A project's own subfolders are its own.
    expect(
      names(
        stripCommonFolder([
          file('board/board.kicad_sch'),
          file('board/sub/amp.kicad_sch'),
          file('board/board.pretty/R.kicad_mod'),
        ]),
      ),
    ).toStrictEqual(['board.kicad_sch', 'sub/amp.kicad_sch', 'board.pretty/R.kicad_mod']);
  });
});

describe('and it is left alone when there is nothing to agree on', () => {
  it('leaves a flat selection of loose files', () => {
    const flat = [file('a.kicad_sch'), file('b.kicad_pcb')];
    expect(names(stripCommonFolder(flat))).toStrictEqual(['a.kicad_sch', 'b.kicad_pcb']);
  });

  it('leaves a selection spanning two folders', () => {
    const two = [file('one/a.kicad_sch'), file('two/b.kicad_sch')];
    expect(names(stripCommonFolder(two))).toStrictEqual(['one/a.kicad_sch', 'two/b.kicad_sch']);
  });

  it('leaves it when one file sits beside the folder rather than in it', () => {
    // `README` has no prefix to share, so there is no common folder.
    const mixed = [file('board/a.kicad_sch'), file('README')];
    expect(names(stripCommonFolder(mixed))).toStrictEqual(['board/a.kicad_sch', 'README']);
  });

  it('handles an empty selection', () => {
    expect(stripCommonFolder([])).toStrictEqual([]);
  });
});

describe('the one funnel runs it', () => {
  const HOME = readFileSync(
    fileURLToPath(new URL('../../../designer/src/home/HomePage.tsx', import.meta.url)),
    'utf8',
  );

  it('strips in `ingest`, which every picker and the drop target share', () => {
    // Not at each call site: the folder picker, the drag-drop walker and the
    // zip reader all end here, and a strip per caller is three chances to
    // forget.
    expect(HOME).toContain('files = stripCommonFolder(files);');
  });
});
