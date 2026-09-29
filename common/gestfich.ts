// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/gestfich.cpp`: the file helpers a kiface's `SaveFileAs` copies a
 * project's files with. So far `CopySexprFile`, which rewrites the value of
 * chosen `(token value)` pairs on the way.
 *
 * The browser has no file to open or write: the source arrives as text and the
 * rewritten text is returned for the caller to store at the destination path.
 */
import { parse, serialize, type SList, type SNode } from '@ziroeda/sexpr';
import { Prettify } from './io/kicad/kicad_io_utils.js';

/** `traverseSEXPR` (gestfich.cpp): depth first, the node before its children. */
function traverseSEXPR(aNode: SNode, aVisitor: (aNode: SNode) => void): void {
  aVisitor(aNode);

  if (aNode.kind === 'list') for (const child of aNode.items) traverseSEXPR(child, aVisitor);
}

/**
 * `CopySexprFile( aSrcPath, aDestPath, aCallback, aErrors )` (gestfich.cpp:360-416):
 * every list whose first child is a symbol and which has a second child hands
 * `( token, value )` to \a aCallback — the value being that second child when
 * it is a string or a symbol, '' otherwise — and a callback answering true has
 * its (edited) value written back. The result goes through the prettifier, as
 * a frame's own save does.
 *
 * @param aSrcText the source file's text.
 * @param aDestPath where the copy goes, for the error message.
 * @param aErrors accumulates "Cannot copy file '…'." on failure, newline-separated.
 * @return the text to write at \a aDestPath, or null when the copy failed.
 */
export function CopySexprFile(
  aSrcText: string,
  aDestPath: string,
  aCallback: (aToken: string, aValue: { value: string }) => boolean,
  aErrors: { value: string },
): string | null {
  let out: string | null = null;

  try {
    const sexpr: SList = parse(aSrcText);

    traverseSEXPR(sexpr, (node) => {
      if (node.kind === 'list' && node.items.length > 1 && node.items[0]!.kind === 'atom') {
        const token = node.items[0]!.value;
        const second = node.items[1]!;
        const path = { value: second.kind === 'list' ? '' : second.value };

        if (aCallback(token, path)) {
          if (second.kind === 'string') node.items[1] = { kind: 'string', value: path.value };
          else if (second.kind === 'atom') node.items[1] = { kind: 'atom', value: path.value };
        }
      }
    });

    // Pass through the pretifier to ensure format is the same as when a file is saved by a frame
    out = Prettify(serialize(sexpr));
  } catch {
    out = null;
  }

  if (out === null) {
    if (aErrors.value !== '') aErrors.value += '\n';

    aErrors.value += `Cannot copy file '${aDestPath}'.`;
  }

  return out;
}
