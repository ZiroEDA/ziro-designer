// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The legacy `.sch` reader, against KiCad's own conversion of the same project.
 *
 * ## Why the oracle is a fixture and not the CLI
 *
 * The `.lib` reader beside this one is diffed against `kicad-cli sym upgrade`,
 * which runs upstream's reader and writer over the file. There is no such thing
 * for a schematic, and I checked rather than assumed:
 *
 *   - `kicad-cli sch upgrade` REFUSES a legacy file — "Expecting '(' … line 1,
 *     offset 1". It only re-saves s-expression schematics.
 *   - `kicad-cli sch export netlist` accepts one and produces `(components)`
 *     EMPTY, while the same command on the same project's `.kicad_sch` yields
 *     68 components. The CLI reads a legacy header and no content.
 *
 * So the oracle here is `qa/data/eeschema/legacy_sch`, which is KiCad's own
 * `complex_hierarchy` test project carried in BOTH formats: `complex_hierarchy.sch`
 * + `ampli_ht.sch`, and the `.kicad_sch` pair KiCad wrote when it converted
 * them. Reading the legacy files and comparing against the converted ones asks
 * the same question, on a real hierarchical design — two sheets, a sub-sheet
 * instantiated twice, `AR Path=` instance records, mirrored and rotated
 * symbols, buses, labels and no-connects.
 *
 * ## What is compared, and what is not
 *
 * The fixture was converted by KiCad 5.99 (`(version 20200512)`), so its
 * spelling of a property or an effects block is not today's. Geometry is not a
 * spelling: positions, angles, mirrors, sizes, endpoints, counts, library ids,
 * references, values and unit numbers all mean the same thing in both. Those
 * are compared. Item ORDER is not — KiCad's writer sorts, our reader keeps file
 * order — so items are matched by identity and not by index.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { computeNetlist, readSchematic } from '@ziroeda/eeschema';
import { readLegacySymbolLibrary } from '@ziroeda/eeschema/src/sch_io/legacy/read-lib.js';
import {
  legacyLibrarySymbols,
  legacyRootFile,
  legacyUuid,
  modernSheetFile,
  readLegacyProject,
  transformToOrientation,
} from '@ziroeda/eeschema/src/sch_io/legacy/read-schematic.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const data = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../data/eeschema/legacy_sch/${name}`, import.meta.url)),
    'utf8',
  );

/** The project's library, keyed the way its symbols' `lib_id`s name it. */
const projectLibrary = () =>
  new Map(
    readLegacySymbolLibrary(data('complex_hierarchy_schlib.lib')).map((s) => [
      `complex_hierarchy_schlib:${s.libId}`,
      s,
    ]),
  );

/** Fixed UUIDs, so nothing in the comparison depends on when it ran. */
const converted = (): Map<string, Schematic> => {
  let n = 0;
  return readLegacyProject({
    files: new Map([
      ['complex_hierarchy.sch', data('complex_hierarchy.sch')],
      ['ampli_ht.sch', data('ampli_ht.sch')],
    ]),
    rootFile: 'complex_hierarchy.sch',
    projectName: 'complex_hierarchy',
    libSymbols: projectLibrary(),
    newUuid: () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
  }).docs;
};

const kicad = (name: string): Schematic => readSchematic(parse(data(name)));

const xy = (p: { x: number; y: number }): string => `${p.x},${p.y}`;

describe('the project KiCad converted, converted again', () => {
  for (const sheet of ['complex_hierarchy', 'ampli_ht']) {
    describe(sheet, () => {
      const ours = (): Schematic => converted().get(`${sheet}.kicad_sch`)!;
      const theirs = (): Schematic => kicad(`${sheet}.kicad_sch`);

      it('holds the same number of every kind of item', () => {
        const a = ours();
        const b = theirs();
        const counts = (d: Schematic) => ({
          symbols: d.symbols.length,
          lines: d.lines.length,
          junctions: d.junctions.length,
          noConnects: d.noConnects.length,
          labels: d.labels.length,
          sheets: d.sheets.length,
          busEntries: d.busEntries.length,
        });
        expect(counts(a)).toEqual(counts(b));
      });

      it('places every symbol where KiCad placed it, turned the same way', () => {
        // The unit is NOT compared here: `ampli_ht.kicad_sch` carries no
        // `(unit …)` token at all, so the fixture cannot state one. It is
        // asserted directly below instead, off the legacy record.
        const key = (d: Schematic) =>
          d.symbols.map((s) => `${s.libId} @${xy(s.at)} r${s.angle} m${s.mirror ?? '-'}`).sort();
        expect(key(ours())).toEqual(key(theirs()));
      });

      it('gives every symbol the same reference and value', () => {
        const key = (d: Schematic) =>
          d.symbols
            .map((s) => {
              const f = (k: string) => s.fields.find((x) => x.key === k)?.value ?? '';
              return `${xy(s.at)} ${f('Reference')}=${f('Value')}`;
            })
            .sort();
        expect(key(ours())).toEqual(key(theirs()));
      });

      it('draws every wire and bus between the same two points', () => {
        const key = (d: Schematic) =>
          d.lines.map((l) => `${l.kind} ${xy(l.start)} ${xy(l.end)}`).sort();
        expect(key(ours())).toEqual(key(theirs()));
      });

      it('puts every junction and no-connect on the same spot', () => {
        const j = (d: Schematic) => d.junctions.map((x) => xy(x.at)).sort();
        const n = (d: Schematic) => d.noConnects.map((x) => xy(x.at)).sort();
        expect(j(ours())).toEqual(j(theirs()));
        expect(n(ours())).toEqual(n(theirs()));
      });

      it('reads every label to the same text, place and angle', () => {
        const key = (d: Schematic) =>
          d.labels.map((l) => `${l.kind} "${l.text}" @${xy(l.at)} r${l.angle}`).sort();
        expect(key(ours())).toEqual(key(theirs()));
      });
    });
  }

  it('reads the sheets, their sizes and the files they point at', () => {
    // The fixture predates the field rename, so it spells them "Sheet name"
    // and "Sheet file"; both spellings are accepted on the way in, and what is
    // being compared is the VALUE, which the rename did not touch.
    const key = (d: Schematic) =>
      d.sheets
        .map((s) => {
          const f = (...keys: string[]) =>
            keys.map((k) => s.fields.find((x) => x.key === k)?.value).find((v) => v) ?? '';
          return `${f('Sheetname', 'Sheet name')} -> ${f('Sheetfile', 'Sheet file')} @${xy(s.at)} ${s.size.w}x${s.size.h}`;
        })
        .sort();
    expect(key(converted().get('complex_hierarchy.kicad_sch')!)).toEqual(
      key(kicad('complex_hierarchy.kicad_sch')),
    );
  });

  it('gives every sheet the same pins, in the same places', () => {
    const key = (d: Schematic) =>
      d.sheets
        .flatMap((s) => s.pins.map((p) => `${p.name} ${p.shape} @${xy(p.at)} r${p.angle}`))
        .sort();
    expect(key(converted().get('complex_hierarchy.kicad_sch')!)).toEqual(
      key(kicad('complex_hierarchy.kicad_sch')),
    );
  });
});

/**
 * The one place a schematic's Y is not simply carried across:
 *
 *     // Y got inverted in symbol coordinates
 *     pos.y = -( pos.y - symbol->GetY() ) + symbol->GetY();
 *
 * and nothing else touches a symbol field afterwards — `loadSymbol` calls
 * `SetTextPos( pos )` and stops. Only a SHEET gets `AutoplaceFields`.
 *
 * This one is asserted against the pinned source and NOT against the fixture,
 * which disagrees: `complex_hierarchy.kicad_sch` was written by 5.99-1712 six
 * years ago, and its field positions are additionally turned by the symbol's
 * transform (`#PWR02`'s reference lands at 9450,2750 there against the
 * formula's 9350,2850-mirrored). Where a six-year-old conversion and the
 * installed 10.0.5 disagree, the installed build is the parity target.
 */
describe('a symbol field’s position', () => {
  const root = () => converted().get('complex_hierarchy.kicad_sch')!;
  const pwr02 = () => root().symbols.find((s) => s.uuid === legacyUuid('4B4B1578'))!;

  it('is mirrored about its own symbol’s Y, and not otherwise moved', () => {
    // `P 9350 2750` with `F 0 "#PWR02" H 9350 2850`:
    //   symbol y  = 2750 mils = 698500 IU
    //   field  y  = 2850 mils = 723900 IU
    //   mirrored  = -(723900 - 698500) + 698500 = 673100
    const s = pwr02();
    expect(s.at).toEqual({ x: 9350 * 254, y: 698500 });
    const ref = s.fields.find((f) => f.key === 'Reference')!;
    expect(ref.value).toBe('#PWR02');
    expect(ref.at).toEqual({ x: 9350 * 254, y: 673100 });
  });

  it('keeps the field’s own angle, V meaning ninety degrees', () => {
    // `F 1 "-VAA" V 9350 2950` -> -(749300 - 698500) + 698500 = 647700.
    const v = pwr02().fields.find((f) => f.key === 'Value')!;
    expect(v.at).toEqual({ x: 9350 * 254, y: 647700 });
    expect(v.angle).toBe(90);
  });

  it('leaves a field level with its symbol exactly where it is', () => {
    // `F 2 "" H 9350 2750` sits on the symbol's own Y, so the mirror is a
    // no-op — which is the case that would hide a sign error.
    const f = pwr02().fields.find((x) => x.key === 'Footprint')!;
    expect(f.at).toEqual({ x: 9350 * 254, y: 698500 });
  });
});

describe('a symbol’s unit', () => {
  /**
   * `symbol->SetUnit( unit )` takes it from the `U <unit> <bodyStyle> <id>`
   * line, and the `AR … Part="2"` records agree — three statements in the file
   * that this LM358N is its second unit.
   *
   * The converted fixture cannot corroborate it: `ampli_ht.kicad_sch` carries
   * no `(unit …)` token anywhere, so every placement in it reads as unit 1.
   * That is a gap in the fixture and not a disagreement, and re-baselining to
   * it would throw away the only thing the legacy file actually says.
   */
  it('comes off the U line, even where the fixture cannot say so', () => {
    const sub = converted().get('ampli_ht.kicad_sch')!;
    const second = sub.symbols.find((s) => s.uuid === legacyUuid('4B3A135C'));
    expect(second, 'the LM358N with U 2 1 4B3A135C').toBeDefined();
    expect(second!.unit).toBe(2);
    // ...and its sibling, `U 1 1 4B3A1368`, is the first unit.
    expect(sub.symbols.find((s) => s.uuid === legacyUuid('4B3A1368'))!.unit).toBe(1);
  });

  it('reaches the instance records as Part=', () => {
    const sub = converted().get('ampli_ht.kicad_sch')!;
    const second = sub.symbols.find((s) => s.uuid === legacyUuid('4B3A135C'))!;
    expect(second.instances!.map((i) => i.unit)).toEqual([2, 2]);
  });

  it('falls back to 1 for the zero a buggy file can carry', () => {
    // "This fixes a potentially buggy files caused by unit being set to zero
    // which causes netlist issues." Same for the body style.
    const root = converted().get('complex_hierarchy.kicad_sch')!;
    expect(root.symbols.every((s) => s.unit >= 1 && s.bodyStyle >= 1)).toBe(true);
  });
});

describe('the hierarchy', () => {
  it('converts the sub-sheet once, however many times it is placed', () => {
    // `loadHierarchy` reuses a screen it has already loaded, which is what
    // makes two instances of one sub-sheet the same document.
    const docs = converted();
    expect([...docs.keys()].sort()).toEqual(['ampli_ht.kicad_sch', 'complex_hierarchy.kicad_sch']);
  });

  it('points each sheet at the .kicad_sch name, not the .sch it came from', () => {
    expect(modernSheetFile('ampli_ht.sch')).toBe('ampli_ht.kicad_sch');
    const root = converted().get('complex_hierarchy.kicad_sch')!;
    for (const s of root.sheets) {
      expect(s.fields.find((f) => f.key === 'Sheetfile')?.value).toMatch(/\.kicad_sch$/);
    }
  });

  /**
   * `AR Path="/4B3A1333/4B617B88" Ref="R26" Part="1"` — the path excludes the
   * root sheet and INCLUDES the symbol, so the symbol id is dropped and the
   * root screen's UUID is put on the front. A symbol placed on a sub-sheet that
   * appears twice carries one instance per appearance, with a different
   * reference in each; that is the whole reason the records exist.
   */
  it('reads a symbol’s per-instance references off its AR lines', () => {
    const sub = converted().get('ampli_ht.kicad_sch')!;
    const r = sub.symbols.find((s) => s.instances?.some((i) => i.reference === 'R26'));
    expect(r, 'no symbol carries the R26 instance').toBeDefined();
    expect(r!.instances!.map((i) => i.reference).sort()).toEqual(['R26', 'R28']);
    // `/4B3A13A4/4B3A1368` becomes root + the SHEET, with the symbol id
    // dropped — "it's already defined in the symbol itself". A path that kept
    // it would be one level too deep and match no sheet at all.
    expect(r!.instances!.map((i) => i.path).sort()).toEqual([
      `/00000000-0000-0000-0000-000000000001/${legacyUuid('4B3A1333')}`,
      `/00000000-0000-0000-0000-000000000001/${legacyUuid('4B3A13A4')}`,
    ]);
  });

  it('files those instances under the project name', () => {
    const sub = converted().get('ampli_ht.kicad_sch')!;
    const projects = new Set(sub.symbols.flatMap((s) => (s.instances ?? []).map((i) => i.project)));
    expect([...projects]).toEqual(['complex_hierarchy']);
  });
});

describe('the page settings and title block', () => {
  it('reads the paper and the title block KiCad read', () => {
    const a = converted().get('complex_hierarchy.kicad_sch')!;
    const b = kicad('complex_hierarchy.kicad_sch');
    expect(a.paper).toEqual(b.paper);
    expect(a.titleBlock?.title).toBe(b.titleBlock?.title);
    expect(a.titleBlock?.date).toBe(b.titleBlock?.date);
  });
});

describe('a legacy timestamp as a KIID', () => {
  /**
   *     m_uuid.data[12] = aTimestamp >> 24; … data[15] = aTimestamp;
   *
   * The low four bytes, which is why the converted fixture is full of
   * `00000000-0000-0000-0000-0000xxxxxxxx`. Getting the end wrong would not
   * show up as a broken symbol; it would show up as instance paths that match
   * nothing, so every reference falls back to the field.
   */
  it('puts the timestamp in the last four bytes', () => {
    expect(legacyUuid('4B617B88')).toBe('00000000-0000-0000-0000-00004b617b88');
    expect(legacyUuid('4AE173EF')).toBe('00000000-0000-0000-0000-00004ae173ef');
  });

  it('matches the ids KiCad wrote when it converted this very project', () => {
    const theirs = new Set(kicad('complex_hierarchy.kicad_sch').symbols.map((s) => s.uuid));
    const ours = converted()
      .get('complex_hierarchy.kicad_sch')!
      .symbols.map((s) => s.uuid);
    expect(ours.filter((u) => theirs.has(u ?? '')).length).toBe(ours.length);
  });
});

/**
 * `SCH_SYMBOL::GetOrientation()` is a search over twelve candidates, not an
 * inversion of the matrix. These are the four the fixture actually contains
 * plus the identity, read off the converted file.
 */
describe('the transform matrix', () => {
  /**
   * Each matrix below is DERIVED from `SetOrientation`'s composition, not read
   * off a passing run:
   *
   *     new.x1 = m.x1*t.x1 + m.x2*t.y1;   new.y1 = m.y1*t.x1 + m.y2*t.y1;
   *     new.x2 = m.x1*t.x2 + m.x2*t.y2;   new.y2 = m.y1*t.x2 + m.y2*t.y2;
   *
   * starting from `TRANSFORM()` = `1 0 0 1` and applying the incremental
   * `SYM_ROTATE_COUNTERCLOCKWISE` = `0 1 -1 0`, `SYM_ROTATE_CLOCKWISE` =
   * `0 -1 1 0`, `SYM_MIRROR_X` = `1 0 0 -1`, `SYM_MIRROR_Y` = `-1 0 0 1`.
   */
  it('reads the identity as no rotation at all', () => {
    expect(transformToOrientation({ x1: 1, y1: 0, x2: 0, y2: 1 })).toEqual({ angle: 0 });
  });

  it('reads the quarter turns', () => {
    expect(transformToOrientation({ x1: 0, y1: 1, x2: -1, y2: 0 })).toEqual({ angle: 90 });
    expect(transformToOrientation({ x1: -1, y1: 0, x2: 0, y2: -1 })).toEqual({ angle: 180 });
    expect(transformToOrientation({ x1: 0, y1: -1, x2: 1, y2: 0 })).toEqual({ angle: 270 });
  });

  it('reads a mirror as a mirror and not as a half turn', () => {
    // The two are different things: `(mirror x)` flips the body about its
    // horizontal axis, a 180 turn rotates it. `1 0 0 -1` is the first and
    // `-1 0 0 -1` the second, and only the candidate ORDER tells them apart.
    expect(transformToOrientation({ x1: 1, y1: 0, x2: 0, y2: -1 })).toEqual({
      angle: 0,
      mirror: 'x',
    });
    expect(transformToOrientation({ x1: -1, y1: 0, x2: 0, y2: 1 })).toEqual({
      angle: 0,
      mirror: 'y',
    });
  });

  /**
   * `1 0 0 -1` is what the FILE writes for an unrotated symbol, and it is NOT
   * the identity: the loader negates both y terms on the way in. Feeding the
   * file's own numbers here would say "mirrored", which is the bug the oracle
   * caught — every symbol in the project came up flipped.
   */
  it('is fed the loader’s matrix and not the file’s', () => {
    expect(transformToOrientation({ x1: 1, y1: 0, x2: 0, y2: -1 })).not.toEqual({ angle: 0 });
  });
});

describe('the library definitions a converted sheet carries', () => {
  /**
   * A legacy schematic embeds none; `UpdateSymbolLinks` fills them from the
   * resolved library and it is that which reaches the `.kicad_sch`. Without
   * them a converted sheet has symbols with no bodies and no pins, so the
   * netlist would be empty — which is exactly what `kicad-cli` produces from
   * one of these files.
   */
  it('embeds the ones the sheet places', () => {
    const root = converted().get('complex_hierarchy.kicad_sch')!;
    const placed = new Set(root.symbols.map((s) => s.libId));
    for (const id of placed) {
      expect(
        root.libSymbols.some((l) => l.libId === id),
        `missing ${id}`,
      ).toBe(true);
    }
  });

  it('gives them the pins the library gives them', () => {
    const root = converted().get('complex_hierarchy.kicad_sch')!;
    const r = root.libSymbols.find((l) => l.libId === 'complex_hierarchy_schlib:R')!;
    expect(
      r.units
        .flatMap((u) => u.pins)
        .map((p) => p.number)
        .sort(),
    ).toEqual(['1', '2']);
  });
});

/**
 * A legacy project has no symbol library table: the `.pro` lists library FILES,
 * and a symbol's id is `<library file stem>:<symbol name>` — which is what
 * `SYMBOL_LIB_TABLE`'s migration produces when it converts one.
 */
describe('resolving a legacy project’s libraries', () => {
  const libs = () =>
    legacyLibrarySymbols(
      new Map([['complex_hierarchy_schlib.lib', data('complex_hierarchy_schlib.lib')]]),
      readLegacySymbolLibrary,
    );

  it('keys each symbol by the id the schematic names it with', () => {
    expect(libs().has('complex_hierarchy_schlib:R')).toBe(true);
    expect(libs().has('complex_hierarchy_schlib:LM358N')).toBe(true);
  });

  it('keeps the bare name too, which is how a cache library files them', () => {
    expect(libs().has('R')).toBe(true);
  });

  it('carries on past a library that will not parse', () => {
    // `LoadAllLibraries` catches the IO_ERROR, logs "Symbol library '%s' failed
    // to load." and loads the rest.
    const mixed = legacyLibrarySymbols(
      new Map([
        ['broken.lib', 'this is not a symbol library'],
        ['complex_hierarchy_schlib.lib', data('complex_hierarchy_schlib.lib')],
      ]),
      readLegacySymbolLibrary,
    );
    expect(mixed.has('complex_hierarchy_schlib:R')).toBe(true);
  });

  it('resolves every symbol the project actually places', () => {
    const placed = new Set([...converted().values()].flatMap((d) => d.symbols.map((s) => s.libId)));
    for (const id of placed) expect(libs().has(id), `unresolved ${id}`).toBe(true);
  });
});

describe('which file is the root', () => {
  const sch = () =>
    new Map([
      ['complex_hierarchy.sch', data('complex_hierarchy.sch')],
      ['ampli_ht.sch', data('ampli_ht.sch')],
    ]);

  it('is the sheet no other sheet points at', () => {
    expect(legacyRootFile(sch())).toBe('complex_hierarchy.sch');
  });

  /**
   * The project name WINS over the search, and the two can disagree: a file
   * every other sheet points at is still the root if the project says so, and
   * a folder holding two unrelated projects has two unreferenced files.
   */
  it('is the one named after the project, ahead of the search', () => {
    const two = new Map([
      ['other.sch', 'EESchema Schematic File Version 4\n'],
      ['wanted.sch', 'EESchema Schematic File Version 4\n'],
    ]);
    // The search takes the first unreferenced file, which is `other.sch`.
    expect(legacyRootFile(two)).toBe('other.sch');
    expect(legacyRootFile(two, 'wanted')).toBe('wanted.sch');
  });

  it('falls back to the search when the project names no file it has', () => {
    expect(legacyRootFile(sch(), 'nothing')).toBe('complex_hierarchy.sch');
  });

  it('has nothing to say about an empty selection', () => {
    expect(legacyRootFile(new Map())).toBeNull();
  });
});

/**
 * The point of all of it: a converted project has to be electrically real, not
 * just geometrically right.
 *
 * `kicad-cli sch export netlist` on the very same `.sch` produces
 * `(components)` and `(nets)` EMPTY — it reads the header and stops. So this is
 * also the one place where reading the legacy format here does something the
 * shipped tooling cannot.
 */
describe('a converted sheet carries a netlist', () => {
  const rootNetlist = () => {
    const root = converted().get('complex_hierarchy.kicad_sch')!;
    return computeNetlist(root, new Map(root.libSymbols.map((l) => [l.libId, l])));
  };

  /** A node id of the form `<symbolRef>:pin<i>` is a symbol pin on the net. */
  const pinCount = (nl: { nets: { items: string[] }[] }): number =>
    nl.nets.flatMap((n) => n.items).filter((id) => id.includes(':pin')).length;

  it('finds nets, with pins on them', () => {
    const nl = rootNetlist();
    expect(nl.nets.length).toBeGreaterThan(0);
    expect(pinCount(nl)).toBeGreaterThan(0);
  });

  it('names the nets the labels name', () => {
    // The root sheet carries one label; whatever it is, a net wears its name.
    const root = converted().get('complex_hierarchy.kicad_sch')!;
    const labelled = root.labels[0]!.text;
    expect(rootNetlist().nets.some((n) => n.name.includes(labelled))).toBe(true);
  });

  /**
   * A symbol with no library definition has no pins, so it joins nothing. If
   * the `lib_symbols` embedding regressed this is where it would show: the
   * geometry tests would all still pass and the netlist would quietly empty.
   */
  it('would be empty without the embedded definitions, and is not', () => {
    const root = converted().get('complex_hierarchy.kicad_sch')!;
    expect(pinCount(computeNetlist(root, new Map()))).toBe(0);
    expect(pinCount(rootNetlist())).toBeGreaterThan(0);
  });
});

/**
 * Cases a real project does not contain, and a mutation sweep found unpinned.
 * Each is a repair or a guard upstream states explicitly, so each is written as
 * the smallest legacy file that reaches it.
 */
describe('the repairs and guards a healthy project never exercises', () => {
  const sch = (body: string): string =>
    `EESchema Schematic File Version 4\nEELAYER 30 0\nEELAYER END\n$Descr A4 11693 8268\nSheet 1 1\n$EndDescr\n${body}$EndSCHEMATC\n`;

  const one = (body: string, files: Record<string, string> = {}) => {
    let n = 0;
    return readLegacyProject({
      files: new Map([['root.sch', sch(body)], ...Object.entries(files)]),
      rootFile: 'root.sch',
      projectName: 'p',
      newUuid: () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
    });
  };

  const comp = (u: string, id: string) =>
    `$Comp\nL Lib:R R1\nU ${u} ${id}\nP 1000 1000\nF 0 "R1" H 1000 1000 50  0000 C CNN\n\t1    1000 1000\n\t1    0    0    -1  \n$EndComp\n`;

  /**
   * "This fixes a potentially buggy files caused by unit being set to zero
   * which causes netlist issues." (`sch_io_kicad_legacy.cpp:1182`) — and the
   * same for the body style two lines below it.
   */
  it('turns a zero unit and body style into one', () => {
    const d = one(comp('0 0', '5A2B3C4D')).docs.get('root.kicad_sch')!;
    expect(d.symbols[0]!.unit).toBe(1);
    expect(d.symbols[0]!.bodyStyle).toBe(1);
  });

  /**
   * The De Morgan alternate. This is written as `body_style`, not the
   * pre-KiCad-8 `convert`, because that is the spelling the reader looks for —
   * writing the old one dropped every alternate body to its base and nothing
   * said so, since `bodyStyle` then defaulted to 1 and looked repaired.
   */
  it('carries a second body style through', () => {
    const d = one(comp('1 2', '5A2B3C4D')).docs.get('root.kicad_sch')!;
    expect(d.symbols[0]!.bodyStyle).toBe(2);
  });

  /** `if( text != "00000000" )` — the format's "no id here" placeholder. */
  it('mints an id rather than believing the 00000000 placeholder', () => {
    const d = one(comp('1 1', '00000000')).docs.get('root.kicad_sch')!;
    expect(d.symbols[0]!.uuid).not.toBe(legacyUuid('00000000'));
    // ...and a real timestamp IS believed.
    const real = one(comp('1 1', '5A2B3C4D')).docs.get('root.kicad_sch')!;
    expect(real.symbols[0]!.uuid).toBe(legacyUuid('5A2B3C4D'));
  });

  const sheet = (file: string, id: string) =>
    `$Sheet\nS 500 500 1000 1000\nU ${id}\nF0 "sub" 50\nF1 "${file}" 50\n$EndSheet\n`;

  /**
   * `loadHierarchy` reuses a screen it has already loaded. Without that, a
   * sheet that reaches itself — which a hand-edited file can do — recurses
   * until the stack goes, and this test would hang rather than fail.
   */
  it('does not follow a sheet that reaches itself', () => {
    const r = one(sheet('root.sch', '4B3A1333'));
    expect([...r.docs.keys()]).toEqual(['root.kicad_sch']);
  });

  it('says so when a sheet names a file that is not there', () => {
    const r = one(sheet('missing.sch', '4B3A1333'));
    expect(r.problems).toEqual(['sheet file not found: missing.sch']);
  });

  /**
   * `Entry Wire Line` writes the two ENDPOINTS, and the loader turns the second
   * into a size: `size.x -= pos.x`. Read as a size instead, a bus entry that
   * starts anywhere but the origin comes out enormous.
   */
  it('reads a bus entry’s second pair as its far end, not its size', () => {
    const d = one('Entry Wire Line\n\t1000 1000 1100 1100\n').docs.get('root.kicad_sch')!;
    expect(d.busEntries[0]!.at).toEqual({ x: 1000 * 254, y: 1000 * 254 });
    expect(d.busEntries[0]!.size).toEqual({ x: 100 * 254, y: 100 * 254 });
  });
});
