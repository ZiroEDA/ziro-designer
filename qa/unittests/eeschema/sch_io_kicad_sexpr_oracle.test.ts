// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live-model `.kicad_sch` reader and writer (SCH_IO_KICAD_SEXPR) against KiCad's own.
 *
 * `qa/data/eeschema/sexpr_oracle/<fixture>.pass1` is what `kicad-cli sch upgrade --force`
 * (10.0.6) wrote for the schematic fixture `qa/data/<fixture>`, each file upgraded as the
 * root of its own load; `.pass2` is what the same command wrote for `.pass1`.
 *
 * `kicad-cli sch upgrade` loads the schematic through EESCHEMA_HELPERS::LoadSchematic (the
 * hierarchy the writer's orphan checks read), then loads the file AGAIN with a fresh
 * plugin and saves that second load (eeschema_jobs_handler.cpp JobUpgrade).  This test
 * runs the same two loads and the save:
 *
 *   - KiCad's rewrite (`.pass1`) read and written by us must be `.pass2`, byte for byte;
 *   - the original read and written by us must be `.pass1` byte for byte when KiCad
 *     invented nothing on the way; when it did — a random uuid for an item an old file
 *     wrote none for, or the order of the pins UpdatePins creates, which upstream walks in
 *     `std::set<SCH_PIN*>` (pointer) order — the two must match with each uuid read as
 *     `U` and those pin runs sorted, and nothing else.
 *
 * Sub-sheets are read from the `.pass1` files (KiCad-written, so their sheet uuids are the
 * ones the root's instance paths name).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT } from '@ziroeda/common/project.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';

const DATA = resolve(__dirname, '../../data');
const ORACLE = join(DATA, 'eeschema', 'sexpr_oracle');

function findOracleFiles(aDir: string): string[] {
  const out: string[] = [];

  for (const name of readdirSync(aDir)) {
    const p = join(aDir, name);

    if (statSync(p).isDirectory()) out.push(...findOracleFiles(p));
    else if (name.endsWith('.kicad_sch.pass1')) out.push(p.slice(0, -'.pass1'.length));
  }

  return out.sort();
}

/**
 * Load \a aFile (the fixture's path in qa/data) as kicad-cli does, with \a aRootText as
 * its content, and return the saved text.
 */
function upgradeLikeKicadCli(aFile: string, aRootText: string): string {
  const dir = dirname(aFile);
  const pro = join(dir, `${basename(aFile, '.kicad_sch')}.kicad_pro`);
  const project = new PROJECT();

  if (existsSync(pro)) project.setProjectFullName(pro);

  const readFile = (p: string): string | null => {
    if (p === aFile) return aRootText;

    const oracle = `${join(ORACLE, relative(DATA, p))}.pass1`;

    return existsSync(oracle) ? readFileSync(oracle, 'utf8') : null;
  };

  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();

  // EESCHEMA_HELPERS::LoadSchematic
  const pi = new SCH_IO_KICAD_SEXPR('eeschema');
  const rootSheet = pi.LoadSchematicFile(aFile, schematic, dir, readFile);

  schematic.SetTopLevelSheets([rootSheet]);

  if (rootSheet.GetName() === '') rootSheet.SetName('Root');

  // JobUpgrade: a second load, saved
  const pi2 = new SCH_IO_KICAD_SEXPR('eeschema');
  const loadedSheet = pi2.LoadSchematicFile(aFile, schematic, dir, readFile);

  return pi2.SaveSchematicFile(loadedSheet, schematic);
}

const UUID = /"?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"?/g;

/** Every uuid in the text, unquoted. */
function uuids(aText: string): Set<string> {
  return new Set([...aText.matchAll(UUID)].map((m) => m[0].replaceAll('"', '')));
}

/**
 * The text with each uuid read as `U`, each run of a symbol's `(pin "N" (uuid U))` entries
 * sorted, and the top-level items sorted (their order is by uuid).
 */
function canonical(aText: string): string {
  const lines = aText.replace(UUID, 'U').split('\n');
  const items: string[] = [];
  let cur: string[] = [];

  const flush = (): void => {
    // Sort runs of three-line symbol pin entries.
    const out: string[] = [];
    let run: string[] = [];

    for (let i = 0; i < cur.length; i++) {
      if (
        /^\t\t\(pin "/.test(cur[i]!) &&
        cur[i + 1] === '\t\t\t(uuid U)' &&
        cur[i + 2] === '\t\t)'
      ) {
        run.push(`${cur[i]}\n${cur[i + 1]}\n${cur[i + 2]}`);
        i += 2;
        continue;
      }

      out.push(...run.sort());
      run = [];
      out.push(cur[i]!);
    }

    out.push(...run.sort());
    items.push(out.join('\n'));
    cur = [];
  };

  for (const line of lines) {
    if (line.startsWith('\t(') && cur.length > 0) flush();

    cur.push(line);
  }

  flush();

  return items.sort().join('\n');
}

const files = existsSync(ORACLE) ? findOracleFiles(ORACLE) : [];

describe('SCH_IO_KICAD_SEXPR against kicad-cli sch upgrade', () => {
  it('has the oracle fixtures', () => {
    // 34, plus the two 10.0.6 fixtures 623de73d added — eeschema/sexpr_1006/
    // v1006.kicad_sch and its sub-sheet sub.kicad_sch — whose .pass1/.pass2 are
    // kicad-cli 10.0.6 `sch upgrade` output, re-generated and byte-identical.
    expect(files.length).toBe(36);
  });

  for (const oracleFile of files) {
    const rel = relative(ORACLE, oracleFile);
    const file = join(DATA, rel);

    it(`${rel}: KiCad's rewrite is a fixed point`, () => {
      const pass1 = readFileSync(`${oracleFile}.pass1`, 'utf8');
      const pass2 = readFileSync(`${oracleFile}.pass2`, 'utf8');

      expect(upgradeLikeKicadCli(file, pass1)).toBe(pass2);
    });

    it(`${rel}: the original upgrades as KiCad upgrades it`, () => {
      const orig = readFileSync(file, 'utf8');
      const pass1 = readFileSync(`${oracleFile}.pass1`, 'utf8');
      const ours = upgradeLikeKicadCli(file, orig);

      const origUuids = uuids(orig);
      const invented = [...uuids(pass1)].some((u) => !origUuids.has(u));

      if (invented) expect(canonical(ours)).toBe(canonical(pass1));
      else expect(ours).toBe(pass1);
    });
  }
});
