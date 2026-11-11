// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The scanner behind the translation ratchet: the string literals in a source
 * file that are KiCad messages and are not marked for translation.
 *
 * "Is a KiCad message" is a fact, not a heuristic: the text is a msgid in the
 * compiled catalogs (`translation/*.json`), which are KiCad's own `.po` files.
 * A string ZiroEDA wrote itself is in no catalog and is never counted - there
 * is no translation for it to be missing.
 *
 * "Marked" means the literal is an argument of `_()`, `wxGetTranslation()`,
 * `wxPLURAL()` or `_HKI()` - translated on the spot, or declared translatable
 * and translated by whatever draws it. A literal that is only ever compared
 * against (`=== 'open'`, `case 'Default':`), used as a key, or part of an
 * import is not interface text and is skipped.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { wxStripMenuCodes } from '@ziroeda/wx/translation.js';

/** The calls that make a literal translated or translatable. */
export const TRANSLATION_CALLS: ReadonlySet<string> = new Set([
  '_',
  '_HKI',
  'wxGetTranslation',
  'wxGetTranslationPlural',
  'wxPLURAL',
]);

/**
 * Every msgid KiCad has a translation for in at least one language, plus the
 * mnemonic-free spelling of each (`&File` is also `File`, which is how our
 * menus write it). The union over all catalogs, because one language's file
 * holds only the entries that language has translated.
 */
export function loadMsgids(aTranslationDir: string): Set<string> {
  const ids = new Set<string>();
  for (const f of readdirSync(aTranslationDir)) {
    if (!f.endsWith('.json')) continue;
    const data = JSON.parse(readFileSync(join(aTranslationDir, f), 'utf8')) as {
      messages: Record<string, unknown>;
    };
    for (const key of Object.keys(data.messages)) {
      ids.add(key);
      if (key.includes('&')) ids.add(wxStripMenuCodes(key));
    }
  }
  return ids;
}

export interface UntranslatedLiteral {
  line: number;
  text: string;
}

/** True when `aNode` is (inside) an argument of one of {@link TRANSLATION_CALLS}. */
function isMarked(aNode: ts.Node): boolean {
  for (let n = aNode.parent; n; n = n.parent) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (TRANSLATION_CALLS.has(n.expression.text)) return true;
    }
    // A call's arguments are marked; a function body inside one is not.
    if (ts.isFunctionLike(n) || ts.isSourceFile(n)) return false;
  }
  return false;
}

/** True when the literal is a value being tested or a name, not text being shown. */
function isNotText(aNode: ts.Node): boolean {
  const p = aNode.parent;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p))
    return true;
  if (ts.isCaseClause(p) && p.expression === aNode) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === aNode) return true;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === aNode) return true;
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    return (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken
    );
  }
  return false;
}

/**
 * The unmarked KiCad messages in one source text, in file order.
 *
 * @param aIsMsgid whether a string is a KiCad message
 */
export function untranslatedLiterals(
  aFileName: string,
  aSource: string,
  aIsMsgid: (aText: string) => boolean,
): UntranslatedLiteral[] {
  const sf = ts.createSourceFile(
    aFileName,
    aSource,
    ts.ScriptTarget.Latest,
    true,
    aFileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: UntranslatedLiteral[] = [];
  const report = (aNode: ts.Node, aText: string): void => {
    if (!aIsMsgid(aText) || isNotText(aNode) || isMarked(aNode)) return;
    found.push({
      line: sf.getLineAndCharacterOfPosition(aNode.getStart(sf)).line + 1,
      text: aText,
    });
  };
  const visit = (aNode: ts.Node): void => {
    if (ts.isStringLiteral(aNode) || ts.isNoSubstitutionTemplateLiteral(aNode)) {
      report(aNode, aNode.text);
    } else if (ts.isTemplateExpression(aNode)) {
      // `Project: ${path}` is KiCad's `wxString::Format( _( "Project: %s" ), path )` with the
      // format already applied, so the catalog can no longer be asked for it.
      const format =
        aNode.head.text + aNode.templateSpans.map((span) => `%s${span.literal.text}`).join('');
      report(aNode, format);
    } else if (ts.isJsxText(aNode)) {
      // JSX collapses the whitespace around a text child; so does this.
      const text = aNode.text.replace(/\s+/g, ' ').trim();
      if (text !== '') report(aNode, text);
    }
    ts.forEachChild(aNode, visit);
  };
  visit(sf);
  return found;
}
