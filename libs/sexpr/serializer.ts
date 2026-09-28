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

/**
 * Where KiCad stops packing `(xy …)` onto a shared line
 * (`xySpecialCaseColumnLimit`, common/io/kicad/kicad_io_utils.cpp). The check
 * is against the column *before* the next pair is written, so a line can end
 * past the limit — matching upstream rather than a tidier rule.
 */
const XY_COLUMN_LIMIT = 99;

/** A `(xy x y)` list, the one node KiCad lays out specially. */
function isXy(node: SNode): node is SList {
  return isList(node) && node.items[0]?.kind === 'atom' && node.items[0].value === 'xy';
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
    const item = node.items[idx]!;
    // KiCad's prettifier packs consecutive `(xy …)` onto one line while the
    // column is under 99 (kicad_io_utils.cpp: xySpecialCaseColumnLimit). A tab
    // counts as one column there — indentSize is 1 — so the same arithmetic
    // works here. Without it every polyline is re-laid-out on first save, which
    // is 71 lines of diff noise on the ecc83 demo alone (#437).
    if (isXy(item)) {
      const text = `(${item.items.map((it) => leafToText(it as Exclude<SNode, SList>)).join(' ')})`;
      const line = out[out.length - 1];
      const packable =
        idx > 0 &&
        isXy(node.items[idx - 1]!) &&
        line !== undefined &&
        line.length < XY_COLUMN_LIMIT;
      if (packable) out[out.length - 1] = `${line} ${text}`;
      else out.push(INDENT.repeat(depth + 1) + text);
      continue;
    }
    writeNode(item, depth + 1, out);
  }

  out.push(`${pad})`);
}

/** Serialize a root list to KiCad-format text (trailing newline included). */
export function serialize(root: SList): string {
  const out: string[] = [];
  writeNode(root, 0, out);
  return `${out.join('\n')}\n`;
}
