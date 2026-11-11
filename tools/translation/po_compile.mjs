// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `msgfmt`, for the browser: one KiCad `.po` in, one compact catalog out.
 *
 * KiCad ships its translations as gettext `.po` sources
 * (`translation/pofiles/<lang>.po`) and compiles each to a binary `.mo` at
 * build time, which wxWidgets' `wxMsgCatalog` then reads. We compile the same
 * sources to JSON instead, because a browser parses JSON natively and a `.mo`
 * would need a reader for no gain - but *which entries end up in the file* is
 * msgfmt's rule, not ours:
 *
 *   - an entry flagged `#, fuzzy` is left out (msgfmt without `-f`);
 *   - an untranslated entry (every `msgstr` empty) is left out;
 *   - an obsolete entry (`#~`) is left out;
 *   - a context is part of the key, joined with EOT (`msgctxt\u0004msgid`),
 *     exactly as the `.mo` hash table keys it;
 *   - a plural entry is keyed by its singular `msgid` and holds every form.
 *
 * The one thing dropped that msgfmt keeps is an entry whose translation is
 * byte-identical to its `msgid`: looking it up and missing gives the same
 * text, so it only costs bytes. (`en.po` is almost entirely such entries.)
 *
 * `qa/unittests/tools/po_compile.test.ts` checks this file against the real
 * `msgfmt`/`msgunfmt` on KiCad's own catalogs.
 */

/** gettext's context separator (`GETTEXT_CONTEXT_GLUE`, "\004"). */
export const CONTEXT_GLUE = '\u0004';

const SIMPLE_ESCAPES = {
  n: '\n',
  t: '\t',
  r: '\r',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
  '"': '"',
  '\\': '\\',
  "'": "'",
  '?': '?',
};

/**
 * The text of one PO string literal, the part between the quotes, with its C
 * escapes resolved the way gettext's `po-lex.c` does: the letter escapes,
 * `\ooo` (up to three octal digits) and `\xHH…`. Octal and hex escapes name
 * *bytes* of the file's encoding, which is UTF-8 for every KiCad catalog, so a
 * run of them is decoded as UTF-8 rather than as code points.
 */
export function unescapePoString(body) {
  if (!body.includes('\\')) return body;
  let out = '';
  /** Bytes from consecutive numeric escapes, flushed as UTF-8. */
  let bytes = [];
  const flush = () => {
    if (bytes.length === 0) return;
    out += new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    bytes = [];
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') {
      flush();
      out += c;
      continue;
    }
    const e = body[++i];
    if (e === undefined) throw new Error('PO string ends in a lone backslash');
    if (e >= '0' && e <= '7') {
      let j = i;
      while (j < i + 3 && body[j] >= '0' && body[j] <= '7') j++;
      bytes.push(Number.parseInt(body.slice(i, j), 8) & 0xff);
      i = j - 1;
    } else if (e === 'x') {
      let j = i + 1;
      while (j < body.length && /[0-9a-fA-F]/.test(body[j])) j++;
      if (j === i + 1) throw new Error('PO string has \\x with no hex digits');
      bytes.push(Number.parseInt(body.slice(i + 1, j), 16) & 0xff);
      i = j - 1;
    } else if (e in SIMPLE_ESCAPES) {
      flush();
      out += SIMPLE_ESCAPES[e];
    } else {
      throw new Error(`PO string has an unknown escape \\${e}`);
    }
  }
  flush();
  return out;
}

/** The quoted literal on a line (after any keyword), unescaped. */
function literalOf(rest, lineNo) {
  const s = rest.trim();
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') {
    throw new Error(`PO line ${lineNo}: expected a quoted string, got ${JSON.stringify(rest)}`);
  }
  return unescapePoString(s.slice(1, -1));
}

/**
 * Every entry of a `.po` file, in file order, the header included (its
 * `msgid` is the empty string). Obsolete entries are not returned.
 *
 * @returns {{ msgctxt: string | null, msgid: string, msgidPlural: string | null,
 *             msgstr: string[], fuzzy: boolean }[]}
 */
export function parsePo(text) {
  const entries = [];
  let cur = null;
  /** Which field a continuation line appends to. */
  let field = null;
  let fuzzy = false;

  const finish = () => {
    if (cur && cur.msgid !== null) {
      entries.push({
        msgctxt: cur.msgctxt,
        msgid: cur.msgid,
        msgidPlural: cur.msgidPlural,
        msgstr: cur.msgstr,
        fuzzy: cur.fuzzy,
      });
    }
    cur = null;
    field = null;
  };
  const begin = () => {
    cur = { msgctxt: null, msgid: null, msgidPlural: null, msgstr: [], fuzzy };
    fuzzy = false;
  };

  // A UTF-8 BOM is not PO syntax, but a file saved by an editor may carry one.
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    const lineNo = n + 1;
    if (line === '') continue;

    if (line[0] === '#') {
      // `#~` is an obsolete entry, `#|` the previous msgid of a fuzzy one:
      // neither is a message. `#,` carries the flags.
      if (line[1] === ',') {
        // A comment after a msgstr belongs to the NEXT entry.
        if (cur && cur.msgstr.length > 0) finish();
        if (/(^|[\s,])fuzzy($|[\s,])/.test(line.slice(2))) {
          if (cur) cur.fuzzy = true;
          else fuzzy = true;
        }
      } else if (cur && cur.msgstr.length > 0) {
        finish();
      }
      continue;
    }

    if (line[0] === '"') {
      if (!cur || field === null) throw new Error(`PO line ${lineNo}: string outside an entry`);
      const s = literalOf(line, lineNo);
      if (field === 'msgctxt') cur.msgctxt += s;
      else if (field === 'msgid') cur.msgid += s;
      else if (field === 'msgid_plural') cur.msgidPlural += s;
      else cur.msgstr[field] += s;
      continue;
    }

    const m = /^(msgctxt|msgid_plural|msgid|msgstr)(?:\[(\d+)\])?\s*(.*)$/.exec(line);
    if (!m) throw new Error(`PO line ${lineNo}: unrecognised line ${JSON.stringify(line)}`);
    const [, kw, index, rest] = m;

    if (kw === 'msgctxt' || (kw === 'msgid' && !(cur && cur.msgid === null))) {
      // A new entry starts at its msgctxt, or at its msgid when it has none.
      finish();
      begin();
    }
    if (!cur) throw new Error(`PO line ${lineNo}: ${kw} outside an entry`);

    const s = literalOf(rest, lineNo);
    if (kw === 'msgctxt') {
      cur.msgctxt = s;
      field = 'msgctxt';
    } else if (kw === 'msgid') {
      cur.msgid = s;
      field = 'msgid';
    } else if (kw === 'msgid_plural') {
      cur.msgidPlural = s;
      field = 'msgid_plural';
    } else {
      const i = index === undefined ? 0 : Number(index);
      cur.msgstr[i] = s;
      field = i;
    }
  }
  finish();
  return entries;
}

/**
 * `Plural-Forms: nplurals=2; plural=n != 1;` out of a PO header.
 *
 * gettext's default when the header has no such line is the Germanic rule,
 * two forms split at `n != 1` (`plural-exp.c`, `GERMANIC_PLURAL`).
 */
export function pluralFormsOf(header) {
  const m = /^Plural-Forms:\s*nplurals\s*=\s*(\d+)\s*;\s*plural\s*=\s*([^;\n]+);?\s*$/m.exec(
    header,
  );
  if (!m) return { nplurals: 2, plural: 'n != 1' };
  return { nplurals: Number(m[1]), plural: m[2].trim() };
}

/** One header field (`Language`, `PO-Revision-Date`…), or '' when absent. */
function headerField(header, name) {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, 'm').exec(header);
  return m ? m[1].trim() : '';
}

/**
 * Compile a `.po` source into the catalog the app fetches.
 *
 * @param {string} text  the `.po` file
 * @returns {{ catalog: { language: string, nplurals: number, plural: string,
 *                        messages: Record<string, string | string[]> },
 *             stats: { total: number, translated: number, fuzzy: number,
 *                      untranslated: number, identical: number } }}
 */
export function compilePo(text) {
  const entries = parsePo(text);
  const header = entries.find((e) => e.msgid === '' && e.msgctxt === null);
  const headerText = header ? (header.msgstr[0] ?? '') : '';
  const { nplurals, plural } = pluralFormsOf(headerText);

  /** A null-prototype object: a msgid may be `constructor` or `__proto__`. */
  const messages = Object.create(null);
  const stats = { total: 0, translated: 0, fuzzy: 0, untranslated: 0, identical: 0 };

  for (const e of entries) {
    if (e === header) continue;
    stats.total++;
    if (e.fuzzy) {
      stats.fuzzy++;
      continue;
    }
    const forms =
      e.msgidPlural === null ? [e.msgstr[0] ?? ''] : Array.from(e.msgstr, (s) => s ?? '');
    if (forms.every((s) => s === '')) {
      stats.untranslated++;
      continue;
    }
    stats.translated++;
    const key = e.msgctxt === null ? e.msgid : e.msgctxt + CONTEXT_GLUE + e.msgid;
    if (e.msgidPlural === null) {
      if (forms[0] === e.msgid) {
        stats.identical++;
        continue;
      }
      messages[key] = forms[0];
    } else {
      messages[key] = forms;
    }
  }

  return {
    catalog: { language: headerField(headerText, 'Language'), nplurals, plural, messages },
    stats,
  };
}

/**
 * The catalog as the bytes that are committed and served: keys sorted by code
 * point, so recompiling an unchanged `.po` gives an unchanged file whatever
 * order the entries were in, and one message per line, so a git diff of a
 * KiCad version bump shows the messages that changed.
 */
export function serializeCatalog(catalog) {
  const keys = Object.keys(catalog.messages).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lines = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(catalog.messages[k])}`);
  const head =
    `"language":${JSON.stringify(catalog.language)},` +
    `"nplurals":${catalog.nplurals},` +
    `"plural":${JSON.stringify(catalog.plural)},`;
  return `{${head}\n"messages":{\n${lines.join(',\n')}\n}}\n`;
}
