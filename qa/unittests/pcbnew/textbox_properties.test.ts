// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading and writing a text box's properties.
 * Counterpart: `DIALOG_TEXTBOX_PROPERTIES`.
 *
 * The interesting part is `(justify …)`: one token holding three independent
 * settings — horizontal alignment, vertical alignment and mirroring — which
 * upstream edits through three separate setters. Two ways to get it wrong, both
 * pinned below:
 *
 * - **Centre is what the file means by saying nothing.** Writing `center` back
 *   adds a word KiCad never writes, so the file changes on every save even when
 *   nothing was edited.
 * - **The token has to be rebuilt from all three**, not patched word by word.
 *   Changing only the horizontal setting must not drop `mirror`.
 *
 * Every assertion that matters round-trips through the writer, because an
 * in-memory check cannot tell those failures apart from success.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  applyTextBoxValues,
  collectTextBoxValues,
  joinJustify,
  splitJustify,
  textBoxAt,
  type TextBoxValues,
} from '@ziroeda/pcbnew/src/textbox_properties.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

const BOX = (justify = '(justify top)'): string => `(gr_text_box "boxed"
    (start 50 50) (end 60 56)
    (margins 1 2 3 4)
    (layer "F.SilkS")
    (uuid "11111111-0000-0000-0000-000000000005")
    (effects (font (size 0.9 1.1) (thickness 0.15) (bold yes)) ${justify})
    (border yes)
    (stroke (width 0.12) (type dot))
    (knockout no))`;

const read = (src = BOX()): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${src}
)`),
  );

/** Apply a change and read the file back, which is where the failures show. */
const roundTrip = (over: Partial<TextBoxValues>, src = BOX()): Board => {
  const b = read(src);
  const v = { ...collectTextBoxValues(b.textBoxes[0]!), ...over };
  return readBoard(parse(serializeBoard(applyTextBoxValues(b, 0, v))));
};

describe('splitting a justify token', () => {
  it('reads the horizontal word', () => {
    expect(splitJustify(['left']).horiz).toBe('left');
    expect(splitJustify(['right']).horiz).toBe('right');
  });

  it('reads the vertical word', () => {
    expect(splitJustify(['top']).vert).toBe('top');
    expect(splitJustify(['bottom']).vert).toBe('bottom');
  });

  it('reads centre from the absence of a word, on both axes', () => {
    const j = splitJustify([]);

    expect(j.horiz).toBe('center');
    expect(j.vert).toBe('center');
  });

  it('reads all three at once', () => {
    const j = splitJustify(['right', 'bottom', 'mirror']);

    expect(j).toEqual({ horiz: 'right', vert: 'bottom', mirrored: true });
  });

  it('treats a missing token as all defaults', () => {
    expect(splitJustify(undefined)).toEqual({
      horiz: 'center',
      vert: 'center',
      mirrored: false,
    });
  });
});

describe('rebuilding a justify token', () => {
  it('omits both centres, which the file expresses by silence', () => {
    expect(joinJustify('center', 'center', false)).toEqual([]);
  });

  it('writes only the non-default words', () => {
    expect(joinJustify('left', 'center', false)).toEqual(['left']);
    expect(joinJustify('center', 'bottom', false)).toEqual(['bottom']);
  });

  it('keeps mirror alongside the others', () => {
    expect(joinJustify('right', 'top', true)).toEqual(['right', 'top', 'mirror']);
  });

  it('keeps mirror even when both axes are centred', () => {
    // The one case where the token exists but says nothing about alignment.
    expect(joinJustify('center', 'center', true)).toEqual(['mirror']);
  });

  it('round-trips through split for every combination', () => {
    for (const h of ['left', 'center', 'right'] as const)
      for (const vv of ['top', 'center', 'bottom'] as const)
        for (const m of [false, true]) {
          const j = splitJustify(joinJustify(h, vv, m));
          expect(j, `${h}/${vv}/${m}`).toEqual({ horiz: h, vert: vv, mirrored: m });
        }
  });
});

describe('finding the selected text box', () => {
  it('takes a single selected one', () => {
    expect(textBoxAt(read(), ['textbox:0'])).toBe(0);
  });

  it('takes nothing from a multiple selection or another kind', () => {
    expect(textBoxAt(read(), ['textbox:0', 'textbox:1'])).toBeNull();
    expect(textBoxAt(read(), ['shape:0'])).toBeNull();
    expect(textBoxAt(read(), ['textbox:9'])).toBeNull();
  });
});

describe('reading the values', () => {
  it('reads the text, layer and font', () => {
    // `EDA_TEXT::Format` writes `(size HEIGHT WIDTH)` — height first — so the
    // fixture's `(size 0.9 1.1)` is a 1.1 mm wide, 0.9 mm tall glyph. Easy to
    // read backwards, and the reader swaps for exactly this reason.
    const v = collectTextBoxValues(read().textBoxes[0]!);

    expect(v.text).toBe('boxed');
    expect(v.layer).toBe('F.SilkS');
    expect(v.height).toBe(MM(0.9));
    expect(v.width).toBe(MM(1.1));
    expect(v.thickness).toBe(MM(0.15));
    expect(v.bold).toBe(true);
  });

  it('keeps height first when written back', () => {
    // A swap here would silently transpose every text box on save.
    const out = serializeBoard(
      applyTextBoxValues(read(), 0, {
        ...collectTextBoxValues(read().textBoxes[0]!),
        width: MM(3),
        height: MM(2),
      }),
    );

    expect(out).toContain('(size 2 3)');
  });

  it('reads the margins in file order', () => {
    const v = collectTextBoxValues(read().textBoxes[0]!);

    expect([v.marginLeft, v.marginTop, v.marginRight, v.marginBottom]).toEqual([
      MM(1),
      MM(2),
      MM(3),
      MM(4),
    ]);
  });

  it('reads the border and its stroke', () => {
    const v = collectTextBoxValues(read().textBoxes[0]!);

    expect(v.border).toBe(true);
    expect(v.borderWidth).toBe(MM(0.12));
    expect(v.borderStyle).toBe('dot');
  });

  it('splits the justify token into three controls', () => {
    const v = collectTextBoxValues(read(BOX('(justify right bottom mirror)')).textBoxes[0]!);

    expect(v.horizJustify).toBe('right');
    expect(v.vertJustify).toBe('bottom');
    expect(v.mirrored).toBe(true);
  });
});

describe('applying a change', () => {
  it('leaves the board alone when nothing moved', () => {
    const b = read();

    expect(applyTextBoxValues(b, 0, collectTextBoxValues(b.textBoxes[0]!))).toBe(b);
  });

  it('does nothing for an index that is not there', () => {
    const b = read();

    expect(applyTextBoxValues(b, 9, collectTextBoxValues(b.textBoxes[0]!))).toBe(b);
  });

  it('writes the text through to the file', () => {
    expect(roundTrip({ text: 'changed' }).textBoxes[0]!.text).toBe('changed');
  });

  it('writes the font through to the file', () => {
    const t = roundTrip({ width: MM(2), height: MM(3), thickness: MM(0.4), italic: true })
      .textBoxes[0]!;

    expect(t.size).toEqual({ x: MM(2), y: MM(3) });
    expect(t.thickness).toBe(MM(0.4));
    expect(t.italic).toBe(true);
  });

  it('writes the margins through to the file', () => {
    const t = roundTrip({ marginLeft: MM(5), marginBottom: MM(6) }).textBoxes[0]!;

    expect(t.margins.left).toBe(MM(5));
    expect(t.margins.bottom).toBe(MM(6));
    expect(t.margins.top).toBe(MM(2));
  });

  it('keeps the geometry, which is not the dialog to change', () => {
    const out = serializeBoard(
      applyTextBoxValues(read(), 0, {
        ...collectTextBoxValues(read().textBoxes[0]!),
        text: 'changed',
      }),
    );

    expect(out).toContain('(start 50 50)');
    expect(out).toContain('(end 60 56)');
    expect(out).toContain('(uuid "11111111-0000-0000-0000-000000000005")');
  });
});

describe('justification through the file', () => {
  it('writes a non-default alignment', () => {
    const t = roundTrip({ horizJustify: 'left', vertJustify: 'bottom' }).textBoxes[0]!;

    expect(t.justify).toEqual(['left', 'bottom']);
  });

  it('drops the token entirely when everything is default', () => {
    // Writing `center center` would add words KiCad never writes.
    const out = serializeBoard(
      applyTextBoxValues(read(), 0, {
        ...collectTextBoxValues(read().textBoxes[0]!),
        horizJustify: 'center',
        vertJustify: 'center',
        mirrored: false,
      }),
    );

    expect(out).not.toContain('(justify');
    expect(out).not.toContain('center');
  });

  it('keeps mirror when only the alignment changed', () => {
    // The token is rebuilt from all three, so editing one must not drop another.
    const t = roundTrip({ horizJustify: 'left' }, BOX('(justify top mirror)')).textBoxes[0]!;

    expect(t.justify).toContain('mirror');
    expect(t.justify).toContain('left');
  });

  it('keeps the alignment when only mirror changed', () => {
    const t = roundTrip({ mirrored: true }, BOX('(justify right)')).textBoxes[0]!;

    expect(t.justify).toContain('right');
    expect(t.justify).toContain('mirror');
  });
});

describe('the border, which is a mode', () => {
  it('writes `no` rather than dropping the token', () => {
    // A missing `(border …)` reads back as true, so this inverts if dropped.
    const t = roundTrip({ border: false }).textBoxes[0]!;

    expect(t.border).toBe(false);
  });

  it('keeps the stroke width while the border is off', () => {
    // So switching it back on restores what was there rather than a default.
    const t = roundTrip({ border: false, borderWidth: MM(0.5) }).textBoxes[0]!;

    expect(t.strokeWidth).toBe(MM(0.5));
  });

  it('writes the style', () => {
    expect(roundTrip({ borderStyle: 'dash_dot' }).textBoxes[0]!.strokeType).toBe('dash_dot');
  });
});

describe('the remaining flags', () => {
  it('writes knockout both ways', () => {
    expect(roundTrip({ knockout: true }).textBoxes[0]!.knockout).toBe(true);
    expect(roundTrip({ knockout: false }).textBoxes[0]!.knockout).toBe(false);
  });

  it('writes and clears the locked flag', () => {
    expect(roundTrip({ locked: true }).textBoxes[0]!.locked).toBe(true);
    const lockedSrc = BOX().replace('"boxed"', '"boxed" (locked yes)');
    expect(roundTrip({ locked: false }, lockedSrc).textBoxes[0]!.locked).toBeFalsy();
  });

  it('writes an orientation, and removes it when set back to zero', () => {
    // Absent is how the file spells upright; a written `(angle 0)` is a token
    // KiCad would not have produced.
    expect(roundTrip({ orientation: 30 }).textBoxes[0]!.angle).toBe(30);

    const angled = BOX().replace('(margins 1 2 3 4)', '(margins 1 2 3 4) (angle 30)');
    const out = serializeBoard(
      applyTextBoxValues(read(angled), 0, {
        ...collectTextBoxValues(read(angled).textBoxes[0]!),
        orientation: 0,
      }),
    );

    expect(out).not.toContain('(angle');
  });

  it('moves the layer', () => {
    expect(roundTrip({ layer: 'Edge.Cuts' }).textBoxes[0]!.layer).toBe('Edge.Cuts');
  });
});
