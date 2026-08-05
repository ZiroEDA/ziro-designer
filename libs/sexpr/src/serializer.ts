// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Serializer: S-expression AST -> KiCad-format text.
 *
 * Formatting conventions, matched to KiCad's own writer:
 *   - Indentation is one TAB per nesting level.
 *   - A list whose items are all leaves (atoms/strings, no sub-lists) is written
 *     inline on a single line:  `(version 20250114)`, `(at 0 2.54 0)`.
 *   - A list containing sub-lists is expanded: the head and any leading leaf
 *     items on the opening line, then each sub-list on its own indented line.
 *
 * NOTE ON FIDELITY: This reproduces KiCad's dominant layout but is not yet
 * byte-for-byte identical for every node type (e.g. KiCad packs multiple `(xy)`
 * pairs onto one line under `(pts)`). That is intentional: correctness is
 * defined as *semantic* round-trip (parse∘serialize∘parse is identity over the
 * AST), which is asserted on the bundled demo in qa/unittests/designer.
 *
 * Byte-exact formatting is #437, filed with the measurement — on ecc83 the
 * only differences are the generator stamp and `(pts)` packing, 71 lines of
 * diff noise on a file the user did not change.
 */

import { isList, type SList, type SNode } from './types.js';

const INDENT = '\t';

function escapeString(value: string): string {
  let out = '';
  for (const ch of value) {
    switch (ch) {
      case '\\':
        out += '\\\\';
        break;
      case '"':
        out += '\\"';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

function leafToText(node: Exclude<SNode, SList>): string {
  return node.kind === 'string' ? `"${escapeString(node.value)}"` : node.value;
}

/** True if the list has no sub-lists and can be rendered on one line. */
function isInlineable(node: SList): boolean {
  return node.items.every((it) => !isList(it));
}

function writeNode(node: SNode, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);

  if (!isList(node)) {
    out.push(pad + leafToText(node));
    return;
  }

  if (isInlineable(node)) {
    const inner = node.items.map((it) => leafToText(it as Exclude<SNode, SList>)).join(' ');
    out.push(`${pad}(${inner})`);
    return;
  }

  // Expanded form: leading leaf items share the opening line; sub-lists nest.
  let opening = `${pad}(`;
  let idx = 0;
  while (idx < node.items.length && !isList(node.items[idx]!)) {
    const leaf = leafToText(node.items[idx] as Exclude<SNode, SList>);
    opening += idx === 0 ? leaf : ` ${leaf}`;
    idx++;
  }
  out.push(opening);

  for (; idx < node.items.length; idx++) {
    writeNode(node.items[idx]!, depth + 1, out);
  }

  out.push(`${pad})`);
}

/** Serialize a root list to KiCad-format text (trailing newline included). */
export function serialize(root: SList): string {
  const out: string[] = [];
  writeNode(root, 0, out);
  return `${out.join('\n')}\n`;
}
