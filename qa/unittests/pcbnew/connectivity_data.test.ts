// CONNECTIVITY_DATA / CN_CONNECTIVITY_ALGO / RN_NET over the item classes
// (issue 636, stage 2). Two oracles, both KiCad 10.0.5's own:
//  - python pcbnew's BuildConnectivity() for the counts (nets, pads, nodes,
//    unconnected) on the intact resave boards and on the same boards with
//    every third track removed;
//  - kicad-cli's DRC `unconnected_items` on the cut boards for the ratsnest
//    itself: every missing connection it reports is a pair of items, and
//    our RN_NET edges must join the same pairs — allowing only for two items
//    that share the anchor point (a pad and the track end sitting on it),
//    where KiCad picks whichever it allocated first.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import type { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';

const RESAVE = fileURLToPath(new URL('../../data/pcbnew/resave/', import.meta.url));
const ORACLES = fileURLToPath(new URL('../../data/pcbnew/connectivity/', import.meta.url));

function load(name: string): BOARD {
  const f = `${RESAVE}${name}.kicad_pcb`;
  return new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(f, 'utf8'), f).Parse() as BOARD;
}

/** python: `for i, t in enumerate(list(b.GetTracks())): if i % 3 == 0: b.Remove(t)`. */
function cutEveryThirdTrack(board: BOARD): void {
  const tracks = [...board.Tracks()];
  tracks.forEach((t, i) => {
    if (i % 3 === 0) board.Remove(t);
  });
}

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

describe('CONNECTIVITY_DATA', () => {
  // python pcbnew 10.0.5: BuildConnectivity(); GetConnectivity().GetNetCount() /
  // GetUnconnectedCount(False) / GetPadCount() / GetNodeCount()
  const intact: [string, number, number, number, number][] = [
    ['ecc83-pp', 14, 0, 33, 151],
    ['One-Air-Max', 157, 0, 655, 4368],
    ['interf_u', 174, 0, 379, 1919],
    ['StickHub_kicad_cli', 48, 0, 273, 2946],
    ['issue10906', 0, 0, 0, 0],
  ];

  for (const [name, nets, unconnected, pads, nodes] of intact) {
    it(`${name}: the intact board has KiCad's net, pad and node counts and no ratsnest`, () => {
      const board = load(name);
      expect(board.BuildConnectivity()).toBe(true);
      const conn = board.GetConnectivity();
      expect(conn.GetNetCount()).toBe(nets);
      expect(conn.GetPadCount()).toBe(pads);
      expect(conn.GetNodeCount()).toBe(nodes);
      expect(conn.GetUnconnectedCount(false)).toBe(unconnected);
    }, 60_000); // One-Air-Max: the zone triangulation Build() caches first is the slow part
  }

  // python pcbnew 10.0.5 on the same boards after cutEveryThirdTrack
  const cut: [string, number, number, number, number][] = [
    ['ecc83-pp', 14, 11, 33, 111],
    ['interf_u', 174, 199, 379, 1403],
  ];

  for (const [name, nets, unconnected, pads, nodes] of cut) {
    it(`${name} with every third track removed: KiCad's counts, and kicad-cli's missing connections`, () => {
      const board = load(name);
      cutEveryThirdTrack(board);
      expect(board.BuildConnectivity()).toBe(true);
      const conn = board.GetConnectivity();
      expect(conn.GetNetCount()).toBe(nets);
      expect(conn.GetPadCount()).toBe(pads);
      expect(conn.GetNodeCount()).toBe(nodes);
      expect(conn.GetUnconnectedCount(false)).toBe(unconnected);

      // Every anchor position of every item, by uuid, for the coincidence test.
      const anchors = new Map<string, Set<string>>();
      conn.GetConnectivityAlgo().ForEachItem((it) => {
        if (!it.Valid()) return;
        const key = String(it.Parent().m_Uuid);
        const set = anchors.get(key) ?? new Set<string>();
        for (const a of it.Anchors()) set.add(`${a.Pos().x},${a.Pos().y}`);
        anchors.set(key, set);
      });
      const coincident = (x: string, y: string): boolean => {
        if (x === y) return true;
        const a = anchors.get(x);
        const b = anchors.get(y);
        if (!a || !b) return false;
        for (const p of a) if (b.has(p)) return true;
        return false;
      };

      const ours: [string, string][] = [];
      for (let n = 1; n < conn.GetNetCount(); n++) {
        const net = conn.GetRatsnestForNet(n);
        if (!net) continue;
        for (const e of net.GetEdges()) {
          ours.push([
            String(e.GetSourceNode()!.Parent().m_Uuid),
            String(e.GetTargetNode()!.Parent().m_Uuid),
          ]);
        }
      }
      expect(ours.length).toBe(unconnected);

      const oracle = JSON.parse(readFileSync(`${ORACLES}${name}_cut_unconnected.json`, 'utf8')) as {
        unconnected_items: [string, string][];
      };
      expect(oracle.unconnected_items.length).toBe(unconnected);

      const key = (p: [string, string]): string => [...p].sort().join('|');
      const oursKeys = new Set(ours.map(key));
      const oracleKeys = new Set(oracle.unconnected_items.map(key));
      const missing = oracle.unconnected_items.filter((p) => !oursKeys.has(key(p)));
      const extra = ours.filter((p) => !oracleKeys.has(key(p)));

      // Each edge KiCad reports that we join differently must be the same
      // connection between coincident anchors — and it must be matched one
      // to one by one of ours.
      expect(extra.length).toBe(missing.length);
      const unexplained = missing.filter(
        ([a, b]) =>
          !extra.some(
            ([c, d]) =>
              (coincident(a, c) && coincident(b, d)) || (coincident(a, d) && coincident(b, c)),
          ),
      );
      expect(unexplained).toEqual([]);
      // ... and most of them are exact.
      expect(missing.length).toBeLessThan(unconnected / 5);
    }, 60_000); // ~2 s alone; the suite runs it under load
  }

  it('GetConnectedItems walks the cluster and the pad queries see through it', () => {
    const board = load('ecc83-pp');
    board.BuildConnectivity();
    const conn = board.GetConnectivity();
    // python pcbnew: the first track of ecc83-pp and what it is connected to
    const track = board.Tracks()[0]! as PCB_TRACK;
    const items = conn.GetConnectedItems(track);
    expect(items).toContain(track);
    expect(items.length).toBe(PY_ECC83_TRACK0_CONNECTED);
    const pads = conn.GetConnectedPads(track);
    expect(pads.length).toBe(PY_ECC83_TRACK0_PADS);
    // GetNetItems is not wrapped for python; the pads of the net counted by hand there.
    const nets = conn.GetNetItems(track.GetNetCode(), [KICAD_T.PCB_PAD_T]);
    expect(nets.length).toBe(PY_ECC83_NET_PADS);
    expect(conn.TestTrackEndpointDangling(track, false)).toBe(false);
  });
});

// python pcbnew 10.0.5 on ecc83-pp.kicad_pcb: t = list(b.GetTracks())[0];
// len(c.GetConnectedItems(t)) == 10, len(c.GetConnectedPads(t)) == 1,
// len([p for fp in b.GetFootprints() for p in fp.Pads() if p.GetNetCode() == t.GetNetCode()]) == 3
const PY_ECC83_TRACK0_CONNECTED = 10;
const PY_ECC83_TRACK0_PADS = 1;
const PY_ECC83_NET_PADS = 3;
