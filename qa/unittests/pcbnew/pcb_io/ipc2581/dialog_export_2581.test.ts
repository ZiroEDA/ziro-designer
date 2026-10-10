// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * DIALOG_EXPORT_2581::GenerateFile: the job's options reach the plugin (units, precision,
 * version), and Compress writes a zip whose one entry is `<name>.xml` holding the same document.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Reporter } from '@ziroeda/common/reporter.js';
import { wxZipInputStream } from '@ziroeda/common/wx/zipstrm.js';
import {
  IPC2581_UNITS,
  IPC2581_VERSION,
  JOB_EXPORT_PCB_IPC2581,
} from '@ziroeda/common/jobs/job_export_pcb_ipc2581.js';
import { GenerateFile } from '@ziroeda/pcbnew/dialogs/dialog_export_2581.js';
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

const strip = (s: string): string =>
  s.replace(/(origination|lastChange|datetime)="[^"]*"/g, '$1=""');

describe('DIALOG_EXPORT_2581::GenerateFile', () => {
  it('passes units, precision and version to the plugin', () => {
    const job = new JOB_EXPORT_PCB_IPC2581();
    job.m_filename = 'fab/out.xml';
    job.m_units = IPC2581_UNITS.INCH;
    job.m_precision = 4;
    job.m_version = IPC2581_VERSION.B;

    const out: [string, string][] = [];
    expect(
      GenerateFile(job, load(), new Reporter(), (p, b) =>
        out.push([p, new TextDecoder().decode(b)]),
      ),
    ).toBe(true);

    expect(out.map(([p]) => p)).toEqual(['fab/out.xml']);
    expect(out[0]![1]).toContain('revision="B"');
    expect(out[0]![1]).toContain('<CadHeader units="INCH">');
    // Four decimals: a coordinate never carries a fifth.
    expect(out[0]![1]).not.toMatch(/ x="-?\d+\.\d{5,}"/);
    expect(out[0]![1]).toMatch(/ x="-?\d+\.\d{3,4}"/);
  });

  it('Compress writes a zip of <name>.xml holding the same document', () => {
    const plain = new JOB_EXPORT_PCB_IPC2581();
    plain.m_filename = 'out.xml';
    let xml = '';
    GenerateFile(plain, load(), null, (_p, b) => {
      xml = new TextDecoder().decode(b);
    });

    const zipped = new JOB_EXPORT_PCB_IPC2581();
    zipped.m_filename = 'fab/out.zip';
    zipped.m_compress = true;
    let zipPath = '';
    let zip: Uint8Array = new Uint8Array();
    GenerateFile(zipped, load(), null, (p, b) => {
      zipPath = p;
      zip = b;
    });

    expect(zipPath).toBe('fab/out.zip');
    const stream = new wxZipInputStream(zip);
    const names: string[] = [];
    let inner = '';

    for (let e = stream.GetNextEntry(); e; e = stream.GetNextEntry()) {
      names.push(e.GetName());
      inner = new TextDecoder().decode(e.Read()!);
    }

    expect(names).toEqual(['out.xml']);
    expect(strip(inner)).toBe(strip(xml));
  });
});
