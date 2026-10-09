// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Every board in KiCad's own importer corpus (`qa/data/pcbnew/plugins` at the
 * pinned tag), imported by us and by `kicad-cli pcb import`, compared with the
 * oracle rules of pcb_io_oracle_support.ts.
 *
 * Opt-in (`PCBIO_SWEEP=1`): it needs the KiCad checkout and the kicad-cli
 * output that ~/scripts/pcbio_oracle_gen.sh writes to ~/pcbio_oracle, and it
 * takes minutes. It writes ~/pcbio_oracle/report.json - one row per board,
 * the plugin our PCB_IO_MGR picked and the first difference - which is the
 * parity table for the pcb_io folder. The per-format oracle tests are what CI
 * runs; a board that matches here belongs in one of them.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { PCB_FILE_T, PCB_IO_MGR } from '@ziroeda/pcbnew/pcb_io/pcb_io_mgr.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { firstDifference, normalizeBoard, stripRenderCache } from './pcb_io_oracle_support.js';

const CORPUS = join(homedir(), 'kicad-reference/qa/data/pcbnew/plugins');
const ORACLE = join(homedir(), 'pcbio_oracle');
const ENABLED = process.env.PCBIO_SWEEP === '1' && existsSync(join(ORACLE, 'status.txt'));

interface ROW {
  file: string;
  plugin: string;
  result: 'match' | 'match-but-outline-font' | 'differs' | 'not-detected' | 'threw';
  detail: string;
}

describe.skipIf(!ENABLED)('pcb_io corpus sweep against kicad-cli pcb import', () => {
  it('imports every board KiCad imports, and reports how each compares', async () => {
    const boards = readFileSync(join(ORACLE, 'status.txt'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('ok '))
      .map((l) => l.slice(3));
    const only = process.env.PCBIO_ONLY;
    const rows: ROW[] = [];
    // What PCB_EDIT_FRAME::importFile awaits before LoadBoard (pcbnew/files.ts).
    await EMBEDDED_FILES.InitCodec();

    for (const file of boards) {
      if (only && !file.includes(only)) continue;
      const abs = join(CORPUS, file);
      // Siblings resolve against the board's folder, as the plugins' own
      // relative reads do upstream.
      const reader = (aPath: string): Uint8Array | null => {
        const p = aPath.startsWith('/') ? aPath : join(dirname(abs), aPath);
        const q = existsSync(p) ? p : aPath === file ? abs : null;
        return q && existsSync(q) ? new Uint8Array(readFileSync(q)) : null;
      };
      const row: ROW = { file, plugin: '', result: 'threw', detail: '' };

      try {
        const type = await PCB_IO_MGR.FindPluginTypeFromBoardPath(abs, reader);
        row.plugin = PCB_IO_MGR.ShowType(type);

        if (type === PCB_FILE_T.FILE_TYPE_NONE) {
          row.result = 'not-detected';
        } else {
          const pi = (await PCB_IO_MGR.FindPlugin(type))!;
          pi.SetFileReader(reader);
          const board = pi.LoadBoard(abs, null);
          const ourText = FormatBoard(board, 'pcbnew');
          const theirText = readFileSync(join(ORACLE, `${file}.kicad_pcb`), 'utf8');
          const compare = (aMask: boolean): string =>
            firstDifference(
              stripRenderCache(normalizeBoard(ourText, { maskOutlineTextPos: aMask })),
              stripRenderCache(normalizeBoard(theirText, { maskOutlineTextPos: aMask })),
            );
          row.detail = compare(false).slice(0, 600);
          // An outline-font text is placed from the font's own metrics: a
          // board that matches once those positions are masked is the importer
          // matching, and the font engine (#154) differing - reported apart.
          row.result =
            row.detail === ''
              ? 'match'
              : compare(true) === ''
                ? 'match-but-outline-font'
                : 'differs';
        }
      } catch (e) {
        row.detail = String(e instanceof Error ? (e.stack ?? e.message) : e).slice(0, 600);
      }

      rows.push(row);
    }

    writeFileSync(
      join(ORACLE, only ? `report_${only.replace(/\W/g, '_')}.json` : 'report.json'),
      JSON.stringify(rows, null, 1),
    );
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
