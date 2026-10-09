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
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { flatText, writtenNodes } from './support/written_node.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (gr_text "faced" (at 10 10) (layer "F.SilkS")
    (uuid "aaaaaaaa-0000-4000-8000-000000000001")
    (effects (font (face "Sans Serif") (size 1.5 1.5) (thickness 0.3))))
  (gr_text "plain" (at 20 10) (layer "F.SilkS")
    (uuid "aaaaaaaa-0000-4000-8000-000000000002")
    (effects (font (size 1.5 1.5) (thickness 0.3))))
  (gr_text_box "boxed" (start 0 0) (end 20 10) (layer "F.SilkS")
    (uuid "aaaaaaaa-0000-4000-8000-000000000003")
    (effects (font (face "Monospace") (size 1.5 1.5) (thickness 0.3)))
    (border yes)))`;

const board = ParseBoard(BOARD);
const out = FormatBoard(board);
const texts = board
  .Drawings()
  .filter((d) => d.Type() === KICAD_T.PCB_TEXT_T) as unknown as EDA_TEXT[];
const box = board.Drawings().find((d) => d.Type() === KICAD_T.PCB_TEXTBOX_T) as unknown as EDA_TEXT;

describe('the face survives a read and a write', () => {
  it('is read off `(font (face …))`, and absent means the stroke font', () => {
    expect(texts[0]!.GetFontName()).toBe('Sans Serif');
    // `GetFont()->GetName().IsEmpty()` is the test upstream makes before
    // writing the token at all, so no token must read back as no face — not as
    // an empty string, which would then be written as `(face "")`.
    expect(texts[1]!.GetFont()).toBeNull();
    expect(box.GetFontName()).toBe('Monospace');
  });

  it('is written back, and written FIRST inside (font …)', () => {
    // `EDA_TEXT::Format` prints the face before the size, and the order of
    // these tokens is the file format's, not ours.
    expect(out).toContain('(face "Sans Serif")');
    expect(out).toContain('(face "Monospace")');
    expect(out).toMatch(/\(face "Sans Serif"\)\s*\(size /);
  });

  it('writes no token at all for a text that has none', () => {
    const plain = writtenNodes(board, 'gr_text')
      .map(flatText)
      .find((t) => t.includes('"plain"'))!;
    expect(plain).not.toContain('(face');
  });
});

describe('one (font …) writer: EDA_TEXT::Format', () => {
  /** The `(font …)` the board writer emits for one gr_text's font tokens. */
  const fontOf = (tokens: string): string => {
    const text = FormatBoard(
      ParseBoard(`(kicad_pcb (version 20241229) (generator "pcbnew")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user))
  (gr_text "X" (at 10 10) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-0000000000c1")
    (effects (font ${tokens})))
)`),
    );
    return /\(font\b.*?\)\s*\)/.exec(text.replace(/\s+/g, ' '))![0];
  };
  const heads = (font: string): string[] => [...font.matchAll(/\((\w+)/g)].map((m) => m[1]!);

  it('writes the tokens in the file format’s order', () => {
    const font = fontOf(
      '(face "Sans Serif") (size 1.5 1.5) (thickness 0.3) (bold yes) (italic yes)',
    );
    expect(heads(font)).toEqual(['font', 'face', 'size', 'thickness', 'bold', 'italic']);
  });

  it('omits a thickness of zero, because auto IS a stored zero', () => {
    // `if( !GetAutoThickness() )` (`eda_text.cpp:1079-1084`) and
    // `GetAutoThickness()` is `GetTextThickness() == 0` (`eda_text.h:150`).
    expect(fontOf('(size 1 1) (thickness 0)')).not.toContain('thickness');
    expect(fontOf('(size 1 1)')).not.toContain('thickness');
  });

  it('and nothing else in pcbnew builds a (font …) of its own', () => {
    // The guard against the six copies coming back. A file that spells
    // `atom('font')` is building the node by hand; EDA_TEXT::Format is the one.
    const SRC = fileURLToPath(new URL('../../../pcbnew', import.meta.url));
    const offenders: string[] = [];
    (function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // node_modules sits beside the sources now that pcbnew has no src/.
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts')) {
          if (readFileSync(p, 'utf8').includes("atom('font')")) offenders.push(entry.name);
        }
      }
    })(SRC);
    expect(offenders).toStrictEqual([]);
  });
});
