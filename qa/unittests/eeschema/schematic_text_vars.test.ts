// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A schematic text's `${VAR}` resolution: `ResolveShownText` (the tail of
 * every `GetShownText`, over common's `ResolveTextVars` / `ExpandTextVars`)
 * and `SCHEMATIC::ResolveTextVar` (`eeschema/schematic.ts`) - sheet tokens,
 * then the title block, then the project.
 */
import { describe, expect, it } from 'vitest';
import { ResolveShownText, type TextVarResolverFn } from '@ziroeda/common/common.js';
import { schematicTextVarResolver } from '@ziroeda/eeschema/schematic.js';

/** A resolver over a table, in KiCad's `bool( wxString* )` shape. */
const table =
  (vars: Record<string, string>): TextVarResolverFn =>
  (t) => {
    const v = vars[t.value];
    if (v === undefined) return false;
    t.value = v;
    return true;
  };

/** Ask a resolver for one token: its value, or undefined when it does not answer. */
const ask = (r: TextVarResolverFn, name: string): string | undefined => {
  const t = { value: name };
  return r(t) ? t.value : undefined;
};

describe('ResolveShownText', () => {
  const resolve = table({ REV: 'B2', WHO: 'ZiroEDA', NESTED: 'rev ${REV}', EMPTY: '' });

  it('substitutes known variables and keeps unknown tokens verbatim', () => {
    expect(ResolveShownText('rev ${REV} by ${WHO}', resolve)).toBe('rev B2 by ZiroEDA');
    expect(ResolveShownText('${NOPE} stays', resolve)).toBe('${NOPE} stays');
  });

  it('resolves in passes (a value may reference other variables)', () => {
    expect(ResolveShownText('v: ${NESTED}', resolve)).toBe('v: rev B2');
  });

  it('shows an escaped reference as the literal it escapes', () => {
    expect(ResolveShownText('literal \\${REV}', resolve)).toBe('literal ${REV}');
  });

  it('takes an unterminated reference to the end of the text as its token', () => {
    // ExpandTextVars scans for the closing brace until the text runs out and
    // resolves what it collected (common.cpp:216-260): no brace needed.
    expect(ResolveShownText('open ${REV', resolve)).toBe('open B2');
  });

  it('resolves empty-string values (they count as resolved)', () => {
    expect(ResolveShownText('[${EMPTY}]', resolve)).toBe('[]');
  });
});

describe('SCHEMATIC::ResolveTextVar', () => {
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
    expect(ask(r, 'TITLE')).toBe('ECC83');
    expect(ask(r, 'REVISION')).toBe('2.0');
    expect(ask(r, 'COMPANY')).toBe('Acme');
    expect(ask(r, 'COMMENT2')).toBe('c2');
    expect(ask(r, 'SHEETNAME')).toBe('Root');
    expect(ask(r, 'FILENAME')).toBe('amp.kicad_sch');
    expect(ask(r, 'PROJECTNAME')).toBe('amp');
    expect(ask(r, '#')).toBe('2');
    expect(ask(r, '##')).toBe('3');
  });

  it('resolves project text variables and rejects unknown names', () => {
    expect(ask(r, 'PROJ')).toBe('Amp');
    expect(ask(r, 'UNKNOWN')).toBeUndefined();
  });

  it('answers a title-block value that names a project variable with its value', () => {
    // TITLE_BLOCK::TextVarResolver expands its answer against the project.
    const withVar = schematicTextVarResolver({
      textVars: { REVNO: '7' },
      titleBlock: { rev: 'r${REVNO}' },
    });
    expect(ask(withVar, 'REVISION')).toBe('r7');
  });

  it('resolves missing title-block fields to empty strings, not unresolved', () => {
    const bare = schematicTextVarResolver({});
    expect(ask(bare, 'TITLE')).toBe('');
    expect(ask(bare, 'COMMENT9')).toBe('');
  });
});
