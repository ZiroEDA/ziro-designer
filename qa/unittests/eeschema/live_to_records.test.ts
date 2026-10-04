// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live model back into the window's records (sch_record_bridge.ts liveScreensToRecords,
 * TRANSITIONAL), and SCH_EDIT_FRAME::WithoutDialogs, the frame driven with no window.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { LABEL_FLAG_SHAPE } from '@ziroeda/eeschema/sch_label.js';
import { liveScreensToRecords } from '@ziroeda/eeschema/sch_record_bridge.js';
import { drawSheet, newHierLabel } from '@ziroeda/ai/sch_hierarchy.js';
import { SCH_DRAWING_TOOLS } from '@ziroeda/eeschema/tools/sch_drawing_tools.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const MIL = 254;

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function openFrame(isOK: () => boolean = () => false) {
  const frame = new SCH_EDIT_FRAME({
    crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
    highlightNet: () => {},
    syncSelection: () => {},
    assignFootprints: () => {},
    saveProject: () => true,
    isOK,
  });
  frame.OpenProjectFiles([`/complex_hierarchy/${SHEETS[0]}`], 0, (p) => {
    const n = SHEETS.find((s) => p === `/complex_hierarchy/${s}`);
    return n ? readFileSync(join(ORACLE, n), 'utf8') : null;
  });
  return frame;
}

describe('liveScreensToRecords', () => {
  it('writes each changed screen as a record under its project-relative file name', () => {
    const frame = openFrame();
    const tools = new SCH_DRAWING_TOOLS(frame);
    const sheet = drawSheet(
      frame,
      tools,
      { x: 0, y: 0 },
      { x: 2000 * MIL, y: 1000 * MIL },
      'Power',
      'power.kicad_sch',
    )!;
    const label = newHierLabel(frame, tools, { x: 0, y: 0 }, 'VIN', LABEL_FLAG_SHAPE.L_INPUT);
    label.ClearFlags();
    frame.AddToScreen(label, sheet.GetScreen()!);
    tools.autoPlaceSheetPins(sheet);

    const docs = liveScreensToRecords(
      frame,
      [frame.GetScreen()!, sheet.GetScreen()!],
      '/complex_hierarchy',
    );
    expect([...docs.keys()]).toEqual(['complex_hierarchy.kicad_sch', 'power.kicad_sch']);

    const root = docs.get('complex_hierarchy.kicad_sch')!;
    const power = root.sheets.find((s) => s.fields.some((f) => f.value === 'Power'))!;
    expect(power.pins.map((p) => p.name)).toEqual(['VIN']);
    expect(power.fields.find((f) => f.key === 'Sheetfile')!.value).toBe('power.kicad_sch');

    const child = docs.get('power.kicad_sch')!;
    expect(child.fileName).toBe('power.kicad_sch');
    expect(child.labels.filter((l) => l.kind === 'hierarchical_label').map((l) => l.text)).toEqual([
      'VIN',
    ]);
  });
});

describe('SCH_EDIT_FRAME::WithoutDialogs', () => {
  it('answers the questions and collects the messages instead of showing them', () => {
    let asked = 0;
    const frame = openFrame(() => {
      asked++;
      return false;
    });
    const { result, messages } = frame.WithoutDialogs(true, () => frame.IsOK('Share it?'));
    expect(result).toBe(true);
    expect(messages).toEqual(['Share it?']);
    expect(asked).toBe(0);
    // Outside it, the hook answers again.
    expect(frame.IsOK('again?')).toBe(false);
    expect(asked).toBe(1);
  });

  it('collects DisplayError', () => {
    const frame = openFrame();
    const { messages } = frame.WithoutDialogs(false, () => frame.DisplayError('bad'));
    expect(messages).toEqual(['bad']);
  });
});
