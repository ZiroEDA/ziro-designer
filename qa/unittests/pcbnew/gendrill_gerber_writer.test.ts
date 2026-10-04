// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Gerber X2 drill files (GERBER_WRITER, `gendrill_gerber_writer.cpp`) against
 * KiCad's own: `qa/data/pcbnew/plot/drill_oracle/gerber*` is what `kicad-cli
 * pcb export drill --format gerber` (10.0.6) wrote. `gerber_oracle.kicad_pcb`
 * has through, blind and buried vias, round and oblong pad holes and an NPTH
 * hole; `gerber_oracle_ipc4761.kicad_pcb` is the same board with vias that
 * are tented, covered, plugged, capped and filled. Each board goes through
 * the writer as `PCBNEW_JOBS_HANDLER::JobExportDrill` sets it up, and every
 * file must match byte for byte, except the lines that name the program and
 * the clock.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GERBER_WRITER } from '@ziroeda/pcbnew/exporters/gendrill_gerber_writer.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const DIR = resolve(__dirname, '../../data/pcbnew/plot');

const IDENTITY = /^(%TF\.GenerationSoftware,|%TF\.CreationDate,|G04 Created by )/;

const normalise = (text: string): string =>
  text
    .split('\n')
    .map((line) => (IDENTITY.test(line) ? '<identity>' : line))
    .join('\n');

interface Job {
  board: string;
  precision: number;
  plotOrigin: boolean;
  tenting: boolean;
}

const JOBS: Record<string, Job> = {
  gerber: { board: 'gerber_oracle', precision: 6, plotOrigin: false, tenting: false },
  gerber_p5_plot: { board: 'gerber_oracle', precision: 5, plotOrigin: true, tenting: false },
  gerber_ipc: { board: 'gerber_oracle_ipc4761', precision: 6, plotOrigin: false, tenting: false },
  gerber_tenting: {
    board: 'gerber_oracle_ipc4761',
    precision: 6,
    plotOrigin: false,
    tenting: true,
  },
};

function run(aJob: Job): Map<string, string> {
  const board = ParseBoard(readFileSync(resolve(DIR, `${aJob.board}.kicad_pcb`), 'utf8'));
  board.SetFileName(`/oracle/${aJob.board}.kicad_pcb`);

  const writer = new GERBER_WRITER(board);
  const offset = aJob.plotOrigin ? board.GetDesignSettings().GetAuxOrigin() : { x: 0, y: 0 };

  writer.SetFormat(aJob.precision);
  writer.SetOptions(offset);
  writer.CreateDrillandMapFilesSet('out', true, false, aJob.tenting);

  const out = new Map<string, string>();

  for (const [path, bytes] of writer.GetWrittenFiles())
    out.set(path.replace(/^out\//, ''), new TextDecoder().decode(bytes));

  return out;
}

describe('Gerber drill files match kicad-cli byte for byte', () => {
  for (const [name, job] of Object.entries(JOBS)) {
    describe(name, () => {
      const expectedFiles = readdirSync(resolve(DIR, 'drill_oracle', name)).sort();
      const written = run(job);

      it('writes exactly the files kicad-cli wrote', () => {
        expect([...written.keys()].sort()).toEqual(expectedFiles);
      });

      for (const file of expectedFiles) {
        it(file, () => {
          const expected = readFileSync(resolve(DIR, 'drill_oracle', name, file), 'utf8');
          expect(normalise(written.get(file) ?? '<not written>')).toBe(normalise(expected));
        });
      }
    });
  }
});

describe('a span with no holes', () => {
  it('writes no file for it: a board without NPTH holes has no NPTH file', () => {
    const text = readFileSync(resolve(DIR, 'gerber_oracle.kicad_pcb'), 'utf8')
      .split('\n')
      .filter((l) => !l.includes('np_thru_hole'))
      .join('\n');
    const board = ParseBoard(text);
    board.SetFileName('/oracle/gerber_oracle.kicad_pcb');
    const writer = new GERBER_WRITER(board);
    writer.SetFormat(6);
    writer.SetOptions({ x: 0, y: 0 });
    writer.CreateDrillandMapFilesSet('out', true, false, false);

    const names = [...writer.GetWrittenFiles().keys()];
    expect(names).toContain('out/gerber_oracle-PTH-drl.gbr');
    expect(names.some((n) => n.includes('NPTH'))).toBe(false);
  });
});

describe('the report', () => {
  it('says what it created, and Done.', () => {
    const board = ParseBoard(readFileSync(resolve(DIR, 'gerber_oracle.kicad_pcb'), 'utf8'));
    board.SetFileName('/oracle/gerber_oracle.kicad_pcb');
    const writer = new GERBER_WRITER(board);
    const lines: string[] = [];
    const reporter = {
      report: (m: string) => lines.push(m),
      reportTail: (m: string) => lines.push(m),
    };

    writer.SetFormat(6);
    writer.SetOptions({ x: 0, y: 0 });
    writer.CreateDrillandMapFilesSet('out', true, false, false, reporter as never);

    expect(lines).toContain("Created file 'out/gerber_oracle-PTH-drl.gbr'.");
    expect(lines.at(-1)).toBe('Done.');
  });
});
