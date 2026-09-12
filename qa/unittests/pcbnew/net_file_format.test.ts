// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two spellings of a net in a `.kicad_pcb`, either side of
 * `SEXPR_BOARD_FILE_VERSION` **20251028** — "Stop writing netcodes; they're an
 * internal implementation detail".
 *
 * Below it a connected item carries a net **code**, `(net 5)`, resolved against
 * the board's `(net <code> "<name>")` declaration table. From it KiCad writes
 * the **name**, `(net "GND")`, and writes no declaration table at all —
 * `PCB_IO_KICAD_SEXPR::format` at :1117/:1857/:2857/:2871.
 *
 * `PCB_IO_KICAD_SEXPR_PARSER::parseNet` reads both at any version, so reading
 * only the number drops the net on every board KiCad 10 has saved. Writing only
 * the number into a 10.0 file is the same loss from the other side: the code
 * names a net nothing declares, and loads back unconnected.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { head, isList, type SList, type SNode } from '@ziroeda/sexpr/src/types.js';
import { arg, numArg } from '@ziroeda/sexpr/src/query.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { applyPadValues, collectPadValues, padAt } from '@ziroeda/pcbnew/src/pad_properties.js';
import {
  applyTrackViaValues,
  collectTrackViaValues,
  trackViaSelection,
} from '@ziroeda/pcbnew/src/track_via_properties.js';
import { ORPHANED_NET } from '@ziroeda/pcbnew/src/netinfo.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import { U } from './support/written_node.js';

const load = (text: string): Board => readBoard(parse(text));

/** A board with one of everything that carries a net, at `version`. */
function src(version: number, decls: string, netOf: (name: string) => string): string {
  return `(kicad_pcb (version ${version}) (generator "pcbnew") (generator_version "10.0")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (44 "Edge.Cuts" user))
${decls}  (footprint "R" (layer "F.Cu") (uuid "${U('f1')}") (at 0 0)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") ${netOf('GND')} (uuid "${U('p1')}"))
    (pad "2" smd rect (at 2 0) (size 1 1) (layers "F.Cu") ${netOf('VCC')} (uuid "${U('p2')}")))
  (gr_line (start 0 5) (end 5 5) (stroke (width 0.1) (type solid)) (layer "F.Cu") ${netOf('GND')} (uuid "${U('g1')}"))
  (segment (start 0 0) (end 5 0) (width 0.2) (layer "F.Cu") ${netOf('GND')} (uuid "${U('t1')}"))
  (segment (start 0 1) (end 5 1) (width 0.2) (layer "F.Cu") ${netOf('VCC')} (uuid "${U('t2')}"))
  (arc (start 0 2) (mid 1 2.5) (end 2 2) (width 0.2) (layer "F.Cu") ${netOf('GND')} (uuid "${U('a1')}"))
  (via (at 3 3) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") ${netOf('VCC')} (uuid "${U('v1')}"))
  (zone ${netOf('GND')} (layer "F.Cu") (uuid "${U('z1')}") (hatch edge 0.5)
    (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))
)`;
}

const LEGACY_DECLS = '  (net 0 "")\n  (net 1 "GND")\n  (net 2 "VCC")\n';

/** A pre-20251028 file: a declaration table, and codes on the items. */
const legacy = (): string =>
  src(20241229, LEGACY_DECLS, (n) => (n === 'GND' ? '(net 1 "GND")' : '(net 2 "VCC")')).replace(
    // Only a pad carries the `(net <code> "<name>")` pair; everything else is
    // the bare code.
    /\((segment|arc|via|zone|gr_line)([\s\S]*?)\(net (\d) "(\w+)"\)/g,
    (_m, kind, mid, code) => `(${kind}${mid}(net ${code})`,
  );

/** A 20251028-or-later file: names on the items, and no declaration table. */
const modern = (): string => src(20260206, '', (n) => `(net "${n}")`);

const netsOf = (b: Board): Record<string, number> => ({
  padGND: b.footprints[0]!.pads[0]!.net ?? 0,
  padVCC: b.footprints[0]!.pads[1]!.net ?? 0,
  shape: b.shapes.find((s) => s.uuid === U('g1'))!.net ?? 0,
  trackGND: b.tracks[0]!.net,
  trackVCC: b.tracks[1]!.net,
  arc: b.arcs[0]!.net,
  via: b.vias[0]!.net,
  zone: b.zones[0]!.net,
});

// -----------------------------------------------------------------------------
// reading
// -----------------------------------------------------------------------------

describe('reading', () => {
  it('reads the two spellings to the same board', () => {
    // The whole point: a 10.0 file and its pre-10.0 equivalent describe one
    // board, so every item lands on the same net either way.
    const want = {
      padGND: 1,
      padVCC: 2,
      shape: 1,
      trackGND: 1,
      trackVCC: 2,
      arc: 1,
      via: 2,
      zone: 1,
    };
    expect(netsOf(load(legacy()))).toEqual(want);
    expect(netsOf(load(modern()))).toEqual(want);
  });

  it('builds the whole table from the names when nothing declares it', () => {
    // `FindNet` misses, so `parseNet` news up a NETINFO_ITEM and adds it to the
    // board. NETINFO_LIST's own constructor holds the unconnected net, and
    // getFreeNetCode hands out 1, 2, … in the order the names first appear.
    expect([...load(modern()).nets]).toEqual([
      [0, ''],
      [1, 'GND'],
      [2, 'VCC'],
    ]);
  });

  it('holds the unconnected net on a file that never mentions one', () => {
    const b = load('(kicad_pcb (version 20260206) (generator "pcbnew"))');
    expect(b.nets.get(0)).toBe('');
  });

  it('gives every item naming one net the same code', () => {
    // Two shapes naming the same net must land on the same one — the reason
    // upstream *adds* the created net rather than resolving each reference on
    // its own.
    const b = load(modern());
    expect(b.tracks[0]!.net).toBe(b.zones[0]!.net);
    expect(b.vias[0]!.net).toBe(b.tracks[1]!.net);
  });

  it('leaves a legacy netcode the table never declared with no net at all', () => {
    // "Legacy files (pre-10.0) will have a netcode instead of a netname. This
    // netcode is authoratative." — `SetNetCode( 7 )` asks `board->FindNet( 7 )`,
    // which misses, so `m_netinfo` is null and `GetNetCode()` is -1
    // (board_connected_item.cpp:100-101, :117). No name is invented.
    const b = load(
      `(kicad_pcb (version 20241229) (net 0 "") (net 1 "GND")
         (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net 7)))`,
    );
    expect(b.tracks[0]!.net).toBe(ORPHANED_NET);
  });

  it('orphans a pad whose code and name disagree', () => {
    // `if( netName != m_board->FindNet( pad->GetNetCode() )->GetNetname() )` →
    // `SetNetCode( NETINFO_LIST::ORPHANED )`. Neither half of a contradiction is
    // trusted, so the pad joins nothing.
    const pad = (net: string): number =>
      load(`(kicad_pcb (version 20241229) (net 0 "") (net 1 "GND") (net 2 "VCC")
        (footprint "R" (layer "F.Cu") (at 0 0)
          (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") ${net})))`).footprints[0]!.pads[0]!
        .net ?? 0;

    expect(pad('(net 1 "GND")')).toBe(1);
    expect(pad('(net 1 "VCC")')).toBe(ORPHANED_NET);
  });
});

// -----------------------------------------------------------------------------
// writing
// -----------------------------------------------------------------------------

/** Every `(net …)` in the file, as its raw arguments. */
function netTokens(text: string): string[] {
  const out: string[] = [];
  const walk = (n: SNode): void => {
    if (!isList(n)) return;
    if (head(n) === 'net') {
      const code = numArg(n, 0);
      const name = arg(n, code !== undefined ? 1 : 0);
      out.push(
        [code, name === undefined ? undefined : `"${name}"`]
          .filter((x) => x !== undefined)
          .join(' '),
      );
    }
    for (const it of (n as SList).items) walk(it);
  };
  walk(parse(text));
  return out;
}

const hasNetName = (text: string): boolean => /\(net_name /.test(text);

describe('writing', () => {
  it('writes a legacy file at the current version, names and no table', () => {
    // `PCB_IO_KICAD_SEXPR::SaveBoard` always writes SEXPR_BOARD_FILE_VERSION;
    // a pre-10.0 file is re-saved in the 10.0 spelling.
    const b = load(legacy());
    const out = serializeBoard(b);
    expect(out).toContain('(version 20260206)');
    expect(netTokens(out).every((t) => /^"/.test(t))).toBe(true);
    expect(hasNetName(out)).toBe(false);
  });

  it('writes names into a 20251028 file, and no net_name', () => {
    // `format( const PCB_TRACK* )`: `(net %s)` with `Quotew( GetNetname() )`,
    // and `format( const ZONE* )` has no `(net_name …)` left to write.
    const b = load(modern());
    const out = serializeBoard({
      ...b,
      tracks: b.tracks.map((t) => ({ ...t })),
      vias: b.vias.map((v) => ({ ...v })),
      arcs: b.arcs.map((a) => ({ ...a })),
      zones: b.zones.map((z) => ({ ...z })),
    });
    expect(netTokens(out).every((t) => /^"/.test(t))).toBe(true);
    expect(netTokens(out)).toContain('"GND"');
    expect(hasNetName(out)).toBe(false);
  });

  it('omits a 20251028 zone net when there is none to write', () => {
    // `aZone->IsOnCopperLayer() && !aZone->GetIsRuleArea() && GetNetCode() > 0`.
    const b = load(modern());
    const out = serializeBoard({
      ...b,
      tracks: [],
      arcs: [],
      vias: [],
      shapes: [],
      footprints: [],
      zones: [{ ...b.zones[0]!, net: 0 }],
    });
    expect(netTokens(out)).toEqual([]);
  });

  it('round-trips a 20251028 board through our own writer with its nets', () => {
    // The integration guard: a board KiCad 10 saved, opened, edited and saved
    // again must still be the same netlist. A numeric net written into a file
    // with no declaration table is a silent rewire.
    const b = load(modern());
    const again = load(serializeBoard(b));
    expect(netsOf(again)).toEqual(netsOf(b));
  });
});

// -----------------------------------------------------------------------------
// the property patchers
// -----------------------------------------------------------------------------

/** The `(net …)` of the first `(pad …)` / `(segment …)` in the file, verbatim. */
function itemNet(text: string, kind: 'pad' | 'segment'): string {
  let found: string | null = null;
  const walk = (n: SNode): void => {
    if (found !== null || !isList(n)) return;
    if (head(n) === kind) {
      for (const it of n.items)
        if (isList(it) && head(it) === 'net') {
          const code = numArg(it, 0);
          const name = arg(it, code !== undefined ? 1 : 0);
          found = [code, name === undefined ? undefined : `"${name}"`]
            .filter((x) => x !== undefined)
            .join(' ');
          return;
        }
      return;
    }
    for (const it of n.items) walk(it);
  };
  walk(parse(text));
  if (found === null) throw new Error(`no (net …) on a ${kind}`);
  return found;
}

describe("changing an item's net", () => {
  const setTrackNet = (b: Board, net: number): string => {
    const sel = trackViaSelection(b, ['track:0']);
    return serializeBoard(applyTrackViaValues(b, sel, { ...collectTrackViaValues(sel), net }));
  };

  const setPadNet = (b: Board, net: number): string => {
    const ref = padAt(b, ['pad:0:0'])!;
    const pad = b.footprints[ref.footprint]!.pads[ref.pad]!;
    return serializeBoard(applyPadValues(b, ref, { ...collectPadValues(pad), net }));
  };

  it('writes a pad net with its name, which the parser insists on', () => {
    // `if( !IsSymbol( token ) ) Expecting( "net name" )` — a pad written as the
    // bare code is a file KiCad refuses to open. Read off the pad itself.
    expect(itemNet(setPadNet(load(legacy()), 2), 'pad')).toBe('"VCC"');
  });

  it('writes the 20251028 pad net as the name alone', () => {
    expect(itemNet(setPadNet(load(modern()), 2), 'pad')).toBe('"VCC"');
  });

  it('writes a track net as the name whatever the file was', () => {
    expect(itemNet(setTrackNet(load(legacy()), 2), 'segment')).toBe('"VCC"');
    expect(itemNet(setTrackNet(load(modern()), 2), 'segment')).toBe('"VCC"');
  });

  it('leaves the patched item loading back on the net it was given', () => {
    // The end of the chain, and the one assertion that does not care how the
    // net is spelled: whatever the patcher wrote, our own reader must find the
    // net the dialog set.
    //
    // By NAME, because a code is not stable across a 20251028 save — the table
    // is rebuilt from the order the names first appear, so moving a pad to VCC
    // can make VCC net 1. That is the point of "they're an internal
    // implementation detail", and a test written on the code would be asserting
    // the thing KiCad stopped promising.
    for (const text of [legacy(), modern()]) {
      const padded = load(setPadNet(load(text), 2));
      expect(padded.nets.get(padded.footprints[0]!.pads[0]!.net ?? 0)).toBe('VCC');
      const tracked = load(setTrackNet(load(text), 2));
      expect(tracked.nets.get(tracked.tracks[0]!.net)).toBe('VCC');
    }
  });
});
