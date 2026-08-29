// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Automatic footprint association: the `.equ` file format and the match.
 *
 * Counterparts: `cvpcb/auto_associate.cpp` (`GetQuotedText` :53-68,
 * `sortListbyCmpValue` :73-76, `buildEquivalenceList` :79-167,
 * `AutomaticFootprintMatching` :170-304) and `common/string_utils.cpp:803-816`
 * (`GetLine`, which is where the comment and blank-line rules live), against
 * the manual's statement of the syntax at eeschema.txt:4433-4460.
 *
 * The fixtures are chosen so each one can REACH the branch it is about, which
 * is the shape of test that keeps failing to fail here. In particular:
 *
 *  - a symbol tested against the ambiguity branch must have NO footprint
 *    assigned already, or `:202` skips it before the branch is reached;
 *  - a symbol tested against the footprint-filter branch must have a value that
 *    appears TWICE, or `equ_is_unique` short-circuits at `:231` and the filters
 *    are never consulted;
 *  - a footprint named in an equivalence must be in `known`, or the run takes
 *    the "not found in any of the project footprint libraries" branch instead
 *    of the one under test.
 */
import { describe, it, expect } from 'vitest';
import type { CvpcbComponent } from '@ziroeda/designer/src/editors/schematic/cvpcb_components.js';
import {
  emptyAssociations,
  footprintOf,
} from '@ziroeda/designer/src/editors/schematic/cvpcb_commands.js';
import {
  automaticFootprintMatching,
  buildEquivalenceList,
  equFileNotFoundMessage,
  equivalencesFoundMessage,
  fgetsLines,
  footprintNotFoundMessage,
  getQuotedText,
  matchesWildcard,
  parseEquivalenceFile,
  sortEquivalences,
  type FootprintEquivalence,
} from '@ziroeda/designer/src/editors/schematic/cvpcb_auto_associate.js';

const comp = (
  reference: string,
  value: string,
  opts: { footprint?: string; fpFilters?: string[] } = {},
): CvpcbComponent => ({
  reference,
  value,
  footprint: opts.footprint ?? '',
  fpFilters: opts.fpFilters ?? [],
  pinCount: 0,
  instances: [{ file: 'sheet.kicad_sch', id: reference }],
});

const pairs = (list: readonly FootprintEquivalence[]): string[] =>
  list.map((e) => `${e.value}=${e.footprint}`);

describe('GetQuotedText (auto_associate.cpp:53-68)', () => {
  it('takes what is between the first two quotes and leaves the rest', () => {
    expect(getQuotedText("  'LM358'  'Package_SO:SOIC-8'")).toEqual({
      quoted: 'LM358',
      rest: "  'Package_SO:SOIC-8'",
    });
  });

  it('a missing opening or closing quote reads empty and consumes nothing', () => {
    expect(getQuotedText('LM358 Package_SO:SOIC-8')).toEqual({
      quoted: '',
      rest: 'LM358 Package_SO:SOIC-8',
    });
    // `wxNOT_FOUND == i` on the SECOND Find (`:63-64`) also returns "" and
    // leaves `text` alone, because the assignment at `:66` is below it.
    expect(getQuotedText("'unterminated")).toEqual({ quoted: '', rest: "'unterminated" });
  });

  it("'' is an empty read, which is how a line gets skipped", () => {
    expect(getQuotedText("'' 'Package_SO:SOIC-8'").quoted).toBe('');
  });
});

describe('the .equ line reader (GetLine + the parse at :139-161)', () => {
  it('reads the manual’s own example file', () => {
    // eeschema.txt:4483-4501, verbatim, comments and blank line included.
    const list = parseEquivalenceFile(
      [
        '#integrated circuits (smd):',
        "'74LV14' 'Package_SO:SOIC-14_3.9x8.7mm_P1.27mm'",
        "'EL7242C' 'Package_SO:SOIC-8_3.9x4.9_P1.27mm'",
        '',
        '#regulators',
        "'LP2985LV' 'Package_TO_SOT_SMD:SOT-23-5_HandSoldering'",
        '',
      ].join('\n'),
    );
    expect(pairs(list)).toEqual([
      '74LV14=Package_SO:SOIC-14_3.9x8.7mm_P1.27mm',
      'EL7242C=Package_SO:SOIC-8_3.9x4.9_P1.27mm',
      'LP2985LV=Package_TO_SOT_SMD:SOT-23-5_HandSoldering',
    ]);
  });

  it('the comment rule is Line[0], so an INDENTED # is not a comment', () => {
    // `while( Line[0] == '#' … )` — a leading space means the test fails and
    // the line is parsed like any other. Two quoted words follow, so it is an
    // equivalence. This is the edge a trimming parser gets wrong.
    const list = parseEquivalenceFile(["# 'A' 'Lib:FP_A'", " # 'B' 'Lib:FP_B'"].join('\n'));
    expect(pairs(list)).toEqual(['B=Lib:FP_B']);
  });

  it('a # after the first column is ordinary text, not a trailing comment', () => {
    // Nothing strips a trailing comment: the second GetQuotedText simply reads
    // the next quoted run, wherever it is.
    expect(pairs(parseEquivalenceFile("'A' 'Lib:FP' # 'B' 'Lib:FP_B'"))).toEqual(['A=Lib:FP']);
  });

  it('drops blank, CR-only and half-quoted lines without failing the file', () => {
    const list = parseEquivalenceFile(
      [
        '',
        '\r',
        "'orphan'", // one quoted word: footprint empty at `:152`
        "'' 'Lib:FP'", // empty value at `:147`
        "'A' ''", // empty footprint at `:152`
        "'good' 'Lib:FP_GOOD'",
      ].join('\n'),
    );
    expect(pairs(list)).toEqual(['good=Lib:FP_GOOD']);
  });

  it('ignores everything outside the two quoted runs', () => {
    expect(pairs(parseEquivalenceFile("junk 'A' junk 'Lib:FP' junk 'C'"))).toEqual(['A=Lib:FP']);
  });

  it('CRLF is trimmed by strtok, not carried into the footprint', () => {
    expect(pairs(parseEquivalenceFile("'A' 'Lib:FP'\r\n'B' 'Lib:FP2'\r\n"))).toEqual([
      'A=Lib:FP',
      'B=Lib:FP2',
    ]);
  });

  it('replaces every space in the FILE value with an underscore (:155)', () => {
    expect(pairs(parseEquivalenceFile("'LT1129 CS8 3.3' 'Lib:FP'"))).toEqual([
      'LT1129_CS8_3.3=Lib:FP',
    ]);
  });

  it('a line over the 1023-byte fgets buffer is split, and the tail is re-read', () => {
    // `char line[1024]` + `fgets( …, sizeof( line ), … )`: the first buffer is
    // 1023 bytes and holds no closing quote for the second word, so it parses
    // as nothing; the remainder arrives as a line of its own and parses.
    const pad = 'x'.repeat(1010);
    const text = `'${pad}' 'Lib:FP_LONG'\n`;
    const buffers = fgetsLines(text);
    expect(buffers.length).toBe(2);
    expect(buffers[0]?.length).toBe(1023);
    // The head has one complete quoted run and then an unterminated one, so
    // both halves fail and nothing at all comes out of this line.
    expect(parseEquivalenceFile(text)).toEqual([]);
  });

  it('fgetsLines keeps the newline and emits no empty trailing buffer', () => {
    expect(fgetsLines('a\nb\n')).toEqual(['a\n', 'b\n']);
    expect(fgetsLines('a\nb')).toEqual(['a\n', 'b']);
    expect(fgetsLines('')).toEqual([]);
  });
});

describe('buildEquivalenceList (auto_associate.cpp:79-167)', () => {
  const files: Record<string, string> = {
    'a.equ': "'R' 'Lib:R_A'\n",
    'sub/b.equ': "'C' 'Lib:C_B'\n",
  };
  const read = (name: string): string | null => files[name] ?? null;

  it('concatenates in list order, so a second file appends', () => {
    const { list, errors } = buildEquivalenceList(['a.equ', 'sub/b.equ'], read);
    expect(pairs(list)).toEqual(['R=Lib:R_A', 'C=Lib:C_B']);
    expect(errors).toEqual([]);
    expect(pairs(buildEquivalenceList(['sub/b.equ', 'a.equ'], read).list)).toEqual([
      'C=Lib:C_B',
      'R=Lib:R_A',
    ]);
  });

  it('a missing file is one error naming the BASE name, and does not stop the rest', () => {
    const { list, errors } = buildEquivalenceList(['sub/gone.equ', 'a.equ'], read);
    // `error_msg.Printf( …, fn.GetFullName() )` — GetFullName is the leaf.
    expect(errors).toEqual(["Equivalence file 'gone.equ' could not be found."]);
    expect(errors[0]).toBe(equFileNotFoundMessage('gone.equ'));
    expect(pairs(list)).toEqual(['R=Lib:R_A']);
  });
});

describe('sortEquivalences (:73-76, :184)', () => {
  it('is DESCENDING by value', () => {
    const list = sortEquivalences([
      { value: 'A', footprint: 'Lib:1' },
      { value: 'C', footprint: 'Lib:2' },
      { value: 'B', footprint: 'Lib:3' },
    ]);
    expect(list.map((e) => e.value)).toEqual(['C', 'B', 'A']);
  });

  it('keeps equal values in list order, which is file order', () => {
    const list = sortEquivalences([
      { value: 'R', footprint: 'Lib:first' },
      { value: 'Z', footprint: 'Lib:z' },
      { value: 'R', footprint: 'Lib:second' },
    ]);
    expect(pairs(list)).toEqual(['Z=Lib:z', 'R=Lib:first', 'R=Lib:second']);
  });
});

describe('wxString::Matches (:253)', () => {
  it('is anchored at both ends and case SENSITIVE', () => {
    expect(matchesWildcard('SOIC-8_3.9x4.9mm', 'SOIC*')).toBe(true);
    expect(matchesWildcard('SOIC-8_3.9x4.9mm', 'soic*')).toBe(false);
    expect(matchesWildcard('SOIC-8', 'OIC')).toBe(false);
    expect(matchesWildcard('R_0805', 'R_?805')).toBe(true);
    // The `.` is a literal, not "any character".
    expect(matchesWildcard('RX0805', 'R.0805')).toBe(false);
  });
});

describe('AutomaticFootprintMatching (auto_associate.cpp:170-304)', () => {
  const known = new Set(['Lib:R_0805', 'Lib:R_0603', 'Lib:C_0805', 'Lib:SOIC-8', 'Lib:DIP-8']);
  const equ = (value: string, footprint: string): FootprintEquivalence => ({ value, footprint });

  it('matches on VALUE, case-insensitively, and reports nothing when it assigns', () => {
    const components = [comp('R1', 'lm358')];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('LM358', 'Lib:SOIC-8')]),
      known,
    );
    expect(footprintOf(res.state, components[0])).toBe('Lib:SOIC-8');
    // Every AssociateFootprint ends in DisplayStatus(), which rewrites field 0.
    expect(res.status).toBeNull();
    expect(res.warning).toBe('');
  });

  it('leaves a symbol that already has a footprint alone (:202-203)', () => {
    const components = [comp('R1', '10k', { footprint: 'Lib:R_0603' })];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_0805')]),
      known,
    );
    expect(footprintOf(res.state, components[0])).toBe('Lib:R_0603');
    // Nothing was associated, so the equivalence count is what field 0 shows.
    expect(res.status).toBe('1 footprint/symbol equivalences found.');
  });

  it('the whole run is ONE undo entry (firstAssoc, :194/:233)', () => {
    const components = [comp('R1', '10k'), comp('R2', '10k'), comp('C1', '100n')];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_0805'), equ('100n', 'Lib:C_0805')]),
      known,
    );
    expect(res.state.undoStack.length).toBe(1);
    expect(res.state.undoStack[0]?.length).toBe(3);
  });

  it('does not move the selection', () => {
    const components = [comp('R1', '10k'), comp('R2', '10k')];
    const res = automaticFootprintMatching(
      emptyAssociations([1]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_0805')]),
      known,
    );
    expect(res.state.selection).toEqual([1]);
  });

  it('with no .equ file at all it reports the count and assigns nothing', () => {
    const components = [comp('R1', '10k')];
    const res = automaticFootprintMatching(emptyAssociations([0]), components, [], known);
    expect(res.status).toBe('0 footprint/symbol equivalences found.');
    expect(res.status).toBe(equivalencesFoundMessage(0));
    expect(footprintOf(res.state, components[0])).toBe('');
  });

  it('an empty netlist returns before the status is written at all (:176-177)', () => {
    const res = automaticFootprintMatching(
      emptyAssociations([]),
      [],
      sortEquivalences([equ('10k', 'Lib:R_0805')]),
      known,
    );
    expect(res.status).toBeNull();
    expect(res.warning).toBe('');
  });

  it('an equivalence naming a footprint no library has warns and assigns nothing', () => {
    const components = [comp('R1', '10k')];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_9999')]),
      known,
    );
    expect(footprintOf(res.state, components[0])).toBe('');
    expect(res.warning).toBe(
      'Component R1: footprint Lib:R_9999 not found in any of the project footprint libraries.',
    );
    expect(res.warning).toBe(footprintNotFoundMessage('R1', 'Lib:R_9999'));
  });

  it('joins several warnings with a blank line (:261-264)', () => {
    const components = [comp('R1', '10k'), comp('R2', '22k')];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_9999'), equ('22k', 'Lib:R_8888')]),
      known,
    );
    expect(res.warning).toBe(
      `${footprintNotFoundMessage('R1', 'Lib:R_9999')}\n\n${footprintNotFoundMessage(
        'R2',
        'Lib:R_8888',
      )}`,
    );
  });

  // ----- the duplicate-value branches -------------------------------------
  //
  // Every fixture here gives the symbol a value that appears TWICE, because
  // `equ_is_unique` (:220-228) is what decides whether the footprint filters
  // are consulted at all. With one entry the run takes `:231` and breaks, and
  // a filter test written against that fixture can never fail.

  it('with duplicates and NO footprint filters, the FIRST entry wins', () => {
    // The manual (eeschema.txt:4446-4449) says the LAST matching file
    // overrides; 10.0.5 does not. `found = ( filtercount == 0 )` at :250 is
    // true straight away, so the first duplicate reached is associated and the
    // loop breaks at :271. Order in the sorted list is file order (stable),
    // so `a.equ` beats `b.equ` and Move UP is what raises priority.
    const components = [comp('R1', '10k')];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_0805'), equ('10k', 'Lib:R_0603')]),
      known,
    );
    expect(footprintOf(res.state, components[0])).toBe('Lib:R_0805');
  });

  it('and reversing the file order reverses the winner', () => {
    const components = [comp('R1', '10k')];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_0603'), equ('10k', 'Lib:R_0805')]),
      known,
    );
    expect(footprintOf(res.state, components[0])).toBe('Lib:R_0603');
  });

  it('a footprint filter picks between duplicates (:247-254)', () => {
    const components = [comp('R1', '10k', { fpFilters: ['R_06*'] })];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_0805'), equ('10k', 'Lib:R_0603')]),
      known,
    );
    expect(footprintOf(res.state, components[0])).toBe('Lib:R_0603');
  });

  it('the filter is matched against the footprint NAME, not the whole FPID', () => {
    // `fp->GetFootprintName()` is the item name; a filter spelling the
    // nickname too therefore matches nothing here.
    const components = [comp('R1', '10k', { fpFilters: ['Lib:R_0603'] })];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_0805'), equ('10k', 'Lib:R_0603')]),
      known,
    );
    // No filter matched, so it falls through to fpid_candidate (:279-284).
    expect(footprintOf(res.state, components[0])).toBe('Lib:R_0805');
  });

  it('when no filter matches, fpid_candidate is the first EXISTING duplicate', () => {
    const components = [comp('R1', '10k', { fpFilters: ['NOTHING*'] })];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      // The first entry names a footprint no library has, so it cannot be the
      // candidate: :241 requires `fp`, and the missing one only warns.
      sortEquivalences([equ('10k', 'Lib:R_9999'), equ('10k', 'Lib:R_0603')]),
      known,
    );
    expect(footprintOf(res.state, components[0])).toBe('Lib:R_0603');
    expect(res.warning).toBe(footprintNotFoundMessage('R1', 'Lib:R_9999'));
  });

  it('a UNIQUE value ignores the footprint filters entirely (:231-237)', () => {
    // The unique branch is above the filter branch, so a filter that matches
    // nothing cannot veto an unambiguous equivalence.
    const components = [comp('R1', '10k', { fpFilters: ['NOTHING*'] })];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_0805')]),
      known,
    );
    expect(footprintOf(res.state, components[0])).toBe('Lib:R_0805');
  });

  it('the last chance: one footprint filter that IS an FPID (:287-296)', () => {
    const components = [comp('U1', 'unlisted', { fpFilters: ['Lib:DIP-8'] })];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences([equ('10k', 'Lib:R_0805')]),
      known,
    );
    expect(footprintOf(res.state, components[0])).toBe('Lib:DIP-8');
  });

  it('but only with exactly one filter, and only if it names a real footprint', () => {
    const two = [comp('U1', 'unlisted', { fpFilters: ['Lib:DIP-8', 'Lib:SOIC-8'] })];
    expect(
      footprintOf(automaticFootprintMatching(emptyAssociations([0]), two, [], known).state, two[0]),
    ).toBe('');
    const bad = [comp('U1', 'unlisted', { fpFilters: ['Lib:NOSUCH'] })];
    expect(
      footprintOf(automaticFootprintMatching(emptyAssociations([0]), bad, [], known).state, bad[0]),
    ).toBe('');
  });

  it('a schematic value with a space can never match, because only the FILE side is underscored', () => {
    // `value.Replace( " ", "_" )` at :155 runs on the equivalence, never on
    // `component->GetValue()`. Upstream's own asymmetry.
    const components = [comp('R1', '10 k')];
    const res = automaticFootprintMatching(
      emptyAssociations([0]),
      components,
      sortEquivalences(parseEquivalenceFile("'10 k' 'Lib:R_0805'")),
      known,
    );
    expect(footprintOf(res.state, components[0])).toBe('');
  });
});
