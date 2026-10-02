// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * annotate.cpp's SCH_EDIT_FRAME members on the live model: AnnotateSymbols, DeleteAnnotation,
 * CheckAnnotate. Expectations are read off the C++; the hierarchy cases use KiCad's own
 * complex_hierarchy files (one sheet used twice).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_WARNING,
  Reporter,
} from '@ziroeda/common/reporter.js';
import { ERCE_T } from '@ziroeda/eeschema/erc/erc_settings.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import {
  ANNOTATE_ALGO_T,
  ANNOTATE_ORDER_T,
  ANNOTATE_SCOPE_T,
  SCH_REFERENCE_LIST,
} from '@ziroeda/eeschema/sch_reference_list.js';
import { SYMBOL_FILTER } from '@ziroeda/eeschema/sch_sheet_path.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const hooks: SCH_EDIT_FRAME_HOOKS = {
  crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
  highlightNet: () => {},
  syncSelection: () => {},
  assignFootprints: () => {},
  saveProject: () => true,
  getNetlist: () => null,
};

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const { ANNOTATE_ALL, ANNOTATE_CURRENT_SHEET } = ANNOTATE_SCOPE_T;

function annotate(
  frame: SCH_EDIT_FRAME,
  opts: { scope?: ANNOTATE_SCOPE_T; reset?: boolean; recursive?: boolean; repair?: boolean } = {},
) {
  const reporter = new Reporter();
  const commit = new SCH_COMMIT(frame);
  frame.AnnotateSymbols(
    commit,
    opts.scope ?? ANNOTATE_ALL,
    ANNOTATE_ORDER_T.SORT_BY_X_POSITION,
    ANNOTATE_ALGO_T.INCREMENTAL_BY_REF,
    opts.recursive ?? true,
    0,
    opts.reset ?? false,
    false,
    opts.repair ?? false,
    reporter,
    SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
  );
  commit.Push('Annotate');
  return reporter.lines.map((l) => [l.location, l.severity, l.message]);
}

// ---- a hand-built sheet ------------------------------------------------------------

function sheet(aProjectJson: object = {}) {
  const project = new PROJECT();
  const file = new PROJECT_FILE('/t/t.kicad_pro');
  project.setProjectFile(file);
  file.LoadFromFile(aProjectJson as never);
  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();
  const path = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(path);
  const frame = new SCH_EDIT_FRAME(hooks);
  frame.SetSchematic(schematic);
  const place = (lib: LIB_SYMBOL, ref: string, x: number, unit = 1, value = 'v') => {
    const sym = new SCH_SYMBOL(lib, new LIB_ID('Lib', lib.GetName()), path, unit, 0, { x, y: 0 });
    path.LastScreen()!.Append(sym);
    sym.SetRef(path, ref);
    sym.SetValueFieldText(value);
    return sym;
  };
  return { frame, schematic, path, place };
}

const R = () => new LIB_SYMBOL('R');
const OPAMP = () => {
  const lib = new LIB_SYMBOL('LM358');
  lib.SetUnitCount(2, true);
  return lib;
};

describe('SCH_EDIT_FRAME::AnnotateSymbols', () => {
  it('numbers the unannotated by X, keeps the annotated, and reports each as KiCad words it', () => {
    const { frame, path, place } = sheet();
    const r = R();
    const a = place(r, 'R?', 300, 1, '10k');
    const b = place(r, 'R2', 100, 1, '1k');
    const c = place(r, 'R?', 200, 1, '4k7');
    const lines = annotate(frame);

    expect([a, b, c].map((s) => s.GetRef(path))).toEqual(['R3', 'R2', 'R1']);
    // annotate.cpp:477-500: an unchanged reference ("R2" before and after) gets no line.
    expect(lines).toEqual([
      ['body', RPT_SEVERITY_ACTION, 'Annotated 4k7 as R1.'],
      ['body', RPT_SEVERITY_ACTION, 'Annotated 10k as R3.'],
      ['tail', RPT_SEVERITY_ACTION, 'Annotation complete.'],
    ]);
  });

  it('gives the units of a package one number and says which unit', () => {
    const { frame, path, place } = sheet();
    const u = OPAMP();
    const a = place(u, 'U?', 0, 1, 'LM358');
    const b = place(u, 'U?', 100, 2, 'LM358');
    const lines = annotate(frame);

    expect([a.GetRef(path, true), b.GetRef(path, true)]).toEqual(['U1A', 'U1B']);
    expect(lines.slice(0, 2)).toEqual([
      ['body', RPT_SEVERITY_ACTION, 'Annotated LM358 (unit A) as U1A.'],
      ['body', RPT_SEVERITY_ACTION, 'Annotated LM358 (unit B) as U1B.'],
    ]);
  });

  it('with reset, renumbers everything and says what each was', () => {
    const { frame, path, place } = sheet();
    const r = R();
    const a = place(r, 'R5', 0, 1, '1k');
    const b = place(r, 'R9', 100, 1, '2k');
    const lines = annotate(frame, { reset: true });

    expect([a.GetRef(path), b.GetRef(path)]).toEqual(['R1', 'R2']);
    expect(lines.slice(0, 2)).toEqual([
      ['body', RPT_SEVERITY_ACTION, 'Updated 1k from R5 to R1.'],
      ['body', RPT_SEVERITY_ACTION, 'Updated 2k from R9 to R2.'],
    ]);
  });

  it("reads the project's designator tracker: with reuse off, a used number stays used", () => {
    const { frame, path, place } = sheet({
      schematic: { reuse_designators: false, used_designators: 'R1' },
    });
    const a = place(R(), 'R?', 0);
    annotate(frame);
    expect(a.GetRef(path)).toBe('R2');
  });

  it('ends with the final check, not "complete", when an error is left', () => {
    const { frame, place } = sheet();
    const r = R();
    place(r, 'R1', 0);
    place(r, 'R1', 100);
    const lines = annotate(frame);

    expect(lines).toEqual([['body', RPT_SEVERITY_ERROR, 'Duplicate items R1\n']]);
  });

  it('reports repaired duplicate time stamps at the tail', () => {
    const { frame, place } = sheet();
    const r = R();
    const a = place(r, 'R1', 0);
    const b = place(r, 'R2', 100);
    // Make b's uuid a's (a pasted file, say).
    (b as unknown as { m_Uuid: unknown }).m_Uuid = a.m_Uuid;
    const lines = annotate(frame, { repair: true });

    expect(lines[0]).toEqual([
      'tail',
      RPT_SEVERITY_WARNING,
      '1 duplicate time stamps were found and replaced.',
    ]);
    expect(a.m_Uuid === b.m_Uuid).toBe(false);
  });

  it('records each annotated symbol in the commit it is given', () => {
    const { frame, place } = sheet();
    place(R(), 'R?', 0);
    const commit = new SCH_COMMIT(frame);
    frame.AnnotateSymbols(
      commit,
      ANNOTATE_ALL,
      ANNOTATE_ORDER_T.SORT_BY_X_POSITION,
      ANNOTATE_ALGO_T.INCREMENTAL_BY_REF,
      true,
      0,
      false,
      false,
      false,
      new Reporter(),
      SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
    );
    expect(commit.Empty()).toBe(false);
  });
});

describe('SCH_EDIT_FRAME::DeleteAnnotation and CheckAnnotate', () => {
  it('clears every reference to its prefix and reports each', () => {
    const { frame, path, place } = sheet();
    const a = place(R(), 'R1', 0, 1, '1k');
    const b = place(OPAMP(), 'U4', 100, 2, 'LM358');
    const reporter = new Reporter();
    frame.DeleteAnnotation(ANNOTATE_ALL, true, reporter);

    expect([a.GetRef(path), b.GetRef(path)]).toEqual(['R?', 'U?']);
    expect(reporter.lines.map((l) => l.message)).toEqual([
      'Cleared annotation for 1k.',
      'Cleared annotation for LM358 (unit B).',
    ]);
  });

  it('counts errors and hands each to the handler', () => {
    const { frame, place } = sheet();
    const r = R();
    place(r, 'R?', 0);
    const seen: ERCE_T[] = [];
    expect(
      frame.CheckAnnotate((t) => seen.push(t), ANNOTATE_ALL, true, SYMBOL_FILTER.SYMBOL_FILTER_ALL),
    ).toBe(1);
    expect(seen).toEqual([ERCE_T.ERCE_UNANNOTATED]);
  });

  it('finds nothing to check on an empty sheet', () => {
    const { frame } = sheet();
    expect(frame.CheckAnnotate(() => {}, ANNOTATE_ALL, true, SYMBOL_FILTER.SYMBOL_FILTER_ALL)).toBe(
      0,
    );
  });
});

// ---- KiCad's complex_hierarchy: one sheet file used twice ----------------------------

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch'];

function hierarchy() {
  const frame = new SCH_EDIT_FRAME(hooks);
  frame.OpenProjectFiles([`/complex_hierarchy/${SHEETS[0]}`], 0, (p) => {
    const n = [...SHEETS, 'complex_hierarchy.kicad_pro'].find(
      (s) => p === `/complex_hierarchy/${s}`,
    );
    return n ? readFileSync(join(ORACLE, n), 'utf8') : null;
  });
  return frame;
}

/** Every reference in the hierarchy, by sheet path name. */
function refsBySheet(frame: SCH_EDIT_FRAME): Map<string, string[]> {
  const out = new Map<string, string[]>();

  for (const path of frame.Schematic().Hierarchy()) {
    const list = new SCH_REFERENCE_LIST();
    path.GetSymbols(list, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
    out.set(
      path.PathHumanReadable(),
      list
        .GetSymbolInstances()
        .map((i) => `${i.m_Reference}/${i.m_Unit}`)
        .sort(),
    );
  }

  return out;
}

const check = (frame: SCH_EDIT_FRAME, scope = ANNOTATE_ALL) =>
  frame.CheckAnnotate(() => {}, scope, true, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

describe('annotation over a reused sheet', () => {
  it("checks KiCad's annotated file clean, and annotating it changes nothing", () => {
    const frame = hierarchy();
    expect(check(frame)).toBe(0);
    const before = refsBySheet(frame);
    const lines = annotate(frame);
    expect(refsBySheet(frame)).toEqual(before);
    expect(lines).toEqual([['tail', RPT_SEVERITY_ACTION, 'Annotation complete.']]);
  });

  it('a reset numbers the two instances apart, with no duplicate anywhere', () => {
    const frame = hierarchy();
    annotate(frame, { reset: true });
    expect(check(frame)).toBe(0);

    const refs = refsBySheet(frame);
    const vertical = new Set(refs.get('/ampli_ht_vertical/')!.map((r) => r.split('/')[0]));
    const horizontal = refs.get('/ampli_ht_horizontal/')!.map((r) => r.split('/')[0]);
    expect(horizontal.filter((r) => vertical.has(r))).toEqual([]);
  });

  it('the current sheet alone: it is renumbered around the others, which are untouched', () => {
    const frame = hierarchy();
    const schematic = frame.Schematic();
    const vertical = schematic
      .Hierarchy()
      .find((p) => p.PathHumanReadable() === '/ampli_ht_vertical/')!;
    schematic.SetCurrentSheet(vertical);
    const before = refsBySheet(frame);

    frame.DeleteAnnotation(ANNOTATE_CURRENT_SHEET, false, new Reporter());
    expect(
      refsBySheet(frame)
        .get('/ampli_ht_vertical/')!
        .every((r) => r.includes('?')),
    ).toBe(true);

    annotate(frame, { scope: ANNOTATE_CURRENT_SHEET, recursive: false });
    const after = refsBySheet(frame);

    expect(after.get('/')).toEqual(before.get('/'));
    expect(after.get('/ampli_ht_horizontal/')).toEqual(before.get('/ampli_ht_horizontal/'));
    expect(after.get('/ampli_ht_vertical/')!.some((r) => r.includes('?'))).toBe(false);
    expect(check(frame)).toBe(0);
  });
});
