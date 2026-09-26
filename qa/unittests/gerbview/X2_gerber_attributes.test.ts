// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `X2_ATTRIBUTE::ParseAttribCmd` and `X2_ATTRIBUTE_FILEFUNCTION`
 * (`gerbview/X2_gerber_attributes.cpp`). Every expectation is read off the
 * C++, not off our output.
 */
import { describe, expect, it } from 'vitest';
import { CHAR_PTR, FILE, LINE_BUFFER } from '@ziroeda/gerbview/libc.js';
import { X2_ATTRIBUTE, X2_ATTRIBUTE_FILEFUNCTION } from '@ziroeda/gerbview/X2_gerber_attributes.js';

/** Parse the text after `%TF` with no file behind it, as a `G04 #@!` comment does. */
function parse(text: string): { attr: X2_ATTRIBUTE; ok: boolean; rest: string } {
  const buf = new LINE_BUFFER();
  buf.s = text;
  const p = new CHAR_PTR(buf);
  const attr = new X2_ATTRIBUTE();
  const ok = attr.ParseAttribCmd(null, null, 0, p, { value: 0 });
  return { attr, ok, rest: p.rest() };
}

const fileFunction = (text: string): X2_ATTRIBUTE_FILEFUNCTION =>
  new X2_ATTRIBUTE_FILEFUNCTION(parse(text).attr);

describe('X2_ATTRIBUTE::ParseAttribCmd', () => {
  it('splits on "," and "*", and stops ON the closing "%"', () => {
    const r = parse('.FileFunction,Copper,L2,Inr*%rest');
    expect(r.attr.GetPrms()).toEqual(['.FileFunction', 'Copper', 'L2', 'Inr']);
    expect(r.attr.GetAttribute()).toBe('.FileFunction');
    // `case '%': return ok;` - the cursor is left at the '%', not past it.
    expect(r.rest).toBe('%rest');
    expect(r.ok).toBe(true);
  });

  it("drops blanks inside a parameter (case ' ': aText++)", () => {
    expect(parse('.C, R 1*%').attr.GetPrms()).toEqual(['.C', 'R1']);
  });

  it('reads on across lines until the "%"', () => {
    const buf = new LINE_BUFFER();
    buf.s = '.FileFunction,Soldermask,\n';
    const file = new FILE('Bot*%\nX0Y0D02*\n');
    const p = new CHAR_PTR(buf);
    const line = { value: 7 };
    const attr = new X2_ATTRIBUTE();
    expect(attr.ParseAttribCmd(file, buf, 100, p, line)).toBe(true);
    expect(attr.GetPrms()).toEqual(['.FileFunction', 'Soldermask', 'Bot']);
    expect(line.value).toBe(8);
  });

  it('fails at end of file with no "%"', () => {
    const buf = new LINE_BUFFER();
    buf.s = '.Part,Single*';
    const attr = new X2_ATTRIBUTE();
    expect(attr.ParseAttribCmd(new FILE(''), buf, 100, new CHAR_PTR(buf), { value: 0 })).toBe(
      false,
    );
  });

  it('answers an empty string past the last parameter', () => {
    const a = parse('.MD5,abc*%').attr;
    expect(a.GetPrm(1)).toBe('abc');
    expect(a.GetPrm(2)).toBe('');
    expect(a.GetPrm(-1)).toBe('');
    expect(a.IsFileMD5()).toBe(true);
    expect(parse('.part,Single*%').attr.IsFilePart()).toBe(true);
    expect(parse('.filefunction,Copper,L1,Top*%').attr.IsFileFunction()).toBe(true);
  });
});

describe('X2_ATTRIBUTE_FILEFUNCTION', () => {
  it('pads to seven parameters', () => {
    const f = fileFunction('.FileFunction,Profile,NP*%');
    expect(f.GetPrmCount()).toBe(7);
    expect(f.GetLabel()).toBe('');
  });

  it('reads a copper layer: side is Item(3), label Item(4), z 0, sub -n', () => {
    const f = fileFunction('.FileFunction,Copper,L3,Inr,Plane*%');
    expect(f.IsCopper()).toBe(true);
    expect(f.GetBrdLayerId()).toBe('L3');
    expect(f.GetBrdLayerSide()).toBe('Inr');
    expect(f.GetLabel()).toBe('Plane');
    expect(f.GetZOrder()).toBe(0);
    expect(f.GetZSubOrder()).toBe(-3);
  });

  it('reads a non-copper layer: side is the layer id', () => {
    const f = fileFunction('.FileFunction,Legend,Bot,Secondary*%');
    expect(f.IsCopper()).toBe(false);
    expect(f.GetBrdLayerSide()).toBe('Bot');
    expect(f.GetLabel()).toBe('Secondary');
    expect(f.GetZOrder()).toBe(-2);
  });

  it.each([
    ['Soldermask,Top', 1],
    ['Soldermask,Bot', -1],
    ['Legend,Top', 2],
    ['Paste,Top', 3],
    ['Paste,Bot', -3],
    ['Glue,Top', 4],
    ['Glue,Bot', -4],
    ['Profile,NP', 100],
    ['copper,L1,Top', 0],
  ])('%s has z order %d', (fn, z) => {
    expect(fileFunction(`.FileFunction,${fn}*%`).GetZOrder()).toBe(z);
  });

  it('keeps sub order 0 when the copper id has no number', () => {
    expect(fileFunction('.FileFunction,Copper,Lx,Top*%').GetZSubOrder()).toBe(0);
  });

  it('reads a drill file', () => {
    const f = fileFunction('.FileFunction,Plated,1,4,PTH,Drill*%');
    expect(f.IsDrillFile()).toBe(true);
    expect(f.GetDrillLayerPair()).toBe('1,4');
    expect(f.GetLPType()).toBe('PTH');
    expect(f.GetRouteType()).toBe('Drill');
    expect(fileFunction('.FileFunction,NonPlated,1,2,NPTH*%').IsDrillFile()).toBe(true);
    expect(fileFunction('.FileFunction,Copper,L1,Top*%').IsDrillFile()).toBe(false);
  });
});
