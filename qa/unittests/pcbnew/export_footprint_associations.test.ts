// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint association (.cmp) file (`export_footprint_associations.cpp`)
 * and File > Export > Footprint Association (.cmp) File...
 * (`BOARD_EDITOR_CONTROL::ExportCmpFile`). The expected text is
 * RecreateCmpFile's fprintf calls read off the C++, one per line.
 */
import { describe, expect, it } from 'vitest';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { RecreateCmpFile } from '@ziroeda/pcbnew/exporters/export_footprint_associations.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (37 "F.Fab" user))
  (setup)
  (net 0 "")
  (footprint "Resistor_SMD:R_0603_1608Metric" (layer "F.Cu") (at 10 10) (uuid "${U(1)}")
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "${U(2)}"))
    (property "Value" "10k" (at 0 0 0) (layer "F.Fab") (uuid "${U(3)}"))
    (path "/${U(10)}/${U(11)}"))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 20 10) (uuid "${U(4)}")
    (property "Reference" "" (at 0 0 0) (layer "F.SilkS") (uuid "${U(5)}"))
    (property "Value" "" (at 0 0 0) (layer "F.Fab") (uuid "${U(6)}")))
)`;

const EXPECTED = `Cmp-Mod V01 Created by PcbNew   date = 2026-10-04T12:00:00

BeginCmp
TimeStamp = ${U(1)}
Path = /${U(10)}/${U(11)}
Reference = R1;
ValeurCmp = 10k;
IdModule  = Resistor_SMD:R_0603_1608Metric;
EndCmp

BeginCmp
TimeStamp = ${U(4)}
Path = 
Reference = [NoRef];
ValeurCmp = [NoVal];
IdModule  = MountingHole:MountingHole_3.2mm_M3;
EndCmp

EndListe
`;

describe('RecreateCmpFile', () => {
  it('writes one BeginCmp block per footprint, [NoRef]/[NoVal] for empty fields', () => {
    expect(RecreateCmpFile(ParseBoard(BOARD_TEXT), '2026-10-04T12:00:00')).toBe(EXPECTED);
  });
});

describe('BOARD_EDITOR_CONTROL::ExportCmpFile', () => {
  it('asks for <board>.cmp, then writes the file', async () => {
    installPgm();
    const settings = new PCBNEW_SETTINGS();
    const asked: unknown[] = [];
    const written: [string, string][] = [];
    const frame = new PCB_EDIT_FRAME({
      settings: () => settings,
      onModify: () => {},
      showSaveFileDialog: (
        aTitle: string,
        aName: string,
        aWildcard: unknown,
        aCheckbox: unknown,
      ) => {
        asked.push([aTitle, aName, aWildcard, aCheckbox]);
        return Promise.resolve({ path: 'out/b.cmp', checked: false });
      },
      writeTextFile: (aPath: string, aText: string) => {
        written.push([aPath, aText]);
        return true;
      },
    } as unknown as PCB_EDIT_FRAME_HOOKS);
    const board = ParseBoard(BOARD_TEXT);
    board.SetFileName('/p/board.kicad_pcb');
    frame.SetBoard(board, false);

    frame.GetToolManager()!.RunAction(PCB_ACTIONS.exportCmpFile);
    await new Promise((r) => setTimeout(r, 0));

    expect(asked).toEqual([
      [
        'Save Footprint Association File',
        'board.cmp',
        { label: 'KiCad symbol footprint link files (*.cmp)', extensions: ['cmp'] },
        null,
      ],
    ]);
    expect(written.map(([p]) => p)).toEqual(['out/b.cmp']);
    const body = (t: string): string => t.slice(t.indexOf('\n'));
    expect(body(written[0]![1])).toBe(body(EXPECTED));
  });

  it('writes nothing when the dialog is cancelled', async () => {
    installPgm();
    const written: string[] = [];
    const frame = new PCB_EDIT_FRAME({
      settings: () => new PCBNEW_SETTINGS(),
      onModify: () => {},
      showSaveFileDialog: () => Promise.resolve(null),
      writeTextFile: (aPath: string) => {
        written.push(aPath);
        return true;
      },
    } as unknown as PCB_EDIT_FRAME_HOOKS);
    frame.SetBoard(ParseBoard(BOARD_TEXT), false);

    frame.GetToolManager()!.RunAction(PCB_ACTIONS.exportCmpFile);
    await new Promise((r) => setTimeout(r, 0));

    expect(written).toEqual([]);
  });
});
