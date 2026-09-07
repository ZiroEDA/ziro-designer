// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text-variable expansion (ExpandTextVars + the schematic resolver):
 * `${VAR}` substitutes recursively, `\${...}` escapes, unresolved tokens stay
 * verbatim, and the standard title-block/sheet/project tokens resolve.
 */
import { describe, expect, it } from 'vitest';
import { expandTextVars, schematicTextVarResolver } from '@ziroeda/common/src/text_vars.js';

describe('expandTextVars', () => {
  const vars: Record<string, string> = { REV: 'B2', WHO: 'ZiroEDA', NESTED: 'rev ${REV}' };
  const resolve = (t: string): string | undefined => vars[t];

  it('substitutes known variables and keeps unknown tokens verbatim', () => {
    expect(expandTextVars('rev ${REV} by ${WHO}', resolve)).toBe('rev B2 by ZiroEDA');
    expect(expandTextVars('${NOPE} stays', resolve)).toBe('${NOPE} stays');
  });

  it('expands recursively (a value may reference other variables)', () => {
    expect(expandTextVars('v: ${NESTED}', resolve)).toBe('v: rev B2');
  });

  it('leaves escaped references as literals', () => {
    expect(expandTextVars('literal \\${REV}', resolve)).toBe('literal ${REV}');
  });

  it('drops empty tokens and passes unterminated references through', () => {
    expect(expandTextVars('a${}b', resolve)).toBe('ab');
    expect(expandTextVars('open ${REV', resolve)).toBe('open ${REV');
  });

  it('resolves empty-string values (they count as resolved)', () => {
    expect(expandTextVars('[${EMPTY}]', (t) => (t === 'EMPTY' ? '' : undefined))).toBe('[]');
  });
});

describe('schematicTextVarResolver', () => {
  const r = schematicTextVarResolver({
    textVars: { PROJ: 'Amp' },
    titleBlock: { title: 'ECC83', rev: '2.0', company: 'Acme', comments: ['c1', 'c2'] },
    sheetName: 'Root',
    fileName: 'amp.kicad_sch',
    projectName: 'amp',
    pageNumber: '2',
    pageCount: 3,
  });

  it('resolves title-block, sheet and project tokens', () => {
    expect(r('TITLE')).toBe('ECC83');
    expect(r('REVISION')).toBe('2.0');
    expect(r('COMPANY')).toBe('Acme');
    expect(r('COMMENT2')).toBe('c2');
    expect(r('SHEETNAME')).toBe('Root');
    expect(r('FILENAME')).toBe('amp.kicad_sch');
    expect(r('PROJECTNAME')).toBe('amp');
    expect(r('#')).toBe('2');
    expect(r('##')).toBe('3');
  });

  it('resolves project text variables and rejects unknown names', () => {
    expect(r('PROJ')).toBe('Amp');
    expect(r('UNKNOWN')).toBeUndefined();
  });

  it('resolves missing title-block fields to empty strings, not undefined', () => {
    const bare = schematicTextVarResolver({});
    expect(bare('TITLE')).toBe('');
    expect(bare('COMMENT9')).toBe('');
  });
});
