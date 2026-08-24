// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Repairing the projects that already carry the extra folder level.
 *
 * `stripCommonFolder` stops NEW imports growing one; this is the records that
 * already have it. Akshay's `ecc83-pp` held one folder called `ecc83` and no
 * `.kicad_sch` at the root, which is why Save As - filtered to schematic files,
 * in the project whose schematic was open - listed no documents at all.
 *
 * It rewrites stored data, so the rule is stricter than the ingest one. Run
 * against a real IndexedDB rather than read out of the source: a migration
 * asserted by grep is a migration nobody has executed.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadProject, saveProject } from '@ziroeda/designer/src/home/projectStore.js';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const store = (names: string[]) => names.map((name) => ({ name, bytes: bytes('(kicad_sch)') }));
/**
 * Open the project and read the names back.
 *
 * Through `loadProject`, not by calling the repair directly: that is where it
 * runs, and a migration exercised only through its own function is a migration
 * whose wiring nobody has checked. `wiring_guard` made the same point.
 */
const namesIn = async (id: string): Promise<string[]> =>
  ((await loadProject(id))?.files ?? []).map((f) => f.name).sort();

let n = 0;
const freshName = (): string => `p${++n}`;

describe('the defect is repaired', () => {
  it('strips the folder and puts the documents at the root', async () => {
    const id = await saveProject(
      freshName(),
      store([
        'ecc83-pp/ecc83-pp.kicad_sch',
        'ecc83-pp/ecc83-pp.kicad_pro',
        'ecc83-pp/fp-lib-table',
      ]),
    );
    expect(await namesIn(id)).toStrictEqual([
      'ecc83-pp.kicad_pro',
      'ecc83-pp.kicad_sch',
      'fp-lib-table',
    ]);
  });

  it('keeps the structure below it', async () => {
    const id = await saveProject(
      freshName(),
      store(['b/b.kicad_pro', 'b/sub/amp.kicad_sch', 'b/b.pretty/R.kicad_mod']),
    );
    expect(await namesIn(id)).toStrictEqual([
      'b.kicad_pro',
      'b.pretty/R.kicad_mod',
      'sub/amp.kicad_sch',
    ]);
  });

  it('runs once - a second call changes nothing', async () => {
    // Idempotent by construction: after the first run the root holds files, so
    // the "no file at the root" condition fails.
    const id = await saveProject(freshName(), store(['x/x.kicad_pro', 'x/x.kicad_sch']));
    expect(await namesIn(id)).toStrictEqual(['x.kicad_pro', 'x.kicad_sch']);
    // Opening it again must not strip a second level.
    expect(await namesIn(id)).toStrictEqual(['x.kicad_pro', 'x.kicad_sch']);
  });
});

describe('and nothing else is touched', () => {
  it('leaves a project that is already flat', async () => {
    const id = await saveProject(freshName(), store(['a.kicad_pro', 'a.kicad_sch']));
    expect(await namesIn(id)).toStrictEqual(['a.kicad_pro', 'a.kicad_sch']);
  });

  it('leaves a project whose files span two folders', async () => {
    const id = await saveProject(freshName(), store(['one/a.kicad_sch', 'two/b.kicad_sch']));
    expect(await namesIn(id)).toStrictEqual(['one/a.kicad_sch', 'two/b.kicad_sch']);
  });

  it('leaves a folder the user meant, when stripping reveals no project document', async () => {
    // The condition that makes this a repair rather than a guess. Everything
    // here really does live in `docs/`, and flattening would not put a
    // .kicad_pro/.kicad_sch/.kicad_pcb at the root.
    const id = await saveProject(freshName(), store(['docs/notes.txt', 'docs/spec.md']));
    expect(await namesIn(id)).toStrictEqual(['docs/notes.txt', 'docs/spec.md']);
  });

  it('leaves it when the revealed document would still be nested', async () => {
    // `b/sub/x.kicad_sch` reveals `sub/x.kicad_sch`, which is not AT the root -
    // so the leading folder was doing real work.
    const id = await saveProject(freshName(), store(['b/sub/x.kicad_sch', 'b/sub/y.kicad_pcb']));
    expect(await namesIn(id)).toStrictEqual(['b/sub/x.kicad_sch', 'b/sub/y.kicad_pcb']);
  });

  it('survives a project with no files', async () => {
    const id = await saveProject(freshName(), []);
    expect(await namesIn(id)).toStrictEqual([]);
  });
});
