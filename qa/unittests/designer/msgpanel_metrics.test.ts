// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How far apart `EDA_MSG_PANEL` puts its cells.
 *
 * `updateItemPos` (common/widgets/msgpanel.cpp:135-158) is not a flex row with
 * a gap:
 *
 *     text = ( upperText.Len() > lowerText.Len() ) ? upperText : lowerText;
 *     text.Append( ' ', item.GetPadding() );                          // :140
 *     if( m_last_x == 0 ) m_last_x = m_fontSize.x;                    // :143
 *     item.m_X = m_last_x;
 *     m_last_x += GetTextExtent( text ).x;                            // :151
 *     m_last_x += m_fontSize.x;                                       // :154
 *
 * The padding spaces are appended BEFORE the string is measured, so the space
 * between two cells is `padding` spaces plus one 'W' — not one 'W', which is
 * what we drew. The first cell's inset really is one 'W' alone (:143), so the
 * two numbers are different and the stylesheet cannot use one token for both.
 *
 * The numbers are measurements, not readings of a stylesheet: `wx-config`d
 * against real wxWidgets in `qa/probes/msgpanel_probe.cpp`, on this desktop's
 * Ubuntu Sans 11 — "W" 14px, a space 3px. They were then corroborated against
 * a capture of a real GerbView: the probe puts DisplayImageInfo's seven cells
 * at x = 14, 96, 216, 304, 389, 477, 564 and the capture has their ink at
 * 80, 163, 283, 371, 455, 543, 630, a constant 66-67px client origin on all
 * seven. Two methods that share no step.
 *
 * WHAT THIS FILE CANNOT DO: jsdom does no layout, so it cannot measure a
 * rendered cell. It checks the declarations, which is where the bug was.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MSG_PANEL_DEFAULT_PAD } from '@ziroeda/designer/src/ui/MsgPanel.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

const SHELL = read('ui/shell.css');
const MSGPANEL_TSX = read('ui/MsgPanel.tsx');

/** The stylesheet with its comments removed, so they cannot read as values. */
const CSS_CODE = SHELL.replace(/\/\*[\s\S]*?\*\//g, '');

const token = (name: string): string => {
  const m = CSS_CODE.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  expect(m, `no token ${name}`).not.toBeNull();
  return m![1]!.trim();
};

const rule = (selector: string): Record<string, string> => {
  const at = CSS_CODE.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = CSS_CODE.slice(at + selector.length + 4, CSS_CODE.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    out[decl.slice(0, i).trim()] = decl
      .slice(i + 1)
      .trim()
      .replace(/\s+/g, ' ');
  }
  return out;
};

describe('the two font metrics EDA_MSG_PANEL lays out in', () => {
  it("one 'W' is 14px, GetTextExtent( \"W\" ).x in Ubuntu Sans 11", () => {
    expect(token('--msgpanel-gutter')).toBe('14px');
  });

  it('one space is 3px, the unit m_Padding counts in', () => {
    expect(token('--msgpanel-space')).toBe('3px');
  });

  it('MSG_PANEL_DEFAULT_PAD is 6', () => {
    // msgpanel.h:41 — "#define MSG_PANEL_DEFAULT_PAD 6".
    expect(MSG_PANEL_DEFAULT_PAD).toBe(6);
  });
});

describe('the cell advance carries the padding spaces', () => {
  it('is padding spaces plus one W, written on the cell', () => {
    // Spelled out rather than computed, so that changing --msgpanel-space or
    // the multiplier has to be done here too.
    expect(rule('.ze-msgpanel-item')['padding-right']).toBe(
      'calc(6 * var(--msgpanel-space) + var(--msgpanel-gutter))',
    );
  });

  it('comes to 32px for a default item, which is what wx measures', () => {
    // 6 spaces at 3px + one 'W' at 14px. The probe's pitch for "Format"/"X1"
    // is 82px and the bare text is 50px, so the separation is 32.
    const spaces = Number.parseInt(token('--msgpanel-space'), 10);
    const w = Number.parseInt(token('--msgpanel-gutter'), 10);
    expect(MSG_PANEL_DEFAULT_PAD * spaces + w).toBe(32);
  });

  it('is NOT a flex gap on the container, which cannot vary per item', () => {
    // The symbol editor passes 8 rather than 6
    // (eeschema/symbol_editor/symbol_editor.cpp:1749-1767), so the advance is a
    // property of the ITEM. A `gap` on .ze-msgpanel would be one number for
    // every cell, and it is how the padding came to be dropped.
    expect(rule('.ze-msgpanel').gap).toBeUndefined();
  });

  it('insets the first cell by one W and nothing else', () => {
    // if( m_last_x == 0 ) m_last_x = m_fontSize.x;   msgpanel.cpp:143
    expect(rule('.ze-msgpanel')['padding-left']).toBe('var(--msgpanel-gutter)');
  });
});

describe('an item that asks for a different padding gets it', () => {
  it('MsgPanelItem carries m_Padding', () => {
    expect(MSGPANEL_TSX).toMatch(/padding\?:\s*number/);
  });

  it('writes the override in the same measured units', () => {
    // Not `${n * 3}px` — the space width is a token because it is a font
    // metric, and an override must scale with it.
    expect(MSGPANEL_TSX).toContain(
      '`calc(${item.padding} * var(--msgpanel-space) + var(--msgpanel-gutter))`',
    );
  });

  it('leaves the default to the stylesheet rather than restating it', () => {
    // Restating 6 inline would be a literal at a higher specificity than the
    // rule that names the tokens — the trap CLAUDE.md calls out.
    expect(MSGPANEL_TSX).toMatch(/item\.padding === MSG_PANEL_DEFAULT_PAD/);
  });
});
