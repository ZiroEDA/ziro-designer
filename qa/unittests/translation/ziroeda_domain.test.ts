// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The `ziroeda` message domain: ZiroEDA's own interface text, beside KiCad's
 * `kicad` domain. tools/translation/extract_ziroeda.mjs is our xgettext +
 * msgmerge, build_catalogs.mjs --ziroeda our msgfmt.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type DomainMessage,
  kicadMsgids,
  markedLiterals,
  mergePo,
} from '../../../tools/translation/extract_ziroeda.mjs';
import { compilePo, parsePo, serializeCatalog } from '../../../tools/translation/po_compile.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DOMAIN = join(ROOT, 'translation/ziroeda');

describe('which messages are ours', () => {
  const kicad = kicadMsgids(join(ROOT, 'translation'));

  it("leaves KiCad's to KiCad, including the spelling without its mnemonic", () => {
    expect(kicad.has('Open Project...')).toBe(true);
    // "&Delete redundant vias" and "Apply, Save Schematic && Continue" are KiCad's msgids;
    // our labels state the mnemonic beside them and say "&" once, as the user sees it.
    expect(kicad.has('Delete redundant vias')).toBe(true);
    expect(kicad.has('Apply, Save Schematic & Continue')).toBe(true);
    expect(kicad.has('Open Demo Project')).toBe(false);
  });

  it('takes a marked literal, never a template that was formatted before the lookup', () => {
    const found = markedLiterals(
      'x.tsx',
      "const a = _('Save a copy'); const b = _HKI('Shared'); const c = _(`x ${y}`); const d = t('No');",
    ).map((m) => m.msgid);
    expect(found).toEqual(['Save a copy', 'Shared']);
  });
});

describe('a language brought up to the template (msgmerge)', () => {
  const messages = new Map<string, DomainMessage>([
    ['Kept', { plural: null, refs: new Set(['a.ts:1']) }],
    ['New', { plural: null, refs: new Set(['b.ts:2']) }],
  ]);
  const before =
    'msgid ""\nmsgstr ""\n"Language: de\\n"\n\nmsgid "Kept"\nmsgstr "Behalten"\n\nmsgid "Gone"\nmsgstr "Weg"\n';

  it('keeps a translation, adds a new message untranslated, drops one that is gone', () => {
    const entries = parsePo(mergePo(before, messages, 'de', 'nplurals=2; plural=(n != 1);'));
    const byId = new Map(entries.map((e) => [e.msgid, e.msgstr[0]]));
    expect(byId.get('Kept')).toBe('Behalten');
    expect(byId.get('New')).toBe('');
    expect(byId.has('Gone')).toBe(false);
    expect(byId.get('')).toContain('Language: de');
  });
});

describe('the committed ziroeda catalogs', () => {
  const linguas = readFileSync(join(DOMAIN, 'pofiles/LINGUAS'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));

  it('are exactly what the compiler makes of the committed .po files', () => {
    const stale = linguas.filter(
      (lang) =>
        serializeCatalog(
          compilePo(readFileSync(join(DOMAIN, `pofiles/${lang}.po`), 'utf8')).catalog,
        ) !== readFileSync(join(DOMAIN, `${lang}.json`), 'utf8'),
    );
    // Stale: run tools/translation/build_catalogs.mjs --ziroeda.
    expect(stale).toEqual([]);
  }, 60_000);

  it('cover every language the interface offers, and translate the launcher in each', () => {
    const kicadLanguages = readdirSync(join(ROOT, 'translation'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
    expect([...linguas].sort()).toEqual(kicadLanguages);
    for (const lang of linguas.filter((l) => l !== 'en')) {
      const { messages } = JSON.parse(readFileSync(join(DOMAIN, `${lang}.json`), 'utf8'));
      expect(messages['Open Demo Project'], lang).toBeTruthy();
      expect(messages['Open Project from GitHub...'], lang).toBeTruthy();
    }
  });

  it('keep every placeholder of every message', () => {
    const SPEC = /%(?:\d+\$)?[-+#0]*\d*(?:\.\d+)?(?:l|ll|z)?[diouxXeEfFgGcs]/g;
    const specs = (s: string): string =>
      (s.match(SPEC) ?? [])
        .map((x) => x.replace(/^%\d+\$/, '%'))
        .sort()
        .join(' ');
    const bad: string[] = [];
    for (const lang of linguas) {
      const { messages } = JSON.parse(readFileSync(join(DOMAIN, `${lang}.json`), 'utf8'));
      for (const [id, tr] of Object.entries(messages as Record<string, string>)) {
        if (/%[a-z]/i.test(id) && specs(tr) !== specs(id)) bad.push(`${lang}: ${id}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
