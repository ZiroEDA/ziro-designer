// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `(font (face "…"))` on board text, and the one function that writes `(font …)`.
 *
 * The face was read by nothing and written by nothing, so a board whose text
 * named a font lost it on the next save — silently, because every other token
 * in `(font …)` survived. It is also why the board's two text dialogs had no
 * `Font:` control while eeschema's did: there was no field to bind one to.
 *
 * The reason it could go missing in six places at once is that `(font …)` was
 * built six times: `write-board.ts` twice, `write-footprint.ts`, and the three
 * property patchers. Upstream every text-bearing item formats through ONE
 * `EDA_TEXT::Format`, which is why a `gr_text`, an `fp_text`, a text box and a
 * dimension's text all carry the same tokens in the same order.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { fontNode } from '@ziroeda/pcbnew/src/eda_text_format.js';
import { applyTextValues, collectTextValues } from '@ziroeda/pcbnew/src/graphic_properties.js';
import {
  applyTextBoxValues,
  collectTextBoxValues,
} from '@ziroeda/pcbnew/src/textbox_properties.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (gr_text "faced" (at 10 10) (layer "F.SilkS")
    (uuid "t1")
    (effects (font (face "Sans Serif") (size 1.5 1.5) (thickness 0.3))))
  (gr_text "plain" (at 20 10) (layer "F.SilkS")
    (uuid "t2")
    (effects (font (size 1.5 1.5) (thickness 0.3))))
  (gr_text_box "boxed" (start 0 0) (end 20 10) (layer "F.SilkS")
    (uuid "b1")
    (effects (font (face "Monospace") (size 1.5 1.5) (thickness 0.3)))
    (border yes)))`;

const board = readBoard(parse(BOARD));
const out = serializeBoard(board);

describe('the face survives a read and a write', () => {
  it('is read off `(font (face …))`, and absent means the stroke font', () => {
    expect(board.texts[0]?.face).toBe('Sans Serif');
    // `GetFont()->GetName().IsEmpty()` is the test upstream makes before
    // writing the token at all, so no token must read back as no face — not as
    // an empty string, which would then be written as `(face "")`.
    expect(board.texts[1]?.face).toBeUndefined();
    expect(board.textBoxes[0]?.face).toBe('Monospace');
  });

  it('is written back, and written FIRST inside (font …)', () => {
    // `EDA_TEXT::Format` prints the face before the size, and the order of
    // these tokens is the file format's, not ours.
    expect(out).toContain('(face "Sans Serif")');
    expect(out).toContain('(face "Monospace")');
    expect(out).toMatch(/\(face "Sans Serif"\)\s*\(size /);
  });

  it('writes no token at all for a text that has none', () => {
    const plain = out.slice(out.indexOf('"plain"'), out.indexOf('gr_text_box'));
    expect(plain).not.toContain('(face');
  });
});

describe('the two dialogs carry it, so it is editable rather than merely kept', () => {
  it('the text dialog collects and applies a face', () => {
    const before = collectTextValues(board.texts[1]!);
    expect(before.face).toBe('');
    const next = applyTextValues(board, 1, { ...before, face: 'Monospace' });
    expect(next.texts[1]?.face).toBe('Monospace');
    expect(serializeBoard(next)).toContain('(face "Monospace")');
  });

  it('and clearing it back to Default Font drops the token', () => {
    const withFace = applyTextValues(board, 0, {
      ...collectTextValues(board.texts[0]!),
      face: '',
    });
    // '' is "Default Font" in the combo, and the file's way of saying that is
    // to carry no `(face …)` at all.
    expect(withFace.texts[0]?.face).toBeUndefined();
    const faced = serializeBoard(withFace).slice(0, serializeBoard(withFace).indexOf('"plain"'));
    expect(faced).not.toContain('(face');
  });

  it('the text box dialog does the same', () => {
    const before = collectTextBoxValues(board.textBoxes[0]!);
    expect(before.face).toBe('Monospace');
    const next = applyTextBoxValues(board, 0, { ...before, face: 'Sans Serif' });
    expect(next.textBoxes[0]?.face).toBe('Sans Serif');
  });
});

describe('one (font …) builder, as upstream has one EDA_TEXT::Format', () => {
  it('writes the tokens in the file format’s order', () => {
    const node = fontNode({
      face: 'Sans Serif',
      size: { x: 1_500_000, y: 1_500_000 },
      thickness: 300_000,
      bold: true,
      italic: true,
    });
    const words = node.items.map((n) =>
      n.kind === 'atom' ? n.value : n.items[0]?.kind === 'atom' ? n.items[0].value : '?',
    );
    expect(words).toEqual(['font', 'face', 'size', 'thickness', 'bold', 'italic']);
  });

  it('omits a thickness of zero, because auto IS a stored zero', () => {
    // `if( !GetAutoThickness() )` (`eda_text.cpp:1079-1084`) and
    // `GetAutoThickness()` is `GetTextThickness() == 0` (`eda_text.h:150`). The
    // two board writers used to test `!== undefined`, which wrote `(thickness 0)`.
    const zero = fontNode({ size: { x: 1, y: 1 }, thickness: 0 });
    expect(JSON.stringify(zero)).not.toContain('thickness');
    const none = fontNode({ size: { x: 1, y: 1 } });
    expect(JSON.stringify(none)).not.toContain('thickness');
  });

  it('and nothing else in pcbnew builds a (font …) of its own', () => {
    // The guard against the six copies coming back. A file that spells
    // `atom('font')` is building the node by hand; only the shared one may.
    const SRC = fileURLToPath(new URL('../../../pcbnew/src', import.meta.url));
    const offenders: string[] = [];
    (function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts') && entry.name !== 'eda_text_format.ts') {
          if (readFileSync(p, 'utf8').includes("atom('font')")) offenders.push(entry.name);
        }
      }
    })(SRC);
    expect(offenders).toStrictEqual([]);
  });
});
