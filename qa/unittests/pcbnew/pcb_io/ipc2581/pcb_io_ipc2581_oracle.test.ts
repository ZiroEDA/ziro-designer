// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * PCB_IO_IPC2581 against `kicad-cli pcb export ipc2581` (KiCad 10.0.6) on seven boards
 * (qa/data/pcbnew/ipc2581_oracle/regen.sh): revision C in millimetres, and one revision B board in
 * inches at four decimals.
 *
 * Exact, attribute for attribute and element for element, with four things set aside by name:
 *  - the export time (HistoryRecord origination / lastChange, AvlHeader datetime);
 *  - the order of the children of a Set or a LayerFeature, and of the AvlItems: upstream sorts
 *    board items by their parent footprint's address and walks a std::map keyed by FOOTPRINT*,
 *    so those follow the heap, not anything in the board;
 *  - dictionary numbering (LINE_n, UPOLY_n, RECT_n …): entries are numbered on first use, which
 *    follows that same walk, so each entry is named by its content and every id reference
 *    rewritten to match - a wrong shape changes its name and breaks the references to it.
 * The file size is pinned too: the same bytes, in another order.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { wxXmlDocumentLoad, type wxXmlNode } from '@ziroeda/common/wx/xml.js';
import { PCB_IO_IPC2581 } from '@ziroeda/pcbnew/pcb_io/ipc2581/pcb_io_ipc2581.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const DIR = new URL('../../../../data/pcbnew/ipc2581_oracle/', import.meta.url).pathname;
const BOARDS = new URL('../../../../data/pcbnew/resave/', import.meta.url).pathname;

const TIMES = new Set(['origination', 'lastChange', 'datetime']);
const HEAP_ORDERED = new Set(['Set', 'LayerFeature', 'Avl']);

function children(aNode: wxXmlNode): wxXmlNode[] {
  const out: wxXmlNode[] = [];

  for (let c = aNode.GetChildren(); c; c = c.GetNext()) out.push(c);

  return out;
}

/** A stable content name: FNV-1a over the entry's tags and attributes, ids left out. */
function contentName(aNode: wxXmlNode): string {
  const parts: string[] = [];
  const walk = (n: wxXmlNode): void => {
    parts.push(
      n.GetName(),
      ...n
        .GetAttributes()
        .filter(([k]) => k !== 'id')
        .flat(),
    );
    children(n).forEach(walk);
    parts.push('/');
  };
  walk(aNode);

  let h = 0x811c9dc5;

  for (const ch of parts.join('\u0001')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;

  return h.toString(16);
}

function canon(aXml: string): string[] {
  const root = wxXmlDocumentLoad(aXml);
  const rename = new Map<string, string>();
  const walkAll = (n: wxXmlNode, f: (x: wxXmlNode) => void): void => {
    f(n);
    children(n).forEach((c) => walkAll(c, f));
  };

  walkAll(root, (d) => {
    if (!d.GetName().startsWith('Dictionary')) return;

    for (const entry of children(d)) {
      const id = entry.GetAttribute('id');
      rename.set(id, `${id.substring(0, id.lastIndexOf('_'))}#${contentName(entry)}`);
    }
  });

  const ser = (n: wxXmlNode, depth: number): string => {
    const attrs = n
      .GetAttributes()
      .map(([k, v]) => `${k}="${TIMES.has(k) ? 'T' : k === 'id' ? (rename.get(v) ?? v) : v}"`)
      .join(' ');
    const kids = children(n).map((c) => ser(c, depth + 1));

    if (HEAP_ORDERED.has(n.GetName()) || n.GetName().startsWith('Dictionary')) kids.sort();

    return [`${'  '.repeat(depth)}<${n.GetName()} ${attrs}>`, ...kids].join('\n');
  };

  return ser(root, 0).split('\n');
}

const CASES: [string, string, [string, string][]][] = [
  ['ecc83-pp', 'ecc83-pp', [['version', 'C']]],
  ['interf_u', 'interf_u', [['version', 'C']]],
  ['blindvias_kicad_cli', 'blindvias_kicad_cli', [['version', 'C']]],
  ['custompads_kicad_cli', 'custompads_kicad_cli', [['version', 'C']]],
  ['hatchpads_kicad_cli', 'hatchpads_kicad_cli', [['version', 'C']]],
  ['StickHub_kicad_cli', 'StickHub_kicad_cli', [['version', 'C']]],
  [
    'ecc83-pp-B-inch',
    'ecc83-pp',
    [
      ['version', 'B'],
      ['units', 'inch'],
      ['sigfig', '4'],
    ],
  ],
];

describe('PCB_IO_IPC2581 against kicad-cli 10.0.6', () => {
  it.each(CASES)(
    '%s',
    (aOracle, aBoard, aProps) => {
      const board = ParseBoard(readFileSync(`${BOARDS}${aBoard}.kicad_pcb`, 'utf8'));
      board.SetFileName(`${BOARDS}${aBoard}.kicad_pcb`);

      let written = '';
      const io = new PCB_IO_IPC2581();
      io.SetFileWriter((aPath, aData) => {
        expect(aPath).toBe('/out.xml');
        written = new TextDecoder().decode(aData);
      });
      io.SaveBoard('/out.xml', board, new Map(aProps));

      const want = readFileSync(`${DIR}${aOracle}.xml`, 'utf8');

      expect(written.length).toBe(want.length);
      expect(canon(written)).toEqual(canon(want));
    },
    120_000,
  );
});
