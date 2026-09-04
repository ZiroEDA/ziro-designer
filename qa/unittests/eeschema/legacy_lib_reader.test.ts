// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The legacy `.lib` reader, against KiCad itself.
 *
 * The oracle here is not a hand-written expectation: it is the installed
 * 10.0.5 running the very code this ports.
 *
 *     kicad-cli sym upgrade <lib>.lib -o <lib>.kicad_sym --force
 *
 * loads the file with `SCH_IO_KICAD_LEGACY_LIB_CACHE` and saves it with
 * `SCH_IO_KICAD_SEXPR_LIB_CACHE`, so the `.kicad_sym` beside each `.lib` in
 * `qa/data/eeschema/legacy` is what upstream's reader made of that exact file.
 * Reading both and comparing the models asks the only question worth asking:
 * does ours land on the same symbol KiCad's does?
 *
 * Two things are set aside, and nothing else is.
 *
 * `source` is the node an item was read from, and the two inputs are different
 * files by construction; comparing it would be comparing the fixtures.
 *
 * The ORDER of the graphics inside a unit is KiCad's WRITER's, not its
 * reader's: `SCH_IO_KICAD_SEXPR_LIB_CACHE::saveSymbol` pours each unit's items
 * into a `std::multiset` keyed on `SCH_ITEM::operator<`, which sorts shapes by
 * their start point (`EDA_SHAPE::Compare` begins `TEST_PT( m_start, … )`).
 * Neither reader sorts anything — ours keeps file order and so does upstream's
 * — so an ordering difference here would be our reader measured against their
 * writer, which is not the question. Every graphic's CONTENT is still compared,
 * and so is the count.
 *
 * Everything else — every number, name, flag, and the order of properties,
 * units and pins — is compared exactly.
 *
 * The fixtures:
 *   - `legacy_all.lib` exercises every DRAW entry (A with explicit ends, A
 *     without them, C, T quoted and unquoted, S, P, B, X in all four
 *     orientations with shapes and a hidden pin), ALIAS, $FPLIST, a user field,
 *     two units, and a `~`-prefixed power symbol with pin names and numbers
 *     hidden.
 *   - `complex_hierarchy-cache.lib` is KiCad's own test corpus — a real
 *     `<project>-cache.lib`, which is the file Rescue actually reads.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSymbolLib } from '@ziroeda/eeschema';
import {
  legacyCacheFileNames,
  readLegacySymbolLibrary,
} from '@ziroeda/eeschema/src/sch_io/legacy/read-lib.js';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';

const data = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../data/eeschema/legacy/${name}`, import.meta.url)),
    'utf8',
  );

/**
 * The model without the `source` nodes and without `parent`, which is a cyclic
 * object link rather than data. Everything else survives.
 */
function comparable(sym: LibSymbol): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === 'source' || k === 'parent') continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  const bare = strip(sym) as { units?: { graphics?: unknown[] }[] };
  // See the note at the head of this file: the graphics of a unit are ordered
  // by the writer, so they are compared as a bag of items and not as a list.
  for (const unit of bare.units ?? []) {
    if (unit.graphics) {
      unit.graphics = [...unit.graphics].sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b) ? -1 : 1,
      );
    }
  }
  return bare;
}

const pair = (base: string): { ours: LibSymbol[]; kicad: LibSymbol[] } => ({
  ours: readLegacySymbolLibrary(data(`${base}.lib`)),
  kicad: readSymbolLib(parse(data(`${base}.kicad_sym`))),
});

describe('a library KiCad itself upgraded', () => {
  for (const base of ['legacy_all', 'complex_hierarchy-cache']) {
    describe(base, () => {
      it('holds the same symbols, in the same order', () => {
        const { ours, kicad } = pair(base);
        expect(ours.map((s) => s.libId)).toEqual(kicad.map((s) => s.libId));
      });

      it('reads every symbol to the same model', () => {
        const { ours, kicad } = pair(base);
        for (let i = 0; i < kicad.length; i++) {
          expect(comparable(ours[i]!), `symbol ${kicad[i]!.libId}`).toEqual(comparable(kicad[i]!));
        }
      });
    });
  }
});

/**
 * The pieces worth naming on their own, so a failure says which rule broke
 * rather than "the whole symbol differs". Each expectation is read off the
 * upgraded file, not invented.
 */
describe('the parts of the format, individually', () => {
  const ours = (): LibSymbol[] => readLegacySymbolLibrary(data('legacy_all.lib'));
  const find = (name: string): LibSymbol => ours().find((s) => s.libId === name)!;

  it('takes the pin name offset off the DEF line', () => {
    // `DEF TESTPART U 0 40 …` — 40 mils, and `SetPinNameOffset( MilsToIU( 40 ) )`.
    expect(find('TESTPART').pinNameOffset).toBe(40 * 254);
  });

  it('reads the power flag, and hidden pin names and numbers', () => {
    // `DEF ~PWRTEST #PWR 0 0 N N 1 F P`.
    const p = find('PWRTEST');
    expect(p.isPower).toBe(true);
    expect(p.pinNamesHidden).toBe(true);
    expect(p.pinNumbersHidden).toBe(true);
  });

  /**
   * `DEF ~PWRTEST …`:
   *
   *     symbol->SetName( name.Right( name.Length() - 1 ) );
   *     symbol->GetValueField().SetVisible( false );
   *
   * The hiding is a DEFAULT, not a decision: `loadField` runs afterwards for
   * every `F` line and sets visibility from the file, so an `F1 … V …` puts the
   * value back on. The fixture has one, and KiCad's own upgrade agrees the
   * value is shown — which is the half of this that is easy to port backwards.
   */
  it('strips the ~ from a DEF name, and lets the F1 line decide visibility', () => {
    const p = find('PWRTEST');
    expect(p.libId).toBe('PWRTEST');
    expect(p.properties.find((f) => f.key === 'Value')?.effects?.hidden).toBe(false);
  });

  it('groups the body items by unit and body style', () => {
    // Unit 1 and unit 2 both draw; the sub-symbol names carry the split.
    expect(find('TESTPART').units.map((u) => u.name)).toEqual(['TESTPART_1_1', 'TESTPART_2_1']);
  });

  it('maps each pin orientation to the angle the sexpr format uses', () => {
    // getPinAngle: R 0, L 180, U 90, D 270.
    const pins = find('TESTPART').units.flatMap((u) => u.pins);
    const angleOf = (number: string): number => pins.find((p) => p.number === number)!.angle;
    expect(angleOf('1')).toBe(0); // R
    expect(angleOf('2')).toBe(180); // L
    expect(angleOf('3')).toBe(270); // D
    expect(angleOf('4')).toBe(90); // U
  });

  it('reads the pin shape flags and the invisible flag', () => {
    const pins = find('TESTPART').units.flatMap((u) => u.pins);
    const pin = (n: string) => pins.find((p) => p.number === n)!;
    expect(pin('1').shape).toBe('line');
    expect(pin('2').shape).toBe('inverted');
    expect(pin('3').shape).toBe('inverted_clock'); // 'CI' = CLOCK | INVERTED
    expect(pin('4').hidden).toBe(true); // 'N'
    expect(pin('3').electricalType).toBe('power_in');
    expect(pin('4').electricalType).toBe('no_connect');
  });

  it('turns an ALIAS into a derived symbol of the one that declared it', () => {
    const all = ours();
    const alt = all.find((s) => s.libId === 'TESTPART_ALT')!;
    expect(alt.extends).toBe('TESTPART');
    // Flattening gives it the parent's body, and its own Value.
    expect(alt.units.flatMap((u) => u.pins)).toHaveLength(4);
    expect(alt.properties.find((f) => f.key === 'Value')?.value).toBe('TESTPART_ALT');
  });

  it('files $FPLIST where the modern format keeps it', () => {
    expect(find('TESTPART').properties.find((f) => f.key === 'ki_fp_filters')?.value).toBe(
      'DIP* SOIC*',
    );
  });

  it('turns the old two-apostrophe spelling back into a double quote', () => {
    // "convert two apostrophes back to double quote" — `he''llo` is `he"llo`,
    // which is how the format wrote a quote it could not otherwise carry.
    const texts = find('TESTPART')
      .units.flatMap((u) => u.graphics)
      .filter((g) => g.kind === 'text')
      .map((g) => (g as { text: string }).text);
    expect(texts).toContain('he"llo');
  });

  it('keeps a user field’s own name', () => {
    expect(find('TESTPART').properties.find((f) => f.key === 'MyField')?.value).toBe('user-value');
  });

  /**
   * The arc is the one entry the format overdefines — centre, radius, both
   * angles AND both endpoints — and `MapAnglesV6` exists to decide when the
   * endpoints have to be swapped. Three are in the fixture: one with explicit
   * ends, one without, one whose sweep crosses zero degrees, and one whose
   * start angle is still the GREATER of the two after `MapAnglesV6` has had its
   * say — 170 degrees to -170, a twenty-degree sweep across the 180 line. That
   * last one is what `CalcArcAngles`' `while( aEndAngle < aStartAngle )
   * aEndAngle += 360` exists for; without it the mid lands on the far side of
   * the circle and the arc is drawn the long way round. The other three do not
   * reach it, because MapAnglesV6 swaps the ends of any sweep over 180 and the
   * wrap is then a no-op.
   */
  it('reads every arc form to the same three points KiCad stores', () => {
    const kicad = readSymbolLib(parse(data('legacy_all.kicad_sym')));
    // Sorted for the reason at the head of this file: the order within a unit
    // is the writer's, and these are being compared for content.
    const arcsOf = (list: LibSymbol[]) =>
      list
        .find((s) => s.libId === 'TESTPART')!
        .units.flatMap((u) => u.graphics)
        .filter((g) => g.kind === 'arc')
        .map((g) => JSON.parse(JSON.stringify({ ...g, source: undefined })) as unknown)
        .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    expect(arcsOf(ours())).toEqual(arcsOf(kicad));
    expect(arcsOf(ours())).toHaveLength(4);
  });
});

describe('a file that is not a legacy library', () => {
  it('is refused rather than read as an empty one', () => {
    expect(() => readLegacySymbolLibrary('(kicad_symbol_lib (version 20241209))')).toThrow();
    expect(() => readLegacySymbolLibrary('')).toThrow();
  });

  it('accepts the old date-stamped version header as 2.3', () => {
    // "Some old libraries use a version syntax like
    //  EESchema-LIBRARY Version 2/10/2006-18:49:15".
    expect(readLegacySymbolLibrary('EESchema-LIBRARY Version 2/10/2006-18:49:15\n')).toEqual([]);
  });
});

/**
 * `LEGACY_SYMBOL_LIBS::CacheName` — which file the project's cache is, and it
 * is named after the `.kicad_pro`, not after the root sheet.
 */
describe('the cache library’s name', () => {
  it('is the project name with -cache, and the 2007 form as a fallback', () => {
    expect(legacyCacheFileNames('board.kicad_pro')).toEqual(['board-cache.lib', 'board.cache.lib']);
  });

  it('takes the name out of a full path', () => {
    expect(legacyCacheFileNames('/home/me/proj/power.kicad_pro')[0]).toBe('power-cache.lib');
  });
});
