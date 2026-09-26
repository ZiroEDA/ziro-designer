// The KiCad-exact board reader and writer over the item classes (issue 636,
// stage 1): every board under qa/data/pcbnew/resave is what pcbnew 10.0.5
// wrote for its own re-save. `PCB_IO_KICAD_SEXPR_PARSER::Parse()` builds a
// BOARD of PCB_SHAPE / FOOTPRINT / PAD / ZONE … and `PCB_IO_KICAD_SEXPR`
// formats that BOARD back; the bytes must be the same, the `(generator …)`
// token aside — the file says pcbnew, and we do not.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { GENERATOR } from '@ziroeda/common/generator.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';

const RESAVE = fileURLToPath(new URL('../../data/pcbnew/resave/', import.meta.url));
const boards = readdirSync(RESAVE)
  .filter((f) => f.endsWith('.kicad_pcb'))
  .sort();

/** `PCB_IO_KICAD_SEXPR::LoadBoard` for a string. */
function parseBoard(text: string, source = 'string'): BOARD {
  return new PCB_IO_KICAD_SEXPR_PARSER(text, source).Parse() as BOARD;
}

/** The first line differing, for a readable failure. */
function firstDiff(a: string, b: string): string {
  const la = a.split('\n');
  const lb = b.split('\n');
  let i = 0;
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
  return `line ${i + 1}:\n  ours   ${JSON.stringify(la.slice(i, i + 3).join('\n'))}\n  theirs ${JSON.stringify(lb.slice(i, i + 3).join('\n'))}`;
}

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

describe('PCB_IO_KICAD_SEXPR over the classes: parse + format is KiCad’s own re-save', () => {
  it('has the oracle corpus', () => {
    expect(boards.length).toBeGreaterThanOrEqual(14);
  });

  for (const f of boards) {
    it(`${f} round-trips byte for byte`, () => {
      const theirs = readFileSync(join(RESAVE, f), 'utf8');
      const board = parseBoard(theirs, f);
      // KiCad's own name here, so that the one token that must differ does
      // not hide a real difference; the writer's default is ours.
      const ours = FormatBoard(board, 'pcbnew');
      if (ours !== theirs) expect.fail(firstDiff(ours, theirs));
    });
  }

  // The corpus is already in KiCad's order, so a missing sort would pass the
  // round-trip: the lists are reversed here and the output must not move.
  for (const f of boards) {
    it(`${f} is sorted by the C++ comparators, not by file order`, () => {
      const theirs = readFileSync(join(RESAVE, f), 'utf8');
      const board = parseBoard(theirs, f);
      board.Footprints().reverse();
      board.Drawings().reverse();
      board.Tracks().reverse();
      board.Zones().reverse();
      board.Groups().reverse();
      board.Generators().reverse();
      board.Points().reverse();
      for (const fp of board.Footprints()) {
        fp.Pads().reverse();
        fp.GraphicalItems().reverse();
        fp.Zones().reverse();
        fp.Groups().reverse();
      }
      const ours = FormatBoard(board, 'pcbnew');
      if (ours !== theirs) expect.fail(firstDiff(ours, theirs));
    });
  }

  it('writes our own generator name by default', () => {
    const theirs = readFileSync(join(RESAVE, boards[0]!), 'utf8');
    const ours = FormatBoard(parseBoard(theirs));
    expect(ours.split('\n')[2]).toBe(`\t(generator "${GENERATOR}")`);
    expect(GENERATOR).not.toBe('pcbnew');
  });

  it('numbers nets by first appearance, the unconnected net 0', () => {
    const theirs = readFileSync(join(RESAVE, 'blindvias_kicad_cli.kicad_pcb'), 'utf8');
    const board = parseBoard(theirs);
    expect(board.FindNet(0)!.GetNetname()).toBe('');
    const pads = board.Footprints()[0]!.Pads();
    const codes = new Set(pads.map((p) => p.GetNetCode()));
    expect(codes.has(0)).toBe(false);
    // The pad list names GND before SIG in the file.
    expect(board.FindNet(1)!.GetNetname()).toBe('GND');
  });

  it('reads footprint children into board coordinates, as the C++ does', () => {
    // ecc83-pp: C1 is a footprint at (141.605, 99.695) rotated 90°; its children
    // are stored footprint-relative in the file — the reference at (4.953,
    // -5.969) angle 90, the first fp_line (2.58,-5.08)→(2.58,5.08) — and turned
    // into board coordinates on read with RotatePoint + Move. Every number
    // below is what python pcbnew 10.0.5 reports for the same board
    // (GetPosition / GetTextAngle / GetDrawRotation / GetOrientation /
    // GetFPRelativePosition), not a re-derivation.
    const theirs = readFileSync(join(RESAVE, 'ecc83-pp.kicad_pcb'), 'utf8');
    const board = parseBoard(theirs);
    const fp = board.Footprints().find((f) => f.GetReference() === 'C1')!;
    expect(fp).toBeInstanceOf(FOOTPRINT);
    expect(fp.GetPosition()).toEqual({ x: 141605000, y: 99695000 });
    expect(fp.GetOrientation().AsDegrees()).toBe(90);

    const line = fp.GraphicalItems().find((d) => d instanceof PCB_SHAPE) as PCB_SHAPE;
    expect(line.GetShape()).toBe(SHAPE_T.SEGMENT);
    expect(line.GetStart()).toEqual({ x: 136525000, y: 97115000 });
    expect(line.GetEnd()).toEqual({ x: 146685000, y: 97115000 });

    const ref = fp.Reference();
    expect(ref).toBeInstanceOf(PCB_TEXT);
    expect(ref.GetPosition()).toEqual({ x: 135636000, y: 94742000 });
    // The file's angle is the footprint-relative one; the text keeps it.
    expect(ref.GetTextAngle().AsDegrees()).toBe(90);
    expect(ref.GetDrawRotation().AsDegrees()).toBe(90);

    const pad = fp.Pads()[0]!;
    expect(pad.GetNumber()).toBe('1');
    expect(pad.GetPosition()).toEqual({ x: 141605000, y: 99695000 });
    expect(pad.GetOrientation().AsDegrees()).toBe(90);
    expect(pad.GetFPRelativePosition()).toEqual({ x: 0, y: 0 });
  });

  it('a via is a PCB_VIA with its layer pair', () => {
    const theirs = readFileSync(join(RESAVE, 'blindvias_kicad_cli.kicad_pcb'), 'utf8');
    const board = parseBoard(theirs);
    const vias = board.Tracks().filter((t): t is PCB_VIA => t instanceof PCB_VIA);
    expect(vias.length).toBeGreaterThan(0);
    const blind = vias.find((v) => v.LayerPair()[1] !== PCB_LAYER_ID.B_Cu);
    expect(blind).toBeDefined();
  });
});
