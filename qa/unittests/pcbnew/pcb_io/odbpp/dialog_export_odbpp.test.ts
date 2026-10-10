// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * DIALOG_EXPORT_ODBPP: OnFmtChoiceOptionChanged's names, and GenerateODBPPFiles' three packagings
 * - a zip of the tree (folders and files), a gzipped tar rooted at "odb/", and the files themselves
 * under the output folder - plus the Overwrite question an existing output gets.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { JOB_EXPORT_PCB_ODB, ODB_COMPRESSION } from '@ziroeda/common/jobs/job_export_pcb_odb.js';
import { wxZipInputStream } from '@ziroeda/common/wx/zipstrm.js';
import {
  GenerateODBPPFiles,
  OnFmtChoiceOptionChanged,
} from '@ziroeda/pcbnew/dialogs/dialog_export_odbpp.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const BOARD = new URL(
  '../../../../data/pcbnew/resave/blindvias_kicad_cli.kicad_pcb',
  import.meta.url,
).pathname;

function load() {
  const b = ParseBoard(readFileSync(BOARD, 'utf8'));
  b.SetFileName(BOARD);
  return b;
}

function job(aPath: string, aMode: ODB_COMPRESSION): JOB_EXPORT_PCB_ODB {
  const j = new JOB_EXPORT_PCB_ODB();
  j.m_outputPath = aPath;
  j.m_compressionMode = aMode;
  j.m_precision = 2;
  return j;
}

async function run(aJob: JOB_EXPORT_PCB_ODB, aExists = false, aAnswer = true) {
  const written = new Map<string, Uint8Array>();
  const asked: string[] = [];
  await GenerateODBPPFiles(
    aJob,
    load(),
    {
      fileExists: () => aExists,
      confirmOverwrite: async (m) => {
        asked.push(m);
        return aAnswer;
      },
      write: (p, b) => written.set(p, b),
    },
    null,
  );
  return { written, asked };
}

/** A ustar archive's entry names. */
function tarNames(aTar: Uint8Array): string[] {
  const names: string[] = [];
  const dec = new TextDecoder();

  for (let at = 0; at + 512 <= aTar.length; ) {
    const h = aTar.subarray(at, at + 512);

    if (h.every((b) => b === 0)) break;

    const field = (o: number, n: number): string =>
      dec.decode(h.subarray(o, o + n)).replace(/\0.*$/s, '');
    const prefix = field(345, 155);
    const name = field(0, 100);
    names.push(prefix ? `${prefix}/${name}` : name);
    const size = Number.parseInt(field(124, 12), 8);
    at += 512 + Math.ceil(size / 512) * 512;
  }

  return names;
}

describe('DIALOG_EXPORT_ODBPP', () => {
  it('OnFmtChoiceOptionChanged keeps the stem and takes the format', () => {
    expect(OnFmtChoiceOptionChanged('fab/board-odb.zip', ODB_COMPRESSION.TGZ)).toBe(
      'fab/board-odb.tgz',
    );
    expect(OnFmtChoiceOptionChanged('fab/board-odb.tgz', ODB_COMPRESSION.ZIP)).toBe(
      'fab/board-odb.zip',
    );
    expect(OnFmtChoiceOptionChanged('fab/board-odb.zip', ODB_COMPRESSION.NONE)).toBe(
      'fab/board-odb/',
    );
    expect(OnFmtChoiceOptionChanged('fab/board-odb/', ODB_COMPRESSION.ZIP)).toBe(
      'fab/board-odb.zip',
    );
  });

  it('ZIP writes one archive of every folder and file', async () => {
    const { written } = await run(job('fab/out.zip', ODB_COMPRESSION.ZIP));
    expect([...written.keys()]).toEqual(['fab/out.zip']);

    const names: string[] = [];
    const zip = new wxZipInputStream(written.get('fab/out.zip')!);

    for (let e = zip.GetNextEntry(); e; e = zip.GetNextEntry()) names.push(e.GetName());

    expect(names).toContain('wheels/');
    expect(names).toContain('matrix/matrix');
    expect(names).toContain('steps/pcb/eda/data');
  });

  it('TGZ writes a gzipped tar rooted at odb/', async () => {
    const { written } = await run(job('out.tgz', ODB_COMPRESSION.TGZ));
    const names = tarNames(gunzipSync(written.get('out.tgz')!));

    expect(names).toContain('odb/wheels/');
    expect(names).toContain('odb/matrix/matrix');
    expect(names.every((n) => n.startsWith('odb/'))).toBe(true);
  });

  it('None writes the files under the output folder', async () => {
    const { written } = await run(job('fab/odb/', ODB_COMPRESSION.NONE));

    expect(written.has('fab/odb/matrix/matrix')).toBe(true);
    expect(written.has('fab/odb/fonts/standard')).toBe(true);
    expect([...written.keys()].every((p) => p.startsWith('fab/odb/'))).toBe(true);
  });

  it('an existing output is replaced only after Overwrite', async () => {
    const refused = await run(job('out.zip', ODB_COMPRESSION.ZIP), true, false);
    expect(refused.asked).toEqual([
      "Output files 'out.zip' already exists. Do you want to overwrite it?",
    ]);
    expect(refused.written.size).toBe(0);

    const accepted = await run(job('out.zip', ODB_COMPRESSION.ZIP), true, true);
    expect(accepted.written.size).toBe(1);
  });
});
