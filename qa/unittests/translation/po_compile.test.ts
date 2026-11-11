// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `tools/translation/po_compile.mjs`, the `.po` compiler, against gettext's
 * rules: hand-written sources for each rule, then - where the machine has
 * them - GNU `msgfmt` itself and the pinned KiCad sources.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_GLUE,
  compilePo,
  parsePo,
  pluralFormsOf,
  serializeCatalog,
  unescapePoString,
} from '../../../tools/translation/po_compile.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TRANSLATION = join(ROOT, 'translation');
const PO_DIR = '/home/akshay/kicad-reference/translation/pofiles';
const HAVE_REFERENCE = existsSync(join(PO_DIR, 'de.po'));
const HAVE_MSGFMT =
  spawnSync('msgfmt', ['--version']).status === 0 &&
  spawnSync('msgunfmt', ['--version']).status === 0;

const HEADER = `msgid ""
msgstr ""
"Language: de\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=n != 1;\\n"
`;

const compile = (body: string) => compilePo(`${HEADER}\n${body}`);

describe('a PO string literal', () => {
  it('resolves the C letter escapes', () => {
    expect(unescapePoString('a\\nb\\tc\\"d\\\\e')).toBe('a\nb\tc"d\\e');
    expect(unescapePoString('\\r\\a\\b\\f\\v')).toBe('\r\x07\b\f\v');
  });

  it('reads octal and hex escapes as bytes of UTF-8, not as code points', () => {
    // U+00E4 is C3 A4 in UTF-8: the two escapes are one character.
    expect(unescapePoString('\\303\\244')).toBe('ä');
    expect(unescapePoString('\\xc3\\xa4')).toBe('ä');
    // An octal escape stops after three digits: \\1012 is "A" then "2".
    expect(unescapePoString('\\1012')).toBe('A2');
  });

  it('refuses an escape gettext does not have, rather than guessing', () => {
    expect(() => unescapePoString('\\q')).toThrow();
    expect(() => unescapePoString('trailing\\')).toThrow();
  });
});

describe("which entries reach the catalog (msgfmt's rules)", () => {
  it('keeps a translated entry, joined across continuation lines', () => {
    const { catalog } = compile(`msgid ""
"Open "
"Project..."
msgstr ""
"Projekt "
"öffnen..."
`);
    expect(catalog.messages['Open Project...']).toBe('Projekt öffnen...');
  });

  it('leaves out a fuzzy entry, and only that entry', () => {
    const { catalog, stats } = compile(`#, fuzzy
msgid "Zoom"
msgstr "Vergrößerung"

msgid "Pan"
msgstr "Schwenken"

#: a.cpp:1
#, c-format, fuzzy
msgid "%d items"
msgstr "%d Elemente"

msgid "Grid"
msgstr "Raster"
`);
    expect(Object.keys(catalog.messages).sort()).toEqual(['Grid', 'Pan']);
    expect(stats.fuzzy).toBe(2);
  });

  it('does not mistake a c-format flag for fuzzy', () => {
    const { catalog } = compile(`#, c-format
msgid "%d items"
msgstr "%d Elemente"
`);
    expect(catalog.messages['%d items']).toBe('%d Elemente');
  });

  it('leaves out an untranslated entry', () => {
    const { catalog, stats } = compile(`msgid "Zoom"
msgstr ""
`);
    expect(catalog.messages).not.toHaveProperty('Zoom');
    expect(stats.untranslated).toBe(1);
  });

  it('leaves out obsolete entries and the previous msgid of a fuzzy one', () => {
    const { catalog } = compile(`#~ msgid "Gone"
#~ msgstr "Weg"

#| msgid "Old spelling"
msgid "New spelling"
msgstr "Neue Schreibweise"
`);
    expect(Object.keys(catalog.messages)).toEqual(['New spelling']);
  });

  it('keys a context entry msgctxt EOT msgid, apart from the bare msgid', () => {
    const { catalog } = compile(`msgctxt "verb"
msgid "Open"
msgstr "Öffnen"

msgid "Open"
msgstr "Offen"
`);
    expect(CONTEXT_GLUE).toBe('\u0004');
    expect(catalog.messages['verb\u0004Open']).toBe('Öffnen');
    expect(catalog.messages.Open).toBe('Offen');
  });

  it('keys a plural entry by its singular and holds every form', () => {
    const { catalog } = compile(`msgid "%d file"
msgid_plural "%d files"
msgstr[0] "%d Datei"
msgstr[1] "%d Dateien"
`);
    expect(catalog.messages['%d file']).toEqual(['%d Datei', '%d Dateien']);
    expect(catalog.messages).not.toHaveProperty('%d files');
  });

  it('keeps a plural entry with one form translated, drops one with none', () => {
    const { catalog } = compile(`msgid "%d a"
msgid_plural "%d as"
msgstr[0] "%d x"
msgstr[1] ""

msgid "%d b"
msgid_plural "%d bs"
msgstr[0] ""
msgstr[1] ""
`);
    expect(catalog.messages['%d a']).toEqual(['%d x', '']);
    expect(catalog.messages).not.toHaveProperty('%d b');
  });

  it('drops a translation identical to its msgid - a miss returns the same text', () => {
    const { catalog, stats } = compile(`msgid "OK"
msgstr "OK"
`);
    expect(catalog.messages).not.toHaveProperty('OK');
    expect(stats.identical).toBe(1);
    expect(stats.translated).toBe(1);
  });

  it('holds a msgid named like an Object.prototype member as data', () => {
    const { catalog } = compile(`msgid "constructor"
msgstr "Konstruktor"

msgid "__proto__"
msgstr "Prototyp"
`);
    expect(Object.keys(catalog.messages).sort()).toEqual(['__proto__', 'constructor']);
    const back = JSON.parse(serializeCatalog(catalog)) as typeof catalog;
    expect(Object.entries(back.messages)).toContainEqual(['constructor', 'Konstruktor']);
  });
});

describe('the header', () => {
  it('gives the plural rule and the language', () => {
    const { catalog } = compile('');
    expect(catalog).toMatchObject({ language: 'de', nplurals: 2, plural: 'n != 1' });
  });

  it('reads a rule that wraps over several header lines', () => {
    const text = `msgid ""
msgstr ""
"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && "
"n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"
`;
    expect(compilePo(text).catalog).toMatchObject({
      nplurals: 3,
      plural: '(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2)',
    });
  });

  it('is still read when it is itself flagged fuzzy, as msgfmt reads it', () => {
    const text = `#, fuzzy
msgid ""
msgstr ""
"Plural-Forms: nplurals=1; plural=0;\\n"

msgid "Zoom"
msgstr "缩放"
`;
    const { catalog } = compilePo(text);
    expect(catalog.nplurals).toBe(1);
    expect(catalog.messages.Zoom).toBe('缩放');
  });

  it('falls back to the Germanic rule gettext assumes when there is none', () => {
    expect(pluralFormsOf('Language: xx\n')).toEqual({ nplurals: 2, plural: 'n != 1' });
  });
});

describe('the served bytes', () => {
  it('do not depend on the order of the entries', () => {
    const a = compile('msgid "B"\nmsgstr "b"\n\nmsgid "A"\nmsgstr "a"\n').catalog;
    const b = compile('msgid "A"\nmsgstr "a"\n\nmsgid "B"\nmsgstr "b"\n').catalog;
    expect(serializeCatalog(a)).toBe(serializeCatalog(b));
    expect(serializeCatalog(a).indexOf('"A"')).toBeLessThan(serializeCatalog(a).indexOf('"B"'));
  });

  it('parse back to the catalog', () => {
    const { catalog } = compile('msgid "a\\tb"\nmsgstr "ä\\nö"\n');
    expect(JSON.parse(serializeCatalog(catalog))).toEqual(catalog);
  });
});

/** What `msgfmt` put in a `.mo`, read back with `msgunfmt`. */
function msgfmtMessages(aPo: string): Map<string, string | string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'ziro-po-'));
  try {
    const mo = join(dir, 'out.mo');
    execFileSync('msgfmt', ['-o', mo, aPo], { stdio: 'ignore' });
    const text = execFileSync('msgunfmt', [mo], { maxBuffer: 1 << 28 }).toString();
    const out = new Map<string, string | string[]>();
    for (const e of parsePo(text)) {
      if (e.msgid === '' && e.msgctxt === null) continue;
      const key = e.msgctxt === null ? e.msgid : e.msgctxt + CONTEXT_GLUE + e.msgid;
      out.set(key, e.msgidPlural === null ? e.msgstr[0]! : e.msgstr);
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The machines that build the app have neither KiCad's sources nor gettext;
// the catalogs are compiled where both exist, and this is the check run there.
describe.skipIf(!HAVE_REFERENCE || !HAVE_MSGFMT)("against GNU msgfmt, on KiCad's own files", () => {
  // German is nearly complete, Thai has 214 fuzzy entries, Arabic six plural
  // forms, Slovenian is almost entirely fuzzy, English almost entirely identical.
  it.each(['de', 'th', 'ar', 'sl', 'en'])('%s.po compiles to what msgfmt keeps', (lang) => {
    const po = join(PO_DIR, `${lang}.po`);
    const reference = msgfmtMessages(po);
    const ours = compilePo(readFileSync(po, 'utf8')).catalog.messages;

    // Everything we kept, msgfmt kept, with the same text.
    for (const [key, value] of Object.entries(ours)) expect(reference.get(key)).toEqual(value);
    // Everything msgfmt kept that we did not is a no-op translation.
    const dropped = [...reference].filter(([key]) => !(key in ours));
    expect(dropped.filter(([key, value]) => value !== key)).toEqual([]);
    expect(reference.size).toBeGreaterThan(50);
  });
});

describe.skipIf(!HAVE_REFERENCE)('the committed catalogs', () => {
  it('are exactly what the compiler makes of the pinned KiCad sources', () => {
    const linguas = readFileSync(join(PO_DIR, 'LINGUAS'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    const stale: string[] = [];
    for (const lang of linguas) {
      const fresh = serializeCatalog(
        compilePo(readFileSync(join(PO_DIR, `${lang}.po`), 'utf8')).catalog,
      );
      if (fresh !== readFileSync(join(TRANSLATION, `${lang}.json`), 'utf8')) stale.push(lang);
    }
    // A stale catalog means the reference tag moved: run tools/translation/build_catalogs.mjs.
    expect(stale).toEqual([]);
    expect(
      readdirSync(TRANSLATION)
        .filter((f) => f.endsWith('.json'))
        .sort(),
    ).toEqual(linguas.map((l) => `${l}.json`).sort());
  }, 60_000); // compiles 44 catalogs (~4 s alone); the 5 s default fails under a full run's load
});
