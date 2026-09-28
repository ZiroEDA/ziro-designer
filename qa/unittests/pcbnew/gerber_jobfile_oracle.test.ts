// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Gerber job file against KiCad's own: `gerber_oracle/default/
 * gerber_oracle-job.gbrjob` is what `kicad-cli pcb export gerbers` (10.0.6)
 * wrote beside that set. GERBER_JOBFILE_WRITER is fed the same files in the
 * same order, as the job handler feeds it, and the JSON must match byte for
 * byte but for the GenerationSoftware block and the CreationDate.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LSET } from '@ziroeda/common/lset.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import {
  dumpJson,
  GERBER_JOBFILE_WRITER,
  JSON_DOUBLE,
} from '@ziroeda/pcbnew/exporters/gerber_jobfile_writer.js';

const DIR = resolve(__dirname, '../../data/pcbnew/plot');

const normalise = (aText: string): string =>
  aText
    .replace(/"GenerationSoftware": \{[^}]*\}/, '"GenerationSoftware": <identity>')
    .replace(/"CreationDate": "[^"]*"/, '"CreationDate": <date>');

describe('GERBER_JOBFILE_WRITER matches kicad-cli', () => {
  it('writes the .gbrjob kicad-cli wrote for the gerber oracle', () => {
    const expected = readFileSync(
      resolve(DIR, 'gerber_oracle/default/gerber_oracle-job.gbrjob'),
      'utf8',
    );
    const board = ParseBoard(readFileSync(resolve(DIR, 'gerber_oracle.kicad_pcb'), 'utf8'));
    board.SetFileName('/oracle/gerber_oracle.kicad_pcb');

    // The clearances come from the DRC engine (`GetOwnClearance`), which a loaded
    // board has; kicad-cli's loader initialises it the same way.
    const engine = new DRC_ENGINE(board, board.GetDesignSettings());
    engine.InitEngine(null);
    board.GetDesignSettings().m_DRCEngine = engine;

    const writer = new GERBER_JOBFILE_WRITER(board);

    // The files, in the order the job file lists them (the order they were plotted).
    for (const f of JSON.parse(expected).FilesAttributes as { Path: string }[]) {
      const name = f.Path.replace(/^gerber_oracle-/, '').replace(/\.[^.]+$/, '');
      const layer = LSET.NameToLayer(
        name.replace('Silkscreen', 'SilkS').replace('User_Drawings', 'Dwgs.User').replace('_', '.'),
      ) as PCB_LAYER_ID;
      writer.AddGbrFile(layer, f.Path);
    }

    // F.Courtyard was plotted too, and the writer drops it (`skip_file`).
    writer.AddGbrFile(LSET.NameToLayer('F.CrtYd') as PCB_LAYER_ID, 'gerber_oracle-F_Courtyard.gbr');

    expect(writer.CreateJobFile('out/gerber_oracle-job.gbrjob')).toBe(true);

    const written = writer.GetWrittenFile()!;
    expect(written.path).toBe('out/gerber_oracle-job.gbrjob');
    expect(normalise(new TextDecoder().decode(written.bytes))).toBe(normalise(expected));
  });

  it('prints a double the way nlohmann does', () => {
    expect(dumpJson({ a: new JSON_DOUBLE(2), b: 2, c: new JSON_DOUBLE(0.035), d: [] })).toBe(
      '{\n  "a": 2.0,\n  "b": 2,\n  "c": 0.035,\n  "d": []\n}',
    );
  });
});
