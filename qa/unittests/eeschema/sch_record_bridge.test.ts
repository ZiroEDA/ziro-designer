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
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_ITEM } from '@ziroeda/eeschema/sch_item.js';
import { SCH_SCREENS, type SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
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
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_NAVIGATE_TOOL } from '@ziroeda/eeschema/tools/sch_navigate_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(
  __dirname,
  '../../data/eeschema/sexpr_oracle/eeschema/netlist_oracle/complex_hierarchy',
);
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch'];
const DIR = '/complex_hierarchy';

const hooks: SCH_EDIT_FRAME_HOOKS = {
  crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
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

describe('the screens a live commit touched', () => {
  /** SCH_COMMIT::pushSchEdit ends in SCHEMATIC::OnItemsChanged; the mirror hears it. */
  it('names every sheet a commit reached, once', () => {
    const frame = new SCH_EDIT_FRAME(hooks);
    const mirror = new LIVE_SCHEMATIC_MIRROR(frame, () => records());
    const sch = mirror.get()!;
    const screens = new SCH_SCREENS(sch.Root());
    const all: SCH_SCREEN[] = [];
    for (let s = screens.GetFirst(); s; s = screens.GetNext()) all.push(s);
    // The root sheet holds sheets and labels, ampli_ht symbols: any item on each will do.
    const itemOf = (aScreen: SCH_SCREEN) => [...aScreen.Items()][0] as SCH_ITEM;
    const sub = all.find((s) => s.GetFileName().endsWith('ampli_ht.kicad_sch'))!;
    const root = all.find((s) => s !== sub)!;

    sch.OnItemsChanged([itemOf(sub), itemOf(root)]);
    sch.OnItemsRemoved([itemOf(sub)]);
    expect([...mirror.TakeCommittedScreens()].map((s) => s.GetFileName()).sort()).toStrictEqual(
      [root.GetFileName(), sub.GetFileName()].sort(),
    );
    // Taken: the next read starts empty.
    expect(mirror.TakeCommittedScreens().size).toBe(0);
  });

  it('stops listening to a schematic once a rebuild replaced it', () => {
    const frame = new SCH_EDIT_FRAME(hooks);
    let project = records();
    const mirror = new LIVE_SCHEMATIC_MIRROR(frame, () => project);
    const old = mirror.get()!;
    const docs = new Map(project.docs);
    docs.set(SHEETS[1]!, readSchematic(parse(pass1(SHEETS[1]!))));
    project = { ...project, docs };
    expect(mirror.get() === old).toBe(false);
    const screens = new SCH_SCREENS(old.Root());
    const symbol = [...screens.GetFirst()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)][0] as SCH_ITEM;
    old.OnItemsChanged([symbol]);
    expect(mirror.TakeCommittedScreens().size).toBe(0);
  });
});

describe('a rebuild and the Back/Forward history', () => {
  /**
   * The window kept a second history of its own because a rebuild reopens the project and
   * OpenProjectFiles' ResetHistory wiped the live one - so Alt+Left (the live tool) and
   * View > Navigate Back (the window's) disagreed. In KiCad an edit never touches the history.
   */
  it('survives a record edit: Back and Forward step through the same sheets after it', () => {
    const h = schToolHarness(schFrame({}));
    let project = records();
    const mirror = new LIVE_SCHEMATIC_MIRROR(h.frame, () => project);
    const first = mirror.get();
    const mgr = h.frame.GetToolManager()!;
    const hierarchy = () => h.frame.Schematic().Hierarchy();
    const [root, a, b] = hierarchy();
    h.frame.SetCurrentSheet(root!);
    mgr.GetTool(SCH_NAVIGATE_TOOL)!.ResetHistory();

    mgr.RunAction(SCH_ACTIONS.changeSheet, a);
    mgr.RunAction(SCH_ACTIONS.changeSheet, b);
    mgr.RunAction(SCH_ACTIONS.navigateBack);
    expect(h.frame.GetCurrentSheet().equals(a!)).toBe(true);

    // A sheet record the window edited: the mirror reopens the project.
    project = {
      ...project,
      docs: new Map(project.docs).set(SHEETS[1]!, readSchematic(parse(pass1(SHEETS[1]!)))),
    };
    expect(mirror.get() !== first).toBe(true);
    // The window shows the instance it was on (showLive), without a step of its own.
    h.frame.SetCurrentSheet(hierarchy().find((p) => p.equals(a!))!);

    const at = () => hierarchy().findIndex((p) => p.equals(h.frame.GetCurrentSheet()));
    mgr.RunAction(SCH_ACTIONS.navigateBack);
    expect(at()).toBe(0);
    // The sheet shown is the new model's, not the one the rebuild threw away.
    expect(h.frame.GetCurrentSheet().Last() === hierarchy()[0]!.Last()).toBe(true);
    mgr.RunAction(SCH_ACTIONS.navigateForward);
    mgr.RunAction(SCH_ACTIONS.navigateForward);
    expect(at()).toBe(2);
  });
});
