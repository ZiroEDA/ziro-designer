// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * IPC-D-356 bare-board test netlist.
 * Counterpart: `IPC356D_WRITER` (pcbnew/exporters/export_d356.cpp).
 *
 * This is a fixed-column format read by test machines, so the tests assert
 * whole records **byte for byte**. Checking field values individually would
 * pass while every column sat one place to the left, and the failure would
 * surface at the fab rather than here.
 *
 * The expected strings below were derived from upstream's format string —
 * `"%03d%-14.14s   %-6.6s%c%-4.4s%c"`, then the hole block, then
 * `"A%02dX%+07dY%+07dX%04dY%04dR%03d"`, then `"S%d"` — not from running this
 * code.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { IPC356D_WRITER } from '@ziroeda/pcbnew/exporters/export_d356.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  internNewD356Netname,
  iuToD356,
  layerNameToId,
} from '@ziroeda/pcbnew/exporters/export_d356.js';
import type { Board, PcbPad, PcbVia } from '@ziroeda/pcbnew/types.js';

const P = (x: number, y: number) => ({ x, y });

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: P(1_000_000, 2_000_000),
  angle: 0,
  size: P(1_500_000, 800_000),
  layers: ['F.Cu', 'F.Mask'],
  net: 1,
  ...over,
});

const via = (over: Partial<PcbVia> = {}): PcbVia => ({
  at: P(0, 0),
  size: 800_000,
  drill: 400_000,
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
  ...over,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'GND'],
    [2, 'VCC'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  ...over,
});

const fp = (pads: PcbPad[], reference = 'R1') =>
  ({ reference, layer: 'F.Cu', at: P(0, 0), pads }) as never;

const records = (text: string): string[] =>
  text.split('\n').filter((l) => l && !l.startsWith('P  ') && l !== '999');

describe('converting to decimils', () => {
  it('rounds halves away from zero, not toward positive infinity', () => {
    // KiROUND is std::llround. Math.round would send -0.5 to 0 and put every
    // coordinate on a half-decimil below the origin one unit out.
    expect(iuToD356(2540 * 3 + 1270, 9999)).toBe(4);
    expect(iuToD356(-(2540 * 3 + 1270), 9999)).toBe(-4);
  });

  it('clamps at both ends, not just the positive one', () => {
    expect(iuToD356(999_999_999, 9999)).toBe(9999);
    expect(iuToD356(-999_999_999, 9999)).toBe(-9999);
  });
});

describe('layer ids and wildcards', () => {
  it('numbers layers the way layer_ids.h does', () => {
    // B.Cu is 2 — it sits between F.Cu and the inner layers, not after them.
    expect(layerNameToId('F.Cu')).toBe(0);
    expect(layerNameToId('B.Cu')).toBe(2);
    expect(layerNameToId('In1.Cu')).toBe(4);
    expect(layerNameToId('In30.Cu')).toBe(62);
    expect(layerNameToId('F.SilkS')).toBeUndefined();
  });
});

describe('net names', () => {
  it('keeps the tail when a name is too long, not the head', () => {
    // wxString::Right(14). Two long names sharing a suffix therefore collide.
    const map = new Map<string, string>();
    const used = new Set<string>();

    // 27 characters in; the last 14 survive.
    expect(internNewD356Netname('A_VERY_LONG_NET_NAME_SUFFIX', map, used)).toBe('ET_NAME_SUFFIX');
  });

  it('uppercases and replaces anything outside printable ASCII', () => {
    const out = internNewD356Netname('net aµ', new Map(), new Set());

    // Space and the micro sign both become '?'.
    expect(out).toBe('NET?A?');
  });

  it('uniquifies a collision by trimming to ten and appending #N', () => {
    const map = new Map<string, string>();
    const used = new Set<string>();

    const first = internNewD356Netname('SAME_NAME_HERE', map, used);
    const second = internNewD356Netname('XSAME_NAME_HERE', map, used);

    expect(first).toBe('SAME_NAME_HERE');
    expect(second).toBe('_NAME_HERE#1');
  });
});

describe('IPC356D_WRITER on a live board', () => {
  const UU = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const BOARD4 = (
    aItems: string,
  ): string => `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no)) (paper "A4")
  (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal)
    (1 "F.Mask" user) (3 "B.Mask" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "") (net 1 "SIG")
  ${aItems}
)`;
  const records = (aText: string, aNoUnconnected = false): string[] => {
    const w = new IPC356D_WRITER(ParseBoard(BOARD4(aText)));
    w.SetDoNotExportUnconnectedPads(aNoUnconnected);
    return w
      .Write()
      .split('\n')
      .filter((l) => /^[0-9]{3}/.test(l) && l !== '999');
  };
  /** Columns of a record: `A%02d` access, `S%d` soldermask, `R%03d` rotation. */
  const field = (aRec: string, aTag: 'A' | 'R' | 'S'): string =>
    new RegExp(`${aTag}(\\d+)`).exec(aRec.slice(aRec.indexOf('A')))![1]!;

  it('codes a via by the layers it reaches (via_access_code)', () => {
    const via = (a: string, b: string, n: number): string =>
      `(via blind (at 10 10) (size 0.6) (drill 0.3) (layers "${a}" "${b}") (net 1) (uuid "${UU(n)}"))`;
    const recs = records(
      [
        `(via (at 10 10) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1) (uuid "${UU(1)}"))`,
        via('F.Cu', 'In1.Cu', 2),
        via('In2.Cu', 'B.Cu', 3),
        `(via buried (at 10 10) (size 0.6) (drill 0.3) (layers "In1.Cu" "In2.Cu") (net 1) (uuid "${UU(4)}"))`,
      ].join('\n'),
    );

    // Through 0, front-reachable 1, back-reachable the copper count (4), and a
    // buried via In1.Cu (id 4): 4 / 2 + 1 = 3. The record type follows: 317
    // for a through via, 307 for the rest.
    expect(recs.map((r) => field(r, 'A'))).toEqual(['00', '01', '04', '03']);
    expect(recs.map((r) => r.slice(0, 3))).toEqual(['317', '307', '307', '307']);
  });

  it('marks an NPTH pad mechanical and skips unconnected pads when asked', () => {
    const fp = `(footprint "H" (layer "F.Cu") (at 20 20) (uuid "${UU(10)}")
      (property "Reference" "H1" (at 0 0 0) (layer "F.Cu") (uuid "${UU(11)}") (effects (font (size 1 1) (thickness 0.15))))
      (pad "" np_thru_hole circle (at 0 0) (size 2 2) (drill 2) (layers "*.Cu" "*.Mask") (uuid "${UU(12)}"))
      (pad "1" smd rect (at 3 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "SIG") (uuid "${UU(13)}")))`;
    const all = records(fp);

    // 367 + the U(nplated) hole for the NPTH pad; 327 for the SMD one.
    expect(all.map((r) => r.slice(0, 3))).toEqual(['367', '327']);
    expect(all[0]).toContain('D0787U');

    // NETINFO_LIST::UNCONNECTED: the NPTH pad has no net, so it goes.
    expect(records(fp, true).map((r) => r.slice(0, 3))).toEqual(['327']);
  });

  it('truncates the rotation toward zero, then adds 360 once', () => {
    const fp = `(footprint "R" (layer "F.Cu") (at 20 20) (uuid "${UU(20)}")
      (property "Reference" "R1" (at 0 0 0) (layer "F.Cu") (uuid "${UU(21)}") (effects (font (size 1 1) (thickness 0.15))))
      (pad "1" smd rect (at 0 0 30.7) (size 1 2) (layers "F.Cu") (net 1 "SIG") (uuid "${UU(22)}")))`;

    // -30.7 -> -30 (an int takes the double) -> 330.
    expect(field(records(fp)[0]!, 'R')).toBe('330');
  });

  it('says which sides a tented via hides (IsTented)', () => {
    const via = (aTent: string, n: number): string =>
      `(via (at 10 10) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") ${aTent} (net 1) (uuid "${UU(n)}"))`;
    const recs = records(
      [
        via('(tenting (front yes) (back no))', 1),
        via('(tenting (front no) (back yes))', 2),
        via('(tenting (front no) (back no))', 3),
      ].join('\n'),
    );

    expect(recs.map((r) => field(r, 'S'))).toEqual(['1', '2', '0']);
  });
});

describe('BOARD_EDITOR_CONTROL::GenD356File', () => {
  it('asks for the file with the checkbox, writes the netlist and keeps the choice', async () => {
    installPgm();
    const settings = new PCBNEW_SETTINGS();
    settings.m_ExportD356.doNotExportUnconnectedPads = true;
    const asked: unknown[] = [];
    const written: [string, string][] = [];
    const frame = new PCB_EDIT_FRAME({
      settings: () => settings,
      onModify: () => {},
      showSaveFileDialog: (
        aTitle: string,
        aName: string,
        _aWildcard: unknown,
        aCheckbox: { label: string; value: boolean } | null,
      ) => {
        asked.push([aTitle, aName, aCheckbox]);
        return Promise.resolve({ path: 'out/board.d356', checked: false });
      },
      writeTextFile: (aPath: string, aText: string) => {
        written.push([aPath, aText]);
        return true;
      },
    } as unknown as PCB_EDIT_FRAME_HOOKS);
    const board = ParseBoard(
      readFileSync(new URL('../../data/pcbnew/resave/ecc83-pp.kicad_pcb', import.meta.url), 'utf8'),
      '/p/ecc83-pp.kicad_pcb',
    );
    // The frame names the board when it loads it (PCB_EDIT_FRAME::OpenProjectFiles).
    board.SetFileName('/p/ecc83-pp.kicad_pcb');
    frame.SetBoard(board, false);

    frame.GetToolManager()!.RunAction(PCB_ACTIONS.generateD356File);
    await new Promise((r) => setTimeout(r, 0));

    // fn.SetExt( IpcD356FileExtension ), and the hook's checkbox at the setting.
    expect(asked).toEqual([
      [
        'Generate IPC-D-356 netlist file',
        'ecc83-pp.d356',
        { label: 'Do not export unconnected pads', value: true },
      ],
    ]);
    expect(written.map(([p]) => p)).toEqual(['out/board.d356']);
    expect(written[0]![1]).toBe(new IPC356D_WRITER(board).Write());
    // The unchecked box is remembered.
    expect(settings.m_ExportD356.doNotExportUnconnectedPads).toBe(false);
  });
});
