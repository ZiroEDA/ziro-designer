// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The Allegro binary parser (convert/allegro_parser.ts), phase 1 of
 * `PCB_IO_ALLEGRO::LoadBoardFromData`, against the reference dumps KiCad
 * ships beside its importer corpus (`qa/data/pcbnew/plugins/allegro/expected`
 * at 10.0.6): the format version, the units divisor, the string and object
 * counts, every block type's count, and the head/tail of three header lists.
 *
 * A parser that mis-sizes one block desyncs every block after it, so the
 * per-type counts are the sharp check - one wrong field width moves them all.
 * The dumps' `units.type` is left out: all five say "metric" across divisors of
 * 1, 10, 1000 and 10000, so it is not the header's units byte.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PARSER } from '@ziroeda/pcbnew/pcb_io/allegro/convert/allegro_parser.js';
import { FMT_VER } from '@ziroeda/pcbnew/pcb_io/allegro/convert/allegro_pcb_structs.js';
import { FILE_STREAM } from '@ziroeda/pcbnew/pcb_io/allegro/convert/allegro_stream.js';

const DATA = fileURLToPath(
  new URL('../../../../data/pcbnew/pcb_io_oracle/allegro/', import.meta.url),
);

interface EXPECTED {
  file: string;
  version: { magic: string; version_string: string };
  units: { divisor: number };
  counts: { strings: number; objects: number };
  object_types: Record<string, number>;
  linked_lists: Record<string, { head: string; tail: string }>;
}

const boards = readdirSync(DATA)
  .filter((f) => f.endsWith('_allegro.json'))
  .map((f) => JSON.parse(readFileSync(`${DATA}${f}`, 'utf8')) as EXPECTED);

const parse = (aName: string) => {
  const bytes = new Uint8Array(gunzipSync(readFileSync(`${DATA}${aName}.gz`)));
  return new PARSER(new FILE_STREAM(bytes), null).Parse();
};

const hex = (v: number) => `0x${v.toString(16)}`;

describe('Allegro PARSER against KiCad 10.0.6 reference dumps', () => {
  it('has the five boards', () => {
    expect(boards.map((b) => b.file).sort()).toEqual([
      'ProiectBoard.brd',
      'TRS80_POWER.brd',
      'led_youtube.brd',
      'mainBoard.brd',
      'mainBoard2.brd',
    ]);
  });

  for (const want of boards) {
    it(`reads ${want.file} block for block`, () => {
      const db = parse(want.file);

      expect(hex(db.m_Header!.m_Magic)).toBe(want.version.magic);
      expect(`V${want.version.version_string.slice(1)}`).toBe(`V${FMT_VER[db.m_FmtVer].slice(2)}`);
      expect(db.m_Header!.m_UnitsDivisor).toBe(want.units.divisor);

      expect(db.m_StringTable.size).toBe(want.counts.strings);
      // The dump's object count is the header's m_ObjectCount, which upstream
      // calls "very close" to the number parsed, not equal to it; the blocks
      // themselves are the per-type table's total.
      expect(db.m_Header!.m_ObjectCount).toBe(want.counts.objects);
      expect(db.m_Blocks.length).toBe(Object.values(want.object_types).reduce((a, b) => a + b, 0));

      // "0x15_SEGMENT_H": 77 -> block type 0x15
      const got = new Map<number, number>();
      for (const b of db.m_Blocks) got.set(b.GetBlockType(), (got.get(b.GetBlockType()) ?? 0) + 1);
      const wantTypes = new Map(
        Object.entries(want.object_types).map(([k, n]) => [Number.parseInt(k.slice(0, 4), 16), n]),
      );
      expect(Object.fromEntries([...got].sort(([a], [b]) => a - b))).toEqual(
        Object.fromEntries([...wantTypes].sort(([a], [b]) => a - b)),
      );

      const h = db.m_Header!;
      const lists = {
        nets_0x1B: h.m_LL_0x1B_Nets,
        footprints_0x2B: h.m_LL_0x2B,
        fonts_0x36: h.m_LL_0x36,
      } as const;
      for (const [name, ll] of Object.entries(want.linked_lists)) {
        const ours = lists[name as keyof typeof lists];
        expect({ head: hex(ours.m_Head), tail: hex(ours.m_Tail) }, name).toEqual(ll);
      }
    });
  }
});
