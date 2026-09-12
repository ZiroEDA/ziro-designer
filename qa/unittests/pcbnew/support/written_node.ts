// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The node `PCB_IO_KICAD_SEXPR` writes for one item.
 *
 * There is no per-item tree builder any more — the writer formats the whole
 * model — so a test that wants to look at one item's `(gr_text …)` or
 * `(table …)` puts the item on a board, writes the board, and reads the node
 * back out of the text.
 */
import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { head, isList, type SList } from '@ziroeda/sexpr/src/types.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

/** A two-layer board with nothing on it. */
export const emptyBoard = (): Board =>
  readBoard(
    '(kicad_pcb (version 20241229) (generator "test") (layers (0 "F.Cu" signal) (31 "B.Cu" signal)))',
  );

/** Every top-level node of that head in the written board. */
export function writtenNodes(board: Board, headName: string): SList[] {
  const root = parse(serializeBoard(board));
  return root.items.filter((i): i is SList => isList(i) && head(i) === headName);
}

/** The nth top-level node of that head in the written board. */
export function writtenNode(board: Board, headName: string, nth = 0): SList {
  const node = writtenNodes(board, headName)[nth];
  if (!node) throw new Error(`no (${headName} …) #${nth} in the written board`);
  return node;
}

/** A node as one line: the pretty-printer's newlines squeezed out. */
export const flatText = (node: SList): string =>
  serialize(node).replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');

/** The first `name` child of a node. */
export const childNode = (node: SList, name: string): SList | undefined =>
  node.items.find((it): it is SList => isList(it) && head(it) === name);

/** The heads of the header the board writer puts before the items. */
const HEADER_HEADS = new Set([
  'version',
  'generator',
  'generator_version',
  'general',
  'paper',
  'title_block',
  'layers',
  'setup',
  'property',
  'net',
  'embedded_fonts',
  'embedded_files',
]);

/** Every top-level ITEM node of the written board, flattened and joined on one line. */
export function writtenItems(board: Board): string {
  const root = parse(serializeBoard(board));
  return root.items
    .filter((i): i is SList => isList(i) && !HEADER_HEADS.has(head(i) ?? ''))
    .map(flatText)
    .join(' ');
}

/** A fixed, valid KIID for a fixture: `U('x1')` is the same uuid every time. */
export function U(tag: string): string {
  const hex = [...tag].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `${hex.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${hex.padEnd(12, '0').slice(0, 12)}`;
}
