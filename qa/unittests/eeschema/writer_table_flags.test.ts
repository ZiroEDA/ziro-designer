// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A table's border and separator flags reach the file.
 *
 * This is the writer audit's shape again, and this time self-inflicted: the
 * properties panel gained editable border/separator toggles before anyone
 * checked that `writeTable` patched them. It did not — it rebuilt `(cells …)`
 * and nothing else — so every toggle would have been lost on save.
 *
 * The rule the audit named: patching only what the source already had is fine
 * for a node that is absent, but the *values inside* a node that exists must be
 * written even when they are `no`, because the reader defaults a missing flag
 * to false and cannot tell "off" from "never mentioned".
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { replaceTable } from '@ziroeda/eeschema/src/tools/mutate.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

const TABLE = `(table (column_count 2)
   (border (external yes) (header yes) (stroke (width 0) (type solid)))
   (separators (rows yes) (cols yes) (stroke (width 0) (type solid)))
   (column_widths 10 10) (row_heights 5)
   (cells
     (table_cell "a" (exclude_from_sim no) (at 0 0 0) (size 10 5)
       (margins 0.9525 0.9525 0.9525 0.9525) (span 1 1)
       (effects (font (size 1.27 1.27))) (uuid "c-a"))
     (table_cell "b" (exclude_from_sim no) (at 10 0 0) (size 10 5)
       (margins 0.9525 0.9525 0.9525 0.9525) (span 1 1)
       (effects (font (size 1.27 1.27))) (uuid "c-b")))
   (uuid "tb-1"))`;

const doc = (): Schematic => sheet(TABLE);
/** Round-trip a table after applying `patch`. */
const after = (patch: Partial<Schematic['tables'][number]>) => {
  const d = doc();
  const out = serializeSchematic(replaceTable(0, { ...d.tables[0]!, ...patch }).apply(d));
  return { text: out, table: readSchematic(parse(out)).tables[0]! };
};

describe('turning a flag off survives the save', () => {
  it('external border', () => {
    expect(after({ borderExternal: false }).table.borderExternal).toBe(false);
  });

  it('header border', () => {
    expect(after({ borderHeader: false }).table.borderHeader).toBe(false);
  });

  it('row separators', () => {
    expect(after({ separatorRows: false }).table.separatorRows).toBe(false);
  });

  it('column separators', () => {
    expect(after({ separatorCols: false }).table.separatorCols).toBe(false);
  });

  it('writes the flag explicitly rather than dropping it', () => {
    // A dropped flag reads back as false too, so the round-trip alone would
    // pass either way; assert the token is really there and says "no".
    expect(after({ borderHeader: false }).text).toContain('(header no)');
  });
});

describe('turning one back on survives too', () => {
  it('a flag written as no can be set to yes', () => {
    const d = doc();
    const off = readSchematic(
      parse(
        serializeSchematic(replaceTable(0, { ...d.tables[0]!, separatorCols: false }).apply(d)),
      ),
    );
    const on = readSchematic(
      parse(
        serializeSchematic(replaceTable(0, { ...off.tables[0]!, separatorCols: true }).apply(off)),
      ),
    );
    expect(on.tables[0]!.separatorCols).toBe(true);
  });
});

describe('what the patch leaves alone', () => {
  it('the cells still round-trip', () => {
    expect(after({ borderExternal: false }).table.cells.map((c) => c.text)).toEqual(['a', 'b']);
  });

  it('the strokes ride along untouched', () => {
    expect(after({ borderExternal: false }).text).toContain('(stroke');
  });

  it('an untouched table is byte-stable', () => {
    const d = doc();
    const before = serializeSchematic(d);
    expect(serializeSchematic(replaceTable(0, { ...d.tables[0]! }).apply(d))).toBe(before);
  });

  it('a table with no border node does not gain one', () => {
    // Patching only what the source already had: a node that never carried
    // (border …) is left alone rather than growing one.
    const bare = sheet(`(table (column_count 1) (column_widths 10) (row_heights 5)
       (cells (table_cell "x" (exclude_from_sim no) (at 0 0 0) (size 10 5)
       (margins 0.9525 0.9525 0.9525 0.9525) (span 1 1)
       (effects (font (size 1.27 1.27))) (uuid "c-x"))) (uuid "tb-2"))`);
    const out = serializeSchematic(
      replaceTable(0, { ...bare.tables[0]!, borderExternal: true }).apply(bare),
    );
    expect(out).not.toContain('(border');
  });
});
