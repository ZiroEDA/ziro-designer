// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Excellon drill files, the drill report and the Gerber drill maps against
 * KiCad's own: `qa/data/pcbnew/plot/drill_oracle/` is what `kicad-cli pcb
 * export drill` (10.0.6) wrote for `gerber_oracle.kicad_pcb` (through vias, a
 * blind and a buried via, round and oblong pad holes, an NPTH hole). The same
 * board goes through EXCELLON_WRITER, set up as
 * `PCBNEW_JOBS_HANDLER::JobExportDrill` sets it up, and every file must match
 * byte for byte, except the lines that name the program and the clock.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/read_board.js';
import { EXCELLON_WRITER } from '@ziroeda/pcbnew/exporters/gendrill_excellon_writer.js';
import { DRILL_PRECISION, ZEROS_FMT } from '@ziroeda/pcbnew/exporters/gendrill_writer_base.js';

const DIR = resolve(__dirname, '../../data/pcbnew/plot');

const IDENTITY =
  /^(; DRILL file |; #@! TF\.CreationDate,|; #@! TF\.GenerationSoftware,|Created on |%TF\.GenerationSoftware,|%TF\.CreationDate,|G04 Created by )/;

const normalise = (text: string): string =>
  text
    .split('\n')
    .map((line) => (IDENTITY.test(line) ? '<identity>' : line))
    .join('\n');

interface Job {
  metric: boolean;
  zeros: ZEROS_FMT;
  mirror: boolean;
  minimalHeader: boolean;
  plotOrigin: boolean;
  merge: boolean;
  route: boolean;
  map: boolean;
  report: boolean;
}

const JOBS: Record<string, Partial<Job>> = {
  default: { report: true },
  separate: { merge: false },
  inch_lz: { metric: false, zeros: ZEROS_FMT.SUPPRESS_LEADING },
  keep: { zeros: ZEROS_FMT.KEEP_ZEROS },
  mirror_route: { mirror: true, minimalHeader: true, route: true },
  plotorigin: { plotOrigin: true, zeros: ZEROS_FMT.SUPPRESS_TRAILING },
  map: { map: true, merge: false },
};

function run(aJob: Partial<Job>): Map<string, string> {
  const job: Job = {
    metric: true,
    zeros: ZEROS_FMT.DECIMAL_FORMAT,
    mirror: false,
    minimalHeader: false,
    plotOrigin: false,
    merge: true, // m_excellonCombinePTHNPTH defaults to true
    route: false, // --excellon-oval-format alternate
    map: false,
    report: false,
    ...aJob,
  };
  const board = ParseBoard(readFileSync(resolve(DIR, 'gerber_oracle.kicad_pcb'), 'utf8'));
  board.SetFileName('/oracle/gerber_oracle.kicad_pcb');

  const writer = new EXCELLON_WRITER(board);
  // dialog_gendrill.cpp's precisionListForInches / precisionListForMetric
  const precision = job.metric ? new DRILL_PRECISION(3, 3) : new DRILL_PRECISION(2, 4);
  const offset = job.plotOrigin ? board.GetDesignSettings().GetAuxOrigin() : { x: 0, y: 0 };

  writer.SetFormat(job.metric, job.zeros, precision.m_Lhs, precision.m_Rhs);
  writer.SetOptions(job.mirror, job.minimalHeader, offset, job.merge);
  writer.SetRouteModeForOvalHoles(job.route);
  writer.SetMapFileFormat(PLOT_FORMAT.GERBER);
  writer.CreateDrillandMapFilesSet('out', true, job.map);

  if (job.report) writer.GenDrillReportFile('out/gerber_oracle-drl.rpt');

  const out = new Map<string, string>();

  for (const [path, bytes] of writer.GetWrittenFiles())
    out.set(path.replace(/^out\//, ''), new TextDecoder().decode(bytes));

  return out;
}

describe('drill files match kicad-cli byte for byte', () => {
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

describe('a blind span ending on B.Cu (10.0.5 source; not in the 10.0.6 oracle)', () => {
  // kicad-cli 10.0.6 names this file "-in2-back"; the 10.0.5 source this port
  // follows orders a DRILL_SPAN by raw layer id, where B_Cu (2) < In2_Cu (6),
  // so Pair() is (B_Cu, In2_Cu) and the name is "-back-in2". The FileFunction
  // layers are sorted top-to-bottom either way: 3,4.
  const BLIND = readFileSync(resolve(DIR, 'gerber_oracle.kicad_pcb'), 'utf8').replace(
    '  (zone (net 1)',
    '  (via blind (at 70 42) (size 0.6) (drill 0.3) (layers "In2.Cu" "B.Cu") (net 1) (uuid "a1b2c3d4-0000-4000-8000-000000000914"))\n  (zone (net 1)',
  );

  it('writes the span with its layers top to bottom', () => {
    const board = ParseBoard(BLIND);
    board.SetFileName('/oracle/gerber_oracle.kicad_pcb');
    const writer = new EXCELLON_WRITER(board);
    writer.SetFormat(true, ZEROS_FMT.DECIMAL_FORMAT, 3, 3);
    writer.SetOptions(false, false, { x: 0, y: 0 }, true);
    writer.CreateDrillandMapFilesSet('', true, false);

    const text = new TextDecoder().decode(
      writer.GetWrittenFiles().get('gerber_oracle-back-in2.drl'),
    );
    expect(text).toContain('; #@! TF.FileFunction,Plated,3,4,Blind\n');
    expect(text).toContain('T1C0.300\n%\nG90\nG05\nT1\nX70.0Y-42.0\nM30\n');
  });
});
