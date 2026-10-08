// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live SCH_DRAWING_TOOLS members that build a hierarchy (sch_drawing_tools.cpp): DrawSheet
 * without the cursor, hierarchical labels, and AutoPlaceAllSheetPins.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { LABEL_FLAG_SHAPE } from '@ziroeda/eeschema/sch_label.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SHEET_SIDE } from '@ziroeda/eeschema/sch_sheet_pin.js';
import { drawSheet, newHierLabel } from '@ziroeda/ai/sch_hierarchy.js';
import { SCH_DRAWING_TOOLS } from '@ziroeda/eeschema/tools/sch_drawing_tools.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const MIL = 254;

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function openFrame() {
  const frame = new SCH_EDIT_FRAME({
    crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
    saveProject: () => true,
    isOK: () => true,
  });
  frame.OpenProjectFiles([`/complex_hierarchy/${SHEETS[0]}`], 0, (p) => {
    const n = SHEETS.find((s) => p === `/complex_hierarchy/${s}`);
    return n ? readFileSync(join(ORACLE, n), 'utf8') : null;
  });
  return { frame, tools: new SCH_DRAWING_TOOLS(frame) };
}

/** Hierarchical labels in \a aSheet's own screen, placed as TwoClickPlace commits them. */
function addHierLabels(
  frame: SCH_EDIT_FRAME,
  tools: SCH_DRAWING_TOOLS,
  aSheet: SCH_SHEET,
  labels: [string, LABEL_FLAG_SHAPE][],
) {
  const parent = frame.GetCurrentSheet().Clone();
  const inside = parent.Clone();
  inside.push_back(aSheet);
  frame.Schematic().SetCurrentSheet(inside);
  const commit = new SCH_COMMIT(frame);
  labels.forEach(([text, shape], i) => {
    const label = newHierLabel(frame, tools, { x: 0, y: i * 100 * MIL }, text, shape);
    label.ClearFlags();
    frame.AddToScreen(label, frame.GetScreen());
    commit.Added(label, frame.GetScreen());
  });
  commit.Push('Place Label');
  frame.Schematic().SetCurrentSheet(parent);
}

describe("drawSheet (the AI's DrawSheet without the cursor)", () => {
  it('adds a sheet on a new file with the next free page number, in one undoable commit', async () => {
    const { frame, tools } = openFrame();
    const before = frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T).length;
    const sheet = (await drawSheet(
      frame,
      tools,
      { x: 0, y: 0 },
      { x: 2000 * MIL, y: 1000 * MIL },
      'Power',
      'power.kicad_sch',
    ))!;

    expect(sheet.GetName()).toBe('Power');
    expect(sheet.GetScreen()!.GetFileName()).toBe('/complex_hierarchy/power.kicad_sch');
    expect(frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)).toHaveLength(before + 1);
    // The file stores no page numbers, so the load numbers the root and the two ampli_ht
    // instances 1..3 (SetInitialPageNumbers): the new sheet takes the first free one, 4.
    const path = frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.Last() === sheet)!;
    expect(path.GetPageNumber()).toBe('4');

    frame.RollbackSchematicFromUndo();
    expect(frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)).toHaveLength(before);
  });

  it('snaps the size to the grid and never below the minimum sheet size', async () => {
    const { frame, tools } = openFrame();
    const sheet = (await drawSheet(
      frame,
      tools,
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      'Tiny',
      'tiny.kicad_sch',
    ))!;
    expect(sheet.GetSize()).toEqual({ x: 500 * MIL, y: 150 * MIL }); // MIN_SHEET_WIDTH/HEIGHT
  });

  it('returns null and adds nothing when the file change is refused', async () => {
    const { frame, tools } = openFrame();
    const sub = frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!;
    frame.Schematic().SetCurrentSheet(sub);
    const before = frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T).length;
    expect(
      await drawSheet(
        frame,
        tools,
        { x: 0, y: 0 },
        { x: 2000 * MIL, y: 1000 * MIL },
        'Loop',
        'complex_hierarchy.kicad_sch',
      ),
    ).toBe(null);
    expect(frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)).toHaveLength(before);
  });
});

describe('SCH_DRAWING_TOOLS::autoPlaceSheetPins (AutoPlaceAllSheetPins on a given sheet)', () => {
  it('puts outputs down the right edge and the rest down the left, by name, and grows the sheet', async () => {
    const { frame, tools } = openFrame();
    const sheet = (await drawSheet(
      frame,
      tools,
      { x: 0, y: 0 },
      { x: 2000 * MIL, y: 500 * MIL },
      'Power',
      'power.kicad_sch',
    ))!;
    addHierLabels(frame, tools, sheet, [
      ['VIN', LABEL_FLAG_SHAPE.L_INPUT],
      ['EN', LABEL_FLAG_SHAPE.L_INPUT],
      ['VOUT', LABEL_FLAG_SHAPE.L_OUTPUT],
      ['GND', LABEL_FLAG_SHAPE.L_BIDI],
      ['PG', LABEL_FLAG_SHAPE.L_OUTPUT],
    ]);

    expect(tools.autoPlaceSheetPins(sheet)).toBe(5);
    const pins = sheet.GetPins();
    const left = pins.filter((p) => p.GetSide() === SHEET_SIDE.LEFT);
    const right = pins.filter((p) => p.GetSide() === SHEET_SIDE.RIGHT);
    expect(left.map((p) => p.GetText())).toEqual(['EN', 'GND', 'VIN']);
    expect(right.map((p) => p.GetText())).toEqual(['PG', 'VOUT']);
    // pitch = max( 2 x 50 mil text, 100 mil ), snapped to 50 mil: 100 mil, starting one pitch down
    expect(left.map((p) => p.GetPosition().y)).toEqual([100, 200, 300].map((y) => y * MIL));
    // three pins on the left need 300 + 100 (margin) = 400 mil: the 500 mil sheet is enough
    expect(sheet.GetSize().y).toBe(500 * MIL);
    expect(right[0]!.GetShape()).toBe(LABEL_FLAG_SHAPE.L_OUTPUT);
  });

  it('grows a short sheet to fit its pins', async () => {
    const { frame, tools } = openFrame();
    const sheet = (await drawSheet(
      frame,
      tools,
      { x: 0, y: 0 },
      { x: 2000 * MIL, y: 150 * MIL },
      'IO',
      'io.kicad_sch',
    ))!;
    addHierLabels(frame, tools, sheet, [
      ['A', LABEL_FLAG_SHAPE.L_INPUT],
      ['B', LABEL_FLAG_SHAPE.L_INPUT],
      ['C', LABEL_FLAG_SHAPE.L_INPUT],
    ]);
    tools.autoPlaceSheetPins(sheet);
    expect(sheet.GetSize().y).toBe(400 * MIL); // 3 x 100 + 100 margin
  });

  it('places nothing when every label already has a pin, and only the new ones otherwise', async () => {
    const { frame, tools } = openFrame();
    const sheet = (await drawSheet(
      frame,
      tools,
      { x: 0, y: 0 },
      { x: 2000 * MIL, y: 500 * MIL },
      'P',
      'p.kicad_sch',
    ))!;
    addHierLabels(frame, tools, sheet, [['VIN', LABEL_FLAG_SHAPE.L_INPUT]]);
    expect(tools.autoPlaceSheetPins(sheet)).toBe(1);
    expect(tools.autoPlaceSheetPins(sheet)).toBe(0);
    addHierLabels(frame, tools, sheet, [['EN', LABEL_FLAG_SHAPE.L_INPUT]]);
    expect(tools.autoPlaceSheetPins(sheet)).toBe(1);
    // the new pin stacks below the existing one
    const ys = sheet.GetPins().map((p) => p.GetPosition().y);
    expect(ys[1]! > ys[0]!).toBe(true);
  });

  it('imports the first label without a pin in natural order (importHierLabel)', async () => {
    const { frame, tools } = openFrame();
    const sheet = (await drawSheet(
      frame,
      tools,
      { x: 0, y: 0 },
      { x: 2000 * MIL, y: 500 * MIL },
      'P',
      'p.kicad_sch',
    ))!;
    addHierLabels(frame, tools, sheet, [
      ['D10', LABEL_FLAG_SHAPE.L_INPUT],
      ['D2', LABEL_FLAG_SHAPE.L_INPUT],
    ]);
    expect(tools.importHierLabel(sheet)!.GetText()).toBe('D2');
  });
});
