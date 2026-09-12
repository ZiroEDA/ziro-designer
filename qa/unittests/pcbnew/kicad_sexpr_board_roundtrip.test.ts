// The KiCad-exact board reader and writer (issue 635, stages 1-2): every
// board under qa/data/pcbnew/resave is what pcbnew 10.0.5 wrote for its own
// re-save (`~/kicad-oracle/resave/resave.py`, run twice: the first re-save
// of a 9.0 board renumbers the nets and is not yet a fixed point). Parsing
// one into the model and formatting the model back must give the same bytes,
// the `(generator …)` token aside — the file says pcbnew, and we do not.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GENERATOR } from '@ziroeda/common/src/generator.js';
import { FormatBoard } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { ParseBoard } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_board.js';

const RESAVE = fileURLToPath(new URL('../../data/pcbnew/resave/', import.meta.url));
const boards = readdirSync(RESAVE)
  .filter((f) => f.endsWith('.kicad_pcb'))
  .sort();

/** The first line differing, for a readable failure. */
function firstDiff(a: string, b: string): string {
  const la = a.split('\n');
  const lb = b.split('\n');
  let i = 0;
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
  return `line ${i + 1}:\n  ours   ${JSON.stringify(la.slice(i, i + 3).join('\n'))}\n  theirs ${JSON.stringify(lb.slice(i, i + 3).join('\n'))}`;
}

describe('PCB_IO_KICAD_SEXPR parse + format is KiCad’s own re-save', () => {
  it('has the oracle corpus', () => {
    expect(boards.length).toBeGreaterThanOrEqual(14);
  });

  for (const f of boards) {
    it(`${f} round-trips byte for byte`, () => {
      const theirs = readFileSync(join(RESAVE, f), 'utf8');
      const board = ParseBoard(theirs, f);
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
      const board = ParseBoard(theirs, f);
      board.footprints.reverse();
      board.drawings.reverse();
      board.tracks.reverse();
      board.zones.reverse();
      board.groups.reverse();
      board.generators.reverse();
      board.points.reverse();
      for (const fp of board.footprints) {
        fp.pads.reverse();
        fp.graphicalItems.reverse();
        fp.zones.reverse();
        fp.groups.reverse();
      }
      const ours = FormatBoard(board, 'pcbnew');
      if (ours !== theirs) expect.fail(firstDiff(ours, theirs));
    });
  }

  it('writes our own generator name by default', () => {
    const theirs = readFileSync(join(RESAVE, boards[0]!), 'utf8');
    const ours = FormatBoard(ParseBoard(theirs));
    expect(ours.split('\n')[2]).toBe(`\t(generator "${GENERATOR}")`);
    expect(GENERATOR).not.toBe('pcbnew');
  });

  it('numbers nets by first appearance, the unconnected net 0', () => {
    const theirs = readFileSync(join(RESAVE, 'blindvias_kicad_cli.kicad_pcb'), 'utf8');
    const board = ParseBoard(theirs);
    expect(board.netNames.get(0)).toBe('');
    const pads = board.footprints[0]!.pads;
    const codes = new Set(pads.map((p) => p.net?.code ?? 0));
    expect(codes.has(0)).toBe(false);
    // The pad list names GND before SIG in the file.
    expect(board.netNames.get(1)).toBe('GND');
  });
});
