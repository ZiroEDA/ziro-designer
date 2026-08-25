// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * eeschema's five `parseMaybeAbsentBool` flags —
 * `SCH_IO_KICAD_SEXPR_PARSER::parseMaybeAbsentBool`
 * (eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:147).
 *
 * The reader and pcbnew's share one helper, so the shape tests live with the
 * helper; what is pinned here is the per-call-site default and the dialect,
 * which is the half that differs. eeschema's copy has no `T_true` arm (:158),
 * so `(hide true)` is `Expecting( "yes or no" )` there while pcbnew reads it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import {
  readEffects,
  readField,
  readSchematic,
} from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';

const dataFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../data/${rel}`, import.meta.url)), 'utf8');

const effects = (body: string) => readEffects(parse(`(x (effects ${body}))`))!;
const field = (body: string) => readField(parse(`(property "Name" "Value" (at 0 0 0) ${body})`));

describe('eeschema: the default at each call site', () => {
  it('hide: parseMaybeAbsentBool( true ) at :891', () => {
    expect(effects('(font (size 1.27 1.27)) hide').hidden).toBe(true);
    expect(effects('(font (size 1.27 1.27)) (hide)').hidden).toBe(true);
    expect(effects('(font (size 1.27 1.27)) (hide no)').hidden).toBe(false);
    expect(effects('(font (size 1.27 1.27))').hidden).toBe(false);
  });

  it('bold: parseMaybeAbsentBool( true ) at :823', () => {
    expect(effects('(font (size 1.27 1.27) bold)').bold).toBe(true);
    expect(effects('(font (size 1.27 1.27) (bold))').bold).toBe(true);
    // An absent or explicitly-false flag leaves the key off entirely, which is
    // what the writer's "only emit what the file had" diffing depends on.
    expect(effects('(font (size 1.27 1.27) (bold no))').bold).toBeUndefined();
    expect(effects('(font (size 1.27 1.27))').bold).toBeUndefined();
  });

  it('italic: parseMaybeAbsentBool( true ) at :828', () => {
    expect(effects('(font (size 1.27 1.27) italic)').italic).toBe(true);
    expect(effects('(font (size 1.27 1.27) (italic))').italic).toBe(true);
    expect(effects('(font (size 1.27 1.27) (italic no))').italic).toBeUndefined();
    expect(effects('(font (size 1.27 1.27))').italic).toBeUndefined();
  });

  it('show_name: parseMaybeAbsentBool( true ) at :1144 and :2419', () => {
    expect(field('show_name').nameShown).toBe(true);
    expect(field('(show_name)').nameShown).toBe(true);
    expect(field('(show_name yes)').nameShown).toBe(true);
    expect(field('(show_name no)').nameShown).toBeUndefined();
    expect(field('').nameShown).toBeUndefined();
  });

  it('do_not_autoplace: parseMaybeAbsentBool( true ) at :1151 and :2426', () => {
    expect(field('do_not_autoplace').doNotAutoplace).toBe(true);
    expect(field('(do_not_autoplace)').doNotAutoplace).toBe(true);
    expect(field('(do_not_autoplace no)').doNotAutoplace).toBe(false);
    // Absent has to stay absent: upstream only calls SetCanAutoplace on the
    // token, so a file without it keeps SCH_FIELD's own value.
    expect(field('').doNotAutoplace).toBeUndefined();
  });
});

describe("eeschema's dialect is narrower than pcbnew's", () => {
  it('refuses `(hide true)`, which pcbnew accepts', () => {
    expect(() => effects('(font (size 1.27 1.27)) (hide true)')).toThrow(/Expecting "yes or no"/);
  });

  it('refuses a word that is not a boolean', () => {
    expect(() => effects('(font (size 1.27 1.27)) (hide sometimes)')).toThrow(
      /Expecting "yes or no"/,
    );
  });
});

describe('a file KiCad wrote', () => {
  it('hides the properties a v20211014 schematic marked with a bare `hide`', () => {
    // qa/data/eeschema/NoConnectOnLineWithLabel.kicad_sch, KiCad's own corpus:
    // `(property "Footprint" "" (id 2) (at 5.08 0 0) (effects (font (size 1.27
    // 1.27)) hide))`.
    const sch = readSchematic(parse(dataFile('eeschema/NoConnectOnLineWithLabel.kicad_sch')));
    const props = sch.symbols.flatMap((s) => s.fields);
    expect(props.length).toBeGreaterThan(0);
    const hidden = props.filter((f) => f.effects?.hidden);
    // Footprint and Datasheet are hidden; Reference and Value are not.
    expect(hidden.map((f) => f.key).sort()).toEqual(['Datasheet', 'Footprint']);
    expect(props.filter((f) => f.key === 'Reference').every((f) => !f.effects?.hidden)).toBe(true);
  });
});
