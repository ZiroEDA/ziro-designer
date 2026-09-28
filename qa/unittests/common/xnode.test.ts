// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `XNODE` / `XATTR` (common/xnode.cpp). Expectations are read off the C++:
 * FormatContents prints attributes first as ` (name value)`, a string quoted
 * and a number bare; an element's first NON-text child is preceded by a
 * newline; Format closes with `)\n` when a sibling follows and `)` when not.
 */
import { STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { XATTR, XNODE, wxXmlNodeType } from '@ziroeda/common/xnode.js';
import { describe, expect, it } from 'vitest';

const E = wxXmlNodeType.wxXML_ELEMENT_NODE;
const T = wxXmlNodeType.wxXML_TEXT_NODE;

const raw = (n: XNODE): string => {
  const out = new STRING_FORMATTER();
  n.Format(out);
  return out.GetString();
};

describe('XNODE::Format', () => {
  it('prints attributes, then text, then element children', () => {
    const root = new XNODE(E, 'comp');
    root.AddAttribute('ref', 'R1');
    root.AddChild(new XNODE(T, '', 'text "quoted"'));
    const a = new XNODE(E, 'a');
    root.AddChild(a);
    root.AddChild(new XNODE(E, 'b'));

    expect(raw(root)).toBe('(comp (ref "R1") "text \\"quoted\\""(a)\n(b))');
  });

  it('puts a newline before an element that is the FIRST child', () => {
    const root = new XNODE(E, 'r');
    root.AddChild(new XNODE(E, 'a'));
    expect(raw(root)).toBe('(r\n(a))');
  });

  it('leaves numbers unquoted', () => {
    const n = new XNODE(E, 'n');
    n.AddAttributeInt('i', 7);
    n.AddAttributeDouble('d', 0.5);
    n.AddBool('b', true);
    expect(raw(n)).toBe('(n (i 7) (d 0.5) (b "yes"))');
  });

  it('Format() is the prettified text', () => {
    const root = new XNODE(E, 'r');
    root.AddChild(new XNODE(E, 'a'));
    // Prettify ends the buffer with '\n' (kicad_io_utils.cpp:336).
    expect(root.Format()).toBe('(r\n\t(a)\n)\n');
  });
});

describe('XATTR double formatting', () => {
  const text = (v: number) => new XATTR('x', { type: 'double', value: v }).GetValueText();

  it('is {:.10g} above 1e-4', () => {
    expect(text(1.5)).toBe('1.5');
    expect(text(1 / 3)).toBe('0.3333333333');
    expect(text(12345678901)).toBe('1.23456789e+10');
    expect(text(0)).toBe('0');
  });

  it('is {:.16f} with trailing zeros stripped at or below 1e-4', () => {
    expect(text(0.0001)).toBe('0.0001');
    expect(text(0.00005)).toBe('0.00005');
    expect(text(-0.00005)).toBe('-0.00005');
  });
});
