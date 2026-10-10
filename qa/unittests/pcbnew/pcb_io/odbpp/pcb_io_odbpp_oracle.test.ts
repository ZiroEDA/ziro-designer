// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * PCB_IO_ODBPP against `kicad-cli pcb export odb --compression none` (KiCad 10.0.6) on eight boards
 * (qa/data/pcbnew/odbpp_oracle/regen.sh): millimetres at 2 decimals, and ecc83-pp in inches at 4.
 *
 * The same folders and files, and every file byte for byte, except by name:
 *  - misc/info's CREATION_DATE / SAVE_DATE / SAVE_APP and eda/data's first two lines: the export
 *    time and KiCad's build string;
 *  - what upstream's heap order moves. A layer's items are sorted by their parent footprint's
 *    address, so the order of its features, and the first-use numbering of its symbols ($n),
 *    attribute names (@n) and texts (&n), follow the heap. Each features file is therefore
 *    compared as the multiset of its features, each written with its symbol and attributes
 *    resolved to their names; and eda/data's FID lines, which quote a feature by index, are
 *    resolved to that feature's text (a subnet's FIDs as a set).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PCB_IO_ODBPP } from '@ziroeda/pcbnew/pcb_io/odbpp/pcb_io_odbpp.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const DIR = new URL('../../../../data/pcbnew/odbpp_oracle/', import.meta.url).pathname;
const BOARDS = new URL('../../../../data/pcbnew/resave/', import.meta.url).pathname;

/** The text attributes, whose values are indices into the &n table. */
const TEXT_ATTRS = new Set(['.string', '.geometry', '.net_name']);
const SYMBOL_FIELD: Record<string, number> = { L: 5, A: 7, P: 3 };

/** A features file's features, each with its symbol and attributes written by name. */
function canonFeatures(aText: string): string[] {
  const sym = new Map<string, string>();
  const an = new Map<string, string>();
  const at = new Map<string, string>();
  const feats: string[][] = [];
  let cur: string[] | null = null;

  for (const ln of aText.split('\n')) {
    let m = /^\$(\d+) (.*)$/.exec(ln);

    if (m) {
      sym.set(m[1]!, m[2]!);
      continue;
    }

    m = /^@(\d+) (.*)$/.exec(ln);

    if (m) {
      an.set(m[1]!, m[2]!);
      continue;
    }

    m = /^&(\d+) (.*)$/.exec(ln);

    if (m) {
      at.set(m[1]!, m[2]!);
      continue;
    }

    if (cur) {
      cur.push(ln);

      if (ln === 'SE') {
        feats.push(cur);
        cur = null;
      }

      continue;
    }

    if (/^[LAP] /.test(ln)) feats.push([ln]);
    else if (/^S /.test(ln)) cur = [ln];
  }

  return feats.map((f) => {
    const head = f[0]!;
    const semi = head.indexOf(';');
    const body = semi < 0 ? head : head.substring(0, semi);
    let attrs = '';

    if (semi >= 0) {
      const named = head
        .substring(semi + 1)
        .split(',')
        .map((kv) => {
          const [k, v = ''] = kv.split('=');
          const name = an.get(k!)!;
          const value = TEXT_ATTRS.has(name) && v !== '' ? at.get(v)! : v;
          return value !== '' ? `${name}=${value}` : name;
        })
        .sort();
      attrs = `;${named.join(',')}`;
    }

    const t = body.split(' ');
    const idx = SYMBOL_FIELD[t[0]!];

    if (idx !== undefined) t[idx] = sym.get(t[idx]!)!;

    return [t.join(' ') + attrs, ...f.slice(1)].join('\n');
  });
}

/** eda/data with the time and build masked and every FID resolved to its feature. */
function canonEda(aText: string, aFeatures: (aLayer: string) => string[]): string[] {
  const lines = aText.split('\n');
  const lyr = lines
    .find((l) => l.startsWith('LYR'))!
    .split(' ')
    .slice(1);
  const out: string[] = [];
  let block: string[] = [];
  const flush = (): void => {
    if (block.length) out.push(block.sort().join('\n'));

    block = [];
  };

  for (const ln of lines.slice(2)) {
    const m = /^FID (\w) (\d+) (\d+)$/.exec(ln);

    if (m) {
      const layer = lyr[Number(m[2])]!;
      block.push(`FID ${m[1]} ${layer} ${aFeatures(layer)[Number(m[3])]}`);
      continue;
    }

    flush();

    if (!ln.startsWith('LYR')) out.push(ln);
  }

  flush();
  out.push(`LYR ${[...lyr].sort().join(' ')}`);
  return out;
}

function walk(aRoot: string, aRel = ''): string[] {
  return readdirSync(join(aRoot, aRel)).flatMap((n) => {
    const rel = aRel ? `${aRel}/${n}` : n;
    return statSync(join(aRoot, rel)).isDirectory() ? walk(aRoot, rel) : [rel];
  });
}

const maskInfo = (s: string): string =>
  s.replace(/^(CREATION_DATE=|SAVE_DATE=|SAVE_APP=KiCad EDA ).*$/gm, '$1T');

const CASES: [string, string, [string, string][]][] = [
  [
    'ecc83-pp',
    'ecc83-pp',
    [
      ['units', 'mm'],
      ['sigfig', '2'],
    ],
  ],
  [
    'interf_u',
    'interf_u',
    [
      ['units', 'mm'],
      ['sigfig', '2'],
    ],
  ],
  [
    'blindvias_kicad_cli',
    'blindvias_kicad_cli',
    [
      ['units', 'mm'],
      ['sigfig', '2'],
    ],
  ],
  [
    'custompads_kicad_cli',
    'custompads_kicad_cli',
    [
      ['units', 'mm'],
      ['sigfig', '2'],
    ],
  ],
  [
    'hatchpads_kicad_cli',
    'hatchpads_kicad_cli',
    [
      ['units', 'mm'],
      ['sigfig', '2'],
    ],
  ],
  [
    'StickHub_kicad_cli',
    'StickHub_kicad_cli',
    [
      ['units', 'mm'],
      ['sigfig', '2'],
    ],
  ],
  [
    'ecc83-pp_flipped',
    'ecc83-pp_flipped',
    [
      ['units', 'mm'],
      ['sigfig', '2'],
    ],
  ],
  [
    'ecc83-pp-inch',
    'ecc83-pp',
    [
      ['units', 'inch'],
      ['sigfig', '4'],
    ],
  ],
];

describe('PCB_IO_ODBPP against kicad-cli 10.0.6', () => {
  it.each(CASES)(
    '%s',
    (aOracle, aBoard, aProps) => {
      const board = ParseBoard(readFileSync(`${BOARDS}${aBoard}.kicad_pcb`, 'utf8'));
      board.SetFileName(`${BOARDS}${aBoard}.kicad_pcb`);

      const tree = new PCB_IO_ODBPP().ExportTree(board, new Map(aProps));
      const root = `${DIR}${aOracle}`;

      const wantDirs = readFileSync(`${DIR}${aOracle}.dirs`, 'utf8')
        .split('\n')
        .filter(Boolean)
        .sort();
      expect([...tree.dirs].sort()).toEqual(wantDirs);

      const wantFiles = walk(root).sort();
      expect([...tree.files.keys()].sort()).toEqual(wantFiles);

      const layerOf = (aPath: string): string => aPath.split('/').slice(-2)[0]!;
      const feats = (aGet: (p: string) => string) => {
        const cache = new Map<string, string[]>();
        return (aLayer: string): string[] => {
          let c = cache.get(aLayer);

          if (!c) {
            c = canonFeatures(aGet(`steps/pcb/layers/${aLayer}/features`));
            cache.set(aLayer, c);
          }

          return c;
        };
      };
      const ours = feats((p) => tree.files.get(p)!);
      const theirs = feats((p) => readFileSync(join(root, p), 'utf8'));

      for (const path of wantFiles) {
        const got = tree.files.get(path)!;
        const want = readFileSync(join(root, path), 'utf8');

        if (/^steps\/pcb\/layers\/[^/]+\/features$/.test(path)) {
          expect([...ours(layerOf(path))].sort(), path).toEqual([...theirs(layerOf(path))].sort());
        } else if (path === 'steps/pcb/eda/data') {
          expect(canonEda(got, ours), path).toEqual(canonEda(want, theirs));
        } else if (path === 'misc/info') {
          expect(maskInfo(got), path).toBe(maskInfo(want));
        } else {
          expect(got, path).toBe(want);
        }
      }
    },
    120_000,
  );
});
