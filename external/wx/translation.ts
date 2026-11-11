// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets, copyright its authors. See NOTICE.md.
/**
 * `wx/translation.h`: `wxGetTranslation`, `_()`, `wxPLURAL`, `wxMsgCatalog`
 * and the `wxTranslations` object that holds the loaded catalog.
 *
 * This is the one place interface text is translated. KiCad writes
 * `_( "Open Project..." )` and that macro is wx's
 * (`#define _(s) wxGetTranslation((s))`); the lookup, the plural rule and the
 * fall back to the string itself all live in wx, which is why they live in this
 * package and not in `common/` - and why the wx widgets here (`menu_ui.tsx`,
 * `controls.tsx`) can translate their labels without reaching up into KiCad's
 * tree. *Which* catalog is loaded is KiCad's business: `PGM_BASE::SetLanguage`,
 * ported in `common/pgm_base.ts`.
 *
 * The catalog is the compiled form of KiCad's own `.po` files
 * (`tools/translation/po_compile.mjs`), fetched when a language is chosen. No
 * catalog loaded means English, which needs none: the msgid *is* the English
 * text, and a lookup that misses returns it.
 */

/** gettext's context separator (`GETTEXT_CONTEXT_GLUE`). */
const CONTEXT_GLUE = '\u0004';

/** The compiled catalog as `translation/<lang>.json` holds it. */
export interface wxMsgCatalogData {
  language: string;
  nplurals: number;
  /** The `.po` header's C expression, e.g. `n != 1`. */
  plural: string;
  /** msgid (or `msgctxt\u0004msgid`) to translation; an array for a plural entry. */
  messages: Record<string, string | string[]>;
}

// ---- plural forms (wx: src/common/translation.cpp, wxPluralFormsCalculator) ----

type PluralNode =
  | { op: 'n' }
  | { op: 'num'; value: number }
  | { op: '!'; a: PluralNode }
  | { op: '?'; a: PluralNode; b: PluralNode; c: PluralNode }
  | { op: string; a: PluralNode; b: PluralNode };

/** Binary operators by precedence, loosest first, as C orders them. */
const BINARY_LEVELS: readonly (readonly string[])[] = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<=', '>=', '<', '>'],
  ['+', '-'],
  ['*', '/', '%'],
];

/**
 * Parse a `Plural-Forms` expression: the C subset gettext allows - `n`,
 * decimal integers, `! * / % + - < <= > >= == != && || ?:` and parentheses.
 *
 * Parsed, never `eval`ed: the text comes out of a fetched file.
 */
function parsePlural(aExpr: string): PluralNode {
  const tokens = aExpr.match(/\d+|n|\|\||&&|[=!<>]=|[!?:()<>+\-*/%]/g) ?? [];
  if (tokens.join('') !== aExpr.replace(/\s+/g, '')) {
    throw new Error(`Plural-Forms: cannot parse ${JSON.stringify(aExpr)}`);
  }
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const expect = (t: string): void => {
    if (tokens[pos++] !== t) throw new Error(`Plural-Forms: expected ${t} in ${aExpr}`);
  };

  const unary = (): PluralNode => {
    const t = tokens[pos++];
    if (t === undefined) throw new Error(`Plural-Forms: ${aExpr} ends early`);
    if (t === '!') return { op: '!', a: unary() };
    if (t === '(') {
      const e = ternary();
      expect(')');
      return e;
    }
    if (t === 'n') return { op: 'n' };
    if (/^\d+$/.test(t)) return { op: 'num', value: Number(t) };
    throw new Error(`Plural-Forms: unexpected ${t} in ${aExpr}`);
  };

  const binary = (level: number): PluralNode => {
    if (level === BINARY_LEVELS.length) return unary();
    let left = binary(level + 1);
    for (let t = peek(); t !== undefined && BINARY_LEVELS[level]!.includes(t); t = peek()) {
      pos++;
      left = { op: t, a: left, b: binary(level + 1) };
    }
    return left;
  };

  const ternary = (): PluralNode => {
    const cond = binary(0);
    if (peek() !== '?') return cond;
    pos++;
    const yes = ternary();
    expect(':');
    // Right-associative: `a ? 0 : b ? 1 : 2` is `a ? 0 : (b ? 1 : 2)`.
    return { op: '?', a: cond, b: yes, c: ternary() };
  };

  const tree = ternary();
  if (pos !== tokens.length) throw new Error(`Plural-Forms: trailing input in ${aExpr}`);
  return tree;
}

function evalPlural(aNode: PluralNode, n: number): number {
  switch (aNode.op) {
    case 'n':
      return n;
    case 'num':
      return (aNode as { value: number }).value;
    case '!':
      return evalPlural((aNode as { a: PluralNode }).a, n) === 0 ? 1 : 0;
    case '?': {
      const t = aNode as { a: PluralNode; b: PluralNode; c: PluralNode };
      return evalPlural(t.a, n) !== 0 ? evalPlural(t.b, n) : evalPlural(t.c, n);
    }
  }
  const b = aNode as { op: string; a: PluralNode; b: PluralNode };
  const x = evalPlural(b.a, n);
  // `&&` and `||` short-circuit in C, which matters for `n%100/0`-style
  // guards; the others always evaluate both sides.
  if (b.op === '&&') return x !== 0 && evalPlural(b.b, n) !== 0 ? 1 : 0;
  if (b.op === '||') return x !== 0 || evalPlural(b.b, n) !== 0 ? 1 : 0;
  const y = evalPlural(b.b, n);
  switch (b.op) {
    case '==':
      return x === y ? 1 : 0;
    case '!=':
      return x !== y ? 1 : 0;
    case '<':
      return x < y ? 1 : 0;
    case '>':
      return x > y ? 1 : 0;
    case '<=':
      return x <= y ? 1 : 0;
    case '>=':
      return x >= y ? 1 : 0;
    case '+':
      return x + y;
    case '-':
      return x - y;
    case '*':
      return x * y;
    // C integer division; a zero divisor is undefined there and 0 here.
    case '/':
      return y === 0 ? 0 : Math.trunc(x / y);
    case '%':
      return y === 0 ? 0 : x % y;
  }
  throw new Error(`Plural-Forms: unknown operator ${b.op}`);
}

/**
 * `wxPluralFormsCalculator::make` + `evaluate`: the function from a count to
 * the index of the plural form a catalog uses for it.
 */
export function wxPluralFormsCalculator(aExpr: string): (n: number) => number {
  const tree = parsePlural(aExpr);
  // gettext takes the count as `unsigned long`; a negative count selects on
  // its magnitude, as wx's own callers (and KiCad's) pass `abs`-like counts.
  return (n) => evalPlural(tree, Math.abs(Math.trunc(n)));
}

// ---- wxStripMenuCodes (wx: src/common/utilscmn.cpp) ----

/**
 * `wxStripMenuCodes( str, wxStrip_Mnemonics | wxStrip_CJKMnemonics )`: a menu
 * or button label without its `&` mnemonic marker.
 *
 * East Asian translations cannot mark a letter of the translated word, so they
 * append the English one - `_( "&File" )` is `文件 (&F)` in zh_CN and
 * `ไฟล์(&F)` in Thai - and wx removes that whole group, with the space before
 * it, when the mnemonic is not wanted. `&&` is a literal ampersand.
 */
export function wxStripMenuCodes(aStr: string): string {
  let str = aStr;
  const pos = str.indexOf('(&');
  if (pos !== -1 && str.length > pos + 3 && str[pos + 3] === ')') {
    const start = pos > 0 && str[pos - 1] === ' ' ? pos - 1 : pos;
    str = str.slice(0, start) + str.slice(pos + 4);
  }
  let out = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '&' && i + 1 < str.length) i++;
    out += str[i];
  }
  return out;
}

// ---- wxMsgCatalog ----

/** One loaded catalog: `wxMsgCatalog`. */
export class wxMsgCatalog {
  private readonly m_messages: Map<string, string | string[]>;
  private readonly m_pluralIndex: (n: number) => number;
  private readonly m_language: string;

  constructor(aData: wxMsgCatalogData) {
    this.m_language = aData.language;
    this.m_messages = new Map(Object.entries(aData.messages));
    this.m_pluralIndex = wxPluralFormsCalculator(aData.plural);

    // KiCad's menu and button strings carry their mnemonic - `_( "&File" )`,
    // `_( "&Cancel" )` - because wx wants it in the label. Ours state the
    // mnemonic beside the label (`MenuItem.mnemonic`) and the label is bare,
    // so "File" would miss a catalog that only knows "&File". Each such entry
    // is therefore also reachable by its stripped text. A msgid that exists in
    // its own right wins: "Edit" and "&Edit" are both in the catalog and need
    // not agree.
    for (const [key, value] of Object.entries(aData.messages)) {
      if (!key.includes('&') || typeof value !== 'string') continue;
      const bare = wxStripMenuCodes(key);
      if (bare !== key && !this.m_messages.has(bare)) {
        this.m_messages.set(bare, wxStripMenuCodes(value));
      }
    }
  }

  /** The `.po` header's `Language:` - `de`, `zh_CN`. */
  GetLanguage(): string {
    return this.m_language;
  }

  /**
   * `wxMsgCatalog::GetString( str, n, ctx )`: the translation, or `undefined`
   * when the catalog has none. `n` absent asks for the singular entry; for a
   * plural entry that is its form 0, as gettext's `gettext()` gives.
   */
  GetString(aStr: string, aN?: number, aContext?: string): string | undefined {
    const entry = this.m_messages.get(aContext ? aContext + CONTEXT_GLUE + aStr : aStr);
    if (entry === undefined) return undefined;
    if (typeof entry === 'string') return aN === undefined ? entry : undefined;
    const form = entry[aN === undefined ? 0 : this.m_pluralIndex(aN)];
    // A form the translator left empty is not a translation.
    return form === undefined || form === '' ? undefined : form;
  }
}

// ---- wxTranslations ----

type Listener = () => void;

/**
 * `wxTranslations`: the process's translations - here, the one catalog of the
 * language in use, or none for untranslated English.
 */
export class wxTranslations {
  private m_catalog: wxMsgCatalog | null = null;
  /** Bumped whenever the catalog changes; what the React binding reads. */
  private m_version = 0;
  private readonly m_listeners = new Set<Listener>();

  /** `wxTranslations::Get()`. */
  static Get(): wxTranslations {
    return s_translations;
  }

  /** The loaded catalog, or null (English). */
  GetCatalog(): wxMsgCatalog | null {
    return this.m_catalog;
  }

  /**
   * Install a catalog (`AddCatalog`), or `null` to return to untranslated
   * English. Everything subscribed is told, which is what
   * `EDA_BASE_FRAME::ShowChangedLanguage` does for KiCad's frames.
   */
  SetCatalog(aCatalog: wxMsgCatalog | null): void {
    if (aCatalog === this.m_catalog) return;
    this.m_catalog = aCatalog;
    this.m_version++;
    for (const fn of [...this.m_listeners]) fn();
  }

  GetVersion = (): number => this.m_version;

  Subscribe = (aFn: Listener): (() => void) => {
    this.m_listeners.add(aFn);
    return () => {
      this.m_listeners.delete(aFn);
    };
  };

  /** `wxTranslations::GetTranslatedString`: undefined when there is none. */
  GetTranslatedString(aStr: string, aN?: number, aContext?: string): string | undefined {
    return this.m_catalog?.GetString(aStr, aN, aContext);
  }
}

const s_translations = new wxTranslations();

/**
 * `wxGetTranslation( str, domain, context )`: the translation of `str` in the
 * current language, or `str` itself when there is none.
 */
export function wxGetTranslation(aStr: string, aContext?: string): string {
  return s_translations.GetTranslatedString(aStr, undefined, aContext) ?? aStr;
}

/**
 * `wxGetTranslation( str, strPlural, n, domain, context )`: the plural form
 * the current language uses for `n`. With no translation the choice is
 * English's own: the singular for exactly 1, the plural otherwise.
 */
export function wxGetTranslationPlural(
  aStr: string,
  aStrPlural: string,
  aN: number,
  aContext?: string,
): string {
  return s_translations.GetTranslatedString(aStr, aN, aContext) ?? (aN === 1 ? aStr : aStrPlural);
}

/** `#define _(s) wxGetTranslation((s))`. */
export const _ = wxGetTranslation;

/** `#define wxPLURAL(sing, plur, n) wxGetTranslation((sing), (plur), n)`. */
export const wxPLURAL = wxGetTranslationPlural;

/**
 * KiCad's `_HKI( x )` (`include/i18n_utility.h`): marks a string as
 * translatable *without* translating it there. KiCad uses it for text that is
 * stored untranslated and translated when shown - a `TOOL_ACTION`'s friendly
 * name and tooltip - and ours is the same: a table built once at module load
 * keeps English, and whatever draws it calls `_()` on the way out, so the row
 * follows a language change instead of freezing in the language it was built
 * in.
 */
export const _HKI = (aStr: string): string => aStr;
