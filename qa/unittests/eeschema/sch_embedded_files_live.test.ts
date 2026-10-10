// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Schematic Setup's Embedded Files page on the live schematic: PANEL_EMBEDDED_FILES( book,
 * &m_frame->Schematic() ). A file added there is written into the .kicad_sch and read back, the
 * embed-fonts flag goes with it, and a file removed there leaves the file.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PANEL_EMBEDDED_FILES } from '@ziroeda/common/dialogs/panel_embedded_files.js';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeAll(() => EMBEDDED_FILES.InitCodec());
beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  return h.frame;
}

const BYTES = new TextEncoder().encode('a note embedded in the schematic\n');

describe('the Embedded Files page on the live schematic', () => {
  it('writes an added file into the .kicad_sch, and the file reads back with its bytes', () => {
    const frame = setUp();
    const schematic = frame.Schematic();
    const shown = PANEL_EMBEDDED_FILES.TransferDataToWindow(schematic.GetEmbeddedFiles());
    expect(shown.files).toEqual([]);

    const modified = PANEL_EMBEDDED_FILES.TransferDataFromWindow(
      { embedFonts: true, files: [{ name: 'note.txt', reference: '', pendingBytes: BYTES }] },
      schematic.GetEmbeddedFiles(),
    );
    expect(modified).toBe(true);

    const root = schematic.GetTopLevelSheet(0)!;
    const text = new SCH_IO_KICAD_SEXPR('eeschema').SaveSchematicFile(root, schematic);
    expect(text).toContain('(embedded_files');
    expect(text).toContain('(name "note.txt")');
    expect(text).toContain('(embedded_fonts yes)');

    // Read back: open the project again with the saved root sheet.
    const back = schToolHarness().frame;
    back.OpenProjectFiles([`/complex_hierarchy/${SHEETS[0]}`], 0, (aPath) => {
      if (aPath === `/complex_hierarchy/${SHEETS[0]}`) return text;
      const name = SHEETS.find((f) => aPath === `/complex_hierarchy/${f}`);
      return name ? readFileSync(join(ORACLE, name), 'utf8') : null;
    });
    const files = back.Schematic().GetEmbeddedFiles();
    const file = files.GetEmbeddedFile('note.txt')!;
    expect(file).not.toBeNull();
    EMBEDDED_FILES.DecompressAndDecode(file);
    expect(new TextDecoder().decode(file.decompressedData)).toBe(new TextDecoder().decode(BYTES));
    expect(files.GetAreFontsEmbedded()).toBe(true);
    expect(PANEL_EMBEDDED_FILES.TransferDataToWindow(files).files.map((f) => f.name)).toEqual([
      'note.txt',
    ]);
  });

  it('leaves a removed file out of the .kicad_sch', () => {
    const frame = setUp();
    const schematic = frame.Schematic();
    PANEL_EMBEDDED_FILES.TransferDataFromWindow(
      { embedFonts: false, files: [{ name: 'note.txt', reference: '', pendingBytes: BYTES }] },
      schematic.GetEmbeddedFiles(),
    );

    const modified = PANEL_EMBEDDED_FILES.TransferDataFromWindow(
      { embedFonts: false, files: [] },
      schematic.GetEmbeddedFiles(),
    );
    expect(modified).toBe(true);

    const text = new SCH_IO_KICAD_SEXPR('eeschema').SaveSchematicFile(
      schematic.GetTopLevelSheet(0)!,
      schematic,
    );
    expect(text).not.toContain('note.txt');
  });
});
