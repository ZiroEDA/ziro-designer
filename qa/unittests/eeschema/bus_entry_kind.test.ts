// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A bus-to-bus stub is a bus segment, not a bus entry — counterpart
 * SCH_IO_KICAD_SEXPR::saveBusEntry, which converts one on the way out, and
 * parseBusEntry, which can never read one back.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  makeBusEntryOrSegment,
  isBusToBus,
  busEntryEnd,
} from '@ziroeda/eeschema/src/tools/bus_entry_kind.js';
import { addItems } from '@ziroeda/eeschema/src/tools/mutate.js';
import { mmToIU, iuToMM } from '@ziroeda/common/src/eda_units.js';
import type { Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const at = (xmm: number, ymm: number): Vec2 => ({ x: mmToIU(xmm), y: mmToIU(ymm) });
const seg = (kind: string, uuid: string, a: Vec2, b: Vec2): string =>
  `(${kind} (pts (xy ${iuToMM(a.x)} ${iuToMM(a.y)}) (xy ${iuToMM(b.x)} ${iuToMM(b.y)}))
     (stroke (width 0) (type default)) (uuid "${uuid}"))`;

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** A 2.54 mm 45-degree stub, the tool's default. */
const SIZE = { x: mmToIU(2.54), y: mmToIU(2.54) };

describe('the far end of a stub', () => {
  it('is the anchor plus the size, signs and all', () => {
    expect(busEntryEnd(at(10, 10), { x: mmToIU(2.54), y: -mmToIU(2.54) })).toEqual(at(12.54, 7.46));
  });
});

describe('deciding what a stub is', () => {
  it('is bus-to-bus when a bus runs under both ends', () => {
    const d = sheet(
      [seg('bus', 'b1', at(0, 10), at(40, 10)), seg('bus', 'b2', at(0, 12.54), at(40, 12.54))].join(
        '\n',
      ),
    );
    expect(isBusToBus(d, undefined, at(10, 10), SIZE)).toBe(true);
  });

  it('is an ordinary entry when only the anchor is on a bus', () => {
    const d = sheet(seg('bus', 'b1', at(0, 10), at(40, 10)));
    expect(isBusToBus(d, undefined, at(10, 10), SIZE)).toBe(false);
  });

  it('is an ordinary entry when the far end lands on a *wire*, not a bus', () => {
    const d = sheet(
      [
        seg('bus', 'b1', at(0, 10), at(40, 10)),
        seg('wire', 'w1', at(0, 12.54), at(40, 12.54)),
      ].join('\n'),
    );
    expect(isBusToBus(d, undefined, at(10, 10), SIZE)).toBe(false);
  });

  it('is an ordinary entry on an empty sheet', () => {
    expect(isBusToBus(sheet(''), undefined, at(10, 10), SIZE)).toBe(false);
  });
});

describe('what gets built', () => {
  const twoBuses = (): Schematic =>
    sheet(
      [seg('bus', 'b1', at(0, 10), at(40, 10)), seg('bus', 'b2', at(0, 12.54), at(40, 12.54))].join(
        '\n',
      ),
    );

  it('bus-to-bus builds a bus line spanning the stub', () => {
    const d = twoBuses();
    const batch = makeBusEntryOrSegment(d, undefined, at(10, 10), SIZE);
    expect(batch.busEntries).toBeUndefined();
    expect(batch.lines).toHaveLength(1);
    expect(batch.lines![0]!.kind).toBe('bus');
    expect(batch.lines![0]!.start).toEqual(at(10, 10));
    expect(batch.lines![0]!.end).toEqual(at(12.54, 12.54));
  });

  it('wire-to-bus still builds a real entry', () => {
    const d = sheet(seg('bus', 'b1', at(0, 10), at(40, 10)));
    const batch = makeBusEntryOrSegment(d, undefined, at(10, 10), SIZE);
    expect(batch.lines).toBeUndefined();
    expect(batch.busEntries).toHaveLength(1);
    expect(batch.busEntries![0]!.at).toEqual(at(10, 10));
    expect(batch.busEntries![0]!.size).toEqual(SIZE);
  });

  it('a bus-to-bus stub serializes as (bus …), never (bus_entry …)', () => {
    const d = twoBuses();
    const after = addItems(makeBusEntryOrSegment(d, undefined, at(10, 10), SIZE)).apply(d);
    const text = serializeSchematic(after);
    // Three bus segments now: the two rails and the stub.
    expect(text.match(/\(bus\s/g) ?? []).toHaveLength(3);
    expect(text).not.toContain('(bus_entry');
  });

  it('a wire-to-bus stub does serialize as (bus_entry …)', () => {
    const d = sheet(seg('bus', 'b1', at(0, 10), at(40, 10)));
    const after = addItems(makeBusEntryOrSegment(d, undefined, at(10, 10), SIZE)).apply(d);
    expect(serializeSchematic(after)).toContain('(bus_entry');
  });

  it('the built stub survives a round trip as the same thing', () => {
    const d = twoBuses();
    const after = addItems(makeBusEntryOrSegment(d, undefined, at(10, 10), SIZE)).apply(d);
    const reloaded = readSchematic(parse(serializeSchematic(after)));
    expect(reloaded.busEntries).toHaveLength(0);
    expect(reloaded.lines.filter((l) => l.kind === 'bus')).toHaveLength(3);
  });
});
