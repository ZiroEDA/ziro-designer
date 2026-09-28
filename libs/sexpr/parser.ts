// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Parser: token stream -> S-expression AST.
 *
 * A KiCad file is a single top-level list, e.g. `(kicad_sch ...)`. This parser
 * is deliberately format-agnostic: it knows nothing about schematics, only about
 * lists, atoms, and strings. That keeps the lossless layer decoupled from the
 * (evolving) typed document model.
 */

import { tokenCursor, type Token } from './tokenizer.js';
import { atom, str, type SList, type SNode } from './types.js';

export class ParseError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(`${message} (at offset ${pos})`);
    this.name = 'ParseError';
  }
}

/**
 * Which lists a caller does not want built, by their head atom.
 *
 * The full tree of a KiCad file is about thirteen times its text (measured:
 * MCU_ST_STM32H7.kicad_sym is 14.8 MB and its tree 198 MB in 1.87 million
 * nodes), and a reader that only wants a few fields of each symbol pays all of
 * it. Pruning at the parser is the one place that cost can be avoided rather
 * than paid and discarded: a pruned list's tokens are scanned and dropped
 * without a node ever being allocated.
 *
 *  - `drop`: the list is skipped entirely and does not appear in its parent.
 *  - `shallow`: the list keeps its head and its direct atoms and strings;
 *    every nested list inside it is skipped.
 *
 * Heads are matched wherever they occur, so a caller names lists that mean the
 * same thing at every depth of the format it is reading.
 */
export interface PruneOptions {
  readonly drop?: ReadonlySet<string>;
  readonly shallow?: ReadonlySet<string>;
}

/** Parse a complete KiCad file into its single root list. */
export function parse(src: string, prune?: PruneOptions): SList {
  const cursor = tokenCursor(src);
  const drop = prune?.drop;
  const shallow = prune?.shallow;
  let tok: Token | undefined = cursor.next();
  if (tok === undefined) throw new ParseError('Empty input: expected a top-level list', 0);

  /** Consume the tokens of a list whose `(` has already been consumed, building nothing. */
  function skipList(open: Token): void {
    let depth = 1;
    while (depth > 0) {
      const t = cursor.next();
      if (t === undefined) throw new ParseError("Unterminated list: missing ')'", open.pos);
      if (t.type === 'lparen') depth++;
      else if (t.type === 'rparen') depth--;
    }
    tok = cursor.next();
  }

  /** Parse the node at `tok`; `undefined` when it was a dropped list. */
  function parseNode(): SNode | undefined {
    if (tok === undefined) throw new ParseError('Unexpected end of input', src.length);

    switch (tok.type) {
      case 'lparen':
        return parseList();
      case 'atom': {
        const a = atom(tok.value);
        tok = cursor.next();
        return a;
      }
      case 'string': {
        const s = str(tok.value);
        tok = cursor.next();
        return s;
      }
      case 'rparen':
        throw new ParseError("Unexpected ')'", tok.pos);
    }
  }

  function parseList(): SList | undefined {
    const open = tok!; // known lparen
    tok = cursor.next();
    const items: SNode[] = [];
    // The head decides the list's fate before anything under it is built.
    let flat = false;
    if (tok?.type === 'atom' && (drop !== undefined || shallow !== undefined)) {
      if (drop?.has(tok.value)) {
        skipList(open);
        return undefined;
      }
      flat = shallow?.has(tok.value) ?? false;
    }
    while (true) {
      if (tok === undefined) throw new ParseError("Unterminated list: missing ')'", open.pos);
      if (tok.type === 'rparen') {
        tok = cursor.next();
        return { kind: 'list', items };
      }
      if (flat && tok.type === 'lparen') {
        skipList(tok);
        continue;
      }
      const node = parseNode();
      if (node !== undefined) items.push(node);
    }
  }

  if (tok.type !== 'lparen') {
    throw new ParseError('Expected a top-level list starting with "("', tok.pos);
  }
  const root = parseList();
  if (root === undefined) throw new ParseError('The top-level list cannot be pruned', 0);

  if (tok !== undefined) {
    throw new ParseError('Unexpected trailing content after top-level list', tok.pos);
  }

  return root;
}
