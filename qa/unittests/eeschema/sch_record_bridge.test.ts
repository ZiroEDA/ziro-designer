// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The transitional record -> live bridge (eeschema/sch_record_bridge.ts, stage S1a):
 * the window's records opened through OpenProjectFiles must be the live model KiCad's own
 * files give, and the mirror rebuilds only when a record changed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { readSchematic } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import {
  LIVE_SCHEMATIC_MIRROR,
  openRecordsLive,
  type RecordProject,
} from '@ziroeda/eeschema/sch_record_bridge.js';
import type { Schematic } from '@ziroeda/eeschema/types.js';
import { getPageSettings, setPageSettingsCommand } from '@ziroeda/eeschema';
import { parse } from '@ziroeda/sexpr/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORACLE = resolve(
  __dirname,
  '../../data/eeschema/sexpr_oracle/eeschema/netlist_oracle/complex_hierarchy',
);
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch'];
const DIR = '/complex_hierarchy';

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

const pass1 = (name: string) => readFileSync(join(ORACLE, `${name}.pass1`), 'utf8');
const records = (): RecordProject => ({
  dir: DIR,
  root: SHEETS[0]!,
  docs: new Map(SHEETS.map((n) => [n, readSchematic(parse(pass1(n)))] as const)),
  files: [],
});
const saved = (frame: SCH_EDIT_FRAME) =>
  new SCH_IO_KICAD_SEXPR('eeschema').SaveSchematicFile(
    frame.Schematic().GetTopLevelSheet()!,
    frame.Schematic(),
  );

describe('the record -> live bridge', () => {
  it('has the fixture', () => {
    expect(SHEETS.every((n) => existsSync(join(ORACLE, `${n}.pass1`)))).toBe(true);
  });

  it("opens the window's records as the same live model KiCad's files give", () => {
    const direct = new SCH_EDIT_FRAME(hooks);
    direct.OpenProjectFiles([`${DIR}/${SHEETS[0]}`], 0, (p) => {
      const n = SHEETS.find((s) => p === `${DIR}/${s}`);
      return n ? pass1(n) : null;
    });
    const viaRecords = new SCH_EDIT_FRAME(hooks);
    expect(openRecordsLive(viaRecords, records())).not.toBeNull();
    expect(saved(viaRecords)).toBe(saved(direct));
    // ...the whole hierarchy, not only the root sheet.
    expect(viaRecords.Schematic().Hierarchy().length).toBe(direct.Schematic().Hierarchy().length);
  });

  it('rebuilds only when a sheet record changed, and then shows the change', () => {
    const frame = new SCH_EDIT_FRAME(hooks);
    let project = records();
    const mirror = new LIVE_SCHEMATIC_MIRROR(frame, () => project);
    const first = mirror.get();
    expect(first).not.toBeNull();
    // Identity as a boolean: a failing toBe() would print two whole SCHEMATIC graphs.
    expect(mirror.get() === first).toBe(true); // nothing changed: the same build

    // An edit makes a new record for that sheet (records are immutable), through the
    // editor's own command, as Page Settings does it.
    const root = project.docs.get(SHEETS[0]!)!;
    const title = 'Edited by the window';
    const edited: Schematic = setPageSettingsCommand({ ...getPageSettings(root), title }).apply(
      root,
    );
    project = { ...project, docs: new Map(project.docs).set(SHEETS[0]!, edited) };
    const second = mirror.get();
    expect(second === first).toBe(false);
    expect(second!.RootScreen()!.GetTitleBlock().GetTitle()).toBe(title);
  });
});
