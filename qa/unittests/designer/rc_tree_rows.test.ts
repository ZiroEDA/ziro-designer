// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * How a DRC/ERC violation row is presented, against the wxDataViewCtrl
 * `RC_TREE_MODEL` puts them in.
 *
 * Both halves are pinned here because both were wrong, and the side-by-side
 * against a live 10.0.5 is what showed it: our rows WRAPPED onto a second line
 * where the control clips, and an excluded row was drawn with an opacity and a
 * strikethrough where `GetAttr` sets a colour and an italic.
 *
 * The metrics are measurements, not readings of a stylesheet:
 * `qa/probes/rc_tree_dataview` builds the control and asks it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RC_TREE_ATTR } from '@ziroeda/common/rc_item.js';
import { rcTreeRowStyle } from '@ziroeda/common/widgets/rc_tree_style.js';

const WHITE = { r: 1, g: 1, b: 1, a: 1 };

/**
 * Every rule block for a selector, joined.
 *
 * EVERY one of them: a selector can appear more than once in this stylesheet,
 * and a check that read only the first could not fail. `.ze-erc-row.excluded
 * .msg` had two blocks, and a mutant that put the strikethrough back in the
 * second survived this file until it counted them all.
 */
function ruleBlock(aSelector: string): string {
  const css = readFileSync(
    resolve(import.meta.dirname, '../../../common/widgets/shell.css'),
    'utf8',
  );
  const blocks: string[] = [];

  for (let at = css.indexOf(`\n${aSelector} {`); at > -1; ) {
    blocks.push(css.slice(at, css.indexOf('}', at)));
    at = css.indexOf(`\n${aSelector} {`, at + 1);
  }

  expect(blocks.length, `${aSelector} is not in shell.css`).toBeGreaterThan(0);

  return blocks.join('\n');
}

describe('a violation row is one clipped line', () => {
  // Measured on the control itself: the renderer reports wxELLIPSIZE_NONE and
  // the GtkCellRendererText PANGO_ELLIPSIZE_NONE with wrap-width -1.
  for (const selector of ['.ze-erc-row', '.ze-erc-subrow']) {
    it(`${selector} never wraps, and is clipped rather than ellipsized`, () => {
      const block = ruleBlock(selector);

      expect(block).toContain('white-space: nowrap');
      expect(block).toContain('overflow: hidden');
      expect(block).not.toContain('text-overflow');
    });

    it(`${selector} is 24px pitched over a 22px cell`, () => {
      const block = ruleBlock(selector);

      expect(block).toContain('height: 24px');
      expect(block).toContain('line-height: 22px');
    });
  }

  it('a child row takes no colour of its own', () => {
    // GetAttr styles a row only when it is a heading or excluded, so a plain
    // child is wxSYS_COLOUR_LISTBOXTEXT exactly like its heading.
    expect(ruleBlock('.ze-erc-subrow')).not.toContain('color:');
  });

  it('an excluded heading keeps its bold', () => {
    // `GetAttr` sets bold on every MARKER row and then ADDS the italic and the
    // colour for an excluded one; it never takes the bold away. This block
    // used to drop it to 500.
    expect(ruleBlock('.ze-erc-row.excluded .msg')).not.toContain('font-weight');
  });

  it('an excluded row is italic, and not struck through', () => {
    // rc_item.cpp:592, in as many words: "Strikethrough would be better, if
    // wxWidgets supported it".
    expect(ruleBlock('.ze-erc-subrow.excluded')).not.toContain('line-through');
    expect(ruleBlock('.ze-erc-row.excluded .msg')).not.toContain('line-through');
    expect(ruleBlock('.ze-erc-subrow.excluded')).toContain('font-style: italic');
  });
});

describe('wxDataViewItemAttr as a row style', () => {
  const attr = (over: Partial<RC_TREE_ATTR>): RC_TREE_ATTR => ({
    bold: false,
    italic: false,
    lightness: null,
    ...over,
  });

  it('SetBold is wxFONTWEIGHT_BOLD, which is 700', () => {
    expect(rcTreeRowStyle(attr({ bold: true }), WHITE).fontWeight).toBe(700);
  });

  it('SetColour is a colour, not a transparency', () => {
    // int( brightness( #ffffff ) * 50 ) = 50, and ChangeLightness( 50 ) of
    // white is #7f7f7f - the heading of an excluded marker.
    const heading = rcTreeRowStyle(attr({ bold: true, italic: true, lightness: 50 }), WHITE);

    expect(heading.color).toBe('rgb(127, 127, 127)');
    expect(heading.fontStyle).toBe('italic');
    expect(heading.opacity).toBeUndefined();
    expect(heading.textDecoration).toBeUndefined();

    // ...and 60 for its children.
    expect(rcTreeRowStyle(attr({ italic: true, lightness: 60 }), WHITE).color).toBe(
      'rgb(153, 153, 153)',
    );
  });

  it('moves a dark listbox text the other way', () => {
    // The `brightness <= 0.5` arm of GetAttr: 170 blends toward white rather
    // than toward black, so the row gets LIGHTER than the text around it.
    // ChangeLightness( 170 ) blends by the COMPLEMENT, (200 - 170)/100 = 0.30:
    // 255 + 0.30 * (26 - 255) = 186.3, truncated by the cast to 186.
    const dark = { r: 0.1, g: 0.1, b: 0.1, a: 1 };

    expect(rcTreeRowStyle(attr({ lightness: 170 }), dark).color).toBe('rgb(186, 186, 186)');
  });

  it('leaves a plain row alone', () => {
    expect(rcTreeRowStyle(null, WHITE)).toEqual({});
  });
});
