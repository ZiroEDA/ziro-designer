// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Does the file we write actually parse as a `.kicad_sch`?
 *
 * `writer_round_trip.test.ts` reads our output back through *our own* reader,
 * which is a check that the model survives a save and nothing more: our reader
 * tolerates unknown children by design, so a token KiCad has never heard of
 * round-trips there perfectly and the file is still unopenable in KiCad. That
 * is exactly how `(hyperlink "…")` survived — a token absent from
 * eeschema/schematic.keywords, written as a direct child of a text item, on
 * which `parseSchText` throws PARSE_ERROR.
 *
 * So this suite validates the *output* against KiCad's grammar rather than
 * ours, two ways:
 *
 *  1. real KiCad. `kicad-cli sch export netlist` loads the file with
 *     SCH_IO_KICAD_SEXPR_PARSER and fails if it will not parse. This is the
 *     only check that catches a *known* token in the wrong place — `href` is a
 *     schematic keyword, but only `parseEDA_TEXT` accepts it, so it is legal
 *     inside `(effects …)` and a parse error anywhere else. Skipped where
 *     kicad-cli is not installed.
 *  2. a token whitelist, always run: every list head in our output has to be a
 *     token in eeschema/schematic.keywords (vendored at qa/data). Weaker than
 *     (1), but it needs nothing installed, so CI still catches an invented
 *     token.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize, isList, head, type SNode } from '@ziroeda/sexpr';
import { readSchematic, writeSchematic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { annotateSymbols, defaultAnnotateOptions } from '@ziroeda/eeschema/src/tools/annotate.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** A whole, loadable document: KiCad needs the header, not just the items. */
const sch = (body: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "eeschema") (generator_version "9.0")
      (uuid "00000000-0000-0000-0000-0000000000aa") (paper "A4") (lib_symbols) ${body})`),
  );

const write = (s: Schematic): string => serialize(writeSchematic(s));

// ----- (1) real KiCad -------------------------------------------------------

const KICAD_CLI = (() => {
  try {
    execFileSync('kicad-cli', ['version'], { stdio: 'pipe', timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Load `text` with real KiCad and export its netlist. `sch export netlist` runs
 * the full SCH_IO_KICAD_SEXPR_PARSER and needs no display; the netlist it
 * writes is built from the loaded model, so it also reports what KiCad *reads*
 * — `(ref "…")` in it is `SCH_SYMBOL::GetRef` for the sheet path in question.
 */
function kicadExport(text: string): { net: string } | { error: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ziro-grammar-'));
  try {
    const file = join(dir, 'out.kicad_sch');
    const netFile = join(dir, 'out.net');
    writeFileSync(file, text);
    execFileSync('kicad-cli', ['sch', 'export', 'netlist', '--output', netFile, file], {
      stdio: 'pipe',
      timeout: 120_000,
    });
    return { net: readFileSync(netFile, 'utf8') };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
    return {
      error:
        `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`.trim() ||
        (err.message ?? 'kicad-cli refused the file'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Null when real KiCad parsed the text, the tool's own complaint otherwise. */
function kicadLoadError(text: string): string | null {
  const r = kicadExport(text);
  return 'error' in r ? r.error : null;
}

/**
 * The distinct references real KiCad reads out of our output, sorted.
 *
 * This is the only check that can see finding 1 at all: our own reader would
 * happily report the Reference property, while KiCad resolves a symbol's name
 * through its `(instances …)` records first.
 */
function kicadRefs(s: Schematic): string[] {
  const r = kicadExport(write(s));
  if ('error' in r) throw new Error(r.error);
  return [...new Set([...r.net.matchAll(/\(ref "([^"]+)"\)/g)].map((m) => m[1]!))].sort();
}

/** Assert real KiCad parses the document, quoting its own message when it does not. */
function expectKiCadLoads(s: Schematic): void {
  expect(kicadLoadError(write(s))).toBeNull();
}

// ----- (2) the token whitelist ---------------------------------------------

const KEYWORDS: ReadonlySet<string> = new Set(
  readFileSync(fileURLToPath(new URL('../../data/schematic.keywords', import.meta.url)), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#')),
);

/** Every list head in the text, e.g. `at`, `effects`, `href`. */
function headTokens(text: string): Set<string> {
  const out = new Set<string>();
  const walk = (n: SNode): void => {
    if (!isList(n)) return;
    const h = head(n);
    if (h !== undefined) out.add(h);
    for (const it of n.items) walk(it);
  };
  walk(parse(text));
  return out;
}

/** The heads our output uses that KiCad's schematic lexer does not know. */
const unknownTokens = (s: Schematic): string[] =>
  [...headTokens(write(s))].filter((t) => !KEYWORDS.has(t)).sort();

// ----- the documents --------------------------------------------------------

/** A whole document KiCad itself wrote, from qa/data. */
const corpus = (name: string): Schematic =>
  readSchematic(
    parse(readFileSync(fileURLToPath(new URL(`../../data/${name}`, import.meta.url)), 'utf8')),
  );

const TEXT_UUID = '00000000-0000-0000-0000-0000000000ab';

/** A plain `(text …)` with no `(effects …)` at all, as another tool may write it. */
const bareText = (): Schematic => sch(`(text "hi" (at 100 100 0) (uuid "${TEXT_UUID}"))`);

/** A text box with neither `(fill …)` nor `(effects …)`. */
const bareTextBox = (): Schematic =>
  sch(`(text_box "tb" (at 50 50 0) (size 20 10) (uuid "00000000-0000-0000-0000-0000000000ac"))`);

/** A one-cell table whose cell has neither `(fill …)` nor `(effects …)`. */
const bareTable = (): Schematic =>
  sch(`(table (column_count 1) (border (external yes) (header yes)
        (stroke (width 0) (type solid)))
      (separators (rows yes) (cols yes) (stroke (width 0) (type solid)))
      (column_widths 20) (row_heights 10)
      (cells (table_cell "c" (at 10 10 0) (size 20 10) (span 1 1)
        (uuid "00000000-0000-0000-0000-0000000000ad")))
      (uuid "00000000-0000-0000-0000-0000000000ae"))`);

describe('a hyperlink is (href …) inside (effects …)', () => {
  // common/eda_text.cpp:1116 writes it there and sch_io_kicad_sexpr_parser.cpp:869
  // (parseEDA_TEXT) is the only code that reads it. We used to append
  // `(hyperlink "…")` straight to the item, which is not a schematic token at
  // all: tick the Hyperlink box in Text Properties, save, and the file would
  // not open in KiCad again.
  const linked = (): Schematic => {
    const d = bareText();
    return { ...d, labels: [{ ...d.labels[0]!, hyperlink: 'https://example.com/ds.pdf' }] };
  };

  it('emits no token KiCad does not know', () => {
    expect(unknownTokens(linked())).toEqual([]);
  });

  it('writes href inside the effects, never a bare hyperlink child', () => {
    const out = write(linked());
    expect(out).not.toContain('hyperlink');
    expect(out).toContain('href');
    // Inside (effects …), not beside it: the parser only takes it there.
    const effects = /\(effects\b[\s\S]*?\(href "https:\/\/example\.com\/ds\.pdf"\)/.test(out);
    expect(effects).toBe(true);
  });

  it.skipIf(!KICAD_CLI)('opens in real KiCad', () => {
    expectKiCadLoads(linked());
  });

  it('still reads a (hyperlink …) we wrote before, and rewrites it as href', () => {
    // Files ZiroEDA already saved carry the bad token. They must keep opening
    // here, and saving them again must clean them up.
    const d = sch(
      `(text "hi" (at 100 100 0) (effects (font (size 1.27 1.27)))
        (hyperlink "https://example.com/old") (uuid "${TEXT_UUID}"))`,
    );
    expect(d.labels[0]!.hyperlink).toBe('https://example.com/old');
    const out = write(d);
    expect(out).not.toContain('hyperlink');
    expect(out).toContain('(href "https://example.com/old")');
    expect(readSchematic(parse(out)).labels[0]!.hyperlink).toBe('https://example.com/old');
  });

  it('round-trips a text box’s hyperlink too', () => {
    const d = bareTextBox();
    const linkedBox = {
      ...d,
      textBoxes: [{ ...d.textBoxes[0]!, hyperlink: 'https://example.com/box' }],
    };
    const out = write(linkedBox);
    expect(out).not.toContain('hyperlink');
    expect(readSchematic(parse(out)).textBoxes[0]!.hyperlink).toBe('https://example.com/box');
    expect(unknownTokens(linkedBox)).toEqual([]);
  });

  it.skipIf(!KICAD_CLI)('a text box’s hyperlink opens in real KiCad', () => {
    const d = bareTextBox();
    expectKiCadLoads({
      ...d,
      textBoxes: [{ ...d.textBoxes[0]!, hyperlink: 'https://example.com/box' }],
    });
  });
});

describe('the bare `private` flag on a property', () => {
  // saveField (sch_io_kicad_sexpr.cpp:1011) prints `private` as an atom BEFORE
  // the name, and parseSchField (:2289) consumes it before reading one. Taking
  // args()[0] as the name made the name read as "private" and the value as the
  // name, so editing the field's value renamed it instead.
  const withPrivate = (): Schematic =>
    sch(`(symbol (lib_id "Device:R") (at 50 50 0) (unit 1)
        (uuid "00000000-0000-0000-0000-0000000000b0")
        (property "Reference" "R1" (at 50 45 0))
        (property "Value" "10k" (at 50 55 0))
        (property private "Spice_Netlist_Enabled" "Y" (at 50 60 0)))`);

  it('reads the field’s true name and value', () => {
    const f = withPrivate().symbols[0]!.fields.find((x) => x.key === 'Spice_Netlist_Enabled');
    expect(f).toBeDefined();
    expect(f!.value).toBe('Y');
    expect(f!.isPrivate).toBe(true);
  });

  it('edits the value, not the name', () => {
    const d = withPrivate();
    const sym = d.symbols[0]!;
    const fields = sym.fields.map((f) =>
      f.key === 'Spice_Netlist_Enabled' ? { ...f, value: 'N' } : f,
    );
    const back = readSchematic(parse(write({ ...d, symbols: [{ ...sym, fields }] })));
    const f = back.symbols[0]!.fields.find((x) => x.key === 'Spice_Netlist_Enabled');
    expect(f).toBeDefined();
    expect(f!.value).toBe('N');
    expect(f!.isPrivate).toBe(true);
    // And no field is left called "private".
    expect(back.symbols[0]!.fields.map((x) => x.key)).not.toContain('private');
  });

  it('keeps the flag ahead of the name in the file', () => {
    expect(write(withPrivate())).toContain('(property private "Spice_Netlist_Enabled"');
  });

  it.skipIf(!KICAD_CLI)('opens in real KiCad', () => {
    expectKiCadLoads(withPrivate());
  });
});

describe('children upstream formats unconditionally', () => {
  // Each of these is patched only when the source node already had the child,
  // so an edit that would INTRODUCE it was silently dropped. Upstream prints
  // all of them every time: EDA_TEXT::Format for (effects …), formatFill
  // (sch_io_kicad_sexpr_common.cpp:33) for (fill (type …)).
  it('adds a label’s effects when the source had none', () => {
    const d = bareText();
    const l = d.labels[0]!;
    const edited = { ...d, labels: [{ ...l, effects: { hidden: false, bold: true } }] };
    const back = readSchematic(parse(write(edited)));
    expect(back.labels[0]!.effects?.bold).toBe(true);
  });

  it('adds a text box’s fill when the source had none', () => {
    const d = bareTextBox();
    const tb = d.textBoxes[0]!;
    const edited = { ...d, textBoxes: [{ ...tb, fill: { type: 'background' } }] };
    expect(readSchematic(parse(write(edited))).textBoxes[0]!.fill?.type).toBe('background');
  });

  it('adds a text box’s effects when the source had none', () => {
    const d = bareTextBox();
    const tb = d.textBoxes[0]!;
    const edited = {
      ...d,
      textBoxes: [{ ...tb, effects: { hidden: false, fontSize: [mmToIU(2), mmToIU(2)] as const } }],
    };
    const back = readSchematic(parse(write(edited)));
    expect(back.textBoxes[0]!.effects?.fontSize).toEqual([mmToIU(2), mmToIU(2)]);
  });

  it('adds a table cell’s fill and effects when the source had neither', () => {
    const d = bareTable();
    const table = d.tables![0]!;
    const cell = table.cells[0]!;
    const edited = {
      ...d,
      tables: [
        {
          ...table,
          cells: [
            { ...cell, fill: { type: 'background' }, effects: { hidden: false, italic: true } },
          ],
        },
      ],
    };
    const back = readSchematic(parse(write(edited)));
    expect(back.tables![0]!.cells[0]!.fill?.type).toBe('background');
    expect(back.tables![0]!.cells[0]!.effects?.italic).toBe(true);
  });

  it.skipIf(!KICAD_CLI)('the added children are in the place KiCad wants them', () => {
    // Order is not free: saveTextBox prints (fill …) then (effects …) then the
    // uuid, and the parser is positional about none of it but does reject a
    // child it does not expect at that level. Loading is the check.
    const d = bareTextBox();
    const tb = d.textBoxes[0]!;
    expectKiCadLoads({
      ...d,
      textBoxes: [
        {
          ...tb,
          fill: { type: 'background' },
          effects: { hidden: false, bold: true },
          hyperlink: 'https://example.com/box',
        },
      ],
    });
    const t = bareTable();
    const table = t.tables![0]!;
    expectKiCadLoads({
      ...t,
      tables: [
        {
          ...table,
          cells: [
            {
              ...table.cells[0]!,
              fill: { type: 'background' },
              effects: { hidden: false, italic: true },
            },
          ],
        },
      ],
    });
  });
});

describe('an untouched document still writes tokens KiCad knows', () => {
  for (const name of ['nfc-antenna.kicad_sch', 'complex_hierarchy.kicad_sch']) {
    it(`${name} re-writes inside the grammar`, () => {
      expect(unknownTokens(corpus(name))).toEqual([]);
    });

    it.skipIf(!KICAD_CLI)(`${name} re-opens in real KiCad`, () => {
      expectKiCadLoads(corpus(name));
    });
  }
});

describe('a symbol reference lives in its (instances …), not its property', () => {
  // SCH_SYMBOL::GetRef (eeschema/sch_symbol.cpp:646) looks the current sheet
  // path up in the symbol's instance list and only falls back to the Reference
  // property when nothing matches, and saveSymbol (sch_io_kicad_sexpr.cpp:940)
  // writes `(path … (reference …) (unit …))` for every path. Our writer patched
  // every child of `(symbol …)` except `(instances …)`, so annotating a
  // KiCad-authored file produced a property saying "P501" beside a record still
  // saying "P102" — and KiCad, on reopening, showed P102 again. Nothing in the
  // suite looked at the instance records, and our own reader cannot see the
  // difference, so the assertions that matter here go through real KiCad.
  const annotated = (): Schematic => {
    const d = corpus('complex_hierarchy.kicad_sch');
    return {
      ...d,
      symbols: annotateSymbols(d, new Map(), {
        ...defaultAnnotateOptions(),
        resetExisting: true,
        startNumber: 500,
      }),
    };
  };

  it('has instance records to begin with', () => {
    // If the fixture ever loses them this whole describe silently proves nothing.
    const d = corpus('complex_hierarchy.kicad_sch');
    const p102 = d.symbols.find(
      (s) => s.fields.find((f) => f.key === 'Reference')?.value === 'P102',
    );
    expect(p102?.instances?.map((i) => [i.project, i.reference, i.unit])).toEqual([
      ['complex_hierarchy', 'P102', 1],
    ]);
  });

  it.skipIf(!KICAD_CLI)('KiCad reads back the reference we annotated with', () => {
    const refs = kicadRefs(annotated());
    expect(refs).toContain('P501');
    expect(refs).toContain('P502');
    expect(refs).not.toContain('P102');
    expect(refs).not.toContain('P101');
  });

  it('writes the new reference into the record, keeping the record’s path', () => {
    const back = readSchematic(parse(write(annotated())));
    const p502 = back.symbols.find(
      (s) => s.fields.find((f) => f.key === 'Reference')?.value === 'P502',
    );
    expect(p502?.instances).toEqual([
      expect.objectContaining({
        project: 'complex_hierarchy',
        path: '/5b9623a5-6d01-41fc-9865-e1bc779418c8',
        reference: 'P502',
        unit: 1,
      }),
    ]);
  });

  it('leaves an untouched document’s records exactly as it found them', () => {
    // The writer is patch-based: reading and writing without editing anything
    // must not move a single reference.
    expect(write(corpus('complex_hierarchy.kicad_sch'))).toContain('(reference "P102")');
  });

  // A symbol placed on two sheet paths. Our model has one reference per symbol
  // and no current sheet path (tools/annotate.ts documents the difference), so
  // the edit goes to the record the model's reference came from — the other
  // path keeps the annotation the file gave it rather than being overwritten
  // with a reference that was never about it.
  const twoPaths = (refA: string, refB: string, property = refA): Schematic =>
    sch(`(symbol (lib_id "Device:R") (at 50 50 0) (unit 1)
        (uuid "00000000-0000-0000-0000-0000000000c0")
        (property "Reference" "${property}" (at 50 45 0))
        (property "Value" "10k" (at 50 55 0))
        (instances (project "p"
          (path "/00000000-0000-0000-0000-0000000000a1" (reference "${refA}") (unit 1))
          (path "/00000000-0000-0000-0000-0000000000a2" (reference "${refB}") (unit 1)))))`);

  const withReference = (d: Schematic, ref: string, unit?: number): Schematic => {
    const sym = d.symbols[0]!;
    return {
      ...d,
      symbols: [
        {
          ...sym,
          ...(unit === undefined ? {} : { unit }),
          fields: sym.fields.map((f) => (f.key === 'Reference' ? { ...f, value: ref } : f)),
        },
      ],
    };
  };

  it('moves only the record the model’s reference came from', () => {
    const out = write(withReference(twoPaths('R1', 'R2'), 'R9'));
    expect(out).toContain('(reference "R9")');
    expect(out).toContain('(reference "R2")');
    expect(out).not.toContain('(reference "R1")');
  });

  it('moves every record when none of them carried the old reference', () => {
    // The file already disagreed with its own property; leaving the records
    // would mean KiCad reads back a reference this app has never shown.
    const out = write(withReference(twoPaths('R1', 'R2', 'R7'), 'R9'));
    expect(out).not.toContain('(reference "R1")');
    expect(out).not.toContain('(reference "R2")');
    expect([...out.matchAll(/\(reference "R9"\)/g)]).toHaveLength(2);
  });

  it('follows a unit change into the record', () => {
    // SCH_SYMBOL_INSTANCE::m_Unit, which is what GetRef appends the A/B suffix
    // from; leaving it stale put the symbol back on unit 1 in KiCad.
    const out = write(withReference(twoPaths('R1', 'R2'), 'R1', 2));
    expect(out).toContain('(unit 2)');
    expect([...out.matchAll(/\(unit 1\)/g)]).toHaveLength(1);
  });

  it.skipIf(!KICAD_CLI)('the patched records still load', () => {
    expectKiCadLoads(withReference(twoPaths('R1', 'R2'), 'R9', 2));
  });

  it.skipIf(!KICAD_CLI)('a symbol with no records at all keeps the field fallback', () => {
    // tools/build.ts strips `(instances …)` from a symbol we place, exactly as
    // KiCad's PruneOrphanedSymbolInstances does on paste, so such a symbol has
    // no record to patch and GetRef reads its Reference property instead. That
    // has to keep working, or every newly placed symbol loses its annotation.
    const root = parse(
      readFileSync(
        fileURLToPath(new URL('../../data/complex_hierarchy.kicad_sch', import.meta.url)),
        'utf8',
      ),
    );
    const d = readSchematic({
      kind: 'list',
      items: root.items.map((it) =>
        isList(it) && head(it) === 'symbol'
          ? {
              kind: 'list' as const,
              items: it.items.filter((c) => !(isList(c) && head(c) === 'instances')),
            }
          : it,
      ),
    });
    expect(d.symbols.every((s) => s.instances === undefined)).toBe(true);
    const refs = kicadRefs({
      ...d,
      symbols: annotateSymbols(d, new Map(), {
        ...defaultAnnotateOptions(),
        resetExisting: true,
        startNumber: 700,
      }),
    });
    expect(refs).toContain('P701');
    expect(refs).not.toContain('P102');
  });
});

describe('a sheet pin’s effects', () => {
  // The fourth of the guarded patchers from the same audit: writeSheetPin only
  // patched `(effects …)` when the source node already had one, so a formatting
  // edit on a pin from a file that carried none was dropped. saveSheet prints
  // the pin's `(at …)`, its uuid and then EDA_TEXT::Format unconditionally
  // (sch_io_kicad_sexpr.cpp:1117-1130), so the node has one right place to go.
  const bareSheetPin = (): Schematic =>
    sch(`(sheet (at 100 100) (size 20 20)
        (stroke (width 0) (type solid)) (fill (color 0 0 0 0.0000))
        (uuid "00000000-0000-0000-0000-0000000000d0")
        (property "Sheetname" "sub" (at 100 99.4 0))
        (property "Sheetfile" "sub.kicad_sch" (at 100 120.7 0))
        (pin "IN" input (at 100 105 180)
          (uuid "00000000-0000-0000-0000-0000000000d1")))`);

  const italicised = (): Schematic => {
    const d = bareSheetPin();
    const sheet = d.sheets[0]!;
    const pin = sheet.pins[0]!;
    return {
      ...d,
      sheets: [{ ...sheet, pins: [{ ...pin, effects: { hidden: false, italic: true } }] }],
    };
  };

  it('is added when the source had none', () => {
    expect(bareSheetPin().sheets[0]!.pins[0]!.effects).toBeUndefined();
    expect(readSchematic(parse(write(italicised()))).sheets[0]!.pins[0]!.effects?.italic).toBe(
      true,
    );
  });

  it('goes after the uuid, where saveSheet prints it', () => {
    expect(write(italicised())).toMatch(/\(uuid "[^"]+"\)\s*\(effects\b/);
  });

  it.skipIf(!KICAD_CLI)('and the result opens in real KiCad', () => {
    expectKiCadLoads(italicised());
  });
});
